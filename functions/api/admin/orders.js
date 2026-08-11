// Управление заказами из админки.
//   GET /api/admin/orders?status=&limit=&offset=  — список заявок/заказов
//   PUT /api/admin/orders  { id, status }         — сменить статус
//
// Статусы: new (заявка) → confirmed (подтверждён) → done (выполнен, идёт в выручку)
//          cancelled (отменён). В выручку попадают только заказы со статусом 'done'.
import { getDB, ensureSchema, json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

const STATUSES = ["new", "confirmed", "done", "cancelled"];

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const url = new URL(request.url);
    const status = (url.searchParams.get("status") || "").trim();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    const where = STATUSES.includes(status) ? "WHERE status = ?" : "";
    const binds = STATUSES.includes(status) ? [status] : [];

    const totalRow = await db.prepare(`SELECT COUNT(*) AS c FROM orders ${where}`).bind(...binds).first();
    const { results } = await db
      .prepare(`SELECT id, name, phone, contact, comment, items, total, currency, status, created_at
                FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset).all();

    const orders = (results || []).map((o) => {
      let items = [];
      try { items = JSON.parse(o.items || "[]"); } catch {}
      return { ...o, items };
    });

    // Сводка по статусам (для вкладки)
    const sumRows = await db.prepare(
      "SELECT status, COUNT(*) c, COALESCE(SUM(total),0) s FROM orders GROUP BY status"
    ).all();
    const byStatus = {};
    for (const r of (sumRows.results || [])) byStatus[r.status] = { count: r.c, total: r.s };

    return json({ ok: true, total: totalRow ? totalRow.c : 0, orders, byStatus });
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
    if (!b.id) throw new HttpError(400, "Не указан id заказа.");
    if (!STATUSES.includes(b.status)) throw new HttpError(400, "Недопустимый статус.");

    await db.prepare("UPDATE orders SET status = ? WHERE id = ?").bind(b.status, b.id).run();
    const row = await db.prepare(
      "SELECT id, name, phone, contact, comment, items, total, currency, status, created_at FROM orders WHERE id = ?"
    ).bind(b.id).first();
    if (!row) throw new HttpError(404, "Заказ не найден.");
    let items = [];
    try { items = JSON.parse(row.items || "[]"); } catch {}
    return json({ ok: true, order: { ...row, items } });
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
    const id = url.searchParams.get("id");
    if (!id) throw new HttpError(400, "Не указан id.");
    await db.prepare("DELETE FROM orders WHERE id = ?").bind(id).run();
    return json({ ok: true, deleted: id });
  } catch (err) {
    return errorResponse(err);
  }
}
