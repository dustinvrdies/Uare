/* ═══════════════════════════════════════════════════════════════════════════
   UARE AI Engineering Workstation — app.js
   Boot module: identity, auth headers, global state, and health check.
   All UI is driven by enki.js. This file is ES module (type="module").
   ═══════════════════════════════════════════════════════════════════════════ */

const params = new URLSearchParams(window.location.search);

// Identity (read from query params → localStorage → defaults)
window.__uare_userId   = params.get('user_id')   || localStorage.getItem('uare.userId')   || 'tester';
window.__uare_userRole = params.get('user_role')  || localStorage.getItem('uare.userRole') || 'owner';

// Expose auth headers globally so Enki can use them
window.__uare_headers = () => ({
  'Content-Type': 'application/json',
  'x-user-id':   window.__uare_userId,
  'x-user-role': window.__uare_userRole,
});

// ── Backend health check ─────────────────────────────────────────────────
async function _checkHealth() {
  try {
    const r = await fetch('/health', {
      headers: window.__uare_headers(),
      signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const d = await r.json();
      console.log('[UARE] Backend healthy:', d.status || 'ok');
      return d;
    }
  } catch (e) {
    console.warn('[UARE] Health check failed:', e.message);
  }
  return null;
}

// ── Boot ─────────────────────────────────────────────────────────────────
(async function boot() {
  // Wait for UARE_ENKI (loaded by enki.js <script> before this module)
  let attempts = 0;
  while (!window.UARE_ENKI && attempts < 30) {
    await new Promise(r => setTimeout(r, 50));
    attempts++;
  }

  if (!window.UARE_ENKI) {
    console.error('[UARE app.js] UARE_ENKI not found after 1.5s. Check enki.js load order.');
    return;
  }

  // Kick off health check in background (non-blocking)
  _checkHealth().then(health => {
    if (health && window.UARE_ENKI.addMessage) {
      // Silently note backend status in Enki's internal state — no UI spam
    }
  });

  // UARE_ENKI.init already called itself (self-boots in enki.js)
  // But if it needs updated headers (e.g. real auth token), re-init:
  if (window.__uare_userId !== 'tester' || window.__uare_userRole !== 'owner') {
    // Re-init with proper auth
    if (window.UARE_ENKI.init) {
      window.UARE_ENKI.init({
        endpoint: '/copilot',
        headers: window.__uare_headers(),
      });
    }
  }

  const executionId = params.get('execution_id');
  if (executionId && window.UARE_ENKI.loadExecution) {
    try {
      await window.UARE_ENKI.loadExecution(executionId);
    } catch (error) {
      console.warn('[UARE app.js] Failed to load execution in unified shell:', error.message);
    }
  }

  console.log('[UARE Workstation] Boot complete. User:', window.__uare_userId, '| Role:', window.__uare_userRole);
})();
