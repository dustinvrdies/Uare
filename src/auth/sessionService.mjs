const DEFAULT_COOKIE_NAME = 'uare_session';

function parseCookieHeader(header = '') {
  return String(header || '').split(';').map((entry) => entry.trim()).filter(Boolean).reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    acc[part.slice(0, idx)] = decodeURIComponent(part.slice(idx + 1));
    return acc;
  }, {});
}

function getCookieName(runtime = {}) {
  return runtime.sessionCookieName || DEFAULT_COOKIE_NAME;
}

function normalizeSameSite(value = 'Lax') {
  const raw = String(value || 'Lax').toLowerCase();
  if (raw === 'strict') return 'Strict';
  if (raw === 'none') return 'None';
  return 'Lax';
}

function serializeCookie(name, value, runtime = {}, maxAge = null) {
  const secure = runtime.sessionCookieSecure ? '; Secure' : '';
  const sameSite = normalizeSameSite(runtime.sessionCookieSameSite);
  const domain = runtime.sessionCookieDomain ? `; Domain=${runtime.sessionCookieDomain}` : '';
  const age = maxAge == null ? Number(runtime.sessionCookieMaxAgeSec || 60 * 60 * 24 * 14) : Number(maxAge);
  const expires = age > 0 ? `; Expires=${new Date(Date.now() + (age * 1000)).toUTCString()}` : '; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${age}${expires}${domain}${secure}`;
}

export function readSessionIdFromReq(req, runtime = {}) {
  const cookies = parseCookieHeader(req.headers?.cookie || '');
  return cookies[getCookieName(runtime)] || cookies[DEFAULT_COOKIE_NAME] || null;
}

export function writeSessionCookie(res, sessionId, runtime = {}) {
  res.setHeader('Set-Cookie', serializeCookie(getCookieName(runtime), sessionId, runtime));
}

export function clearSessionCookie(res, runtime = {}) {
  res.setHeader('Set-Cookie', serializeCookie(getCookieName(runtime), '', runtime, 0));
}

export function shouldRefreshSession(session = {}, runtime = {}) {
  if (!runtime.sessionRollingEnabled) return false;
  const expiresAt = new Date(session.expires_at || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  const remainingMs = expiresAt - Date.now();
  return remainingMs < Math.max(Number(runtime.sessionCookieMaxAgeSec || 0) * 1000 * 0.25, 60_000);
}
