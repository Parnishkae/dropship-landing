// Управление товарами из админки.
//   GET    /api/admin/products?q=&limit=&offset=   — список (включая скрытые)
//   PUT    /api/admin/products   { id, title?, price?, oldPrice?, available?, category? }
//   DELETE /api/admin/products?id=<id>   | ?all=1   — удалить один / все
import { getDB, ensureSchema, rowToProduct, json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    const where = q ? "WHERE title LIKE ? OR category LIKE ? OR vendor LIKE ?" : "";
    const binds = q ? [`%${q}%`, `%${q}%`, `%${q}%`] : [];

    const totalRow = await db.prepare(`SELECT COUNT(*) AS c FROM products ${where}`).bind(...binds).first();
    const { results } = await db
      .prepare(`SELECT * FROM products ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all();

    return json({
      ok: true,
      total: totalRow ? totalRow.c : 0,
      products: (results || []).map(rowToProduct),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPut({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const b = await request.json();
    if (!b.id) throw new HttpError(400, "Не указан id товара.");

    const fields = [];
    const binds = [];
    if (b.title !== undefined) { fields.push("title = ?"); binds.push(String(b.title)); }
    if (b.price !== undefined) { fields.push("price = ?"); binds.push(Number(b.price) || 0); }
    if (b.oldPrice !== undefined) { fields.push("old_price = ?"); binds.push(b.oldPrice === null ? null : Number(b.oldPrice)); }
    if (b.available !== undefined) { fields.push("available = ?"); binds.push(b.available ? 1 : 0); }
    if (b.category !== undefined) { fields.push("category = ?"); binds.push(b.category || null); }
    if (!fields.length) throw new HttpError(400, "Нет полей для обновления.");
    fields.push("updated_at = ?"); binds.push(Date.now());

    await db.prepare(`UPDATE products SET ${fields.join(", ")} WHERE id = ?`).bind(...binds, b.id).run();
    const row = await db.prepare("SELECT * FROM products WHERE id = ?").bind(b.id).first();
    return json({ ok: true, product: rowToProduct(row) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const url = new URL(request.url);
    if (url.searchParams.get("all") === "1") {
      await db.prepare("DELETE FROM products").run();
      await db.prepare("DELETE FROM categories").run();
      return json({ ok: true, cleared: true });
    }
    const id = url.searchParams.get("id");
    if (!id) throw new HttpError(400, "Не указан id.");
    await db.prepare("DELETE FROM products WHERE id = ?").bind(id).run();
    return json({ ok: true, deleted: id });
  } catch (err) {
    return errorResponse(err);
  }
}
