'use strict';

const GRAPH_API_VERSION = 'v20.0';

/** Send a plain-text WhatsApp message via Meta's Cloud API (Graph API). */
async function sendCloudApiText({ phoneNumberId, accessToken, to, text }) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Cloud API send failed: ${data?.error?.message || `HTTP ${response.status}`}`);
  return { messageId: data.messages?.[0]?.id || null, timestamp: Math.floor(Date.now() / 1000) };
}

/**
 * Confirm a phone_number_id/access_token pair is valid before saving it, by
 * asking Meta for the number's own display name. Throws with Meta's own
 * error message on failure (bad token, wrong phone_number_id, etc).
 */
async function verifyCloudApiCredentials({ phoneNumberId, accessToken }) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Verifikasi kredensial gagal: ${data?.error?.message || `HTTP ${response.status}`}`);
  return { displayPhoneNumber: data.display_phone_number || null, verifiedName: data.verified_name || null };
}

module.exports = { sendCloudApiText, verifyCloudApiCredentials };
