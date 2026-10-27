import { vi } from 'vitest';
import { outbox } from './helpers/outbox';

// Account e-mails are captured instead of sent
vi.mock('../src/services/mailer', () => ({
  mailerConfigured: () => true,
  sendAccountEmail: vi.fn(async (to: string, subject: string, _intro: string, action: { url: string }) => {
    outbox.push({ to, subject, url: action.url });
  }),
}));
