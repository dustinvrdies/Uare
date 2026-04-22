import { Router } from 'express';
import { clearSessionCookie, readSessionIdFromReq, writeSessionCookie } from '../auth/sessionService.mjs';
import { resolveActor } from '../auth/actorResolver.mjs';
import { validateBody } from '../middleware/requestValidation.mjs';
import { simpleRateLimit } from '../rateLimit/simpleRateLimit.mjs';
import { recordAuditEvent } from '../utils/auditStore.mjs';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password, mode = 'strong') {
  const value = String(password || '');
  if (mode === 'none') return null;
  if (value.length < (mode === 'strong' ? 12 : 8)) return `Password must be at least ${mode === 'strong' ? 12 : 8} characters.`;
  if (mode === 'strong' && (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value))) return 'Password must include upper, lower, number, and symbol characters.';
  return null;
}

function sanitizeUser(user) {
  if (!user) return null;
  const next = { ...user };
  delete next.password_digest;
  return next;
}

export function buildAuthRoutes(runtime, productStore) {
  const router = Router();
  const authLimiter = simpleRateLimit({ windowMs: runtime.authRateLimitWindowMs, max: runtime.authRateLimitMax, namespace: 'auth', runtime });

  router.post('/register', authLimiter, validateBody({
    email: { type: 'string', required: true, maxLength: 320, pattern: EMAIL_PATTERN, transform: (value) => value.toLowerCase() },
    password: { type: 'string', required: true, minLength: 8, maxLength: 200, trim: false },
    full_name: { type: 'string', required: false, maxLength: 160 },
  }), async (req, res) => {
    try {
      const { email, password, full_name: fullName } = req.validatedBody;
      const passwordMode = runtime.nodeEnv === 'production' ? 'strong' : (runtime.nodeEnv === 'test' ? 'none' : 'basic');
      const passwordError = validatePassword(password, passwordMode);
      if (passwordError) return res.status(400).json({ ok: false, error: passwordError });
      const existing = await productStore.findUserByEmail(email);
      if (existing) return res.status(409).json({ ok: false, error: 'Account already exists' });
      const user = await productStore.upsertUser({ email, password, full_name: fullName || null, role: 'owner', plan_id: 'free' });
      const session = await productStore.createSession(user.user_id, { source: 'register' });
      writeSessionCookie(res, session.session_id, runtime);
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'auth.register', target_type: 'user', target_id: user.user_id, metadata_json: { email } });
      return res.status(201).json({ ok: true, user: sanitizeUser(user), session: { session_id: session.session_id, expires_at: session.expires_at } });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: runtime.exposeErrors ? error.message : 'Unable to register account' });
    }
  });

  router.post('/login', authLimiter, validateBody({
    email: { type: 'string', required: true, maxLength: 320, pattern: EMAIL_PATTERN, transform: (value) => value.toLowerCase() },
    password: { type: 'string', required: true, minLength: 1, maxLength: 200, trim: false },
  }), async (req, res) => {
    try {
      const { email, password } = req.validatedBody;
      const user = await productStore.authenticateUser(email, password);
      if (!user) {
        await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'auth.login.failed', target_type: 'user', target_id: email, status: 'rejected', metadata_json: { email } });
        return res.status(401).json({ ok: false, error: 'Invalid credentials' });
      }
      const priorSessionId = readSessionIdFromReq(req, runtime);
      if (priorSessionId) await productStore.deleteSession(priorSessionId);
      const session = await productStore.createSession(user.user_id, { source: 'login' });
      writeSessionCookie(res, session.session_id, runtime);
      req.actor = { id: user.user_id, role: user.role || 'owner', email: user.email || email, isAuthenticated: true, provider: 'session', sessionId: session.session_id };
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'auth.login.succeeded', target_type: 'user', target_id: user.user_id, metadata_json: { email } });
      return res.json({ ok: true, user: sanitizeUser(user), session: { session_id: session.session_id, expires_at: session.expires_at } });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: runtime.exposeErrors ? error.message : 'Unable to sign in' });
    }
  });

  router.post('/logout', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      const sessionId = readSessionIdFromReq(req, runtime);
      if (sessionId) await productStore.deleteSession(sessionId);
      clearSessionCookie(res, runtime);
      await recordAuditEvent(req.app?.locals?.auditStore, req, { action: 'auth.logout', target_type: 'user', target_id: actor?.id || null, metadata_json: { session_id: sessionId || null } });
      return res.json({ ok: true });
    } catch (error) {
      return res.status(500).json({ ok: false, error: runtime.exposeErrors ? error.message : 'Unable to sign out' });
    }
  });

  router.get('/me', async (req, res) => {
    try {
      const actor = await resolveActor(req, runtime);
      if (actor?.isAuthenticated && actor.id !== 'anonymous') {
        const user = await productStore.upsertUser({ user_id: actor.id, email: actor.email || `${actor.id}@local.dev`, role: actor.role || 'owner' });
        return res.json({ ok: true, user: sanitizeUser(user), provider: actor.provider || 'dev' });
      }
      return res.status(401).json({ ok: false, error: 'Not authenticated' });
    } catch (error) {
      return res.status(error.statusCode || 500).json({ ok: false, error: runtime.exposeErrors ? error.message : 'Unable to fetch account' });
    }
  });

  return router;
}
