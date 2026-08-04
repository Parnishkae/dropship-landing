// ── Админ-панель: логика ──
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (v, cur) => `${Math.round(Number(v) || 0)} ${cur || "грн"}`;

// ============ AUTH ============
async function checkAuth() {
  try {
    const r = await fetch("/api/admin/login");
    const d = await r.json();
    return d.authed;
  } catch { return false; }
}

async function doLogin(e) {
  e.preventDefault();
  const pass = $("#login-pass").value;
  const msg = $("#login-msg");
  msg.className = "msg info hidden";
  const r = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pass }) });
  const d = await r.json();
  if (d.ok) { showApp(); }
  else { msg.className = "msg err"; msg.textContent = d.error || "Неверный пароль"; }
}

function showApp() { $("#login-view").classList.add("hidden"); $("#app-view").classList.remove("hidden"); switchTab("import"); }
function showLogin() { $("#app-view").classList.add("hidden"); $("#login-view").classList.remove("hidden"); }

// ============ TABS ============
function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "panel-" + name));
  if (name === "products") loadProducts();
  if (name === "bundles") { loadBundleList(); tgStatus(); }
  if (name === "stats") loadStats();
  if (name === "ai") loadPicks();
}

// ============ XML PARSER (в браузере) ============
function textOf(node, names) {
  if (!node) return "";
  for (const ch of node.children) {
    if (names.includes(ch.localName.toLowerCase())) return (ch.textContent || "").trim();
  }
  return "";
}
function allText(node, names) {
  const out = [];
  for (const ch of node.children) {
    if (names.includes(ch.localName.toLowerCase())) { const v = (ch.textContent || "").trim(); if (v) out.push(v); }
  }
  return out;
}
function parsePrice(s) {
  if (!s) return null;
  const m = String(s).replace(/\s+/g, "").replace(",", ".").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}
function currencyFrom(s, fallback) {
  if (!s) return fallback;
  const m = String(s).match(/[A-Za-z]{3}|грн|руб|₴|\$|€/);
  return m ? m[0] : fallback;
}

function parseFeed(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Файл не является корректным XML");

  // Категории (YML): id -> name
  const catMap = {};
  doc.querySelectorAll("categories > category, category").forEach((c) => {
    const id = c.getAttribute("id");
    if (id) catMap[id] = (c.textContent || "").trim();
  });

  // Узлы товаров: пробуем разные форматы фидов
  let nodes = Array.from(doc.getElementsByTagName("offer"));
  let kind = "yml";
  if (!nodes.length) { nodes = Array.from(doc.getElementsByTagName("item")); kind = "rss"; }
  if (!nodes.length) { nodes = Array.from(doc.getElementsByTagName("product")); kind = "product"; }
  if (!nodes.length) { nodes = Array.from(doc.getElementsByTagName("entry")); kind = "entry"; }
  if (!nodes.length) throw new Error("В файле не найдены товары (offer / item / product)");

  const products = nodes.map((n) => normalizeNode(n, catMap)).filter((p) => p && p.title);
  return { products, kind, count: products.length };
}

function normalizeNode(n, catMap) {
  const id = n.getAttribute("id") || textOf(n, ["id", "g:id", "sku", "vendorcode", "article"]) || textOf(n, ["url", "link"]);
  const title = textOf(n, ["name", "title", "g:title", "model"]);
  const description = textOf(n, ["description", "g:description"]);
  const priceRaw = textOf(n, ["price", "g:price", "sale_price", "g:sale_price"]);
  const oldRaw = textOf(n, ["oldprice", "old_price", "g:price"]);
  const cur = textOf(n, ["currencyid", "currency"]) || currencyFrom(priceRaw, "грн");

  // категория
  let category = "";
  const catId = textOf(n, ["categoryid"]);
  if (catId && catMap[catId]) category = catMap[catId];
  if (!category) category = textOf(n, ["category", "g:product_type", "product_type", "g:google_product_category"]);
  if (category && category.includes(">")) category = category.split(">").pop().trim();
  if (category && category.includes("/")) category = category.split("/").pop().trim();

  // изображения
  let images = allText(n, ["picture", "image", "g:image_link", "image_link", "g:additional_image_link"]);
  if (!images.length) {
    const img = textOf(n, ["image_link", "picture", "image"]);
    if (img) images = [img];
  }

  // наличие
  let available = true;
  const av = (n.getAttribute("available") || textOf(n, ["available", "g:availability", "availability"]) || "").toLowerCase();
  if (av === "false" || av === "0" || av === "out of stock" || av === "outofstock" || av === "нет") available = false;

  // параметры
  const params = {};
  n.querySelectorAll("param").forEach((p) => {
    const k = p.getAttribute("name"); const v = (p.textContent || "").trim();
    if (k && v) params[k] = v;
  });
  ["g:brand", "brand", "g:color", "color", "g:size", "size"].forEach((tag) => {
    const v = textOf(n, [tag]);
    if (v && !params[tag.replace("g:", "")]) params[tag.replace("g:", "")] = v;
  });

  const price = parsePrice(priceRaw) || 0;
  let oldPrice = parsePrice(oldRaw);
  if (oldPrice && oldPrice <= price) oldPrice = null;

  return {
    id: String(id || "").trim(),
    sku: textOf(n, ["vendorcode", "sku", "g:mpn", "article"]) || null,
    title, description, price, oldPrice,
    currency: cur,
    category: category || null,
    vendor: textOf(n, ["vendor", "g:brand", "brand"]) || null,
    image: images[0] || null,
    images,
    available,
    params,
    url: textOf(n, ["url", "link", "g:link"]) || null,
  };
}

// ============ IMPORT UI ============
let parsedProducts = null;
let importFileName = "";

function handleFile(file) {
  importFileName = file.name;
  const reader = new FileReader();
  reader.onload = () => {
    const box = $("#import-msg");
    try {
      const { products, kind } = parseFeed(reader.result);
      parsedProducts = products;
      box.className = "msg ok";
      box.textContent = `Файл распознан (${kind.toUpperCase()}): найдено ${products.length} товаров. Проверьте превью и нажмите «Загрузить в каталог».`;
      renderPreview(products);
      $("#import-btn").disabled = products.length === 0;
    } catch (e) {
      parsedProducts = null;
      box.className = "msg err";
      box.textContent = "Ошибка: " + e.message;
      $("#preview").innerHTML = "";
      $("#import-btn").disabled = true;
    }
  };
  reader.readAsText(file);
}

function renderPreview(products) {
  const list = products.slice(0, 50).map((p) => `
    <div class="p">
      ${p.image ? `<img src="${esc(p.image)}" onerror="this.outerHTML='<div class=&quot;noimg&quot;>нет</div>'">` : `<div class="noimg">нет</div>`}
      <div class="t">${esc(p.title)}</div>
      <div style="color:var(--muted);font-size:.8rem">${esc(p.category || "—")}</div>
      <div class="pr">${money(p.price, p.currency)}</div>
    </div>`).join("");
  $("#preview").innerHTML = `<div class="preview-list">${list}</div>${products.length > 50 ? `<p class="sub" style="margin-top:8px">…и ещё ${products.length - 50}</p>` : ""}`;
}

async function doImport() {
  if (!parsedProducts) return;
  const mode = $$('input[name="mode"]').find((r) => r.checked)?.value || "merge";
  const btn = $("#import-btn"); btn.disabled = true; btn.textContent = "Загрузка…";
  const box = $("#import-msg");
  try {
    const r = await fetch("/api/admin/import", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: parsedProducts, mode, source: importFileName }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    box.className = "msg ok";
    box.textContent = `Готово! Загружено ${d.imported} товаров${d.skipped ? `, пропущено ${d.skipped}` : ""}. Всего в каталоге: ${d.totalInCatalog}.`;
    $("#preview").innerHTML = "";
    parsedProducts = null;
  } catch (e) {
    box.className = "msg err"; box.textContent = "Ошибка загрузки: " + e.message;
  }
  btn.disabled = false; btn.textContent = "Загрузить в каталог";
}

// ============ PRODUCTS ============
async function loadProducts() {
  const q = $("#prod-search").value.trim();
  const body = $("#prod-body");
  body.innerHTML = `<tr><td colspan="6" class="state">Загрузка…</td></tr>`;
  try {
    const r = await fetch("/api/admin/products?limit=100&q=" + encodeURIComponent(q));
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    $("#prod-total").textContent = d.total;
    if (!d.products.length) { body.innerHTML = `<tr><td colspan="6" class="state">Нет товаров</td></tr>`; return; }
    body.innerHTML = d.products.map(rowHTML).join("");
    bindRows();
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="state">Ошибка: ${esc(e.message)}</td></tr>`;
  }
}

function rowHTML(p) {
  return `<tr data-id="${esc(p.id)}">
    <td>${p.image ? `<img src="${esc(p.image)}">` : `<div class="tbl-noimg" style="width:40px;height:40px;border-radius:8px;background:var(--surface2)"></div>`}</td>
    <td style="max-width:280px"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.title)}</div><small style="color:var(--muted)">${esc(p.category || "")}</small></td>
    <td><input class="edit-inline" data-price value="${p.price}"></td>
    <td><span class="pill ${p.available ? "on" : "off"}" data-avail>${p.available ? "в наличии" : "скрыт"}</span></td>
    <td><a href="/product.html?id=${encodeURIComponent(p.id)}" target="_blank">открыть ↗</a></td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-line btn-sm" data-save>Сохранить</button>
      <button class="btn btn-danger btn-sm" data-del>Удалить</button>
    </td>
  </tr>`;
}

function bindRows() {
  $$("#prod-body tr").forEach((tr) => {
    const id = tr.dataset.id;
    const avail = $("[data-avail]", tr);
    avail.style.cursor = "pointer";
    avail.title = "Нажмите, чтобы переключить наличие";
    avail.onclick = () => {
      const on = !avail.classList.contains("on");
      avail.classList.toggle("on", on);
      avail.classList.toggle("off", !on);
      avail.textContent = on ? "в наличии" : "скрыт";
    };
    $("[data-save]", tr).onclick = async () => {
      const price = Number($("[data-price]", tr).value) || 0;
      const available = avail.classList.contains("on");
      const r = await fetch("/api/admin/products", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, price, available }) });
      const d = await r.json();
      if (d.ok) { $("[data-save]", tr).textContent = "✓"; setTimeout(() => $("[data-save]", tr).textContent = "Сохранить", 1200); }
    };
    $("[data-del]", tr).onclick = async () => {
      if (!confirm("Удалить товар?")) return;
      const r = await fetch("/api/admin/products?id=" + encodeURIComponent(id), { method: "DELETE" });
      const d = await r.json();
      if (d.ok) tr.remove();
    };
  });
}

async function clearAll() {
  if (!confirm("Удалить ВСЕ товары из каталога? Это действие необратимо.")) return;
  await fetch("/api/admin/products?all=1", { method: "DELETE" });
  loadProducts();
}

// ============ STATS ============
async function loadStats() {
  const days = $("#stats-days").value;
  const root = $("#stats-root");
  root.innerHTML = `<div class="state">Загрузка статистики…</div>`;
  try {
    const r = await fetch("/api/admin/stats?days=" + days);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    renderStats(d);
  } catch (e) {
    root.innerHTML = `<div class="state">Ошибка: ${esc(e.message)}</div>`;
  }
}

function renderStats(d) {
  const t = d.totals, c = d.conversion;
  const kpis = [
    { v: t.products, l: "Товаров в каталоге" },
    { v: t.available, l: "В наличии" },
    { v: t.ordersPeriod, l: `Заказов / ${d.days} дн.`, a: true },
    { v: money(t.revenuePeriod), l: "Выручка за период", a: true },
    { v: t.productViews, l: "Просмотров товаров" },
    { v: t.pageviews, l: "Визитов" },
  ];
  $("#stats-root").innerHTML = `
    <div class="kpis">${kpis.map((k) => `<div class="kpi"><div class="v ${k.a ? "accent" : ""}">${k.v}</div><div class="l">${k.l}</div></div>`).join("")}</div>
    <div class="grid2">
      <div class="chart-card"><h3>Активность по дням</h3>${lineChart(d.series)}</div>
      <div class="chart-card"><h3>Воронка конверсии</h3>
        <div class="funnel">
          <div class="f"><div><div class="n">${c.productViews}</div><small>Просмотры товаров</small></div></div>
          <div class="f"><div><div class="n">${c.addToCart}</div><small>В корзину — ${c.viewToCart}%</small></div></div>
          <div class="f"><div><div class="n">${c.orders}</div><small>Заказы — ${c.viewToOrder}% от просмотров</small></div></div>
        </div>
      </div>
    </div>
    <div class="grid2" style="margin-top:18px">
      <div class="chart-card"><h3>Топ просматриваемых товаров</h3>${topTable(d.topViewed)}</div>
      <div class="chart-card"><h3>Последние заказы</h3>${ordersTable(d.recentOrders)}</div>
    </div>`;
}

function lineChart(series) {
  const W = 560, H = 220, pad = 28;
  if (!series.length) return `<div class="state">Нет данных</div>`;
  const maxV = Math.max(1, ...series.map((s) => Math.max(s.pviews, s.orders * 5)));
  const x = (i) => pad + (i * (W - pad * 2)) / Math.max(1, series.length - 1);
  const yV = (v) => H - pad - (v / maxV) * (H - pad * 2);
  const path = (key) => series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yV(s[key]).toFixed(1)}`).join(" ");
  const ordPath = series.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yV(s.orders * 5).toFixed(1)}`).join(" ");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="var(--line)"/>
    <path d="${path("pviews")}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
    <path d="${ordPath}" fill="none" stroke="#22c55e" stroke-width="2.5"/>
  </svg>
  <div style="display:flex;gap:16px;font-size:.8rem;color:var(--muted);margin-top:6px">
    <span><b style="color:var(--accent)">—</b> просмотры</span><span><b style="color:#22c55e">—</b> заказы ×5</span>
  </div>`;
}

function topTable(rows) {
  if (!rows.length) return `<div class="state">Пока нет просмотров</div>`;
  return `<table class="tbl"><tbody>${rows.map((r) => `<tr>
    <td>${r.image ? `<img src="${esc(r.image)}">` : ""}</td>
    <td>${esc(r.title || r.id || "—")}</td>
    <td style="text-align:right;font-weight:700">${r.views} 👁</td>
  </tr>`).join("")}</tbody></table>`;
}

function ordersTable(rows) {
  if (!rows.length) return `<div class="state">Заказов пока нет</div>`;
  return `<table class="tbl"><tbody>${rows.map((o) => `<tr>
    <td>${esc(o.name || "—")}<br><small style="color:var(--muted)">${esc(o.phone || o.contact || "")}</small></td>
    <td><small>${(o.items || []).map((i) => esc(i.title)).join(", ").slice(0, 60)}</small></td>
    <td style="text-align:right;font-weight:700;white-space:nowrap">${money(o.total, o.currency)}</td>
  </tr>`).join("")}</tbody></table>`;
}

// ============ AI ============
async function loadAI() {
  const days = $("#ai-days").value;
  const root = $("#ai-root");
  root.innerHTML = `<div class="state"><span class="spinner"></span><p style="margin-top:12px">ИИ анализирует ваш магазин…</p></div>`;
  try {
    const r = await fetch("/api/admin/ai?days=" + days);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    renderAI(d);
  } catch (e) {
    root.innerHTML = `<div class="state">Ошибка: ${esc(e.message)}</div>`;
  }
}

function renderAI(d) {
  const a = d.analysis || {};
  const badge = d.source === "ai"
    ? `<span class="ai-badge live">⚡ Claude AI</span>`
    : `<span class="ai-badge">Базовый анализ${d.source === "heuristic-fallback" ? " (ИИ недоступен)" : ""}</span>`;
  const metrics = a.metrics ? Object.entries(a.metrics).map(([k, v]) => `<div class="ai-metric"><div class="v">${esc(v)}</div><div class="l">${esc(k)}</div></div>`).join("") : "";
  const recs = (a.recommendations || []).map((x) => `<div class="ai-rec">${esc(x)}</div>`).join("");
  $("#ai-root").innerHTML = `
    <div class="ai-head">${badge}<span class="sub" style="margin:0">за ${d.summary.days} дней</span></div>
    <div class="ai-headline">${esc(a.headline || "")}</div>
    ${metrics ? `<div class="ai-metrics">${metrics}</div>` : ""}
    <div class="ai-recs">${recs}</div>`;
}

// ---- Авто-подбор товара ----
async function runAutoPick() {
  const btn = $("#pick-run"); btn.disabled = true; btn.textContent = "ИИ подбирает…";
  const box = $("#pick-result");
  box.innerHTML = `<div class="state"><span class="spinner"></span><p style="margin-top:10px">ИИ анализирует каталог и выбирает лучший товар…</p></div>`;
  try {
    const r = await fetch("/api/admin/auto-pick", { method: "POST" });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    const p = d.pick;
    box.innerHTML = `
      <div class="msg ${d.telegramSent ? "ok" : "info"}">${d.telegramSent ? "✅ Готово! Отчёт отправлен в Telegram." : "✅ Готово! (Telegram не настроен — отчёт не отправлен)"}</div>
      <div class="ai-rec" style="margin-top:12px">
        <b>🔥 ${esc(p.title)}</b><br>
        Закупка ${p.cost} → на сайте <b>${money(p.price, p.currency)}</b> · наценка ×${p.markup} · прибыль ${p.profit}<br>
        <span style="color:var(--muted)">${esc(p.reason || "")}</span><br>
        ${p.angle ? `🎯 ${esc(p.angle)}<br>` : ""}
        ${p.tgPost ? `<div style="margin-top:8px;padding:10px;background:var(--surface2);border-radius:8px;white-space:pre-wrap">${esc(p.tgPost)}</div>` : ""}
        <a href="${esc(p.link || "/product.html?id=" + encodeURIComponent(p.id))}" target="_blank">Открыть товар ↗</a>
      </div>`;
    loadPicks();
  } catch (e) {
    box.innerHTML = `<div class="msg err">Ошибка: ${esc(e.message)}</div>`;
  }
  btn.disabled = false; btn.textContent = "✨ Найти и внедрить";
}

async function loadPicks() {
  const el = $("#picks-log");
  try {
    const r = await fetch("/api/admin/auto-pick");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    if (!d.picks.length) { el.innerHTML = `<div class="state">Пока не было авто-подборов</div>`; return; }
    el.innerHTML = `<div class="card" style="padding:0;overflow-x:auto"><table class="tbl">
      <thead><tr><th>Дата</th><th>Товар</th><th>Закупка</th><th>Цена</th><th>Причина</th></tr></thead>
      <tbody>${d.picks.map((p) => `<tr>
        <td style="white-space:nowrap">${new Date(p.ts).toLocaleDateString("ru-RU")}</td>
        <td>${esc(p.title)}</td>
        <td>${Math.round(p.cost)}</td>
        <td style="font-weight:700">${Math.round(p.retail)} <small style="color:var(--muted)">×${p.markup}</small></td>
        <td><small style="color:var(--muted)">${esc(p.reason || "")}</small></td>
      </tr>`).join("")}</tbody></table></div>`;
  } catch (e) { el.innerHTML = `<div class="state">${esc(e.message)}</div>`; }
}

// ---- Идеи из трендов (наружу) ----
async function runTrendIdeas() {
  const btn = $("#trend-run"); btn.disabled = true; btn.textContent = "ИИ ищет…";
  const box = $("#trend-result"); const modeEl = $("#trend-mode");
  modeEl.textContent = "";
  box.innerHTML = `<div class="state"><span class="spinner"></span><p style="margin-top:10px">ИИ анализирует тренды и подбирает идеи…</p></div>`;
  try {
    const r = await fetch("/api/admin/trend-ideas", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ niche: $("#trend-niche").value.trim(), geo: $("#trend-geo").value, notify: true }),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    modeEl.innerHTML = (d.grounded
      ? "🔎 Реальный поиск в интернете (Gemini)"
      : "⚡ На основе модели + Google Trends. Для настоящего поиска в интернете добавь бесплатный <b>GEMINI_API_KEY</b>.")
      + (d.telegramSent ? " · ✅ отправлено в Telegram" : "");
    if (!d.ideas.length) {
      box.innerHTML = `<div class="msg info">ИИ не вернул структурированные идеи.${d.raw ? "<br><br>" + esc(d.raw) : ""}</div>`;
    } else {
      box.innerHTML = d.ideas.map((i) => `<div class="ai-rec">
        <b>${esc(i.name || "")}</b><br>
        <span style="color:var(--muted)">${esc(i.why || "")}</span><br>
        💵 закуп ~${esc(i.buy)} → розница <b>${esc(i.sell)}</b> · 🎯 ${esc(i.angle || "")}<br>
        👥 ${esc(i.audience || "")} · 🛒 ${esc(i.supplier || "")}
      </div>`).join("")
      + (d.sources && d.sources.length ? `<div class="sub" style="margin-top:10px">Источники: ${d.sources.slice(0, 4).map((s) => `<a href="${esc(s.uri)}" target="_blank" style="color:var(--accent)">${esc(s.title || "ссылка")}</a>`).join(" · ")}</div>` : "")
      + (d.trends && d.trends.length ? `<div class="sub" style="margin-top:6px">🔥 Сейчас в трендах (${esc(d.geo)}): ${d.trends.slice(0, 8).map(esc).join(", ")}</div>` : "");
    }
  } catch (e) { box.innerHTML = `<div class="msg err">Ошибка: ${esc(e.message)}</div>`; }
  btn.disabled = false; btn.textContent = "🔎 Предложить идеи";
}

// ============ BUNDLES ============
let bundleItems = [];
let editingBundleId = null;

function bndMode() { return $("#bnd-mode").value; }
function bndSyncMode() {
  $("#bnd-fixed-wrap").classList.toggle("hidden", bndMode() !== "fixed");
  $("#bnd-disc-wrap").classList.toggle("hidden", bndMode() !== "discount");
}

async function bndSearch() {
  const q = $("#bnd-search").value.trim();
  const box = $("#bnd-search-res");
  if (q.length < 2) { box.innerHTML = ""; return; }
  const r = await fetch("/api/admin/products?limit=8&q=" + encodeURIComponent(q));
  const d = await r.json();
  if (!d.ok) return;
  box.innerHTML = d.products.map((p) => `<div class="r" data-p='${esc(JSON.stringify({ id: p.id, title: p.title, price: p.price, image: p.image }))}'>
    ${p.image ? `<img src="${esc(p.image)}">` : ""}<span style="flex:1">${esc(p.title)}</span><b>${money(p.price, p.currency)}</b></div>`).join("");
  $$("#bnd-search-res .r").forEach((el) => el.onclick = () => { bndAddItem(JSON.parse(el.dataset.p)); $("#bnd-search").value = ""; box.innerHTML = ""; });
}

function bndAddItem(p) {
  if (bundleItems.some((i) => i.id === p.id)) return;
  bundleItems.push(p);
  bndRenderItems();
}
function bndRenderItems() {
  $("#bnd-items").innerHTML = bundleItems.map((i) => `<div class="bnd-item">
    ${i.image ? `<img src="${esc(i.image)}">` : ""}<span class="t">${esc(i.title)}</span><b>${money(i.price)}</b>
    <button class="rm" data-rm="${esc(i.id)}">✕</button></div>`).join("");
  $$("#bnd-items [data-rm]").forEach((b) => b.onclick = () => { bundleItems = bundleItems.filter((i) => i.id !== b.dataset.rm); bndRenderItems(); });
}

function bndReset() {
  editingBundleId = null; bundleItems = [];
  $("#bnd-form-title").textContent = "Новый набор";
  $("#bnd-title").value = ""; $("#bnd-desc").value = "";
  $("#bnd-pick").value = 3; $("#bnd-mode").value = "fixed";
  $("#bnd-fixed").value = 0; $("#bnd-disc").value = 15; $("#bnd-active").checked = true;
  $("#bnd-items").innerHTML = ""; $("#bnd-search-res").innerHTML = "";
  $("#bnd-msg").className = "msg info hidden"; bndSyncMode();
}

async function bndSave() {
  const msg = $("#bnd-msg");
  const payload = {
    id: editingBundleId || undefined,
    title: $("#bnd-title").value.trim(),
    description: $("#bnd-desc").value.trim(),
    pickCount: parseInt($("#bnd-pick").value, 10) || 3,
    priceMode: bndMode(),
    fixedPrice: Number($("#bnd-fixed").value) || 0,
    discount: Number($("#bnd-disc").value) || 0,
    active: $("#bnd-active").checked,
    items: bundleItems,
  };
  const r = await fetch("/api/admin/bundles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (d.ok) { msg.className = "msg ok"; msg.textContent = "Набор сохранён"; bndReset(); loadBundleList(); }
  else { msg.className = "msg err"; msg.textContent = d.error || "Ошибка"; }
}

async function loadBundleList() {
  const el = $("#bnd-list");
  try {
    const r = await fetch("/api/admin/bundles");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    if (!d.bundles.length) { el.innerHTML = `<div class="state">Наборов пока нет</div>`; return; }
    el.innerHTML = d.bundles.map((b) => `<div class="bnd-row" data-id="${esc(b.id)}">
      ${b.image ? `<img src="${esc(b.image)}" style="width:44px;height:44px;border-radius:8px;object-fit:cover">` : ""}
      <div class="t"><b>${esc(b.title)}</b><br><small>${b.pickCount} из ${b.items.length} · ${b.priceMode === "fixed" ? money(b.fixedPrice, b.currency) : b.priceMode === "discount" ? "−" + b.discount + "%" : "сумма"} ${b.active ? "" : "· <span style=color:var(--muted)>скрыт</span>"}</small></div>
      <button class="btn btn-line btn-sm" data-edit>✎</button>
      <button class="btn btn-danger btn-sm" data-del>✕</button>
    </div>`).join("");
    $$("#bnd-list .bnd-row").forEach((row) => {
      const b = d.bundles.find((x) => x.id === row.dataset.id);
      $("[data-edit]", row).onclick = () => bndEdit(b);
      $("[data-del]", row).onclick = async () => { if (!confirm("Удалить набор?")) return; await fetch("/api/admin/bundles?id=" + encodeURIComponent(b.id), { method: "DELETE" }); loadBundleList(); };
    });
  } catch (e) { el.innerHTML = `<div class="state">${esc(e.message)}</div>`; }
}

function bndEdit(b) {
  editingBundleId = b.id; bundleItems = b.items.slice();
  $("#bnd-form-title").textContent = "Редактирование: " + b.title;
  $("#bnd-title").value = b.title; $("#bnd-desc").value = b.description || "";
  $("#bnd-pick").value = b.pickCount; $("#bnd-mode").value = b.priceMode;
  $("#bnd-fixed").value = b.fixedPrice; $("#bnd-disc").value = b.discount; $("#bnd-active").checked = b.active;
  bndSyncMode(); bndRenderItems();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============ TELEGRAM BOT ============
async function tgStatus() {
  const el = $("#tg-status");
  try {
    const r = await fetch("/api/admin/tg-setup");
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    el.innerHTML = d.configured
      ? `Статус: <span style="color:#86efac">✅ подключён</span>`
      : `Статус: не подключён. Задайте BOT_TOKEN и нажмите «Подключить бота».`;
  } catch (e) { el.textContent = "Статус: " + e.message; }
}
async function tgConnect() {
  const btn = $("#tg-connect"); btn.disabled = true; btn.textContent = "Подключаю…";
  try {
    const r = await fetch("/api/admin/tg-setup", { method: "POST" });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    $("#tg-status").innerHTML = `Статус: <span style="color:#86efac">✅ ${esc(d.result)}</span>`;
  } catch (e) { $("#tg-status").innerHTML = `<span style="color:#fca5a5">${esc(e.message)}</span>`; }
  btn.disabled = false; btn.textContent = "Подключить бота";
}

// ============ INIT ============
document.addEventListener("DOMContentLoaded", async () => {
  $("#login-form").addEventListener("submit", doLogin);
  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  // import
  const drop = $("#drop"), fileInput = $("#file-input");
  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  ["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
  $("#import-btn").addEventListener("click", doImport);

  // products
  $("#prod-search").addEventListener("input", () => { clearTimeout(window._ps); window._ps = setTimeout(loadProducts, 350); });
  $("#prod-clear").addEventListener("click", clearAll);
  $("#prod-refresh").addEventListener("click", loadProducts);

  // bundles
  $("#bnd-mode").addEventListener("change", bndSyncMode);
  $("#bnd-search").addEventListener("input", () => { clearTimeout(window._bs); window._bs = setTimeout(bndSearch, 300); });
  $("#bnd-save").addEventListener("click", bndSave);
  $("#bnd-reset").addEventListener("click", bndReset);
  $("#tg-connect").addEventListener("click", tgConnect);

  // stats & ai
  $("#stats-days").addEventListener("change", loadStats);
  $("#ai-run").addEventListener("click", loadAI);
  $("#pick-run").addEventListener("click", runAutoPick);
  $("#trend-run").addEventListener("click", runTrendIdeas);

  if (await checkAuth()) showApp(); else showLogin();
});
