// Подключение Telegram-бота одной кнопкой из админки.
//   POST /api/admin/tg-setup — установить вебхук на этот сайт
//   GET  /api/admin/tg-setup — статус вебхука
import { json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  try {
    await requireAuth(request, env);
    if (!env.BOT_TOKEN) throw new HttpError(503, "Не задан BOT_TOKEN.");
    const origin = new URL(request.url).origin;
    const url = `${origin}/api/tg/webhook`;
    const body = { url, allowed_updates: ["message", "callback_query"], drop_pending_updates: true };
    if (env.TG_WEBHOOK_SECRET) body.secret_token = env.TG_WEBHOOK_SECRET;

    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!data.ok) throw new HttpError(502, "Telegram: " + (data.description || "ошибка setWebhook"));
    return json({ ok: true, webhook: url, result: data.description || "Webhook set" });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    await requireAuth(request, env);
    if (!env.BOT_TOKEN) return json({ ok: true, configured: false });
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getWebhookInfo`);
    const data = await r.json();
    return json({ ok: true, configured: !!data.result?.url, info: data.result || null });
  } catch (err) {
    return errorResponse(err);
  }
}
