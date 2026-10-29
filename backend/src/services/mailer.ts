import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import nodemailer from 'nodemailer';
import { config } from '../config';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const mailerConfigured = () => !!config.smtp.host;

/**
 * Sends a system e-mail (account verification, password reset) with one action button.
 * Without SMTP_HOST the message is printed to the server log, so links still work in development.
 */
export async function sendAccountEmail(to: string, subject: string, intro: string, action: { label: string; url: string }, outro = '') {
  if (!mailerConfigured()) {
    console.log(`✉ [no SMTP] to ${to} — ${subject}\n   ${action.url}`);
    return;
  }
  // Resolve through the OS (dns.lookup), not nodemailer's own DNS queries: those can time out
  // when the machine's resolver is a local VPN/proxy stub. TLS still checks the real hostname.
  const { host } = config.smtp;
  const address = isIP(host) ? host : (await lookup(host, { family: 4 })).address;
  const transport = nodemailer.createTransport({
    host: address,
    tls: { servername: host },
    port: config.smtp.port,
    secure: config.smtp.secure || config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 20000,
  });
  await transport.sendMail({
    from: config.smtp.from,
    to,
    subject,
    text: `${intro}\n\n${action.label}: ${action.url}${outro ? `\n\n${outro}` : ''}`,
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.9;color:#1f2430;max-width:560px;margin:auto">
      <p>${esc(intro)}</p>
      <p style="margin:24px 0"><a href="${esc(action.url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#5b4cf0;color:#fff;text-decoration:none;font-weight:bold">${esc(action.label)}</a></p>
      <p style="color:#6b7280;font-size:13px">${esc(outro)}</p>
      <p style="color:#9ca3af;font-size:12px;direction:ltr;word-break:break-all">${esc(action.url)}</p>
    </div>`,
  });
}
