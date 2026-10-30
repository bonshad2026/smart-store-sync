import crypto from 'crypto';
import { config } from '../config';
import { query } from '../db/pool';
import { InstagramError, igRequest, IgParams } from './instagramApi';
import { getPlatformByKey } from './platforms';
import { open, seal } from './secretBox';

/**
 * Instagram professional accounts connected with "Instagram API with Instagram Login".
 *
 * Connecting (the store owner only signs in to Instagram and approves):
 *  1. the panel asks for a one-time OAuth state and opens instagram.com/oauth/authorize
 *  2. Instagram redirects to PUBLIC_URL/api/instagram/callback with a code
 *  3. the code becomes a short-lived token, then a 60-day token (refreshed automatically), stored encrypted
 *  4. the account gets a publishing destination of the built-in "instagram" platform
 */

export const IG_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_business_manage_insights',
];

const STATE_MINUTES = 15;
// a token is refreshed once it is this old (Instagram allows it after 24 h; it lives 60 days)
const REFRESH_AFTER_DAYS = 7;

export type AccountStatus = 'active' | 'expired' | 'disconnected';

export interface InstagramAccount {
  id: number;
  ig_user_id: string;
  username: string;
  name: string;
  account_type: string;
  profile_picture_url: string;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  permissions: string;
  token_expires_at: string | null;
  token_refreshed_at: string | null;
  status: AccountStatus;
  error: string;
  destination_id: number | null;
  connected_at: string;
  refreshed_at: string | null;
  disconnected_at: string | null;
}

const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ACCOUNT_COLUMNS = `id, ig_user_id, username, name, account_type, profile_picture_url, followers_count, follows_count, media_count,
  permissions, token_expires_at, token_refreshed_at, status, error, destination_id, connected_at, refreshed_at, disconnected_at`;

export const instagramConfigured = () => !!(config.instagram.appId && config.instagram.appSecret);
/** Instagram must reach this panel (OAuth redirect, media files), so it needs a public https address */
export const publicUrlReady = () => /^https:\/\//.test(config.publicUrl) && !/\/\/(localhost|127\.|\[::1\])/.test(config.publicUrl);
export const redirectUri = () => `${config.publicUrl}/api/instagram/callback`;

// ------------------------------------------------------------------ connect flow

/** Creates a one-time OAuth state and the Instagram sign-in URL for it */
export async function createConnectUrl(userId: number) {
  if (!instagramConfigured()) throw fail(503, 'اتصال اینستاگرام هنوز فعال نشده است');
  if (!publicUrlReady()) throw fail(503, 'آدرس عمومی سرور (PUBLIC_URL) برای اتصال اینستاگرام تنظیم نشده است');
  const state = crypto.randomBytes(24).toString('base64url');
  const [row] = await query<{ id: number }>(
    `INSERT INTO instagram_connect_requests (user_id, state_hash, expires_at) VALUES ($1, $2, NOW() + make_interval(mins => $3)) RETURNING id`,
    [userId, sha256(state), STATE_MINUTES],
  );
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', config.instagram.appId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', IG_SCOPES.join(','));
  url.searchParams.set('state', `${row.id}.${state}`);
  url.searchParams.set('enable_fb_login', 'false');
  url.searchParams.set('force_reauth', 'true');
  return { id: row.id, url: url.toString() };
}

/** Where the browser goes after the callback: the Instagram page of the panel, which then asks for the request's result */
async function backToPanel(requestId?: number) {
  const platform = await getPlatformByKey('instagram');
  const page = platform ? `/channels/${platform.id}` : '/channels';
  return `${config.appUrl}/#${page}${requestId ? `?ig_connect=${requestId}` : ''}`;
}

/**
 * Handles Instagram's redirect after the owner approved (or cancelled) the connection.
 * Returns the panel URL to send the browser to; the outcome is stored on the connect request.
 */
export async function handleCallback(q: Record<string, unknown>): Promise<string> {
  const [idPart, state] = String(q.state || '').split('.');
  const id = Number(idPart);
  if (!id || !state) return backToPanel();
  const [req] = await query<{ id: number; user_id: number }>(
    `UPDATE instagram_connect_requests SET used_at=NOW()
     WHERE id=$1 AND state_hash=$2 AND used_at IS NULL AND expires_at > NOW() RETURNING id, user_id`,
    [id, sha256(state)],
  );
  if (!req) return backToPanel(id); // used, expired or forged: the panel shows the request's own state
  const setError = (msg: string) => query(`UPDATE instagram_connect_requests SET error=$2 WHERE id=$1`, [id, msg.slice(0, 255)]);

  if (q.error || !q.code) {
    await setError(q.error_reason === 'user_denied' ? 'اتصال در اینستاگرام لغو شد' : String(q.error_description || q.error || 'اتصال انجام نشد'));
    return backToPanel(id);
  }
  try {
    const account = await connectWithCode(String(q.code).replace(/#_$/, ''), req.user_id);
    await query(`UPDATE instagram_connect_requests SET account_id=$2 WHERE id=$1`, [id, account.id]);
  } catch (e) {
    console.error('instagram connect:', (e as Error).message);
    await setError((e as Error).message);
  }
  return backToPanel(id);
}

interface ShortToken { access_token: string; user_id: string | number; permissions?: string | string[] }
interface LongToken { access_token: string; expires_in?: number }

async function connectWithCode(code: string, userId: number) {
  const short = await igRequest<{ data?: ShortToken[] } & Partial<ShortToken>>('POST', 'https://api.instagram.com/oauth/access_token', {
    client_id: config.instagram.appId,
    client_secret: config.instagram.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code,
  });
  const s = short.data?.[0] ?? (short as ShortToken);
  if (!s?.access_token) throw new Error('اینستاگرام توکن دسترسی برنگرداند');
  const long = await igRequest<LongToken>('GET', '/access_token', {
    grant_type: 'ig_exchange_token',
    client_secret: config.instagram.appSecret,
    access_token: s.access_token,
  });
  const profile = await fetchProfile(long.access_token);
  if (String(profile.account_type || '').toUpperCase() === 'PERSONAL') {
    throw new Error('این پیج حرفه‌ای نیست؛ در تنظیمات اینستاگرام آن را به حساب Business یا Creator تبدیل کنید');
  }
  const permissions = Array.isArray(s.permissions) ? s.permissions.join(',') : String(s.permissions || '');
  return saveAccount(profile, long, permissions, userId);
}

interface Profile {
  user_id: string;
  username?: string;
  name?: string;
  account_type?: string;
  profile_picture_url?: string;
  followers_count?: number;
  follows_count?: number;
  media_count?: number;
}

const fetchProfile = (token: string) =>
  igRequest<Profile>('GET', '/me', {
    fields: 'user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count',
    access_token: token,
  });

const expiresAt = (t: LongToken) => new Date(Date.now() + (t.expires_in || 60 * 24 * 3600) * 1000);

/** Creates or re-activates the account and its publishing destination */
async function saveAccount(p: Profile, token: LongToken, permissions: string, userId: number): Promise<InstagramAccount> {
  const igUserId = String(p.user_id);
  const [existing] = await query<{ destination_id: number | null }>(`SELECT destination_id FROM instagram_accounts WHERE ig_user_id=$1`, [igUserId]);
  const name = p.username ? `@${p.username}` : p.name || igUserId;
  let destinationId = existing?.destination_id ?? null;
  if (destinationId) {
    await query(`UPDATE destinations SET name=$2, enabled=TRUE, updated_at=NOW() WHERE id=$1`, [destinationId, name]);
  } else {
    const platform = await getPlatformByKey('instagram');
    if (platform) {
      const [d] = await query<{ id: number }>(`INSERT INTO destinations (platform_id, name, config) VALUES ($1, $2, '{}') RETURNING id`, [platform.id, name]);
      destinationId = d.id;
    }
  }
  const [row] = await query<{ id: number }>(
    `INSERT INTO instagram_accounts (ig_user_id, username, name, account_type, profile_picture_url, followers_count, follows_count, media_count,
       permissions, token_enc, token_expires_at, token_refreshed_at, status, error, destination_id, connected_by, refreshed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),'active','',$12,$13,NOW())
     ON CONFLICT (ig_user_id) DO UPDATE SET username=EXCLUDED.username, name=EXCLUDED.name, account_type=EXCLUDED.account_type,
       profile_picture_url=EXCLUDED.profile_picture_url, followers_count=EXCLUDED.followers_count, follows_count=EXCLUDED.follows_count,
       media_count=EXCLUDED.media_count, permissions=EXCLUDED.permissions, token_enc=EXCLUDED.token_enc,
       token_expires_at=EXCLUDED.token_expires_at, token_refreshed_at=NOW(), status='active', error='',
       destination_id=EXCLUDED.destination_id, connected_by=EXCLUDED.connected_by, connected_at=NOW(), refreshed_at=NOW(), disconnected_at=NULL
     RETURNING id`,
    [igUserId, p.username || '', p.name || '', p.account_type || '', p.profile_picture_url || '', p.followers_count ?? null,
      p.follows_count ?? null, p.media_count ?? null, permissions, seal(token.access_token), expiresAt(token), destinationId, userId],
  );
  if (destinationId) {
    await query(`UPDATE destinations SET config = config || $2::jsonb WHERE id=$1`, [destinationId, JSON.stringify({ ig_account_id: row.id })]);
  }
  return (await getAccount(row.id))!;
}

/** State of a connect request, for the panel after Instagram sent the browser back */
export async function connectStatus(id: number, userId: number) {
  const [r] = await query<{ account_id: number | null; error: string; used_at: string | null; expired: boolean }>(
    `SELECT account_id, error, used_at, expires_at < NOW() AS expired FROM instagram_connect_requests WHERE id=$1 AND user_id=$2`,
    [id, userId],
  );
  if (!r) throw fail(404, 'درخواست اتصال یافت نشد');
  const account = r.account_id ? await getAccount(r.account_id) : null;
  const status = account ? 'connected' : r.error ? 'failed' : r.expired ? 'expired' : 'pending';
  return { status, error: r.error || undefined, account };
}

// ------------------------------------------------------------------ accounts

export async function getAccount(id: number) {
  return (await query<InstagramAccount>(`SELECT ${ACCOUNT_COLUMNS} FROM instagram_accounts WHERE id=$1`, [id]))[0];
}

export async function listAccounts() {
  return query<InstagramAccount>(
    `SELECT ${ACCOUNT_COLUMNS} FROM instagram_accounts ORDER BY (status='disconnected'), connected_at DESC`,
  );
}

/**
 * Runs an Instagram call with the account's token. A rejected token marks the account as expired,
 * so the panel asks the owner to connect it again.
 */
export async function withAccount<T>(id: number, fn: (token: string, account: InstagramAccount) => Promise<T>): Promise<T> {
  const [row] = await query<InstagramAccount & { token_enc: string }>(`SELECT * FROM instagram_accounts WHERE id=$1`, [id]);
  if (!row) throw fail(404, 'پیج اینستاگرام یافت نشد');
  if (row.status === 'disconnected' || !row.token_enc) throw fail(409, `پیج @${row.username} قطع شده است`);
  if (row.status === 'expired') throw fail(409, `دسترسی به پیج @${row.username} تمام شده است؛ آن را دوباره وصل کنید`);
  try {
    return await fn(open(row.token_enc), row);
  } catch (e) {
    if (e instanceof InstagramError && e.tokenInvalid) {
      const msg = `دسترسی به پیج @${row.username} تمام شده است؛ آن را دوباره وصل کنید`;
      await query(`UPDATE instagram_accounts SET status='expired', error=$2 WHERE id=$1`, [id, msg]);
      throw fail(409, msg);
    }
    throw e;
  }
}

/** Calls the Graph API as the account */
export const igCall = <T = any>(id: number, method: 'GET' | 'POST', path: string, params: IgParams = {}) =>
  withAccount(id, (token) => igRequest<T>(method, path, { ...params, access_token: token }));

/** Updates the profile (followers, posts) and renews the token when it is due */
export async function refreshAccount(id: number) {
  await withAccount(id, async (token, a) => {
    let current = token;
    const age = a.token_refreshed_at ? Date.now() - new Date(a.token_refreshed_at).getTime() : Infinity;
    if (age > REFRESH_AFTER_DAYS * 24 * 3600 * 1000) {
      const t = await igRequest<LongToken>('GET', '/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: token });
      current = t.access_token;
      await query(`UPDATE instagram_accounts SET token_enc=$2, token_expires_at=$3, token_refreshed_at=NOW() WHERE id=$1`, [
        id, seal(current), expiresAt(t),
      ]);
    }
    const p = await fetchProfile(current);
    await query(
      `UPDATE instagram_accounts SET username=$2, name=$3, account_type=$4, profile_picture_url=$5, followers_count=$6,
         follows_count=$7, media_count=$8, error='', refreshed_at=NOW() WHERE id=$1`,
      [id, p.username || a.username, p.name || '', p.account_type || a.account_type, p.profile_picture_url || '',
        p.followers_count ?? null, p.follows_count ?? null, p.media_count ?? null],
    );
  });
  return getAccount(id);
}

export async function refreshAllAccounts() {
  const rows = await query<{ id: number }>(`SELECT id FROM instagram_accounts WHERE status='active'`);
  for (const r of rows) await refreshAccount(r.id).catch((e) => console.error(`instagram account ${r.id}:`, e.message));
}

export async function disconnectAccount(id: number) {
  const a = await getAccount(id);
  if (!a) throw fail(404, 'پیج اینستاگرام یافت نشد');
  await query(`UPDATE instagram_accounts SET status='disconnected', token_enc='', disconnected_at=NOW() WHERE id=$1`, [id]);
  if (a.destination_id) await query(`UPDATE destinations SET enabled=FALSE WHERE id=$1`, [a.destination_id]);
  return getAccount(id);
}

export async function accountDetails(id: number) {
  const account = await getAccount(id);
  if (!account) throw fail(404, 'پیج اینستاگرام یافت نشد');
  const posts = await query(
    `SELECT p.id, p.media_id, p.format, p.permalink, p.caption, p.content_id, p.created_at
     FROM instagram_posts p WHERE p.account_id=$1 ORDER BY p.created_at DESC LIMIT 50`,
    [id],
  );
  return { account, posts };
}
