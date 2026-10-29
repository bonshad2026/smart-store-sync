import crypto from 'crypto';
import { config } from '../config';

/**
 * Encrypts secrets stored in the database (managed bot tokens) with AES-256-GCM.
 * The key is derived from APP_SECRET, so a database dump alone does not reveal the tokens.
 */
const key = () => {
  if (!config.appSecret) throw new Error('APP_SECRET در فایل .env تنظیم نشده است');
  return crypto.createHash('sha256').update(`sss-secret-box:${config.appSecret}`).digest();
};

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('invalid sealed value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
