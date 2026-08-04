// Идеи трендовых товаров ИЗВНЕ (не из каталога).
//   POST /api/admin/trend-ideas — ИИ анализирует тренды и подкидывает идеи новых товаров.
//   Тело: { niche?, geo?, notify? }.  Доступ: сессия админа ИЛИ X-Cron-Secret.
// Источники трендов:
//   1) Gemini + Google Search (реальный поиск в интернете) — если задан GEMINI_API_KEY;
//   2) Google Trends (живые запросы по стране) — как доп. сигнал, без ключа.
import { json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { aiComplete, aiProvider, geminiGrounded, extractJSON, DROPSHIP_SYSTEM } from "../../_lib/ai.js";

function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

async function authorize(request, env) {
  const secret = request.headers.get("X-Cron-Secret");
  if (env.CRON_SECRET && secret && secret === env.CRON_SECRET) return;
  await requireAuth(request, env);
}

// Живые трендовые запросы Google Trends (неофициальный публичный эндпоинт).
async function fetchGoogleTrends(geo) {
  try {
    const url = `https://trends.google.com/trends/api/dailytrends?hl=ru&tz=-120&geo=${encodeURIComponent(geo)}`;
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "ru,en" } });
    if (!r.ok) return [];
    let txt = await r.text();
    txt = txt.replace(/^\)\]\}'?,?\s*/, ""); // Google префиксует ответ мусором
    const data = JSON.parse(txt);
    const days = data?.default?.trendingSearchesDays || [];
    const out = [];
    for (const d of days) for (const t of (d.trendingSearches || [])) {
      const q = t?.title?.query; if (q) out.push(q);
    }
    return out.slice(0, 25);
  } catch { return []; }
}

async function sendTelegram(env, text) {
  if (!env.BOT_TOKEN || !env.CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    return r.ok;
  } catch { return false; }
}

function buildPrompt(niche, geo, terms, markup) {
  return `Подскажи владельцу дропшип-магазина 5 ТРЕНДОВЫХ ТОВАРОВ, которые сейчас стоит завезти (не новости, а именно товары для продажи).
${niche ? "Ниша/фокус: " + niche + "\n" : ""}Страна продаж: ${geo}. Наценка магазина: ×${markup}.
Учитывай текущие тренды соцсетей (TikTok, Instagram, Reels), сезонность и реальный спрос${terms.length ? `. Живые трендовые запросы для контекста: ${terms.slice(0, 15).join(", ")}` : ""}.
Для каждого товара верни поля: name (товар), why (почему в тренде сейчас, 1-2 предложения), audience (кому продавать), buy (примерная закупка, число), sell (розница = закупка×${markup}, число), angle (маркетинговый оффер одной фразой), supplier (где искать поставщика).
Ответ — СТРОГО валидный JSON без markdown: {"ideas":[{"name","why","audience","buy","sell","angle","supplier"}], "note":"1 фраза про источники/тренды"}.`;
}

function parseIdeas(text) {
  try {
    const obj = extractJSON(text);
    if (Array.isArray(obj)) return { ideas: obj, note: "" };
    return { ideas: Array.isArray(obj.ideas) ? obj.ideas : [], note: obj.note || "" };
  } catch {
    return { ideas: [], note: "", raw: String(text || "").slice(0, 1500) };
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await authorize(request, env);
    const body = await request.json().catch(() => ({}));
    const niche = (body.niche || "").toString().slice(0, 120).trim();
    const geo = (body.geo || "UA").toString().slice(0, 5).toUpperCase();
    const notify = body.notify === true || body.notify === "1";
    const markup = Math.max(1, parseFloat(env.MARKUP) || 3);

    if (!aiProvider(env)) throw new HttpError(503, "ИИ не подключён (нет binding AI и GEMINI_API_KEY).");

    const terms = await fetchGoogleTrends(geo);
    const user = buildPrompt(niche, geo, terms, markup);

    let parsed, sources = [], mode;
    if (env.GEMINI_API_KEY) {
      const { text, sources: srcs } = await geminiGrounded(env, { system: DROPSHIP_SYSTEM, user, maxTokens: 2200 });
      parsed = parseIdeas(text); sources = srcs; mode = "gemini-search";
    } else {
      // Workers AI не ходит в интернет — идеи на основе знаний модели + живых Google Trends запросов.
      const text = await aiComplete(env, { system: DROPSHIP_SYSTEM, user, maxTokens: 1500 });
      parsed = parseIdeas(text); mode = "workers-ai";
    }

    let telegramSent = false;
    if (notify && parsed.ideas.length) {
      const lines = parsed.ideas.slice(0, 5).map((i, n) =>
        `${n + 1}. <b>${esc(i.name)}</b>\n   💡 ${esc(i.why)}\n   💵 закуп ~${esc(i.buy)} → розница <b>${esc(i.sell)}</b> (×${markup})\n   🎯 ${esc(i.angle)}\n   🛒 ${esc(i.supplier)}`);
      const src = sources.slice(0, 3).map((s) => s.uri).join("\n");
      const msg = `💡 <b>Идеи трендовых товаров</b> (${esc(geo)}${niche ? ", " + esc(niche) : ""})\n\n` +
        lines.join("\n\n") + (parsed.note ? `\n\nℹ️ ${esc(parsed.note)}` : "") + (src ? `\n\n🔗 Источники:\n${src}` : "");
      telegramSent = await sendTelegram(env, msg);
    }

    return json({
      ok: true, mode, geo, niche: niche || null,
      grounded: mode === "gemini-search",
      trends: terms.slice(0, 10),
      ideas: parsed.ideas, note: parsed.note || "", raw: parsed.raw || null,
      sources, telegramSent,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
