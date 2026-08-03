// GET /api/admin/ai?days=30 — ИИ-аналитика магазина (Claude API), с эвристическим запасным вариантом.
import { getDB, ensureSchema, json, errorResponse } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

async function gatherSummary(db, days) {
  const since = Date.now() - days * 86400000;
  const products = (await db.prepare("SELECT COUNT(*) c FROM products").first())?.c || 0;
  const available = (await db.prepare("SELECT COUNT(*) c FROM products WHERE available=1").first())?.c || 0;
  const ord = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE created_at >= ?").bind(since).first();
  const ev = await db.prepare("SELECT type, COUNT(*) c FROM events WHERE ts >= ? GROUP BY type").bind(since).all();
  const evMap = {};
  for (const r of (ev.results || [])) evMap[r.type] = r.c;

  const topViewed = await db.prepare(
    `SELECT p.title, COUNT(*) views FROM events e JOIN products p ON p.id = e.product_id
     WHERE e.type='product_view' AND e.ts >= ? GROUP BY e.product_id ORDER BY views DESC LIMIT 5`
  ).bind(since).all();

  const topCats = await db.prepare(
    `SELECT category, COUNT(*) c FROM products WHERE category IS NOT NULL AND category != ''
     GROUP BY category ORDER BY c DESC LIMIT 5`
  ).all();

  const noImages = (await db.prepare("SELECT COUNT(*) c FROM products WHERE image IS NULL OR image=''").first())?.c || 0;
  const noPrice = (await db.prepare("SELECT COUNT(*) c FROM products WHERE price IS NULL OR price=0").first())?.c || 0;

  return {
    days,
    products, available, unavailable: products - available,
    productsWithoutImage: noImages,
    productsWithoutPrice: noPrice,
    orders: ord?.c || 0,
    revenue: ord?.s || 0,
    pageviews: evMap.pageview || 0,
    productViews: evMap.product_view || 0,
    addToCart: evMap.add_to_cart || 0,
    searches: evMap.search || 0,
    topViewed: (topViewed.results || []).map((r) => ({ title: r.title, views: r.views })),
    topCategories: (topCats.results || []).map((r) => ({ category: r.category, count: r.c })),
  };
}

function heuristic(s) {
  const tips = [];
  const cr = s.productViews ? (s.orders / s.productViews * 100) : 0;
  const cartRate = s.productViews ? (s.addToCart / s.productViews * 100) : 0;

  if (s.products === 0) tips.push("В каталоге нет товаров — загрузите XML-фид в разделе «Импорт», чтобы витрина ожила.");
  if (s.productsWithoutImage > 0) tips.push(`У ${s.productsWithoutImage} товаров нет изображения. Карточки без фото почти не покупают — добавьте картинки в фиде.`);
  if (s.productsWithoutPrice > 0) tips.push(`У ${s.productsWithoutPrice} товаров не указана цена. Проверьте теги <price> в XML.`);
  if (s.unavailable > s.available && s.products > 0) tips.push("Больше половины каталога помечено как «нет в наличии» — обновите фид, чтобы не терять трафик.");
  if (s.pageviews > 30 && s.productViews / Math.max(s.pageviews, 1) < 0.3) tips.push("Посетители заходят, но редко открывают карточки товара. Поработайте над превью на главной: фото, цена, короткое название.");
  if (s.addToCart > 5 && cr < 20) tips.push(`Конверсия из корзины в заказ ${cr.toFixed(1)}% — низкая. Упростите оформление и добавьте быстрый контакт (Telegram) прямо в корзине.`);
  if (s.searches > s.productViews && s.searches > 10) tips.push("Много поиска, мало просмотров — вероятно, люди не находят нужное. Проверьте названия и категории товаров.");
  if (s.topViewed.length) tips.push(`Хит просмотров: «${s.topViewed[0].title}». Продвигайте его в Telegram и вынесите на главную.`);
  if (!tips.length) tips.push("Данных пока мало для выводов. Дайте магазину поработать несколько дней и заходите за аналитикой снова.");

  return {
    headline: `За ${s.days} дн.: ${s.productViews} просмотров товаров, ${s.orders} заказов, выручка ${s.revenue} грн.`,
    metrics: {
      "Конверсия в корзину": `${cartRate.toFixed(1)}%`,
      "Конверсия в заказ": `${cr.toFixed(1)}%`,
      "Товаров в каталоге": `${s.available} / ${s.products}`,
    },
    recommendations: tips,
  };
}

async function askClaude(env, s) {
  const model = env.AI_MODEL || "claude-opus-5";
  const prompt =
`Ты — аналитик дропшип-магазина. На основе метрик за ${s.days} дней дай краткий разбор на русском языке для владельца (не технический).
Метрики (JSON):
${JSON.stringify(s, null, 2)}

Верни СТРОГО JSON без markdown-обёртки, по схеме:
{"headline": "одно предложение с ключевым итогом за период",
 "metrics": {"Метрика": "значение", ...},   // 3-4 важные метрики словами
 "recommendations": ["конкретный совет 1", "совет 2", ...]}  // 4-6 практичных советов: что улучшить в каталоге, ценах, фото, категориях, продвижении в Telegram и конверсии.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error("AI upstream " + res.status);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const jsonText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(jsonText);
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);

    const url = new URL(request.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
    const summary = await gatherSummary(db, days);

    let analysis, source;
    if (env.ANTHROPIC_API_KEY) {
      try { analysis = await askClaude(env, summary); source = "ai"; }
      catch (_) { analysis = heuristic(summary); source = "heuristic-fallback"; }
    } else {
      analysis = heuristic(summary);
      source = "heuristic";
    }

    return json({ ok: true, source, summary, analysis });
  } catch (err) {
    return errorResponse(err);
  }
}
