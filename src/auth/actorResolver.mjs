import { verifyBearerToken } from './jwtVerifier.mjs';
import { readSessionIdFromReq, shouldRefreshSession, writeSessionCookie } from './sessionService.mjs';

function bearerTokenFromReq(req) {
  const header = req.headers['authorization'] || '';
  if (!String(header).startsWith('Bearer ')) return null;
  return String(header).slice(7);
}

function devQueryActorFromReq(req, runtime = {}) {
  if (!runtime.allowDevHeaderAuth) return null;
  const queryId = req.query?.user_id || req.query?.userId || null;
  if (!queryId) return null;
  return {
    id: String(queryId),
    role: String(req.query?.user_role || req.query?.userRole || 'owner'),
    isAuthenticated: true,
    provider: 'dev-query',
  };
}

async function sessionActorFromReq(req, runtime = {}) {
  const productStore = req.app?.locals?.productStore || null;
  if (!productStore?.getSession || !productStore?.getUser) return null;
  const sessionId = readSessionIdFromReq(req, runtime);
  if (!sessionId) return null;
  const session = await productStore.getSession(sessionId);
  if (!session?.user_id) return null;
  const user = await productStore.getUser(session.user_id);
  if (!user?.user_id) return null;
  if (runtime.sessionRollingEnabled && shouldRefreshSession(session, runtime)) {
    const refreshed = await productStore.touchSession?.(session.session_id, runtime.sessionCookieMaxAgeSec);
    writeSessionCookie(req.res, (refreshed || session).session_id || session.session_id, runtime);
  }
  return {
    id: user.user_id,
    role: user.role || 'owner',
    email: user.email || null,
    isAuthenticated: true,
    provider: 'session',
    sessionId: session.session_id,
  };
}

export async function resolveActor(req, runtime = {}) {
  if (req.actor) return req.actor;
  const token = bearerTokenFromReq(req);
  if (token) {
    const payload = await verifyBearerToken(token, runtime);
    req.actor = {
      id: payload.sub || 'anonymous',
      role: payload.role || payload.user_role || 'owner',
      isAuthenticated: Boolean(payload.sub),
      provider: 'jwt',
      email: payload.email || null,
    };
    return req.actor;
  }

  const sessionActor = await sessionActorFromReq(req, runtime);
  if (sessionActor) {
    req.actor = sessionActor;
    return req.actor;
  }

  const headerId = req.headers['x-user-id'];
  const headerRole = req.headers['x-user-role'];
  if (runtime.allowDevHeaderAuth && headerId) {
    req.actor = {
      id: String(headerId),
      role: String(headerRole || 'owner'),
      isAuthenticated: true,
      provider: 'dev-header',
    };
    return req.actor;
  }

  const queryActor = devQueryActorFromReq(req, runtime);
  if (queryActor) {
    req.actor = queryActor;
    return req.actor;
  }

  req.actor = {
    id: 'anonymous',
    role: 'viewer',
    isAuthenticated: false,
    provider: 'none',
  };
  return req.actor;
}

export function requireActor(actor) {
  if (!actor?.isAuthenticated || !actor?.id || actor.id === 'anonymous') {
    const error = new Error('Authenticated actor required');
    error.statusCode = 401;
    throw error;
  }
}

export function requireOwnerLike(actor) {
  requireActor(actor);
  if (!['owner', 'admin'].includes(actor.role)) {
    const error = new Error('Owner or admin role required');
    error.statusCode = 403;
    throw error;
  }
}
