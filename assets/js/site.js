// Общие для всех страниц: заполнение бренда/контактов, подвал, cookie-баннер.
(function () {
  const S = window.SITE || {};
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const year = new Date().getFullYear();

  function fillBrand() {
    document.querySelectorAll("[data-site-name]").forEach((e) => e.textContent = S.name || "SHOP");
    document.querySelectorAll("[data-tg]").forEach((e) => { if (S.telegram) e.href = S.telegram; });
    document.querySelectorAll("[data-phone]").forEach((e) => { if (S.phone) { e.href = "tel:" + S.phone; if (!e.dataset.keep) e.textContent = S.phone; } });
    document.querySelectorAll("[data-email]").forEach((e) => { if (S.email) { e.href = "mailto:" + S.email; if (!e.dataset.keep) e.textContent = S.email; } });
    document.querySelectorAll("[data-year]").forEach((e) => e.textContent = year);
  }

  function renderFooter() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    const tg = S.telegram || "#";
    const ig = S.instagram;
    el.innerHTML = `
      <div class="wrap footer-top">
        <div class="footer-brand">
          <a href="/" class="logo"><span class="dot"></span><span>${esc(S.name || "SHOP")}</span></a>
          <p>${esc(S.heroText || S.tagline || "")}</p>
          <div class="pay"><span>VISA</span><span>Mastercard</span><span>Наложенный платёж</span><span>Нова Пошта</span></div>
        </div>
        <div class="footer-col">
          <h4>Магазин</h4>
          <a href="/">Каталог</a>
          <a href="/#catalog">Товары</a>
          <a href="/#bundles-band">Наборы</a>
        </div>
        <div class="footer-col">
          <h4>Покупателю</h4>
          <a href="/delivery.html">Доставка и оплата</a>
          <a href="/returns.html">Возврат и обмен</a>
          <a href="/offer.html">Публичная оферта</a>
          <a href="/privacy.html">Конфиденциальность</a>
        </div>
        <div class="footer-col">
          <h4>Контакты</h4>
          <a href="/contacts.html">Все контакты</a>
          <a href="tel:${esc(S.phone || "")}">${esc(S.phone || "")}</a>
          <a href="mailto:${esc(S.email || "")}">${esc(S.email || "")}</a>
          <a href="${esc(tg)}" target="_blank" rel="noopener">Telegram</a>
          ${ig ? `<a href="${esc(ig)}" target="_blank" rel="noopener">Instagram</a>` : ""}
        </div>
      </div>
      <div class="wrap footer-bottom">
        <span>© ${year} ${esc(S.name || "SHOP")}. Все права защищены.</span>
        <span><a href="/privacy.html">Политика конфиденциальности</a> · <a href="/offer.html">Оферта</a></span>
      </div>`;
  }

  function cookieBanner() {
    if (localStorage.getItem("cookie_ok") === "1") return;
    const bar = document.createElement("div");
    bar.className = "cookie";
    bar.innerHTML = `<p>Мы используем cookie, чтобы сайт работал удобнее. Продолжая, вы соглашаетесь с <a href="/privacy.html">политикой конфиденциальности</a>.</p><button class="btn btn-primary" type="button">Принять</button>`;
    document.body.appendChild(bar);
    requestAnimationFrame(() => bar.classList.add("show"));
    bar.querySelector("button").addEventListener("click", () => {
      localStorage.setItem("cookie_ok", "1");
      bar.classList.remove("show");
      setTimeout(() => bar.remove(), 300);
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    renderFooter();
    fillBrand();     // после рендера подвала, чтобы заполнить и его
    cookieBanner();
  });
})();
