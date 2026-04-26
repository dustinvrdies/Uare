import net from 'node:net';

const strictMode = process.argv.includes('--strict');

function resolveValue(keys, fallback = '') {
  for (const key of keys) {
    const value = process.env[key];
    if (value && String(value).trim()) return { value: String(value).trim(), source: key };
  }
  return { value: fallback, source: fallback ? 'default' : null };
}

function parseTargetUrl(raw, fallbackProtocol) {
  try {
    const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(raw) ? raw : `${fallbackProtocol}://${raw}`;
    const url = new URL(candidate);
    const host = url.hostname || '127.0.0.1';
    const port = Number(url.port) || (url.protocol.startsWith('redis') ? 6379 : 4222);
    return { host, port, raw: candidate };
  } catch {
    return null;
  }
}

function probeTcp(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok, message) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, message });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true, `reachable at ${host}:${port}`));
    socket.once('timeout', () => finish(false, `timeout reaching ${host}:${port}`));
    socket.once('error', (error) => finish(false, `${error.code || 'ERROR'} at ${host}:${port}`));
  });
}

async function run() {
  const redisCfg = resolveValue(['REDIS_URL', 'EVENT_BUS_REDIS_URL'], 'redis://127.0.0.1:6379');
  const natsCfg = resolveValue(['NATS_SERVERS', 'EVENT_BUS_NATS_SERVERS'], 'nats://127.0.0.1:4222');

  const targets = [
    { name: 'Redis', config: redisCfg, fallbackProtocol: 'redis', docs: 'Set REDIS_URL=redis://127.0.0.1:6379' },
    { name: 'NATS', config: natsCfg, fallbackProtocol: 'nats', docs: 'Set NATS_SERVERS=nats://127.0.0.1:4222' },
  ];

  const checks = [];
  for (const target of targets) {
    const parsed = parseTargetUrl(target.config.value, target.fallbackProtocol);
    if (!parsed) {
      checks.push({
        name: target.name,
        ok: false,
        source: target.config.source,
        target: target.config.value,
        message: 'invalid URL format',
        action: target.docs,
      });
      continue;
    }
    const probe = await probeTcp(parsed.host, parsed.port);
    checks.push({
      name: target.name,
      ok: probe.ok,
      source: target.config.source,
      target: parsed.raw,
      message: probe.message,
      action: probe.ok ? 'ready for broker integration tests' : `start local service and retry; ${target.docs}`,
    });
  }

  const ok = checks.every((entry) => entry.ok);
  console.log(JSON.stringify({ ok, strictMode, checks }, null, 2));
  if (strictMode && !ok) process.exit(1);
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
});
