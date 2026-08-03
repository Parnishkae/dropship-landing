// POST /api/admin/import — приём нормализованных товаров (XML парсится в браузере).
// Тело: { products: [...], mode: "merge" | "replace", source: "имя_файла.xml" }
import { getDB, ensureSchema, json, errorResponse, HttpError } from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";

function num(v) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalize(p, source, now) {
  const images = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const image = p.image || images[0] || null;
  const id = String(p.id || p.sku || p.url || p.title || "").trim().slice(0, 200);
  if (!id || !p.title) return null;
  return {
    id,
    sku: p.sku ? String(p.sku).slice(0, 120) : null,
    title: String(p.title).slice(0, 500),
    description: p.description ? String(p.description).slice(0, 8000) : "",
    price: num(p.price) || 0,
    old_price: num(p.oldPrice),
    currency: (p.currency || "UAH").toString().slice(0, 8),
    category: p.category ? String(p.category).slice(0, 200) : null,
    vendor: p.vendor ? String(p.vendor).slice(0, 200) : null,
    image,
    images: JSON.stringify(images.length ? images : image ? [image] : []),
    available: p.available === false ? 0 : 1,
    params: p.params && typeof p.params === "object" ? JSON.stringify(p.params) : null,
    url: p.url ? String(p.url).slice(0, 1000) : null,
    source: source || null,
    updated_at: now,
  };
}

export async function onRequestPost({ request, env }) {
  try {
    await requireAuth(request, env);
    const db = getDB(env);
    await ensureSchema(db);

    const body = await request.json();
    const incoming = Array.isArray(body.products) ? body.products : [];
    const mode = body.mode === "replace" ? "replace" : "merge";
    const source = body.source ? String(body.source).slice(0, 200) : "import";
    if (!incoming.length) throw new HttpError(400, "В файле не найдено ни одного товара.");

    const now = Date.now();
    const rows = [];
    const seen = new Set();
    for (const p of incoming) {
      const r = normalize(p, source, now);
      if (r && !seen.has(r.id)) { seen.add(r.id); rows.push(r); }
    }
    if (!rows.length) throw new HttpError(400, "Товары есть, но у них нет id/названия — проверь формат XML.");

    if (mode === "replace") {
      await db.prepare("DELETE FROM products").run();
    }

    const upsert = `INSERT INTO products
      (id, sku, title, description, price, old_price, currency, category, vendor,
       image, images, available, params, url, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        sku=excluded.sku, title=excluded.title, description=excluded.description,
        price=excluded.price, old_price=excluded.old_price, currency=excluded.currency,
        category=excluded.category, vendor=excluded.vendor, image=excluded.image,
        images=excluded.images, available=excluded.available, params=excluded.params,
        url=excluded.url, source=excluded.source, updated_at=excluded.updated_at`;

    const CHUNK = 40;
    let saved = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const batch = rows.slice(i, i + CHUNK).map((r) =>
        db.prepare(upsert).bind(
          r.id, r.sku, r.title, r.description, r.price, r.old_price, r.currency,
          r.category, r.vendor, r.image, r.images, r.available, r.params, r.url,
          r.source, now, r.updated_at
        )
      );
      await db.batch(batch);
      saved += batch.length;
    }

    // Обновляем справочник категорий.
    await db.prepare("DELETE FROM categories").run();
    const cats = await db.prepare(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND category != ''`
    ).all();
    const catRows = (cats.results || []).map((c) =>
      db.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)").bind(c.category, c.category)
    );
    if (catRows.length) {
      for (let i = 0; i < catRows.length; i += CHUNK) {
        await db.batch(catRows.slice(i, i + CHUNK));
      }
    }

    const totalRow = await db.prepare("SELECT COUNT(*) AS c FROM products").first();

    return json({
      ok: true,
      imported: saved,
      skipped: incoming.length - rows.length,
      totalInCatalog: totalRow ? totalRow.c : saved,
      mode,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
