// Общие помощники для работы с Cloudflare D1.
// Папки/файлы с префиксом "_" не превращаются в маршруты Pages Functions.

export function getDB(env) {
  if (!env || !env.DB) {
    throw new HttpError(
      503,
      "База данных не подключена. Создай D1 и привяжи binding DB (см. README / wrangler.toml)."
    );
  }
  return env.DB;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

export function errorResponse(err) {
  const status = err instanceof HttpError ? err.status : 500;
  return json({ ok: false, error: err.message || "Ошибка сервера" }, status);
}

// Гарантирует, что таблицы существуют (безопасно вызывать при каждом запросе).
let schemaReady = false;
export async function ensureSchema(db) {
  if (schemaReady) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, sku TEXT, title TEXT NOT NULL, description TEXT,
      price REAL DEFAULT 0, old_price REAL, currency TEXT DEFAULT 'UAH',
      category TEXT, vendor TEXT, image TEXT, images TEXT,
      available INTEGER DEFAULT 1, params TEXT, url TEXT, source TEXT,
      cost REAL, featured INTEGER DEFAULT 0,
      created_at INTEGER, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT, title TEXT,
      cost REAL, retail REAL, markup REAL, reason TEXT, angle TEXT, ts INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_picks_ts ON ai_picks(ts)`,
    `CREATE TABLE IF NOT EXISTS bundles (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, image TEXT,
      pick_count INTEGER DEFAULT 3, price_mode TEXT DEFAULT 'fixed',
      fixed_price REAL DEFAULT 0, discount REAL DEFAULT 0, currency TEXT DEFAULT 'грн',
      items TEXT, active INTEGER DEFAULT 1, created_at INTEGER, updated_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS tg_sessions (
      chat_id TEXT PRIMARY KEY, state TEXT, updated_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`,
    `CREATE INDEX IF NOT EXISTS idx_products_available ON products(available)`,
    `CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at)`,
    `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT, parent TEXT)`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, contact TEXT, comment TEXT,
      items TEXT, total REAL DEFAULT 0, currency TEXT DEFAULT 'UAH',
      status TEXT DEFAULT 'new', created_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at)`,
    `CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, product_id TEXT,
      meta TEXT, ts INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)`,
    `CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)`,
    `CREATE INDEX IF NOT EXISTS idx_events_prod ON events(product_id)`,
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  ];
  for (const sql of statements) {
    await db.prepare(sql).run();
  }
  // Догоняющие миграции для уже созданных баз (безопасно игнорируем "duplicate column").
  for (const sql of [
    "ALTER TABLE products ADD COLUMN cost REAL",
    "ALTER TABLE products ADD COLUMN featured INTEGER DEFAULT 0",
  ]) {
    try { await db.prepare(sql).run(); } catch (_) { /* колонка уже есть */ }
  }
  schemaReady = true;
}

// Приводит строку БД к товару для отдачи наружу.
export function rowToProduct(row) {
  if (!row) return null;
  let images = [];
  let params = {};
  try { images = row.images ? JSON.parse(row.images) : []; } catch { images = []; }
  try { params = row.params ? JSON.parse(row.params) : {}; } catch { params = {}; }
  return {
    id: row.id,
    sku: row.sku || null,
    title: row.title,
    description: row.description || "",
    price: row.price || 0,
    oldPrice: row.old_price || null,
    currency: row.currency || "UAH",
    category: row.category || null,
    vendor: row.vendor || null,
    image: row.image || (images[0] || null),
    images: images.length ? images : (row.image ? [row.image] : []),
    available: row.available === 1 || row.available === true,
    featured: row.featured === 1 || row.featured === true,
    cost: row.cost != null ? row.cost : null,
    params,
    url: row.url || null,
    source: row.source || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function rowToBundle(row) {
  if (!row) return null;
  let items = [];
  try { items = row.items ? JSON.parse(row.items) : []; } catch { items = []; }
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    image: row.image || (items[0] && items[0].image) || null,
    pickCount: row.pick_count || 3,
    priceMode: row.price_mode || "fixed",   // fixed | sum | discount
    fixedPrice: row.fixed_price || 0,
    discount: row.discount || 0,
    currency: row.currency || "грн",
    items,                                   // [{id,title,price,image}]
    active: row.active === 1 || row.active === true,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

// Авторитетная цена набора по выбранным позициям (используется на сервере и в боте).
export function bundlePrice(bundle, chosen) {
  const sum = (chosen || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
  if (bundle.priceMode === "fixed") return Math.round(bundle.fixedPrice || 0);
  if (bundle.priceMode === "discount") return Math.round(sum * (1 - (bundle.discount || 0) / 100));
  return Math.round(sum);
}
