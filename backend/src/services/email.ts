import nodemailer from 'nodemailer';
import type { LinkItem, ResolvedMedia } from './media';

export interface EmailConfig {
  smtp_host: string;
  smtp_port?: string | number;
  smtp_secure?: boolean | string;
  smtp_user?: string;
  smtp_password?: string;
  from?: string;
  recipients: string; // comma / newline separated
}

export const splitList = (v: string) =>
  String(v || '')
    .split(/[\s,،;]+/)
    .map((x) => x.trim())
    .filter(Boolean);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const stripTags = (s: string) => s.replace(/<\/?(b|i|s|u|code)>/g, '');

/** Clean RTL HTML e-mail: hero image, text, link buttons, list of other media */
function toHtml(text: string, heroCid: string | null, links: LinkItem[], extra: ResolvedMedia[]) {
  const buttons = links
    .map((l) => `<a href="${esc(l.url)}" style="display:inline-block;margin:4px;padding:10px 18px;border-radius:10px;background:#5b4cf0;color:#fff;text-decoration:none;font-weight:bold">${esc(l.title)}</a>`)
    .join('');
  const files = extra
    .filter((m) => !m.filePath) // local files are attached; remote ones are linked
    .map((m) => `<li><a href="${esc(m.publicUrl)}">${m.type === 'video' ? '🎬' : m.type === 'audio' ? '🎧' : '🖼'} ${esc(m.name)}</a></li>`)
    .join('');
  return `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#1f2430;max-width:600px;margin:auto">
    ${heroCid ? `<img src="cid:${heroCid}" style="max-width:100%;border-radius:12px;margin-bottom:16px">` : ''}
    ${esc(text).replace(/\n/g, '<br>')}
    ${buttons ? `<div style="margin-top:18px">${buttons}</div>` : ''}
    ${files ? `<ul style="margin-top:16px">${files}</ul>` : ''}
  </div>`;
}

export async function sendEmail(cfg: EmailConfig, subject: string, text: string, media: ResolvedMedia[] = [], links: LinkItem[] = []) {
  const to = splitList(cfg.recipients);
  if (!to.length) throw new Error('هیچ گیرنده‌ای برای ایمیل تعریف نشده است');
  const port = Number(cfg.smtp_port || 587);
  const transport = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure: cfg.smtp_secure === true || cfg.smtp_secure === 'true' || port === 465,
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_password || '' } : undefined,
    connectionTimeout: 20000,
  });
  const plain = stripTags(text);
  const hero = media.find((m) => m.type === 'image');
  const heroCid = hero ? 'hero-image' : null;
  const attachments = media
    .filter((m) => m.filePath || m === hero)
    .map((m) => ({
      filename: m.name,
      ...(m.filePath ? { path: m.filePath } : { path: m.url! }),
      ...(m === hero ? { cid: 'hero-image' } : {}),
    }));
  const linkText = links.map((l) => `${l.title}: ${l.url}`).join('\n');
  const info = await transport.sendMail({
    from: cfg.from || cfg.smtp_user,
    bcc: to, // recipients don't see each other
    subject: subject || 'خبر جدید',
    text: linkText ? `${plain}\n\n${linkText}` : plain,
    html: toHtml(plain, heroCid, links, media.filter((m) => m !== hero)),
    attachments,
  });
  return { message_id: info.messageId, recipients: to.length };
}
