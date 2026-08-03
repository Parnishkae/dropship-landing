// POST /api/track — лёгкий сбор событий для статистики (просмотры, добавления в корзину, поиск).
import { getDB, ensureSchema, json, errorResponse } from "../_lib/db.js";

const ALLOWED = new Set(["pageview", "product_view", "add_to_cart", "search"]);

export async function onRequestPost({ request, env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);

    const data = await request.json().catch(() => ({}));
    const type = ALLOWED.has(data.type) ? data.type : null;
    if (!type) return json({ ok: true }); // молча игнорируем неизвестные типы

    const productId = data.productId ? String(data.productId).slice(0, 128) : null;
    const meta = data.meta ? JSON.stringify(data.meta).slice(0, 1024) : null;

    await db.prepare(`INSERT INTO events (type, product_id, meta, ts) VALUES (?, ?, ?, ?)`)
      .bind(type, productId, meta, Date.now()).run();

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
