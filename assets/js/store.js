// ── Каталог витрины ──
const CART_KEY = "dropshop_cart";
const S = window.SITE || {};

// ---- Корзина (localStorage) ----
const cart = {
  items: JSON.parse(localStorage.getItem(CART_KEY) || "[]"),
  save() { localStorage.setItem(CART_KEY, JSON.stringify(this.items)); renderCart(); updateCartCount(); },
  add(p) {
    const ex = this.items.find((i) => i.id === p.id);
    if (ex) ex.qty += 1;
    else this.items.push({ id: p.id, title: p.title, price: p.price, currency: p.currency, image: p.image, qty: 1 });
    this.save();
    track("add_to_cart", p.id);
  },
  setQty(id, q) {
    const it = this.items.find((i) => i.id === id);
    if (!it) return;
    it.qty = Math.max(0, q);
    if (it.qty === 0) this.items = this.items.filter((i) => i.id !== id);
    this.save();
  },
  remove(id) { this.items = this.items.filter((i) => i.id !== id); this.save(); },
  clear() { this.items = []; this.save(); },
  total() { return this.items.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0); },
  count() { return this.items.reduce((s, i) => s + i.qty, 0); },
};

function money(v, cur) { return `${Math.round(Number(v) || 0)} ${cur || S.currency || "грн"}`; }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function track(type, productId, meta) {
  fetch("/api/track", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, productId, meta }), keepalive: true,
  }).catch(() => {});
}

// ---- Рендер каталога ----
const state = { q: "", category: "", sort: "new", limit: 24, offset: 0, total: 0 };

async function loadProducts(reset = true) {
  const gridEl = document.getElementById("grid");
  if (reset) { state.offset = 0; gridEl.innerHTML = skeletons(8); }
  const params = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort, limit: state.limit, offset: state.offset });
  try {
    const res = await fetch("/api/products?" + params);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    state.total = data.total;
    if (reset) renderCategories(data.categories);
    renderGrid(data.products, reset);
    renderPager();
  } catch (e) {
    gridEl.innerHTML = `<div class="state" style="grid-column:1/-1"><h3>Не удалось загрузить каталог</h3><p>${esc(e.message || "")}. Проверьте, что база подключена и товары загружены в админке.</p></div>`;
  }
}

function skeletons(n) { return Array.from({ length: n }, () => `<div class="skeleton sk-card"></div>`).join(""); }

function renderGrid(products, reset) {
  const gridEl = document.getElementById("grid");
  if (reset && !products.length) {
    gridEl.innerHTML = `<div class="state" style="grid-column:1/-1"><h3>Пока пусто</h3><p>Здесь появятся товары после загрузки XML-фида в админ-панели.</p></div>`;
    return;
  }
  const html = products.map(cardHTML).join("");
  if (reset) gridEl.innerHTML = html; else gridEl.insertAdjacentHTML("beforeend", html);
  gridEl.querySelectorAll("[data-add]").forEach((b) => {
    if (b.dataset.bound) return; b.dataset.bound = "1";
    b.addEventListener("click", (e) => {
      e.preventDefault();
      cart.add(JSON.parse(b.dataset.add));
      toast("Добавлено в корзину");
    });
  });
}

function cardHTML(p) {
  const img = p.image
    ? `<img loading="lazy" src="${esc(p.image)}" alt="${esc(p.title)}" onerror="this.parentNode.innerHTML='<div class=&quot;ph&quot;>нет фото</div>'">`
    : `<div class="ph">нет фото</div>`;
  const disc = p.oldPrice && p.oldPrice > p.price ? `<span class="old">${money(p.oldPrice, p.currency)}</span>` : "";
  const badge = !p.available
    ? `<span class="badge out">нет в наличии</span>`
    : (p.featured ? `<span class="badge hit">🔥 ХИТ</span>` : (disc ? `<span class="badge">-скидка</span>` : ""));
  const payload = esc(JSON.stringify({ id: p.id, title: p.title, price: p.price, currency: p.currency, image: p.image }));
  const addBtn = p.available
    ? `<button class="add-btn" data-add="${payload}" title="В корзину"><svg fill="none" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg></button>`
    : "";
  return `<article class="card">
    <a class="card-img" href="/product.html?id=${encodeURIComponent(p.id)}">${badge}${img}</a>
    <div class="card-body">
      ${p.category ? `<span class="card-cat">${esc(p.category)}</span>` : ""}
      <div class="card-title"><a href="/product.html?id=${encodeURIComponent(p.id)}">${esc(p.title)}</a></div>
      <div class="card-foot">
        <span class="price">${money(p.price, p.currency)}${disc}</span>
        ${addBtn}
      </div>
    </div>
  </article>`;
}

function renderCategories(cats) {
  const el = document.getElementById("chips");
  const all = `<button class="chip ${state.category === "" ? "active" : ""}" data-cat="">Все</button>`;
  el.innerHTML = all + (cats || []).map((c) =>
    `<button class="chip ${state.category === c.name ? "active" : ""}" data-cat="${esc(c.name)}">${esc(c.name)} <span style="opacity:.6">${c.count}</span></button>`
  ).join("");
  el.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
    state.category = b.dataset.cat; loadProducts(true);
  }));
}

function renderPager() {
  const el = document.getElementById("pager");
  const shown = state.offset + state.limit;
  if (shown >= state.total) { el.innerHTML = ""; return; }
  el.innerHTML = `<button class="btn btn-line" id="more">Показать ещё</button>`;
  document.getElementById("more").addEventListener("click", () => { state.offset += state.limit; loadProducts(false); });
}

// ---- Корзина UI ----
function updateCartCount() { document.querySelectorAll(".cart-count").forEach((e) => e.textContent = cart.count()); }

function renderCart() {
  const body = document.getElementById("cart-body");
  if (!body) return;
  if (!cart.items.length) {
    body.innerHTML = `<div class="state"><h3>Корзина пуста</h3><p>Добавьте товары из каталога.</p></div>`;
  } else {
    body.innerHTML = cart.items.map((i) => `
      <div class="ci">
        ${i.image ? `<img src="${esc(i.image)}" alt="">` : `<div class="ph"></div>`}
        <div class="ci-main">
          <div class="ci-title">${esc(i.title)}</div>
          <div class="ci-price">${money(i.price, i.currency)}</div>
          <div class="qty">
            <button data-dec="${esc(i.id)}">−</button><span>${i.qty}</span><button data-inc="${esc(i.id)}">+</button>
          </div>
        </div>
        <button class="ci-rm" data-rm="${esc(i.id)}">✕</button>
      </div>`).join("");
    body.querySelectorAll("[data-inc]").forEach((b) => b.onclick = () => cart.setQty(b.dataset.inc, (cart.items.find(i => i.id === b.dataset.inc)?.qty || 0) + 1));
    body.querySelectorAll("[data-dec]").forEach((b) => b.onclick = () => cart.setQty(b.dataset.dec, (cart.items.find(i => i.id === b.dataset.dec)?.qty || 0) - 1));
    body.querySelectorAll("[data-rm]").forEach((b) => b.onclick = () => cart.remove(b.dataset.rm));
  }
  const tot = document.getElementById("cart-total");
  if (tot) tot.textContent = money(cart.total());
  const btn = document.getElementById("checkout-btn");
  if (btn) btn.disabled = !cart.items.length;
}

function openCart() { document.getElementById("overlay").classList.add("show"); document.getElementById("drawer").classList.add("show"); renderCart(); }
function closeCart() { document.getElementById("overlay").classList.remove("show"); document.getElementById("drawer").classList.remove("show"); }

let toastT;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

async function checkout(e) {
  e.preventDefault();
  const name = document.getElementById("c-name").value.trim();
  const phone = document.getElementById("c-phone").value.trim();
  const comment = document.getElementById("c-comment").value.trim();
  if (!name || !phone) { toast("Заполните имя и телефон"); return; }
  const btn = document.getElementById("checkout-btn");
  btn.disabled = true; btn.textContent = "Отправляем…";
  try {
    const res = await fetch("/api/order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, phone, comment, items: cart.items }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    cart.clear();
    document.getElementById("cart-body").innerHTML = `<div class="state"><h3>Заказ принят! 🎉</h3><p>Заказ #${esc(data.orderId)}. Свяжемся с вами в ближайшее время.</p></div>`;
    document.getElementById("checkout-form").style.display = "none";
    toast("Заказ отправлен");
  } catch (err) {
    toast("Ошибка: " + (err.message || "попробуйте позже"));
    btn.disabled = false; btn.textContent = "Оформить заказ";
  }
}

// ---- init ----
function applyConfig() {
  document.querySelectorAll("[data-site-name]").forEach((e) => e.textContent = S.name || "SHOP");
  const h = document.getElementById("hero-title"); if (h) h.textContent = S.heroTitle || "";
  const p = document.getElementById("hero-text"); if (p) p.textContent = S.heroText || "";
  document.querySelectorAll("[data-tg]").forEach((e) => { if (S.telegram) e.href = S.telegram; });
  document.querySelectorAll("[data-phone]").forEach((e) => { if (S.phone) { e.href = "tel:" + S.phone; e.textContent = S.phone; } });
}

document.addEventListener("DOMContentLoaded", () => {
  applyConfig();
  updateCartCount();
  loadProducts(true);
  track("pageview");

  const si = document.getElementById("search-input");
  let deb;
  si.addEventListener("input", () => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.q = si.value.trim(); if (state.q) track("search", null, { q: state.q }); loadProducts(true); }, 350);
  });
  document.getElementById("sort").addEventListener("change", (e) => { state.sort = e.target.value; loadProducts(true); });
  document.getElementById("cart-open").addEventListener("click", openCart);
  document.getElementById("cart-close").addEventListener("click", closeCart);
  document.getElementById("overlay").addEventListener("click", closeCart);
  document.getElementById("checkout-form").addEventListener("submit", checkout);
});
