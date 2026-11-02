// How a dashboard link names its feed. The topic and the ntfy access token live in the URL fragment
// (#topic&ntfy=...&auth=...), which the browser does not send to the site that served this page.
// Requests that carry the token are built here and must go only to the feed server.

export const DEFAULT_FEED_SERVER = 'https://ntfy.sh';

const TOPIC = /^[A-Za-z0-9_-]{6,64}$/;
// ntfy access tokens (tk_…) are ASCII. Reject whitespace and quotes so the value cannot break a header or a query.
const TOKEN = /^[A-Za-z0-9._~+/-]{1,512}$/;

/** https server, or http on localhost / 127.0.0.1 / ::1. Credentials in the URL are refused: use &auth=. */
export function parseFeedServer(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password) return null;
  return (u.origin + u.pathname).replace(/\/+$/, '');
}

/**
 * `#topic`, `#topic&ntfy=<server>`, `#topic&auth=<token>`, in either order after the topic.
 * Returns null when the topic or an explicit server/token is not usable, so the page does not
 * fall through to some other host with the topic attached.
 */
export function parseFeedHash(hash) {
  const raw = String(hash || '');
  if (!raw.startsWith('#')) return null;
  const body = raw.slice(1);
  const amp = body.indexOf('&');
  const topic = amp === -1 ? body : body.slice(0, amp);
  if (!TOPIC.test(topic)) return null;
  const params = new URLSearchParams(amp === -1 ? '' : body.slice(amp + 1));
  let server = DEFAULT_FEED_SERVER;
  if (params.has('ntfy')) {
    const parsed = parseFeedServer(params.get('ntfy'));
    if (!parsed) return null;
    server = parsed;
  }
  let auth = '';
  if (params.has('auth')) {
    const tok = params.get('auth') || '';
    if (tok && !TOKEN.test(tok)) return null;
    auth = tok;
  }
  return { topic, server, auth, explicitServer: params.has('ntfy') };
}

/**
 * ntfy cannot read an Authorization header from EventSource. It accepts `?auth=` as the
 * base64 of the header value, for example base64("Bearer tk_…"). Fetch uses the same form
 * so both calls stay a simple GET to the feed host.
 */
export function ntfyAuthUrl(url, auth) {
  if (!auth) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}auth=${encodeURIComponent(btoa(`Bearer ${auth}`))}`;
}
