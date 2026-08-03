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
  cost        REAL,            -- закупочная цена (база для наценки)
  featured    INTEGER DEFAULT 0, -- «ХИТ» / выбран ИИ
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

-- Лог авто-подбора товаров ИИ
CREATE TABLE IF NOT EXISTS ai_picks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  title      TEXT,
  cost       REAL,
  retail     REAL,
  markup     REAL,
  reason     TEXT,
  angle      TEXT,
  ts         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_picks_ts ON ai_picks(ts);

-- Наборы-конструкторы (выбери N из M)
CREATE TABLE IF NOT EXISTS bundles (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  image       TEXT,
  pick_count  INTEGER DEFAULT 3,   -- сколько позиций выбрать
  price_mode  TEXT DEFAULT 'fixed',-- fixed | sum | discount
  fixed_price REAL DEFAULT 0,
  discount    REAL DEFAULT 0,      -- % скидки для режима discount
  currency    TEXT DEFAULT 'грн',
  items       TEXT,                -- JSON: [{id,title,price,image}]
  active      INTEGER DEFAULT 1,
  created_at  INTEGER,
  updated_at  INTEGER
);

-- Состояния диалогов Telegram-бота
CREATE TABLE IF NOT EXISTS tg_sessions (
  chat_id    TEXT PRIMARY KEY,
  state      TEXT,
  updated_at INTEGER
);
