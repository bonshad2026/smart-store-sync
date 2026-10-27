import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
import { config } from './config';
import { migrate } from './db/migrate';
import { bootstrap } from './services/bootstrap';
import { startFeedbackPolling } from './services/feedback';
import { api } from './routes/api';
import { auth, loadSession, requireAuth, sameOrigin } from './routes/auth';
import { cleanupAuth } from './services/auth';
import { publishDue } from './services/content';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Dashboard users log in (HttpOnly session cookie); n8n and scripts may use the shared API_KEY (x-api-key)
app.use('/api', sameOrigin, loadSession, requireAuth);
app.use('/api/auth', auth);
app.use('/api', api);

// Uploaded product images
app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d' }));

// Serve the built dashboard (frontend/dist) if present - single-port production mode
const dist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'داده‌های ورودی نامعتبر است', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
  }
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم فایل بیش از حد مجاز است (حداکثر ۵۰ مگابایت برای هر فایل)' });
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ error: 'تعداد فایل‌ها بیش از حد مجاز است (حداکثر ۱۰ فایل)' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'خطای داخلی سرور' });
});

async function start() {
  await migrate();
  await bootstrap();
  app.listen(config.port, () => console.log(`🚀 Smart Store Sync API: http://localhost:${config.port}/api`));

  // Built-in scheduler: publishes approved content when its scheduled time arrives.
  // (n8n can do the same by calling POST /api/contents/publish-due)
  const interval = Number(process.env.SCHEDULER_INTERVAL_SEC || 60);
  if (interval > 0) {
    setInterval(() => {
      publishDue()
        .then((r) => r.length && console.log('scheduler published:', r))
        .catch((e) => console.error('scheduler error:', e.message));
    }, interval * 1000);
  }

  // Hourly: delete accounts that never verified their e-mail, expired sessions and links
  const cleanup = () =>
    cleanupAuth()
      .then((n) => n && console.log(`auth cleanup: removed ${n} unverified account(s)`))
      .catch((e) => console.error('auth cleanup error:', e.message));
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000);

  // Telegram button taps & private messages to the bot (set FEEDBACK_POLLING=false to disable)
  if (process.env.FEEDBACK_POLLING !== 'false') startFeedbackPolling().catch((e) => console.error('feedback polling:', e.message));
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
