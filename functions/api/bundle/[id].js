// GET /api/bundle/:id — один активный набор.
import { getDB, ensureSchema, rowToBundle, json, errorResponse, HttpError } from "../../_lib/db.js";

export async function onRequestGet({ params, env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);
    const row = await db.prepare("SELECT * FROM bundles WHERE id = ?").bind(params.id).first();
    if (!row) throw new HttpError(404, "Набор не найден.");
    return json({ ok: true, bundle: rowToBundle(row) });
  } catch (err) {
    return errorResponse(err);
  }
}
