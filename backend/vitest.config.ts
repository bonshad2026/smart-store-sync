import dotenv from 'dotenv';
import os from 'os';
import path from 'path';
import { defineConfig } from 'vitest/config';

// Same Postgres server as development, but a separate database ending in _test.
// CI sets TEST_DATABASE_URL explicitly.
const env = dotenv.config({ path: path.resolve(__dirname, '../.env') }).parsed || {};
const pick = (k: string, d: string) => process.env[k] || env[k] || d;
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ||
  `postgres://${pick('POSTGRES_USER', 'sss')}:${pick('POSTGRES_PASSWORD', 'sss_password')}@${pick('POSTGRES_HOST', 'localhost')}:${pick(
    'POSTGRES_PORT', '5432')}/${pick('POSTGRES_DB', 'smart_store_sync')}_test`;

const testEnv = {
  TEST_DATABASE_URL: testDatabaseUrl,
  DATABASE_URL: testDatabaseUrl,
  API_KEY: 'test-api-key',
  APP_URL: 'http://localhost:5173',
  ALLOW_REGISTRATION: 'true',
  SESSION_DAYS: '30',
  UNVERIFIED_TTL_DAYS: '7',
  SMTP_HOST: '',
  FEEDBACK_POLLING: 'false',
  TELEGRAM_BOT_TOKEN: 'test-bot-token',
  TELEGRAM_PROXY: '',
  APP_SECRET: 'test-app-secret',
  INSTAGRAM_APP_ID: '1234567890',
  INSTAGRAM_APP_SECRET: 'test-instagram-secret',
  INSTAGRAM_PROXY: '',
  INSTAGRAM_POLL_MS: '1',
  PUBLIC_URL: 'https://panel.example.test',
  UPLOAD_DIR: path.join(os.tmpdir(), 'sss-test-uploads'),
};
// globalSetup runs in this process; test files get the same values through `env`
Object.assign(process.env, testEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/globalSetup.ts'],
    setupFiles: ['test/setup.ts'],
    // every file shares one database, so run files one after another
    fileParallelism: false,
    testTimeout: 15000,
    env: testEnv,
  },
});
