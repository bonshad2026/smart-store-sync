import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
import { config } from './config';
import { api } from './routes/api';
import { auth, loadSession, requireAuth, sameOrigin } from './routes/auth';

/** Builds the Express app (routes + middleware) without starting a server; used by index.ts and the tests */
export function createApp() {
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

  return app;
}
