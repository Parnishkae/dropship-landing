// Планировщик авто-подбора товара.
// По расписанию (cron) дёргает эндпоинт сайта /api/admin/auto-pick с секретом,
// сайт подбирает товар, ставит наценку и шлёт отчёт в Telegram.

async function hit(base, path, env, body) {
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "X-Cron-Secret": env.CRON_SECRET || "", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { path, status: res.status };
}

async function run(env) {
  const base = String(env.SITE_URL || "").replace(/\/$/, "");
  const out = [];
  // 1) Идеи трендовых товаров из интернета → в Telegram
  try { out.push(await hit(base, "/api/admin/trend-ideas", env, { geo: env.GEO || "UA", notify: true })); }
  catch (e) { out.push({ path: "/api/admin/trend-ideas", error: String(e) }); }
  // 2) Подбор лучшего товара из каталога → «ХИТ» + Telegram
  try { out.push(await hit(base, "/api/admin/auto-pick", env)); }
  catch (e) { out.push({ path: "/api/admin/auto-pick", error: String(e) }); }
  return out;
}

export default {
  // Автозапуск по расписанию из [triggers].crons
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env));
  },
  // Ручной запуск: открой https://<worker>/run в браузере
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/run") {
      const r = await run(env);
      return new Response(JSON.stringify(r, null, 2), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("Dropship automation worker. Открой /run для ручного запуска.", { status: 200 });
  },
};
