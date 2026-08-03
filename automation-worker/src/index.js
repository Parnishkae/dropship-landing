// Планировщик авто-подбора товара.
// По расписанию (cron) дёргает эндпоинт сайта /api/admin/auto-pick с секретом,
// сайт подбирает товар, ставит наценку и шлёт отчёт в Telegram.

async function run(env) {
  const url = String(env.SITE_URL || "").replace(/\/$/, "") + "/api/admin/auto-pick";
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Cron-Secret": env.CRON_SECRET || "", "Content-Type": "application/json" },
  });
  return { status: res.status, body: await res.text() };
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
