# Smart Store Sync (فروشگاه‌یار هوشمند) — working notes

Persian-first (RTL) dashboard for a store: products → AI/template content → publishing to channels
(Telegram, Instagram, website, SMS, e-mail) + engagement tracking. Reply to the owner in Persian.
Persian guide for people: `docs/HANDOFF.fa.md`. Last updated 2026-10-29.

## Stack & layout
- `backend/` Express + TypeScript (`tsx watch`), PostgreSQL 16, zod. Entry `src/index.ts`, app in `src/app.ts`.
  - Schema: `src/db/schema.sql`, idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`), applied on every start.
    Append new versions at the end (latest section: v0.10).
  - Routes: `src/routes/auth.ts` (auth + guards), `src/routes/api.ts` (everything else, `requireAdmin` for owner-only).
- `frontend/` React + Vite, hash router, Persian strings are the i18n keys: `tr("…")`, English in `src/i18n.en.ts`
  (add every new string there; duplicate keys break the build).
- `.env` lives in the repo root (not committed). `.env.example` documents every variable.

## Run (Windows dev machine)
- `docker compose up -d postgres` (user `sss`, db `smart_store_sync`, port 5432)
- `cd backend && npm run dev` (port 4000) · `cd frontend && npm run dev` (port 5173, proxies /api)
- tsx watch restarts on file changes and re-reads `.env`. On Windows, stopping the task can leave the
  child node process holding port 4000: find it with `Get-NetTCPConnection -LocalPort 4000` and kill it.

## Tests & CI
- `cd backend && npm run typecheck && npm test` — Vitest + supertest against a real Postgres `*_test` DB
  (dropped and recreated per run). Mailer and Telegram Bot API are mocked (`test/setup.ts`, `test/telegram.test.ts`).
- `.github/workflows/ci.yml` runs typecheck, build and tests on every PR and push to main. Flow: feature branch → PR → CI green → merge.
- 94 tests: auth (46) + Telegram bots/channels (26) + Instagram (22, `instagramApi.igRequest` mocked).

## Auth (done)
HttpOnly `sss_session` cookie with opaque tokens (SHA-256 stored), sessions list/revoke, profile, password change/reset,
e-mail verification (unverified non-admins deleted after 7 days), CSRF same-origin check, throttling.
First account = admin. n8n uses `x-api-key` (API_KEY). No explanatory "how the system works" text in UI or e-mails (owner's rule).
SMTP via nodemailer; host resolved with `dns.lookup` because Node's resolver points at a local VPN stub (127.0.0.1).

## Telegram (done)
- Main bot = `TELEGRAM_BOT_TOKEN` (@SmartStoreSyncBot), Bot Management Mode enabled in BotFather.
- It creates each store's own bot as a Telegram *managed bot*: panel link → `/start bot_<token>` →
  `request_managed_bot` button → `managed_bot` update → `getManagedBotToken` → stored AES-GCM encrypted
  (`APP_SECRET`, never change it after bots exist) → `setManagedBotAccessSettings(is_access_restricted=false)`.
  Code: `services/telegramBots.ts`. Note: `getMe.can_manage_bots` lags behind BotFather, so it only logs a warning.
- Channels connect through the store bot: `/start ch_<token>` → `request_chat` (channel, admin rights) → `chat_shared`.
  Code: `services/telegramChannels.ts`. Each channel gets a `destinations` row (`config.tg_channel = true`).
  Tracked: posts (panel + Telegram), reaction counts, joins/leaves, daily member count. Views/forwards are not available to bots.
- Every Telegram call runs in a bot context (`withBot` / `asMainBot` / `runAsBot`, AsyncLocalStorage in `services/telegram.ts`);
  update handlers run in the context of the bot that received the update. Polling for all bots: `services/telegramPolling.ts`.
- One-time links (15 min, hashed, bound to the first Telegram account that opens them) are shown as a QR code:
  desktop browsers and the Claude app's built-in browser cannot open `tg://`.
- Test setup in use: store bot @shop_23daf0_bot, channel «Sales app test» (@smart_store_sync).

## Gotchas on this machine
- `gh` is not installed: open/merge PRs in the browser pane (signed in to GitHub). Git push needs the interactive
  credential prompt — run `git push` in a Terminal tab, not in a background shell.
- Network to Telegram is flaky (ECONNRESET/timeouts in logs); polling retries on its own.
- No Python; use `node -` scripts for multi-line edits.

## Instagram (phase 1 in progress: connect + publish)
- Instagram API with Instagram Login (no Facebook Page). Built-in platform `instagram` now has `delivery = 'instagram'`;
  destinations without `config.ig_account_id` stay manual.
- Connect: panel → `POST /api/instagram/connect` (one-time OAuth state, hash stored) → instagram.com/oauth/authorize →
  `GET /api/instagram/callback` (public route) → long-lived token, AES-GCM encrypted, renewed weekly (`services/instagram.ts`).
- Publish (`services/instagramPublish.ts`): photo = post, video = reel, several = carousel, or `story`; photos converted to
  JPEG with `sharp` and served from `PUBLIC_URL/uploads` (Instagram fetches media by URL). All HTTP in `instagramApi.ts`.
- Needs `INSTAGRAM_APP_ID`/`INSTAGRAM_APP_SECRET` and an https `PUBLIC_URL`. Dev: Matstack tunnel `tools/tunnel.ps1`
  (agent in `.local/`, key in `.env`) → `https://tunnel_1szlvfmdxy.mattunnel.ir`. Secrets go in via `tools/set-env.ps1 NAME`.
- Blocked: the owner's Meta developer account shows "not available in this location"; a friend in NL will create the app.
- Next phases: comments/mentions/DMs (webhooks), insights.
