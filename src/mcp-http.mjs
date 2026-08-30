import http from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpOAuth } from './mcp-auth.mjs';
import { buildMcpServer } from './mcp-server.mjs';

const port = Number(process.env.MCP_PORT || 4200);
const host = process.env.MCP_HOST || '0.0.0.0';
const bearerToken = process.env.MCP_BEARER_TOKEN || process.env.API_KEY || 'dev-api-key';
const publicUrl = process.env.MCP_PUBLIC_URL || `http://127.0.0.1:${port}/mcp`;
const signingSecret = process.env.MCP_OAUTH_SIGNING_SECRET || process.env.SESSION_SECRET || 'dev-oauth-signing-secret';
if (process.env.NODE_ENV === 'production' && (!process.env.MCP_BEARER_TOKEN || !process.env.API_KEY || !process.env.MCP_OAUTH_SIGNING_SECRET || !process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD || !process.env.MCP_PUBLIC_URL)) {
  throw new Error('Production MCP requires API_KEY, MCP_BEARER_TOKEN, MCP_OAUTH_SIGNING_SECRET, MCP_PUBLIC_URL, ADMIN_EMAIL, and ADMIN_PASSWORD');
}
const handler = createMcpHandler(buildMcpServer, { legacy: 'stateless', responseMode: 'json' });
const nodeHandler = toNodeHandler(handler, { onerror: (error) => console.error(error) });
const oauth = createMcpOAuth({
  publicUrl,
  legacyBearerToken: bearerToken,
  signingSecret,
  adminEmail: process.env.ADMIN_EMAIL || 'admin@agnee.local',
  adminPassword: process.env.ADMIN_PASSWORD || 'dev-password',
  statePath: process.env.MCP_OAUTH_STATE_PATH || '/data/mcp/oauth.json',
});
const requestCounts = new Map();

function applySecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
}

function rateLimited(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || request.socket.remoteAddress || 'unknown';
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
  if (await oauth.handle(request, response, url)) return;
  if (url.pathname !== '/mcp') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!oauth.verifyAccessToken(token, oauth.scopes.read)) return oauth.challenge(response, oauth.scopes.read);
  await nodeHandler(request, response);
});

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

server.listen(port, host, () => console.error(`Agnee MCP listening on http://${host}:${port}/mcp`));
