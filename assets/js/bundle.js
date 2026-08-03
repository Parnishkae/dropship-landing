// ── Конструктор набора: выбери N из M, цена пересчитывается вживую ──
const CART_KEY = "dropshop_cart";
const S = window.SITE || {};
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const money = (v, cur) => `${Math.round(Number(v) || 0)} ${cur || S.currency || "грн"}`;

function bundlePrice(b, chosen) {
  const sum = chosen.reduce((s, i) => s + (Number(i.price) || 0), 0);
  if (b.priceMode === "fixed") return Math.round(b.fixedPrice || 0);
  if (b.priceMode === "discount") return Math.round(sum * (1 - (b.discount || 0) / 100));
  return Math.round(sum);
}

const state = { bundle: null, picks: [] };

async function load() {
  const id = new URLSearchParams(location.search).get("id");
  const root = document.getElementById("bd-root");
  if (!id) { root.innerHTML = `<div class="state"><h3>Набор не выбран</h3><a class="btn btn-line" href="/">← В каталог</a></div>`; return; }
  try {
    const r = await fetch("/api/bundle/" + encodeURIComponent(id));
    const d = await r.json();
    if (!d.ok) throw new Error(d.error);
    state.bundle = d.bundle;
    render();
  } catch (e) {
    root.innerHTML = `<div class="state"><h3>Набор не найден</h3><p>${esc(e.message || "")}</p><a class="btn btn-line" href="/">← В каталог</a></div>`;
  }
}

function toggle(idx) {
  const b = state.bundle;
  const has = state.picks.includes(idx);
  if (has) state.picks = state.picks.filter((i) => i !== idx);
  else {
    if (state.picks.length >= b.pickCount) { toast(`Можно выбрать только ${b.pickCount}`); return; }
    state.picks.push(idx);
  }
  update();
}

function chosenItems() { return state.picks.map((i) => state.bundle.items[i]); }

function render() {
  const b = state.bundle;
  document.title = b.title + " — набор";
  const opts = b.items.map((it, i) => `
    <button class="opt" data-i="${i}" type="button">
      <span class="opt-check"></span>
      ${it.image ? `<img src="${esc(it.image)}" alt="" onerror="this.style.display='none'">` : `<div class="opt-ph">нет фото</div>`}
      <span class="opt-title">${esc(it.title)}</span>
      <span class="opt-price">${money(it.price, b.currency)}</span>
    </button>`).join("");

  const hint = b.priceMode === "fixed"
    ? `Любые ${b.pickCount} — за фиксированную цену`
    : b.priceMode === "discount"
      ? `Скидка ${b.discount}% на выбранные ${b.pickCount}`
      : `Соберите ${b.pickCount} — платите за выбранное`;

  document.getElementById("bd-root").innerHTML = `
    <div class="crumbs"><a href="/">Каталог</a> / Наборы</div>
    <div class="bd-head">
      <h1>${esc(b.title)}</h1>
      <p class="bd-sub">${esc(b.description || "")}</p>
      <div class="bd-rule">🎁 Выберите <b>${b.pickCount}</b> из <b>${b.items.length}</b> · ${esc(hint)}</div>
    </div>
    <div class="builder-grid" id="opts">${opts}</div>
    <div class="bd-bar" id="bar">
      <div><span id="bd-count">0</span>/${b.pickCount} выбрано</div>
      <div class="bd-price" id="bd-price">${money(0, b.currency)}</div>
      <button class="btn btn-primary" id="bd-add" disabled>Добавить набор в корзину</button>
    </div>`;

  document.querySelectorAll(".opt").forEach((el) => el.addEventListener("click", () => toggle(+el.dataset.i)));
  document.getElementById("bd-add").addEventListener("click", addToCart);
  update();
}

function update() {
  const b = state.bundle;
  document.querySelectorAll(".opt").forEach((el) => el.classList.toggle("selected", state.picks.includes(+el.dataset.i)));
  const complete = state.picks.length === b.pickCount;
  const price = complete ? bundlePrice(b, chosenItems()) : bundlePrice(b, chosenItems());
  document.getElementById("bd-count").textContent = state.picks.length;
  document.getElementById("bd-price").textContent = money(price, b.currency);
  const add = document.getElementById("bd-add");
  add.disabled = !complete;
  document.getElementById("bar").classList.toggle("ready", complete);
}

function addToCart() {
  const b = state.bundle;
  const chosen = chosenItems();
  const price = bundlePrice(b, chosen);
  const id = b.id + ":" + state.picks.slice().sort((a, z) => a - z).join(",");
  const title = `Набор «${b.title}»: ` + chosen.map((i) => i.title).join(" + ");
  const item = { id, title, price, currency: b.currency, image: b.image || chosen[0]?.image, qty: 1, bundle: b.id };
  const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
  const ex = cart.find((i) => i.id === id);
  if (ex) ex.qty += 1; else cart.push(item);
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  location.href = "/?cart=1";
}

let toastT;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-site-name]").forEach((e) => e.textContent = S.name || "SHOP");
  document.querySelectorAll("[data-tg]").forEach((e) => { if (S.telegram) e.href = S.telegram; });
  load();
});
