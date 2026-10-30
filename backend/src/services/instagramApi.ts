import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { config } from '../config';

// Optional proxy for reaching Instagram (e.g. when Instagram is filtered).
const proxyAgent = config.instagram.proxy ? new ProxyAgent(config.instagram.proxy) : undefined;

export type IgParams = Record<string, string | number | boolean | undefined | null>;

export class InstagramError extends Error {
  constructor(message: string, public status: number, public code?: number, public subcode?: number) {
    super(message);
  }
  /** The access token is invalid, expired or was revoked by the user */
  get tokenInvalid() {
    return this.code === 190;
  }
}

/**
 * Calls an Instagram endpoint (graph.instagram.com, or the OAuth hosts with a full URL).
 * GET parameters go into the query string, POST parameters into a form body.
 * All Instagram traffic goes through here, so tests replace only this function.
 */
export async function igRequest<T = any>(method: 'GET' | 'POST', pathOrUrl: string, params: IgParams = {}): Promise<T> {
  const url = new URL(/^https?:\/\//.test(pathOrUrl) ? pathOrUrl : `${config.instagram.graphBase}${pathOrUrl}`);
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    (method === 'GET' ? url.searchParams : form).append(k, String(v));
  }
  let res;
  try {
    res = await undiciFetch(url, {
      method,
      body: method === 'POST' ? form : undefined,
      dispatcher: proxyAgent,
      signal: AbortSignal.timeout(60000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const detail = e.cause?.code || e.cause?.message || e.message;
    throw new InstagramError(
      `اتصال به سرور اینستاگرام برقرار نشد (${detail})` + (proxyAgent ? `. پروکسی ${config.instagram.proxy} را بررسی کنید.` : ''),
      0,
    );
  }
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || data?.error || data?.error_type) {
    // Graph errors: { error: { message, code, error_subcode, error_user_msg } }; OAuth errors: { error_type, code, error_message }
    const e = typeof data?.error === 'object' ? data.error : data;
    const message = e?.error_user_msg || e?.message || e?.error_message || `HTTP ${res.status}`;
    throw new InstagramError(`خطای اینستاگرام: ${message}`, res.status, Number(e?.code) || undefined, Number(e?.error_subcode) || undefined);
  }
  return data as T;
}
