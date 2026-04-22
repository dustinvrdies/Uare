import crypto from 'crypto';
import { getRedisClient } from '../redis/client.mjs';

const buckets = new Map();
let cleanupAt = 0;

function normalizeIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map((entry) => entry.trim()).filter(Boolean)[0];
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function keyPartsFromReq(req, namespace = 'global') {
  const ip = normalizeIp(req);
  const actor = req.actor?.id || req.headers['x-user-id'] || 'anonymous';
  const route = req.route?.path || req.path || req.originalUrl || 'unknown';
  return { ip, actor: String(actor), route: String(route), namespace };
}

function hashKey(parts) {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function writeHeaders(res, max, remaining, resetAt) {
  res.setHeader('x-ratelimit-limit', String(max));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, remaining)));
  res.setHeader('x-ratelimit-reset', String(Math.max(0, Math.ceil(resetAt / 1000))));
}

function maybeCleanup(now) {
  if (now < cleanupAt) return;
  cleanupAt = now + 60_000;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

async function incrementRedisBucket(runtime, namespace, req, windowMs, max) {
  const client = await getRedisClient({ ...runtime, redisUrl: runtime.rateLimitRedisUrl || runtime.redisUrl || runtime.eventBusRedisUrl });
  const parts = keyPartsFromReq(req, namespace);
  const key = `rate_limit:${namespace}:${hashKey(parts)}`;
  const now = Date.now();
  const resetAt = now + windowMs;
  const count = await client.incr(key);
  if (count === 1) await client.pExpire(key, windowMs);
  const ttl = await client.pTTL(key);
  return {
    count,
    remaining: max - count,
    resetAt: ttl > 0 ? now + ttl : resetAt,
  };
}

function incrementMemoryBucket(namespace, req, windowMs, max) {
  const now = Date.now();
  maybeCleanup(now);
  const key = `${namespace}:${hashKey(keyPartsFromReq(req, namespace))}`;
  const bucket = buckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  bucket.count += 1;
  buckets.set(key, bucket);
  return {
    count: bucket.count,
    remaining: max - bucket.count,
    resetAt: bucket.resetAt,
  };
}

export function simpleRateLimit({ windowMs = 60000, max = 120, namespace = 'global', runtime = {}, mode = runtime.rateLimitMode || 'memory' } = {}) {
  return async function rateLimit(req, res, next) {
    try {
      const state = mode === 'redis'
        ? await incrementRedisBucket(runtime, namespace, req, windowMs, max)
        : incrementMemoryBucket(namespace, req, windowMs, max);

      writeHeaders(res, max, state.remaining, state.resetAt);
      if (state.count > max) {
        return res.status(429).json({
          ok: false,
          error: 'Rate limit exceeded',
          retry_after_ms: Math.max(0, state.resetAt - Date.now()),
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
