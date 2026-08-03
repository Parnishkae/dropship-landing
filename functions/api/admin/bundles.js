// Управление наборами из админки.
//   GET    /api/admin/bundles            — все наборы
//   POST   /api/admin/bundles            — создать/обновить (если задан id)
//   DELETE /api/admin/bundles?id=<id>    — удалить
import { getDB, ensureSchema, rowToBundle, json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const { results } = await db.prepare("SELECT * FROM bundles ORDER BY updated_at DESC").all();
    return json({ ok: true, bundles: (results || []).map(rowToBundle) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const b = await request.json();

    const title = (b.title || "").toString().trim();
    const items = Array.isArray(b.items) ? b.items
      .filter((i) => i && i.id && i.title)
      .map((i) => ({ id: String(i.id), title: String(i.title).slice(0, 300), price: Number(i.price) || 0, image: i.image || null }))
      : [];
    if (!title) throw new HttpError(400, "Укажите название набора.");
    if (items.length < 2) throw new HttpError(400, "Добавьте минимум 2 товара-варианта.");

    const pickCount = Math.min(Math.max(parseInt(b.pickCount, 10) || 3, 1), items.length);
    const priceMode = ["fixed", "sum", "discount"].includes(b.priceMode) ? b.priceMode : "fixed";
    const now = Date.now();
    const id = b.id ? String(b.id) : "bnd_" + now.toString(36) + Math.random().toString(36).slice(2, 6);

    const row = {
      id, title,
      description: (b.description || "").toString().slice(0, 2000),
      image: b.image || items[0].image || null,
      pick_count: pickCount,
      price_mode: priceMode,
      fixed_price: Number(b.fixedPrice) || 0,
      discount: Math.min(Math.max(Number(b.discount) || 0, 0), 95),
      currency: (b.currency || "грн").toString().slice(0, 8),
      items: JSON.stringify(items),
      active: b.active === false ? 0 : 1,
      updated_at: now,
    };

    await db.prepare(
      `INSERT INTO bundles (id, title, description, image, pick_count, price_mode, fixed_price, discount, currency, items, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, description=excluded.description, image=excluded.image,
         pick_count=excluded.pick_count, price_mode=excluded.price_mode, fixed_price=excluded.fixed_price,
         discount=excluded.discount, currency=excluded.currency, items=excluded.items,
         active=excluded.active, updated_at=excluded.updated_at`
    ).bind(row.id, row.title, row.description, row.image, row.pick_count, row.price_mode, row.fixed_price,
           row.discount, row.currency, row.items, row.active, now, now).run();

    const saved = await db.prepare("SELECT * FROM bundles WHERE id = ?").bind(id).first();
    return json({ ok: true, bundle: rowToBundle(saved) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new HttpError(400, "Не указан id.");
    await db.prepare("DELETE FROM bundles WHERE id = ?").bind(id).run();
    return json({ ok: true, deleted: id });
  } catch (err) {
    return errorResponse(err);
  }
}
