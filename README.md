# 🛒 Дропшип-магазин

Сайт для дропшипинга на Cloudflare Pages: витрина с каталогом товаров, загрузка товаров из **XML-фида** (YML / Google Merchant / произвольный XML), интеграция с **Telegram**, **статистика** и **ИИ-аналитика** на Claude.

## Что внутри

| Раздел | Описание |
|--------|----------|
| **Витрина** (`/`) | Каталог с поиском, фильтром по категориям, сортировкой, корзиной и оформлением заказа |
| **Карточка товара** (`/product.html?id=…`) | Галерея, характеристики, похожие товары |
| **Админка** (`/admin.html`) | Вход по паролю, загрузка XML, управление товарами, статистика, ИИ-аналитика |
| **Telegram** | Заявки и заказы автоматически падают в ваш чат/канал |
| **ИИ-аналитика** | Claude разбирает данные магазина и даёт конкретные советы (или встроенный базовый анализ без ключа) |

Технологии: Cloudflare Pages + Pages Functions (API) + Cloudflare D1 (база данных). Внешних зависимостей нет.

## Структура

```
index.html            витрина (каталог)
product.html          страница товара
admin.html            админ-панель
assets/css, assets/js статика (в т.ч. config.js — контакты магазина)
functions/api/…       API (Pages Functions)
functions/_lib/…      общие модули (БД, авторизация)
schema.sql            схема базы данных
wrangler.toml         конфиг Cloudflare
```

## Настройка (пошагово)

### 1. Создать базу данных D1
```bash
npx wrangler d1 create dropship-db
```
Скопируйте `database_id` из вывода и вставьте в `wrangler.toml` (поле `database_id`).

Примените схему:
```bash
npx wrangler d1 execute dropship-db --remote --file=./schema.sql
```

### 2. Задать секреты
В дашборде Cloudflare Pages → ваш проект → **Settings → Environment variables** (или через CLI `npx wrangler pages secret put <ИМЯ>`):

| Переменная | Обязательно | Что это |
|-----------|:----------:|---------|
| `ADMIN_PASSWORD` | ✅ | Пароль для входа в `/admin.html` |
| `AUTH_SECRET` | ✅ | Любая случайная строка 32+ символов (подпись сессии) |
| `BOT_TOKEN` | для Telegram | Токен бота от [@BotFather](https://t.me/BotFather) |
| `CHAT_ID` | для Telegram | ID чата/канала, куда слать заказы |
| `ANTHROPIC_API_KEY` | для ИИ | Ключ [Claude API](https://console.anthropic.com). Без него работает базовый анализ |
| `AI_MODEL` | нет | Модель Claude (по умолчанию `claude-opus-5`) |

> **Как узнать CHAT_ID:** напишите боту, затем откройте `https://api.telegram.org/bot<BOT_TOKEN>/getUpdates` — id чата будет в ответе.

### 3. Привязать D1 к Pages
В дашборде: **Settings → Functions → D1 database bindings** → добавьте binding с именем `DB`, указывающий на `dropship-db`. (Либо это подхватится из `wrangler.toml` при деплое через `wrangler pages deploy`.)

### 4. Настроить контакты магазина
Отредактируйте `assets/js/config.js` — название, ссылку на Telegram-менеджера, телефон, валюту.

### 5. Задеплоить
Проще всего — подключить репозиторий к Cloudflare Pages (авто-деплой при push). Либо вручную:
```bash
npx wrangler pages deploy .
```

## Как загрузить товары

1. Откройте `/admin.html`, войдите по паролю.
2. Вкладка **📥 Импорт** → перетащите XML-файл поставщика.
3. Файл распознаётся прямо в браузере, показывается превью.
4. Выберите режим (*дополнить* или *заменить каталог*) → **Загрузить в каталог**.

Поддерживаемые форматы фида:
- **YML** (Yandex Market Language) — большинство дропшип-поставщиков, Prom.ua и т.п.
- **Google Merchant** (RSS с тегами `g:`)
- Произвольный XML с тегами `<offer>`, `<item>` или `<product>`

Распознаются: название, цена, старая цена, валюта, категория, бренд, изображения (несколько), наличие, характеристики (`<param>`), ссылка.

## Локальная разработка
```bash
npx wrangler pages dev . --d1 DB=dropship-db
# схема для локальной БД:
npx wrangler d1 execute dropship-db --local --file=./schema.sql
```

## Безопасность
- Админка защищена паролем (`ADMIN_PASSWORD`), сессия — подписанная HttpOnly-кука.
- Токены и ключи хранятся только в секретах Cloudflare, в коде их нет.
- XML парсится в браузере, на сервер уходит уже нормализованный JSON.
