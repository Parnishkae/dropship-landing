// ── Страница товара ──
const CART_KEY = "dropshop_cart";
const S = window.SITE || {};
function money(v, cur) { return `${Math.round(Number(v) || 0)} ${cur || S.currency || "грн"}`; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

const cart = {
  items: JSON.parse(localStorage.getItem(CART_KEY) || "[]"),
  save() { localStorage.setItem(CART_KEY, JSON.stringify(this.items)); count(); },
  add(p) {
    const ex = this.items.find((i) => i.id === p.id);
    if (ex) ex.qty += 1; else this.items.push({ id: p.id, title: p.title, price: p.price, currency: p.currency, image: p.image, qty: 1 });
    this.save();
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "add_to_cart", productId: p.id }), keepalive: true }).catch(() => {});
  },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); },
};
function count() { document.querySelectorAll(".cart-count").forEach((e) => e.textContent = cart.count()); }

function toast(msg) {
  const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  const root = document.getElementById("pd-root");
  if (!id) { root.innerHTML = `<div class="state"><h3>Товар не выбран</h3></div>`; return; }
  try {
    const res = await fetch("/api/product/" + encodeURIComponent(id));
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    render(data.product, data.related);
    fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "product_view", productId: id }), keepalive: true }).catch(() => {});
  } catch (e) {
    root.innerHTML = `<div class="state"><h3>Товар не найден</h3><p>${esc(e.message || "")}</p><a class="btn btn-line" href="/">← В каталог</a></div>`;
  }
}

function render(p, related) {
  document.title = p.title + " — магазин";
  const imgs = p.images && p.images.length ? p.images : (p.image ? [p.image] : []);
  const gallery = imgs.length
    ? `<div class="pd-main"><img id="pd-main-img" src="${esc(imgs[0])}" alt="${esc(p.title)}"></div>
       ${imgs.length > 1 ? `<div class="pd-thumbs">${imgs.map((s, i) => `<img class="${i === 0 ? "active" : ""}" data-thumb="${esc(s)}" src="${esc(s)}" alt="">`).join("")}</div>` : ""}`
    : `<div class="pd-main"><div class="ph" style="height:100%;display:flex;align-items:center;justify-content:center;color:#c4c8cf">нет фото</div></div>`;

  const disc = p.oldPrice && p.oldPrice > p.price ? `<span class="old">${money(p.oldPrice, p.currency)}</span>` : "";
  const params = p.params && Object.keys(p.params).length
    ? `<div class="pd-params">${Object.entries(p.params).map(([k, v]) => `<div class="row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : "";
  const buy = p.available
    ? `<button class="btn btn-primary" id="pd-add">В корзину</button>`
    : `<button class="btn btn-line" disabled>Нет в наличии</button>`;

  document.getElementById("pd-root").innerHTML = `
    <div class="crumbs"><a href="/">Каталог</a> ${p.category ? "/ " + esc(p.category) : ""}</div>
    <div class="pd">
      <div class="pd-gallery">${gallery}</div>
      <div class="pd-info">
        ${p.category ? `<span class="card-cat">${esc(p.category)}</span>` : ""}
        <h1>${esc(p.title)}</h1>
        <div class="pd-price">${money(p.price, p.currency)}${disc}</div>
        ${p.available ? `<span class="badge" style="position:static;display:inline-block">В наличии</span>` : `<span class="badge out" style="position:static;display:inline-block">Нет в наличии</span>`}
        ${p.description ? `<p class="pd-desc">${esc(p.description)}</p>` : ""}
        ${params}
        <div class="pd-actions">
          ${buy}
          <a class="btn btn-line" data-tg href="${esc(S.telegram || "#")}" target="_blank" rel="noopener">Спросить в Telegram</a>
        </div>
      </div>
    </div>
    ${related && related.length ? `<h2 style="margin:10px 0 16px">Похожие товары</h2><div class="grid">${related.map(relCard).join("")}</div>` : ""}
  `;

  document.querySelectorAll("[data-thumb]").forEach((t) => t.addEventListener("click", () => {
    document.getElementById("pd-main-img").src = t.dataset.thumb;
    document.querySelectorAll(".pd-thumbs img").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
  }));
  const addBtn = document.getElementById("pd-add");
  if (addBtn) addBtn.addEventListener("click", () => { cart.add({ id: p.id, title: p.title, price: p.price, currency: p.currency, image: p.image }); toast("Добавлено в корзину"); });
}

function relCard(p) {
  const img = p.image ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.title)}">` : `<div class="ph">нет фото</div>`;
  return `<article class="card">
    <a class="card-img" href="/product.html?id=${encodeURIComponent(p.id)}">${img}</a>
    <div class="card-body">
      <div class="card-title"><a href="/product.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></div>
      <div class="card-foot"><span class="price">${money(p.price, p.currency)}</span></div>
    </div>
  </article>`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-site-name]").forEach((e) => e.textContent = S.name || "SHOP");
  document.querySelectorAll("[data-tg]").forEach((e) => { if (S.telegram) e.href = S.telegram; });
  count();
  load();
});
