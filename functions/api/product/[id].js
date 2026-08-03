// GET /api/product/:id — карточка одного товара (+ похожие из той же категории).
import { getDB, ensureSchema, rowToProduct, json, errorResponse, HttpError } from "../../_lib/db.js";

export async function onRequestGet({ params, env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);

    const id = params.id;
    const row = await db.prepare("SELECT * FROM products WHERE id = ?").bind(id).first();
    if (!row) throw new HttpError(404, "Товар не найден.");

    const product = rowToProduct(row);

    let related = [];
    if (product.category) {
      const { results } = await db
        .prepare(`SELECT * FROM products WHERE category = ? AND id != ? ORDER BY updated_at DESC LIMIT 4`)
        .bind(product.category, id).all();
      related = (results || []).map(rowToProduct);
    }

    return json({ ok: true, product, related });
  } catch (err) {
    return errorResponse(err);
  }
}
