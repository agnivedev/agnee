import http from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpOAuth } from './mcp-auth.mjs';
import { buildMcpServer } from './mcp-server.mjs';
import { mcpContext } from './mcp-context.mjs';

const port = Number(process.env.MCP_PORT || 4200);
const host = process.env.MCP_HOST || '0.0.0.0';
const publicUrl = process.env.MCP_PUBLIC_URL || `http://127.0.0.1:${port}/mcp`;
const apiBaseUrl = (process.env.MCP_API_BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const signingSecret = process.env.MCP_OAUTH_SIGNING_SECRET || process.env.SESSION_SECRET || 'dev-oauth-signing-secret';
if (process.env.NODE_ENV === 'production' && (!process.env.API_KEY || !process.env.MCP_OAUTH_SIGNING_SECRET || !process.env.MCP_PUBLIC_URL)) {
  throw new Error('Production MCP requires API_KEY, MCP_OAUTH_SIGNING_SECRET, and MCP_PUBLIC_URL');
}

/* The deployment smoke test's static token. It reads only, and only as the
   member named here — never as "the system". Unset = no static token at all. */
const legacyIdentity = process.env.MCP_LEGACY_USER_ID && process.env.AGNEE_COMPANY
  ? { userId: process.env.MCP_LEGACY_USER_ID, companyId: process.env.AGNEE_COMPANY }
  : null;

/** Signs in through the backend's own login: same passwords, same rules,
 *  same "inactive member cannot get in". */
async function authenticate(email, password) {
  const response = await fetch(`${apiBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return null;
  const { user } = await response.json().catch(() => ({}));
  return user?.userId && user?.companyId
    ? { userId: user.userId, companyId: user.companyId, displayName: user.displayName }
    : null;
}
const handler = createMcpHandler(buildMcpServer, { legacy: 'stateless', responseMode: 'json' });
const nodeHandler = toNodeHandler(handler, { onerror: (error) => console.error(error) });
const oauth = createMcpOAuth({
  publicUrl,
  legacyBearerToken: process.env.MCP_BEARER_TOKEN || '',
  legacyIdentity,
  signingSecret,
  authenticate,
  statePath: process.env.MCP_OAUTH_STATE_PATH || '/data/mcp/oauth.json',
});
const requestCounts = new Map();

function applySecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

// Only honour X-Forwarded-For when TRUST_PROXY is enabled; otherwise a client can
// spoof the header and get a fresh rate-limit bucket on every request.
const trustProxy = ['1', 'true', 'yes'].includes(String(process.env.TRUST_PROXY || '').toLowerCase());

function clientAddress(request) {
  const forwarded = trustProxy
    ? String(request.headers['x-forwarded-for'] || '').split(',')[0].trim()
    : '';
  return forwarded || request.socket.remoteAddress || 'unknown';
}

function rateLimited(request) {
  const key = clientAddress(request);
  const window = Math.floor(Date.now() / 60_000);
  const record = requestCounts.get(key);
  if (!record || record.window !== window) {
    requestCounts.set(key, { window, count: 1 });
    if (requestCounts.size > 5000) requestCounts.clear();
    return false;
  }
  record.count += 1;
  return record.count > Number(process.env.MCP_RATE_LIMIT_PER_MINUTE || 180);
}

const server = http.createServer(async (request, response) => {
  applySecurityHeaders(response);
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (rateLimited(request)) {
    response.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' });
    response.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }
  if (Number(request.headers['content-length'] || 0) > 1024 * 1024) {
    response.writeHead(413, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Request body too large' }));
    return;
  }
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'agnee-mcp' }));
    return;
  }
  if (await oauth.handle(request, response, url, clientAddress(request))) return;
  if (url.pathname !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const identity = oauth.verifyAccessToken(token, oauth.scopes.read);
  if (!identity) return oauth.challenge(response, oauth.scopes.read);
  // Every tool call in this request acts as this member, with these scopes.
  await mcpContext.run(identity, () => nodeHandler(request, response));
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(port, host, () => console.error(`Agnee MCP listening on http://${host}:${port}/mcp`));
