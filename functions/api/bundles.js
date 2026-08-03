// GET /api/bundles — публичный список активных наборов.
import { getDB, ensureSchema, rowToBundle, json, errorResponse } from "../_lib/db.js";

export async function onRequestGet({ env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);
    const { results } = await db
      .prepare("SELECT * FROM bundles WHERE active = 1 ORDER BY updated_at DESC")
      .all();
    return json({ ok: true, bundles: (results || []).map(rowToBundle) });
  } catch (err) {
    return errorResponse(err);
  }
}
