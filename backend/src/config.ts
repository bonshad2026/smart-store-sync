import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

export const config = {
  port: Number(process.env.BACKEND_PORT || 4000),
  databaseUrl:
    process.env.DATABASE_URL ||
    `postgres://${process.env.POSTGRES_USER || 'sss'}:${process.env.POSTGRES_PASSWORD || 'sss_password'}@${
      process.env.POSTGRES_HOST || 'localhost'
    }:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || 'smart_store_sync'}`,
  // Shared secret between n8n and backend (sent as header x-api-key)
  apiKey: process.env.API_KEY || '',
  auth: {
    // How long a login stays valid
    sessionDays: Number(process.env.SESSION_DAYS || 30),
    // After the first (admin) account exists, may others sign up from the login page?
    allowRegistration: process.env.ALLOW_REGISTRATION !== 'false',
  },
  ai: {
    // Any OpenAI-compatible Chat Completions endpoint (OpenAI, OpenRouter, local LLM, ...)
    baseUrl: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    maxTokens: Number(process.env.AI_MAX_TOKENS || 600),
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    defaultChatId: process.env.TELEGRAM_CHAT_ID || '',
    // HTTP proxy for Telegram requests, e.g. http://host.docker.internal:10809
    proxy: process.env.TELEGRAM_PROXY || '',
    // Custom Bot API base (e.g. a self-hosted relay); default is the official API
    apiBase: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, ''),
  },
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || '', // e.g. http://n8n:5678/webhook/product-changed
  maxRetries: Number(process.env.MAX_RETRIES || 3),
  // Public address of this panel; used to build absolute links to uploaded files (webhooks, e-mails)
  publicUrl: (process.env.PUBLIC_URL || `http://localhost:${process.env.BACKEND_PORT || 4000}`).replace(/\/$/, ''),
  // Where uploaded product images are stored (served at /uploads)
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../uploads'),
};
