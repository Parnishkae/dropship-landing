// GET /api/admin/stats?days=30 — агрегированная статистика для дашборда.
import { getDB, ensureSchema, json, errorResponse } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);

    const url = new URL(request.url);
    const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 365);
    const since = Date.now() - days * 86400000;

    const totals = {};
    totals.products = (await db.prepare("SELECT COUNT(*) c FROM products").first())?.c || 0;
    totals.available = (await db.prepare("SELECT COUNT(*) c FROM products WHERE available=1").first())?.c || 0;
    totals.categories = (await db.prepare("SELECT COUNT(DISTINCT category) c FROM products WHERE category IS NOT NULL AND category != ''").first())?.c || 0;

    // Выручка = только ВЫПОЛНЕННЫЕ заказы (status='done'). Заявки — отдельно.
    const leadsAll = (await db.prepare("SELECT COUNT(*) c FROM orders").first())?.c || 0;
    const doneAll = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status='done'").first();
    totals.leadsAll = leadsAll;
    totals.doneAll = doneAll?.c || 0;
    totals.revenueAll = doneAll?.s || 0;

    const leadsP = (await db.prepare("SELECT COUNT(*) c FROM orders WHERE created_at >= ?").bind(since).first())?.c || 0;
    const doneP = await db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE status='done' AND created_at >= ?").bind(since).first();
    const pipeP = (await db.prepare("SELECT COALESCE(SUM(total),0) s FROM orders WHERE status IN ('new','confirmed') AND created_at >= ?").bind(since).first())?.s || 0;
    const leadsPeriod = leadsP;
    const donePeriod = doneP?.c || 0;
    const revenuePeriod = doneP?.s || 0;
    const pipelinePeriod = pipeP;

    // Счётчики событий за период
    const evRows = await db.prepare(
      "SELECT type, COUNT(*) c FROM events WHERE ts >= ? GROUP BY type"
    ).bind(since).all();
    const ev = {};
    for (const r of (evRows.results || [])) ev[r.type] = r.c;
    const pageviews = ev.pageview || 0;
    const productViews = ev.product_view || 0;
    const addToCart = ev.add_to_cart || 0;

    // Воронка конверсии. leads = заявки (все заказы), completed = выполненные.
    const conversion = {
      productViews,
      addToCart,
      leads: leadsPeriod,
      completed: donePeriod,
      viewToCart: productViews ? +(addToCart / productViews * 100).toFixed(1) : 0,
      cartToLead: addToCart ? +(leadsPeriod / addToCart * 100).toFixed(1) : 0,
      viewToLead: productViews ? +(leadsPeriod / productViews * 100).toFixed(1) : 0,
      leadToDone: leadsPeriod ? +(donePeriod / leadsPeriod * 100).toFixed(1) : 0,
    };

    // Дневной ряд (события + заказы)
    const evSeries = await db.prepare(
      `SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch') d,
              SUM(CASE WHEN type='pageview' THEN 1 ELSE 0 END) views,
              SUM(CASE WHEN type='product_view' THEN 1 ELSE 0 END) pviews,
              SUM(CASE WHEN type='add_to_cart' THEN 1 ELSE 0 END) carts
       FROM events WHERE ts >= ? GROUP BY d`
    ).bind(since).all();
    const ordSeries = await db.prepare(
      `SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d,
              COUNT(*) orders, COALESCE(SUM(total),0) revenue
       FROM orders WHERE created_at >= ? GROUP BY d`
    ).bind(since).all();

    const seriesMap = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      seriesMap[d] = { date: d, views: 0, pviews: 0, carts: 0, orders: 0, revenue: 0 };
    }
    for (const r of (evSeries.results || [])) if (seriesMap[r.d]) Object.assign(seriesMap[r.d], { views: r.views, pviews: r.pviews, carts: r.carts });
    for (const r of (ordSeries.results || [])) if (seriesMap[r.d]) Object.assign(seriesMap[r.d], { orders: r.orders, revenue: r.revenue });
    const series = Object.values(seriesMap);

    // Топ просматриваемых товаров
    const topViewed = await db.prepare(
      `SELECT e.product_id id, COUNT(*) views, p.title, p.image, p.price, p.currency
       FROM events e LEFT JOIN products p ON p.id = e.product_id
       WHERE e.type='product_view' AND e.ts >= ? AND e.product_id IS NOT NULL
       GROUP BY e.product_id ORDER BY views DESC LIMIT 8`
    ).bind(since).all();

    // Последние заказы
    const recent = await db.prepare(
      "SELECT id, name, phone, contact, items, total, currency, status, created_at FROM orders ORDER BY created_at DESC LIMIT 10"
    ).all();
    const recentOrders = (recent.results || []).map((o) => {
      let items = [];
      try { items = JSON.parse(o.items || "[]"); } catch {}
      return { ...o, items };
    });

    return json({
      ok: true,
      days,
      totals: { ...totals, leadsPeriod, donePeriod, revenuePeriod, pipelinePeriod, pageviews, productViews, addToCart },
      conversion,
      series,
      topViewed: topViewed.results || [],
      recentOrders,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
