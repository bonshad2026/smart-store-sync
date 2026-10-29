export interface SentMail {
  to: string;
  subject: string;
  url: string;
}

/** E-mails "sent" during a test (see test/setup.ts) */
export const outbox: SentMail[] = [];

/** Token from the newest e-mail of a kind sent to `to` */
export function lastToken(to: string, route: 'verify-email' | 'reset-password') {
  const mail = [...outbox].reverse().find((m) => m.to === to && m.url.includes(`/#/${route}?`));
  if (!mail) throw new Error(`no ${route} e-mail sent to ${to}`);
  return new URL(mail.url.replace('/#/', '/')).searchParams.get('token')!;
}
