// POST /api/admin/login   { password }  -> ставит куку сессии
// GET  /api/admin/login   -> проверка текущей сессии
import { json, errorResponse } from "../../_lib/db.js";
import { checkPassword, createSessionCookie, requireAuth } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    const { password } = await request.json().catch(() => ({}));
    if (!checkPassword(env, password)) {
      return json({ ok: false, error: "Неверный пароль." }, 401);
    }
    const cookie = await createSessionCookie(env);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    return json({ ok: true, authed: true });
  } catch {
    return json({ ok: true, authed: false });
  }
}
