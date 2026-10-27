-- Smart Store Sync - database schema (PostgreSQL)
-- Idempotent: safe to run multiple times.

CREATE TABLE IF NOT EXISTS products (
  id             SERIAL PRIMARY KEY,
  sku            VARCHAR(100) NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  description    TEXT DEFAULT '',
  price          NUMERIC(14, 0) NOT NULL DEFAULT 0,      -- Toman
  discount_price NUMERIC(14, 0),                          -- optional sale price
  stock          INTEGER NOT NULL DEFAULT 0,
  category       VARCHAR(150) DEFAULT '',
  image_url      TEXT DEFAULT '',
  attributes     JSONB NOT NULL DEFAULT '{}'::jsonb,
  source         VARCHAR(50) NOT NULL DEFAULT 'manual',   -- manual | csv | store
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- History of detected changes (price / stock / details)
CREATE TABLE IF NOT EXISTS product_changes (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  field       VARCHAR(50) NOT NULL,                       -- price | discount_price | stock | name | description
  old_value   TEXT,
  new_value   TEXT,
  source      VARCHAR(50) NOT NULL DEFAULT 'manual',
  processed   BOOLEAN NOT NULL DEFAULT FALSE,             -- handled by n8n / sync workflow
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_changes_product ON product_changes(product_id);
CREATE INDEX IF NOT EXISTS idx_changes_unprocessed ON product_changes(processed) WHERE processed = FALSE;

-- AI-generated marketing content, waiting for human approval
CREATE TABLE IF NOT EXISTS contents (
  id           SERIAL PRIMARY KEY,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel      VARCHAR(30) NOT NULL,                      -- website | instagram | telegram | discount
  body         TEXT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | published | failed
  generated_by VARCHAR(50) NOT NULL DEFAULT 'ai',         -- ai | template | manual
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status);

-- Every operation (sync, publish, AI call, import) is logged here; failed ones can be retried
CREATE TABLE IF NOT EXISTS operations (
  id           SERIAL PRIMARY KEY,
  type         VARCHAR(50) NOT NULL,                      -- import_csv | generate_content | publish_telegram | sync
  status       VARCHAR(20) NOT NULL DEFAULT 'success',    -- success | failed | retrying
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  message      TEXT DEFAULT '',
  attempts     INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);

-- Key/value store settings (store tone of voice, telegram channel, ...). Secrets stay in .env.
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(100) PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('store_name', 'فروشگاه من'),
  ('brand_tone', 'صمیمی، حرفه‌ای و کوتاه'),
  ('telegram_chat_id', ''),
  ('auto_generate_on_change', 'true'),
  ('brand_color', '#5b4cf0')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- v0.2: multi-platform publishing (platforms, destinations, templates)
-- =====================================================================

-- Product gallery (list of image URLs; first one is the main image)
ALTER TABLE products ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;
UPDATE products SET images = jsonb_build_array(image_url)
 WHERE image_url <> '' AND images = '[]'::jsonb;

-- Social networks / channels (built-in + user-defined)
CREATE TABLE IF NOT EXISTS platforms (
  id          SERIAL PRIMARY KEY,
  key         VARCHAR(50) NOT NULL UNIQUE,
  name        VARCHAR(100) NOT NULL,
  icon        VARCHAR(30) NOT NULL DEFAULT 'globe',
  color       VARCHAR(20) NOT NULL DEFAULT '#6366f1',
  delivery    VARCHAR(20) NOT NULL DEFAULT 'manual',   -- telegram | email | webhook | manual
  max_length  INTEGER,
  style_guide TEXT NOT NULL DEFAULT '',
  is_builtin  BOOLEAN NOT NULL DEFAULT FALSE,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO platforms (key, name, icon, color, delivery, max_length, style_guide, is_builtin, sort_order) VALUES
  ('telegram',  'تلگرام',    'telegram',  '#229ED9', 'telegram', 4096,
   'پیام کانال تلگرام؛ کوتاه و خوانا، با تیتر، قیمت، وضعیت موجودی و دعوت به خرید. چند ایموجی مناسب.', TRUE, 1),
  ('instagram', 'اینستاگرام', 'instagram', '#E1306C', 'manual',   2200,
   'کپشن اینستاگرام؛ جذاب و احساسی، حداکثر ۸ خط، ایموجی مناسب و ۵ تا ۸ هشتگ فارسی مرتبط در انتها.', TRUE, 2),
  ('website',   'وب‌سایت',    'globe',     '#0EA5E9', 'manual',   NULL,
   'متن معرفی محصول برای صفحه وب‌سایت؛ ۲ تا ۳ پاراگراف، سئو-محور، رسمی و بدون ایموجی.', TRUE, 3),
  ('sms',       'پیامک',      'sms',       '#16A34A', 'webhook',  335,
   'پیامک تبلیغاتی؛ بسیار کوتاه (حداکثر ۲ خط)، بدون ایموجی، شامل نام محصول، قیمت و نام فروشگاه.', TRUE, 4),
  ('email',     'ایمیل',      'mail',      '#F59E0B', 'email',    NULL,
   'ایمیل خبرنامه؛ یک خط عنوان جذاب، سپس متن کوتاه معرفی، قیمت و دعوت به خرید.', TRUE, 5)
ON CONFLICT (key) DO NOTHING;

-- Concrete targets of a platform: e.g. several Telegram channels, several SMS lists
CREATE TABLE IF NOT EXISTS destinations (
  id          SERIAL PRIMARY KEY,
  platform_id INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  name        VARCHAR(150) NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_destinations_platform ON destinations(platform_id);

-- Content templates per platform (optionally per destination) and per content kind
CREATE TABLE IF NOT EXISTS content_templates (
  id             SERIAL PRIMARY KEY,
  platform_id    INTEGER NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  destination_id INTEGER REFERENCES destinations(id) ON DELETE CASCADE,
  kind           VARCHAR(30) NOT NULL DEFAULT 'intro',  -- intro | discount | restock | price_change
  name           VARCHAR(150) NOT NULL,
  title          VARCHAR(255) NOT NULL DEFAULT '',      -- e-mail subject
  body           TEXT NOT NULL,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_templates_platform ON content_templates(platform_id);

-- Contents: channel = platform key; kind = type of message
ALTER TABLE contents ADD COLUMN IF NOT EXISTS kind VARCHAR(30) NOT NULL DEFAULT 'intro';
ALTER TABLE contents ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT '';
ALTER TABLE contents ADD COLUMN IF NOT EXISTS template_id INTEGER REFERENCES content_templates(id) ON DELETE SET NULL;
ALTER TABLE contents ADD COLUMN IF NOT EXISTS destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL;
UPDATE contents SET kind = 'discount', channel = 'telegram' WHERE channel = 'discount';

-- One row per (content -> destination) delivery
CREATE TABLE IF NOT EXISTS publications (
  id             SERIAL PRIMARY KEY,
  content_id     INTEGER NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  status         VARCHAR(20) NOT NULL DEFAULT 'scheduled', -- scheduled | sending | sent | failed | manual
  scheduled_at   TIMESTAMPTZ,
  sent_at        TIMESTAMPTZ,
  message        TEXT NOT NULL DEFAULT '',
  external_id    VARCHAR(100),
  attempts       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_publications_status ON publications(status);
CREATE INDEX IF NOT EXISTS idx_publications_content ON publications(content_id);
-- v0.1 used status 'failed' on contents; failures now live on publications
UPDATE contents SET status = 'approved' WHERE status = 'failed';

-- =====================================================================
-- v0.3: rich content — images, videos, audio and link buttons
-- =====================================================================
ALTER TABLE contents ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;   -- [{type,url,name,mime,size}]
ALTER TABLE contents ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;   -- [{title,url}]
ALTER TABLE contents ADD COLUMN IF NOT EXISTS use_product_image BOOLEAN NOT NULL DEFAULT TRUE;

-- =====================================================================
-- v0.4: product videos, product-media mode, template attachments
-- =====================================================================
-- product_media: none | main (first gallery item) | all (whole gallery)
ALTER TABLE contents ADD COLUMN IF NOT EXISTS product_media VARCHAR(10) NOT NULL DEFAULT 'main';
UPDATE contents SET product_media = 'none' WHERE use_product_image = FALSE AND product_media = 'main';
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS links JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE content_templates ADD COLUMN IF NOT EXISTS product_media VARCHAR(10) NOT NULL DEFAULT 'main';

-- =====================================================================
-- v0.5: store logo & dashboard hero slides (stored as settings)
-- =====================================================================
INSERT INTO settings (key, value) VALUES ('logo_url', ''), ('hero_slides', '[]'), ('language', 'fa')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- v0.6: interactive Telegram buttons & user feedback inbox
-- =====================================================================
CREATE TABLE IF NOT EXISTS feedback (
  id           SERIAL PRIMARY KEY,
  kind         VARCHAR(20) NOT NULL,                  -- click | start | message
  content_id   INTEGER REFERENCES contents(id) ON DELETE SET NULL,
  button_id    VARCHAR(20),
  button_title TEXT NOT NULL DEFAULT '',
  tg_user_id   BIGINT,
  tg_username  VARCHAR(100) NOT NULL DEFAULT '',
  tg_name      VARCHAR(200) NOT NULL DEFAULT '',
  chat_id      BIGINT,                                -- private chat with the bot (when known)
  text         TEXT NOT NULL DEFAULT '',              -- what the user wrote
  auto_reply   TEXT NOT NULL DEFAULT '',              -- what the bot answered automatically
  reply        TEXT NOT NULL DEFAULT '',              -- manual answer from the panel / n8n
  status       VARCHAR(20) NOT NULL DEFAULT 'new',    -- new | seen | replied
  replied_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_content ON feedback(content_id);
INSERT INTO settings (key, value) VALUES
  ('bot_welcome', 'سلام! 👋 پیام شما به فروشگاه رسید و به‌زودی پاسخ می‌دهیم.'),
  ('tg_update_offset', '0')
ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- v0.7: reusable automatic interactions (review, order, payment, ...)
-- =====================================================================
CREATE TABLE IF NOT EXISTS interactions (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(60) NOT NULL,
  emoji         VARCHAR(16) NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  mode          VARCHAR(10) NOT NULL DEFAULT 'flow',   -- flow (bot conversation) | popup (instant alert)
  popup_text    TEXT NOT NULL DEFAULT '',
  steps         JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{type: message|text|choice|contact|payment, text, ...}]
  final_message TEXT NOT NULL DEFAULT '',
  notify_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One conversation of a user with an interaction (started from a button under a post)
CREATE TABLE IF NOT EXISTS interaction_sessions (
  id             SERIAL PRIMARY KEY,
  interaction_id INTEGER NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  content_id     INTEGER REFERENCES contents(id) ON DELETE SET NULL,
  tg_user_id     BIGINT,
  tg_username    VARCHAR(100) NOT NULL DEFAULT '',
  tg_name        VARCHAR(200) NOT NULL DEFAULT '',
  chat_id        BIGINT,
  step           INTEGER NOT NULL DEFAULT 0,
  answers        JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{key, question, answer}]
  status         VARCHAR(20) NOT NULL DEFAULT 'active', -- active | completed | cancelled
  reply          TEXT NOT NULL DEFAULT '',
  seen           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_isessions_chat ON interaction_sessions(chat_id, status);
CREATE INDEX IF NOT EXISTS idx_isessions_content ON interaction_sessions(content_id);
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS interaction_id INTEGER REFERENCES interactions(id) ON DELETE SET NULL;
INSERT INTO settings (key, value) VALUES ('admin_chat_id', ''), ('payment_link', '') ON CONFLICT (key) DO NOTHING;

-- =====================================================================
-- v0.8: authentication — dashboard users and login sessions
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(120) NOT NULL DEFAULT '',
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,                          -- scrypt$<salt>$<hash>
  role          VARCHAR(20) NOT NULL DEFAULT 'member',  -- admin | member
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- Opaque bearer tokens; only the SHA-256 of the token is stored
CREATE TABLE IF NOT EXISTS auth_sessions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   CHAR(64) NOT NULL UNIQUE,
  user_agent   VARCHAR(255) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS ip VARCHAR(64) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_users_unverified ON users(created_at) WHERE email_verified_at IS NULL;

-- One-time e-mail links (verify address, reset password); only the SHA-256 of the token is stored
CREATE TABLE IF NOT EXISTS auth_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       VARCHAR(20) NOT NULL,                     -- verify_email | reset_password
  token_hash CHAR(64) NOT NULL UNIQUE,
  email      VARCHAR(255) NOT NULL DEFAULT '',         -- address the link was sent to
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id, kind);
