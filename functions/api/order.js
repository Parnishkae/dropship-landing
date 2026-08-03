// POST /api/order — оформление заказа: сохраняем в БД, шлём в Telegram, пишем событие.
import { getDB, ensureSchema, json, errorResponse, HttpError } from "../_lib/db.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

export async function onRequestPost({ request, env }) {
  try {
    const db = getDB(env);
    await ensureSchema(db);

    const data = await request.json();
    const name = (data.name || "").toString().trim();
    const phone = (data.phone || "").toString().trim();
    const contact = (data.contact || "").toString().trim();
    const comment = (data.comment || "").toString().trim();
    const items = Array.isArray(data.items) ? data.items : [];

    if (!name || (!phone && !contact)) {
      throw new HttpError(400, "Укажите имя и телефон/контакт.");
    }
    if (!items.length) throw new HttpError(400, "Корзина пуста.");

    let total = 0;
    const lines = items.map((it) => {
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      const price = Number(it.price) || 0;
      total += qty * price;
      return `• ${esc(it.title)} × ${qty} — ${price * qty} ${esc(it.currency || "UAH")}`;
    });

    const id = "ord_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = Date.now();
    const currency = (items[0] && items[0].currency) || "UAH";

    await db.prepare(
      `INSERT INTO orders (id, name, phone, contact, comment, items, total, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
    ).bind(id, name, phone, contact, comment, JSON.stringify(items), total, currency, now).run();

    await db.prepare(`INSERT INTO events (type, product_id, meta, ts) VALUES ('order', ?, ?, ?)`)
      .bind(items[0] && items[0].id ? String(items[0].id) : null, JSON.stringify({ orderId: id, total }), now)
      .run();

    // Telegram-уведомление (не роняем заказ, если бот не настроен).
    if (env.BOT_TOKEN && env.CHAT_ID) {
      const text =
        `🛒 <b>Новый заказ</b> #${id}\n\n` +
        `👤 ${esc(name)}\n` +
        (phone ? `📞 ${esc(phone)}\n` : "") +
        (contact ? `✉️ ${esc(contact)}\n` : "") +
        (comment ? `💬 ${esc(comment)}\n` : "") +
        `\n${lines.join("\n")}\n\n` +
        `💰 <b>Итого: ${total} ${esc(currency)}</b>`;
      try {
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env.CHAT_ID, text, parse_mode: "HTML" }),
        });
      } catch (_) { /* игнорируем сбой телеги */ }
    }

    return json({ ok: true, orderId: id, total, currency });
  } catch (err) {
    return errorResponse(err);
  }
}
