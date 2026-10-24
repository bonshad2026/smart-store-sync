export const hasBrandLogo = (icon: string) => ['telegram', 'instagram', 'globe', 'sms', 'mail', 'whatsapp'].includes(icon);

/** Full-colour logos for the built-in networks; returns null for unknown icons */
export function BrandLogo({ icon, size = 36 }: { icon: string; size?: number }) {
  const s = { width: size, height: size, display: 'block', flexShrink: 0 } as const;
  switch (icon) {
    case 'telegram':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <defs><linearGradient id="bl-tg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#37BBFE" /><stop offset="1" stopColor="#007DBB" /></linearGradient></defs>
          <circle cx="24" cy="24" r="24" fill="url(#bl-tg)" />
          <path d="M10.6 23.4 34.3 14c1.1-.4 2.1.3 1.7 1.9l-4 19c-.3 1.3-1.1 1.7-2.2 1l-6.2-4.6-3 2.9c-.3.3-.6.6-1.3.6l.5-6.3 11.4-10.3c.5-.4-.1-.7-.8-.3L16.3 26.8l-6-1.9c-1.3-.4-1.3-1.3.3-1.5z" fill="#fff" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <defs>
            <radialGradient id="bl-ig" cx="0.3" cy="1.07" r="1.2">
              <stop offset="0" stopColor="#FFDD55" /><stop offset=".1" stopColor="#FFDD55" /><stop offset=".5" stopColor="#FF543E" /><stop offset="1" stopColor="#C837AB" />
            </radialGradient>
          </defs>
          <rect width="48" height="48" rx="13" fill="url(#bl-ig)" />
          <rect x="11" y="11" width="26" height="26" rx="8" fill="none" stroke="#fff" strokeWidth="3" />
          <circle cx="24" cy="24" r="6.2" fill="none" stroke="#fff" strokeWidth="3" />
          <circle cx="31.6" cy="16.4" r="1.9" fill="#fff" />
        </svg>
      );
    case 'globe':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <defs><linearGradient id="bl-web" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38BDF8" /><stop offset="1" stopColor="#2563EB" /></linearGradient></defs>
          <rect width="48" height="48" rx="13" fill="url(#bl-web)" />
          <g fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
            <circle cx="24" cy="24" r="12" /><path d="M12 24h24 M24 12c3.2 3.3 5 7.5 5 12s-1.8 8.7-5 12c-3.2-3.3-5-7.5-5-12s1.8-8.7 5-12z" />
          </g>
        </svg>
      );
    case 'sms':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <defs><linearGradient id="bl-sms" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4ADE80" /><stop offset="1" stopColor="#15803D" /></linearGradient></defs>
          <rect width="48" height="48" rx="13" fill="url(#bl-sms)" />
          <path d="M13 15h22a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H21l-6 5v-5h-2a3 3 0 0 1-3-3V18a3 3 0 0 1 3-3z" fill="#fff" />
          <circle cx="18" cy="23.5" r="1.8" fill="#16A34A" /><circle cx="24" cy="23.5" r="1.8" fill="#16A34A" /><circle cx="30" cy="23.5" r="1.8" fill="#16A34A" />
        </svg>
      );
    case 'mail':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <defs><linearGradient id="bl-mail" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FBBF24" /><stop offset="1" stopColor="#EA580C" /></linearGradient></defs>
          <rect width="48" height="48" rx="13" fill="url(#bl-mail)" />
          <rect x="11" y="15" width="26" height="18" rx="3" fill="#fff" />
          <path d="M12 17l12 8.5L36 17" fill="none" stroke="#EA580C" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'whatsapp':
      return (
        <svg viewBox="0 0 48 48" style={s} aria-hidden="true">
          <circle cx="24" cy="24" r="24" fill="#25D366" />
          <path d="M24 11.5a12.5 12.5 0 0 0-10.8 18.8L11.5 36.5l6.4-1.7A12.5 12.5 0 1 0 24 11.5z" fill="#fff" />
          <path d="M19.4 17.8c-.3-.6-.5-.6-.8-.6h-.7c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.6c.2.2 2.4 3.8 5.9 5.2 2.9 1.1 3.5.9 4.1.9.6-.1 2-.8 2.3-1.6.3-.8.3-1.5.2-1.6-.1-.2-.3-.3-.7-.4l-2.3-1.1c-.3-.1-.5-.2-.8.2l-1 1.3c-.2.2-.4.3-.8.1-.3-.2-1.5-.5-2.8-1.7-1-.9-1.7-2-1.9-2.4-.2-.3 0-.5.2-.7l.5-.6c.2-.2.2-.4.4-.6.1-.2 0-.5 0-.6l-1-2.5z" fill="#25D366" />
        </svg>
      );
    default:
      return null;
  }
}

/** The app's own mark: a %-tag badge drawn in the brand colour */
export function AppMark({ size = 40 }: { size?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <defs>
        <radialGradient id="am-g" cx="0.32" cy="0.28" r="0.9">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset=".45" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="var(--accent)" />
      <circle cx="24" cy="24" r="22" fill="url(#am-g)" />
      <circle cx="24" cy="24" r="20.5" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.2" />
      <g fill="none" stroke="var(--on-accent)" strokeWidth="3.2" strokeLinecap="round">
        <circle cx="17" cy="18" r="4.4" />
        <circle cx="31" cy="30" r="4.4" />
        <path d="M33.5 14.5 14.5 33.5" />
      </g>
    </svg>
  );
}
