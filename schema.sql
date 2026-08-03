-- Схема базы данных дропшип-магазина (Cloudflare D1 / SQLite)
-- Применить локально:      npx wrangler d1 execute dropship-db --local  --file=./schema.sql
-- Применить на проде:      npx wrangler d1 execute dropship-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  sku         TEXT,
  title       TEXT NOT NULL,
  description TEXT,
  price       REAL DEFAULT 0,
  old_price   REAL,
  currency    TEXT DEFAULT 'UAH',
  category    TEXT,
  vendor      TEXT,
  image       TEXT,
  images      TEXT,            -- JSON-массив ссылок на изображения
  available   INTEGER DEFAULT 1,
  params      TEXT,            -- JSON доп. характеристик (размер, цвет и т.д.)
  url         TEXT,            -- ссылка на товар у поставщика
  source      TEXT,            -- имя импортированного фида
  created_at  INTEGER,
  updated_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(available);
CREATE INDEX IF NOT EXISTS idx_products_updated   ON products(updated_at);

CREATE TABLE IF NOT EXISTS categories (
  id    TEXT PRIMARY KEY,
  name  TEXT,
  parent TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id         TEXT PRIMARY KEY,
  name       TEXT,
  phone      TEXT,
  contact    TEXT,
  comment    TEXT,
  items      TEXT,             -- JSON состава заказа
  total      REAL DEFAULT 0,
  currency   TEXT DEFAULT 'UAH',
  status     TEXT DEFAULT 'new',
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT,             -- pageview | product_view | add_to_cart | order | search
  product_id TEXT,
  meta       TEXT,             -- JSON доп. данных
  ts         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_prod ON events(product_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
