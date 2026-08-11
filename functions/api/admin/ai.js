// GET /api/admin/ai?days=30 — ИИ-аналитика магазина (бесплатный ИИ), с эвристическим запасным вариантом.
import { getDB, ensureSchema, json, errorResponse } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import { aiComplete, aiProvider, extractJSON, DROPSHIP_SYSTEM } from "../../_lib/ai.js";

async function gatherSummary(db, days) {
  const since = Date.now() - days * 86400000;
  const products = (await db.prepare("SELECT COUNT(*) c FROM products").first())?.c || 0;
  const available = (await db.prepare("SELECT COUNT(*) c FROM products WHERE available=1").first())?.c || 0;
  const leads = await db.prepare("SELECT COUNT(*) c FROM orders WHERE created_at >= ?").bind(since).first();
  const done = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status='done' AND created_at >= ?").bind(since).first();
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
    leads: leads?.c || 0,
    orders: done?.c || 0,
    revenue: done?.s || 0,
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
  const cr = s.productViews ? (s.leads / s.productViews * 100) : 0;
  const cartRate = s.productViews ? (s.addToCart / s.productViews * 100) : 0;
  const doneRate = s.leads ? (s.orders / s.leads * 100) : 0;

  if (s.products === 0) tips.push("В каталоге нет товаров — загрузите XML-фид в разделе «Импорт», чтобы витрина ожила.");
  if (s.productsWithoutImage > 0) tips.push(`У ${s.productsWithoutImage} товаров нет изображения. Карточки без фото почти не покупают — добавьте картинки в фиде.`);
  if (s.productsWithoutPrice > 0) tips.push(`У ${s.productsWithoutPrice} товаров не указана цена. Проверьте теги <price> в XML.`);
  if (s.unavailable > s.available && s.products > 0) tips.push("Больше половины каталога помечено как «нет в наличии» — обновите фид, чтобы не терять трафик.");
  if (s.pageviews > 30 && s.productViews / Math.max(s.pageviews, 1) < 0.3) tips.push("Посетители заходят, но редко открывают карточки товара. Поработайте над превью на главной: фото, цена, короткое название.");
  if (s.addToCart > 5 && cr < 20) tips.push(`Конверсия из корзины в заявку ${cr.toFixed(1)}% — низкая. Упростите оформление и добавьте быстрый контакт (Telegram) прямо в корзине.`);
  if (s.leads > 3 && doneRate < 50) tips.push(`Из ${s.leads} заявок выкуплено только ${s.orders} (${doneRate.toFixed(0)}%). Быстрее связывайтесь с клиентом после заявки и подтверждайте заказ — так меньше «отвалов».`);
  if (s.searches > s.productViews && s.searches > 10) tips.push("Много поиска, мало просмотров — вероятно, люди не находят нужное. Проверьте названия и категории товаров.");
  if (s.topViewed.length) tips.push(`Хит просмотров: «${s.topViewed[0].title}». Продвигайте его в Telegram и вынесите на главную.`);
  if (!tips.length) tips.push("Данных пока мало для выводов. Дайте магазину поработать несколько дней и заходите за аналитикой снова.");

  return {
    headline: `За ${s.days} дн.: ${s.productViews} просмотров, ${s.leads} заявок, ${s.orders} выкуплено, выручка ${s.revenue} грн.`,
    metrics: {
      "Конверсия в корзину": `${cartRate.toFixed(1)}%`,
      "Конверсия в заявку": `${cr.toFixed(1)}%`,
      "Выкуп заявок": `${doneRate.toFixed(1)}%`,
      "Товаров в каталоге": `${s.available} / ${s.products}`,
    },
    recommendations: tips,
  };
}

async function askAI(env, s) {
  const user =
`Проанализируй мой дропшип-магазин за ${s.days} дней и дай разбор для владельца (не технаря).
Данные магазина (JSON):
${JSON.stringify(s, null, 2)}

Верни СТРОГО валидный JSON без markdown по схеме:
{"headline": "одно предложение с ключевым итогом за период",
 "metrics": {"Название метрики": "значение", ...},
 "recommendations": ["конкретный совет 1", "совет 2", ...]}
В recommendations дай 4-6 практичных советов именно по дропшипингу: какие товары/категории продвигать, что не так с ценами и наценкой, фото и карточками, как поднять конверсию и что постить в Telegram.`;

  const text = await aiComplete(env, { system: DROPSHIP_SYSTEM, user, maxTokens: 1200 });
  return extractJSON(text);
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
    if (aiProvider(env)) {
      try { analysis = await askAI(env, summary); source = "ai"; }
      catch (_) { analysis = heuristic(summary); source = "heuristic-fallback"; }
    } else {
      analysis = heuristic(summary);
      source = "heuristic";
    }

    return json({ ok: true, source, provider: aiProvider(env), summary, analysis });
  } catch (err) {
    return errorResponse(err);
  }
}
