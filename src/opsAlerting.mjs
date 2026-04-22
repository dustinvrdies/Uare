export async function sendOpsAlert(event) {
  const webhookUrl = process.env.OPS_ALERT_WEBHOOK_URL;
  const payload = { service: 'uare-custom-backend', ts: new Date().toISOString(), ...event };
  if (!webhookUrl) {
    console.error(JSON.stringify({ level: 'error', type: 'ops_alert', ...payload }));
    return { delivered: false, reason: 'OPS_ALERT_WEBHOOK_URL_not_configured', payload };
  }
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { delivered: res.ok, status: res.status };
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', type: 'ops_alert_delivery_failed', error: err.message, ...payload }));
    return { delivered: false, error: err.message };
  }
}
