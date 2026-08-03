// Telegram-бот: проводит покупателя по сборке набора и оформляет заказ.
// Вебхук: POST /api/tg/webhook  (подключается через /api/admin/tg-setup).
import { getDB, ensureSchema, rowToBundle, bundlePrice } from "../../_lib/db.js";

const CUR = "грн";

// ---- Bot API ----
async function tg(env, method, payload) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    return await r.json();
  } catch { return null; }
}
const send = (env, chat, text, extra = {}) => tg(env, "sendMessage", { chat_id: chat, text, parse_mode: "HTML", ...extra });
const editText = (env, chat, mid, text, extra = {}) => tg(env, "editMessageText", { chat_id: chat, message_id: mid, text, parse_mode: "HTML", ...extra });
const answer = (env, id, text) => tg(env, "answerCallbackQuery", { callback_query_id: id, text: text || "", show_alert: !!text });

// ---- Состояние диалога ----
async function getState(db, chat) {
  const row = await db.prepare("SELECT state FROM tg_sessions WHERE chat_id = ?").bind(String(chat)).first();
  if (!row) return { step: "idle" };
  try { return JSON.parse(row.state) || { step: "idle" }; } catch { return { step: "idle" }; }
}
async function setState(db, chat, state) {
  await db.prepare("INSERT INTO tg_sessions (chat_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at")
    .bind(String(chat), JSON.stringify(state), Date.now()).run();
}
async function clearState(db, chat) {
  await db.prepare("DELETE FROM tg_sessions WHERE chat_id = ?").bind(String(chat)).run();
}

function esc(s) { return String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
function trunc(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

// ---- Экраны ----
async function showBundles(env, db, chat) {
  const { results } = await db.prepare("SELECT * FROM bundles WHERE active = 1 ORDER BY updated_at DESC LIMIT 20").all();
  const bundles = (results || []).map(rowToBundle);
  if (!bundles.length) {
    return send(env, chat, "Пока нет доступных наборов. Загляните в каталог на сайте 🙌");
  }
  const kb = bundles.map((b) => [{ text: `🎁 ${trunc(b.title, 40)}`, callback_data: "b:" + b.id }]);
  return send(env, chat,
    "👋 Привет! Я помогу собрать набор и оформить заказ.\n\nВыберите набор:",
    { reply_markup: { inline_keyboard: kb } });
}

function selectionKeyboard(bundle, picks) {
  const rows = bundle.items.map((it, i) => {
    const on = picks.includes(i);
    return [{ text: `${on ? "✅" : "⬜️"} ${trunc(it.title, 30)} — ${Math.round(it.price)}`, callback_data: "t:" + i }];
  });
  const ctrl = [];
  if (picks.length === bundle.pickCount) {
    const price = bundlePrice(bundle, picks.map((i) => bundle.items[i]));
    ctrl.push({ text: `✅ Оформить за ${price} ${bundle.currency || CUR}`, callback_data: "done" });
  }
  ctrl.push({ text: "❌ Отмена", callback_data: "cancel" });
  rows.push(ctrl);
  return { inline_keyboard: rows };
}

function selectionText(bundle, picks) {
  const hint = bundle.priceMode === "fixed" ? `фикс. цена за ${bundle.pickCount}`
    : bundle.priceMode === "discount" ? `−${bundle.discount}% на выбранные` : "оплата за выбранные";
  const price = bundlePrice(bundle, picks.map((i) => bundle.items[i]));
  return `🎁 <b>${esc(bundle.title)}</b>\n${esc(bundle.description || "")}\n\n` +
    `Выберите <b>${bundle.pickCount}</b> из ${bundle.items.length} · ${hint}\n` +
    `Выбрано: <b>${picks.length}/${bundle.pickCount}</b>\n` +
    `Сумма: <b>${price} ${esc(bundle.currency || CUR)}</b>`;
}

async function startBuilding(env, db, chat, bundleId, cbId) {
  const row = await db.prepare("SELECT * FROM bundles WHERE id = ? AND active = 1").bind(bundleId).first();
  if (!row) { if (cbId) await answer(env, cbId, "Набор недоступен"); return; }
  const bundle = rowToBundle(row);
  const msg = await send(env, chat, selectionText(bundle, []), { reply_markup: selectionKeyboard(bundle, []) });
  const mid = msg?.result?.message_id;
  await setState(db, chat, { step: "building", bundleId, picks: [], msgId: mid });
  if (cbId) await answer(env, cbId);
}

async function toggle(env, db, chat, idx, state, cbId) {
  const row = await db.prepare("SELECT * FROM bundles WHERE id = ?").bind(state.bundleId).first();
  if (!row) { await answer(env, cbId, "Набор пропал"); return; }
  const bundle = rowToBundle(row);
  let picks = state.picks || [];
  if (picks.includes(idx)) picks = picks.filter((i) => i !== idx);
  else {
    if (picks.length >= bundle.pickCount) { await answer(env, cbId, `Можно выбрать только ${bundle.pickCount}`); return; }
    picks = [...picks, idx];
  }
  state.picks = picks;
  await setState(db, chat, state);
  await editText(env, chat, state.msgId, selectionText(bundle, picks), { reply_markup: selectionKeyboard(bundle, picks) });
  await answer(env, cbId);
}

async function askContact(env, db, chat, state, cbId) {
  const row = await db.prepare("SELECT * FROM bundles WHERE id = ?").bind(state.bundleId).first();
  const bundle = rowToBundle(row);
  if ((state.picks || []).length !== bundle.pickCount) { await answer(env, cbId, "Выберите нужное количество"); return; }
  state.step = "contact";
  await setState(db, chat, state);
  await answer(env, cbId);
  await send(env, chat,
    "Отлично! Остался последний шаг — как с вами связаться?\nНажмите кнопку ниже или пришлите номер телефона сообщением.",
    { reply_markup: { keyboard: [[{ text: "📱 Отправить мой номер", request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
}

async function createOrder(env, db, chat, state, name, phone) {
  const row = await db.prepare("SELECT * FROM bundles WHERE id = ?").bind(state.bundleId).first();
  const bundle = rowToBundle(row);
  const chosen = (state.picks || []).map((i) => bundle.items[i]);
  const price = bundlePrice(bundle, chosen);
  const id = "ord_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const items = [{ id: bundle.id, title: `Набор «${bundle.title}»: ` + chosen.map((c) => c.title).join(" + "), price, currency: bundle.currency || CUR, qty: 1, bundle: bundle.id }];

  await db.prepare(
    `INSERT INTO orders (id, name, phone, contact, comment, items, total, currency, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
  ).bind(id, name || "", phone || "", "Telegram @" + (state.username || chat), "Заказ через Telegram-бота", JSON.stringify(items), price, bundle.currency || CUR, now).run();
  await db.prepare("INSERT INTO events (type, product_id, meta, ts) VALUES ('order', ?, ?, ?)").bind(bundle.id, JSON.stringify({ orderId: id, total: price, via: "tg" }), now).run();

  await clearState(db, chat);

  // покупателю
  await send(env, chat,
    `✅ <b>Заказ оформлен!</b>\nНомер: <code>${id}</code>\n\n🎁 ${esc(items[0].title)}\n💰 Итого: <b>${price} ${esc(bundle.currency || CUR)}</b>\n\nМенеджер свяжется с вами в ближайшее время. Спасибо! 🙌`,
    { reply_markup: { remove_keyboard: true } });

  // админу
  if (env.CHAT_ID) {
    await send(env, env.CHAT_ID,
      `🛒 <b>Новый заказ из Telegram-бота</b> #${id}\n\n👤 ${esc(name || "—")}\n📞 ${esc(phone || "—")}\n💬 @${esc(state.username || chat)}\n\n🎁 ${esc(items[0].title)}\n💰 <b>Итого: ${price} ${esc(bundle.currency || CUR)}</b>`);
  }
}

// ---- Обработка апдейта ----
async function handle(env, db, update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat = cq.message.chat.id;
    const data = cq.data || "";
    const state = await getState(db, chat);
    if (cq.from?.username) state.username = cq.from.username;

    if (data === "cancel") { await clearState(db, chat); await answer(env, cq.id, "Отменено"); await showBundles(env, db, chat); return; }
    if (data.startsWith("b:")) return startBuilding(env, db, chat, data.slice(2), cq.id);
    if (data.startsWith("t:") && state.step === "building") return toggle(env, db, chat, parseInt(data.slice(2), 10), state, cq.id);
    if (data === "done" && state.step === "building") return askContact(env, db, chat, state, cq.id);
    return answer(env, cq.id);
  }

  const msg = update.message;
  if (!msg) return;
  const chat = msg.chat.id;
  const state = await getState(db, chat);
  if (msg.from?.username) state.username = msg.from.username;

  // контакт / телефон на шаге оформления
  if (state.step === "contact") {
    let phone = "", name = msg.from?.first_name || "";
    if (msg.contact) { phone = msg.contact.phone_number; name = msg.contact.first_name || name; }
    else if (msg.text) { phone = msg.text.trim(); }
    if (!phone) { await send(env, chat, "Пришлите номер телефона или нажмите кнопку 📱"); return; }
    return createOrder(env, db, chat, state, name, phone);
  }

  const text = (msg.text || "").trim().toLowerCase();
  if (text === "/start" || text === "/naboru" || text.includes("набор") || text === "/menu") {
    return showBundles(env, db, chat);
  }
  return showBundles(env, db, chat);
}

export async function onRequestPost({ request, env }) {
  // проверка секрета вебхука
  if (env.TG_WEBHOOK_SECRET) {
    const got = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (got !== env.TG_WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  }
  if (!env.BOT_TOKEN || !env.DB) return new Response("ok"); // не настроено — тихо игнорируем
  try {
    const db = env.DB;
    await ensureSchema(db);
    const update = await request.json();
    await handle(env, db, update);
  } catch (e) { /* Telegram не должен видеть 500 и ретраить бесконечно */ }
  return new Response("ok");
}

export async function onRequestGet() {
  return new Response("Telegram webhook endpoint. Настройте через /api/admin/tg-setup.");
}
