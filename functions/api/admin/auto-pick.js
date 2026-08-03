// Авто-подбор товара ИИ.
//   POST /api/admin/auto-pick  — подобрать лучший товар, поставить наценку ×MARKUP,
//        сделать «ХИТ» и прислать отчёт в Telegram. Доступ: сессия админа ИЛИ
//        заголовок  X-Cron-Secret: <CRON_SECRET>  (для запуска по расписанию).
//   GET  /api/admin/auto-pick  — история подборов (только для админа).
import { getDB, ensureSchema, rowToProduct, json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { aiComplete, aiProvider, extractJSON, DROPSHIP_SYSTEM } from "../../_lib/ai.js";

function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

async function authorize(request, env) {
  const secret = request.headers.get("X-Cron-Secret");
  if (env.CRON_SECRET && secret && secret === env.CRON_SECRET) return; // запуск по расписанию
  await requireAuth(request, env); // иначе — обычная сессия админа
}

// Кандидаты: доступные и ещё не сделанные «ХИТом», с числом просмотров.
async function loadCandidates(db, since) {
  const { results } = await db.prepare(
    `SELECT p.*, COALESCE(v.views,0) AS views
     FROM products p
     LEFT JOIN (SELECT product_id, COUNT(*) views FROM events
                WHERE type='product_view' AND ts >= ? GROUP BY product_id) v
       ON v.product_id = p.id
     WHERE p.available = 1 AND COALESCE(p.featured,0) = 0
     ORDER BY views DESC, p.updated_at DESC
     LIMIT 40`
  ).bind(since).all();
  return results || [];
}

async function askPick(env, candidates) {
  const list = candidates.map((c, i) => ({
    id: c.id,
    n: i + 1,
    title: c.title,
    category: c.category || "—",
    base_price: c.cost != null ? c.cost : c.price,
    views: c.views,
  }));
  const user =
`Вот товары моего дропшип-магазина (JSON). base_price — закупочная цена, views — просмотры за период.
${JSON.stringify(list)}

Выбери ОДИН товар, который сейчас лучше всего "зайдёт" на продажу (вау-эффект, импульсная покупка, спрос, маржа, лёгкая доставка). Ориентируйся на здравый смысл дропшипинга и на просмотры.
Верни СТРОГО валидный JSON без markdown:
{"id": "<id выбранного товара из списка>",
 "reason": "1-2 предложения: почему именно он зайдёт",
 "angle": "маркетинговый угол/оффер одной фразой",
 "tg_post": "готовый короткий пост для Telegram-канала с эмодзи и призывом купить"}`;

  const text = await aiComplete(env, { system: DROPSHIP_SYSTEM, user, maxTokens: 700 });
  return extractJSON(text);
}

async function sendTelegram(env, text) {
  if (!env.BOT_TOKEN || !env.CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: false }),
    });
    return r.ok;
  } catch { return false; }
}

export async function onRequestPost({ request, env }) {
  try {
    await authorize(request, env);
    const db = getDB(env);
    await ensureSchema(db);

    const markup = Math.max(1, num(env.MARKUP) || 3);
    const since = Date.now() - 30 * 86400000;
    const candidates = await loadCandidates(db, since);
    if (!candidates.length) {
      return json({ ok: false, error: "Нет подходящих товаров. Загрузите фид или снимите отметку «ХИТ» с части товаров." }, 400);
    }

    // Выбор ИИ (с эвристическим запасным вариантом).
    let choiceRow, reason, angle, tgPost, source;
    if (aiProvider(env)) {
      try {
        const pick = await askPick(env, candidates);
        choiceRow = candidates.find((c) => String(c.id) === String(pick.id));
        reason = pick.reason || "";
        angle = pick.angle || "";
        tgPost = pick.tg_post || "";
        source = "ai";
      } catch (_) { source = "heuristic-fallback"; }
    } else {
      source = "heuristic";
    }
    if (!choiceRow) {
      choiceRow = candidates[0]; // самый просматриваемый
      reason = reason || "Лидер по просмотрам среди доступных товаров — на нём уже есть спрос.";
      angle = angle || "Хит продаж — забирай, пока в наличии";
      source = source && source !== "ai" ? source : "heuristic-fallback";
    }

    const cost = choiceRow.cost != null ? choiceRow.cost : (choiceRow.price || 0);
    const retail = Math.round(cost * markup);
    const now = Date.now();

    await db.prepare(
      "UPDATE products SET cost = ?, price = ?, featured = 1, available = 1, updated_at = ? WHERE id = ?"
    ).bind(cost, retail, now, choiceRow.id).run();

    await db.prepare(
      "INSERT INTO ai_picks (product_id, title, cost, retail, markup, reason, angle, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(choiceRow.id, choiceRow.title, cost, retail, markup, reason, angle, now).run();

    // Отчёт в Telegram
    const origin = new URL(request.url).origin;
    const link = `${origin}/product.html?id=${encodeURIComponent(choiceRow.id)}`;
    const profit = retail - cost;
    const msg =
      `🤖 <b>ИИ подобрал товар и внедрил его на сайт</b>\n\n` +
      `🔥 <b>${esc(choiceRow.title)}</b>\n` +
      (choiceRow.category ? `📂 ${esc(choiceRow.category)}\n` : "") +
      `\n💵 Закупка: <b>${cost}</b>\n` +
      `🏷 Наценка: <b>×${markup}</b>\n` +
      `💰 Цена на сайте: <b>${retail} ${esc(choiceRow.currency || "грн")}</b>\n` +
      `📈 Прибыль с продажи: <b>${profit}</b>\n` +
      `\n🧠 Почему зайдёт: ${esc(reason)}\n` +
      (angle ? `🎯 Оффер: ${esc(angle)}\n` : "") +
      `\n✅ Что сделано: товар помечен как «ХИТ», выставлена цена с наценкой ×${markup}, показан на витрине.\n` +
      `🔗 ${link}` +
      (tgPost ? `\n\n— — —\n📢 Готовый пост:\n${esc(tgPost)}` : "");

    const tgSent = await sendTelegram(env, msg);

    return json({
      ok: true, source, telegramSent: tgSent,
      pick: { ...rowToProduct(choiceRow), cost, price: retail, featured: true, reason, angle, tgPost, markup, profit, link },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const { results } = await db.prepare("SELECT * FROM ai_picks ORDER BY ts DESC LIMIT 30").all();
    return json({ ok: true, provider: aiProvider(env), picks: results || [] });
  } catch (err) {
    return errorResponse(err);
  }
}
