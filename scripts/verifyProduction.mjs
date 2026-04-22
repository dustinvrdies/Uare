const baseUrl = process.env.APP_BASE_URL || 'http://localhost:8787';

async function fetchResponse(path, options = {}) {
  const url = new URL(path, baseUrl).toString();
  const res = await fetch(url, {
    credentials: 'include',
    headers: { ...(options.headers || {}) },
    ...options
  });
  let text = '';
  let body = null;
  try { text = await res.text(); } catch {}
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { url, res, body };
}

async function expectStatus(name, path, allowed, options = {}) {
  const { url, res, body } = await fetchResponse(path, options);
  const ok = allowed.includes(res.status);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} ${url}`);
  if (!ok) {
    console.error(body);
    process.exitCode = 1;
  }
  return { res, body };
}

await expectStatus('lab shell', '/lab', [200], { headers: { accept: 'text/html' } });
await expectStatus('ops liveness', '/ops/liveness', [200]);
await expectStatus('ops readiness', '/ops/readiness', [200, 503]);
await expectStatus('ops config audit', '/ops/quality/config-audit', [200, 401]);
await expectStatus('billing plans', '/billing/plans', [200]);
await expectStatus('billing lifecycle', '/billing/lifecycle', [200, 401, 403]);
await expectStatus('export summary', '/exports/summary', [200, 401, 403]);
await expectStatus('billing subscription', '/billing/subscription', [200, 401, 403]);
await expectStatus('org list', '/orgs', [200, 401, 403]);
await expectStatus('usage summary', '/usage/summary', [200, 401, 403]);

if (process.exitCode) {
  console.error('Production verification failed.');
  process.exit(process.exitCode);
}
console.log(`Production verification completed against ${baseUrl}`);
