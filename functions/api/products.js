// GET /api/products — публичный каталог с фильтрами, поиском и пагинацией.
import { getDB, ensureSchema, rowToProduct, json, errorResponse } from "../_lib/db.js";

export async function onRequestGet({ request, env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const category = (url.searchParams.get("category") || "").trim();
    const sort = url.searchParams.get("sort") || "new";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    const where = [];
    const binds = [];
    if (q) {
      where.push("(title LIKE ? OR description LIKE ? OR vendor LIKE ? OR category LIKE ?)");
      const like = `%${q}%`;
      binds.push(like, like, like, like);
    }
    if (category) { where.push("category = ?"); binds.push(category); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const orderSql = {
      new: "featured DESC, updated_at DESC",
      price_asc: "price ASC",
      price_desc: "price DESC",
      title: "title ASC",
    }[sort] || "featured DESC, updated_at DESC";

    const countRow = await db
      .prepare(`SELECT COUNT(*) AS c FROM products ${whereSql}`)
      .bind(...binds).first();
    const total = countRow ? countRow.c : 0;

    const { results } = await db
      .prepare(`SELECT * FROM products ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all();

    const cats = await db
      .prepare(`SELECT category AS name, COUNT(*) AS count FROM products
                WHERE category IS NOT NULL AND category != ''
                GROUP BY category ORDER BY count DESC`)
      .all();

    return json({
      ok: true,
      total,
      limit,
      offset,
      products: (results || []).map(rowToProduct),
      categories: cats.results || [],
    });
  } catch (err) {
    return errorResponse(err);
  }
}
