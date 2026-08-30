import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const READ_SCOPE = 'whatsapp:read';
const WRITE_SCOPE = 'whatsapp:write';
const SCOPES = [READ_SCOPE, WRITE_SCOPE];

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function html(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

async function readBody(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function normalizeScopes(value) {
  const requested = String(value || READ_SCOPE).split(/\s+/).filter(Boolean);
  if (requested.some((scope) => !SCOPES.includes(scope))) return null;
  return [...new Set(requested)];
}

function redirectAllowed(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname));
  } catch {
    return false;
  }
}

export function createMcpOAuth({ publicUrl, legacyBearerToken, signingSecret, adminEmail, adminPassword, statePath }) {
  const resource = new URL(publicUrl).toString().replace(/\/$/, '');
  const issuer = new URL(resource).origin;
  const resourceMetadata = `${issuer}/.well-known/oauth-protected-resource`;
  const clients = new Map();
  const codes = new Map();
  const refreshTokens = new Map();

  function loadState() {
    if (!statePath || !fs.existsSync(statePath)) return;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      for (const client of state.clients || []) clients.set(client.client_id, client);
    } catch (error) {
      console.error(`Could not load MCP OAuth state: ${error.message}`);
    }
  }

  function saveState() {
    if (!statePath) return;
    fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
    const temporary = `${statePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ clients: [...clients.values()] }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, statePath);
  }

  function signAccessToken({ subject, scopes, lifetime = 3600 }) {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
      iss: issuer,
      sub: subject,
      aud: resource,
      scope: scopes.join(' '),
      iat: now,
      exp: now + lifetime,
      jti: randomToken(12),
    }));
    const signature = crypto.createHmac('sha256', signingSecret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  function verifyAccessToken(token, requiredScope = READ_SCOPE) {
    if (legacyBearerToken && safeEqual(token, legacyBearerToken)) return { sub: 'legacy-smoke-test', scope: SCOPES.join(' ') };
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const expected = crypto.createHmac('sha256', signingSecret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (!safeEqual(parts[2], expected)) return null;
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      const scopes = String(payload.scope || '').split(/\s+/);
      if (payload.iss !== issuer || payload.aud !== resource || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      if (requiredScope && !scopes.includes(requiredScope)) return null;
      return payload;
    } catch {
      return null;
    }
  }

  function challenge(response, scope = READ_SCOPE) {
    json(response, 401, { error: 'Unauthorized' }, {
      'www-authenticate': `Bearer resource_metadata="${resourceMetadata}", scope="${scope}"`,
    });
  }

  function validateAuthorize(params) {
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const requestedResource = params.get('resource');
    const scopes = normalizeScopes(params.get('scope'));
    const client = clients.get(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) return { error: 'invalid_client' };
    if (params.get('response_type') !== 'code') return { error: 'unsupported_response_type' };
    if (params.get('code_challenge_method') !== 'S256' || !params.get('code_challenge')) return { error: 'invalid_request' };
    if (requestedResource !== resource || !scopes) return { error: 'invalid_scope' };
    return { client, clientId, redirectUri, requestedResource, scopes };
  }

  async function handle(request, response, url) {
    if (request.method === 'GET' && (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')) {
      json(response, 200, {
        resource,
        authorization_servers: [issuer],
        scopes_supported: SCOPES,
        resource_documentation: `${issuer}/mcp/docs`,
      });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      json(response, 200, {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: SCOPES,
        authorization_response_iss_parameter_supported: true,
      });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/oauth/register') {
      try {
        const input = JSON.parse(await readBody(request));
        const redirectUris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter(redirectAllowed) : [];
        if (!redirectUris.length || redirectUris.length !== input.redirect_uris.length) {
          json(response, 400, { error: 'invalid_redirect_uri' });
          return true;
        }
        const client = {
          client_id: randomToken(24),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_name: String(input.client_name || 'MCP client').slice(0, 100),
          redirect_uris: redirectUris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
        clients.set(client.client_id, client);
        saveState();
        json(response, 201, client);
      } catch {
        json(response, 400, { error: 'invalid_client_metadata' });
      }
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/oauth/authorize') {
      const validated = validateAuthorize(url.searchParams);
      if (validated.error) {
        json(response, 400, validated);
        return true;
      }
      const hidden = [...url.searchParams.entries()].map(([key, value]) => `<input type="hidden" name="${html(key)}" value="${html(value)}">`).join('');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      response.end(`<!doctype html><html lang="id"><meta name="viewport" content="width=device-width"><title>Hubungkan Agnee</title><style>body{font:16px system-ui;background:#f4f5ef;color:#102820;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(390px,calc(100% - 48px));padding:32px;background:white;border:1px solid #dce3dc;border-radius:24px;box-shadow:0 24px 70px #183c2920}h1{margin:0 0 8px}p{color:#5d6d65}label{display:block;margin:18px 0 6px;font-weight:650}input{box-sizing:border-box;width:100%;padding:13px;border:1px solid #bcc8c0;border-radius:12px;font:inherit}button{width:100%;margin-top:22px;padding:14px;border:0;border-radius:12px;background:#102820;color:white;font:700 16px system-ui}</style><body><form class="card" method="post" action="/oauth/authorize"><h1>Hubungkan Agnee</h1><p>Izinkan klien MCP membaca percakapan dan mengirim balasan WhatsApp atas instruksi Anda.</p>${hidden}<label>Email admin</label><input name="email" type="email" autocomplete="username" required><label>Password</label><input name="password" type="password" autocomplete="current-password" required><button type="submit">Masuk dan izinkan</button></form></body></html>`);
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/oauth/authorize') {
      const params = new URLSearchParams(await readBody(request));
      const validated = validateAuthorize(params);
      if (validated.error || !safeEqual(params.get('email'), adminEmail) || !safeEqual(params.get('password'), adminPassword)) {
        json(response, 401, { error: validated.error || 'access_denied', error_description: 'Login admin tidak valid.' });
        return true;
      }
      const code = randomToken(32);
      codes.set(code, {
        clientId: validated.clientId,
        redirectUri: validated.redirectUri,
        resource: validated.requestedResource,
        scopes: validated.scopes,
        codeChallenge: params.get('code_challenge'),
        subject: params.get('email'),
        expiresAt: Date.now() + 5 * 60_000,
      });
      const destination = new URL(validated.redirectUri);
      destination.searchParams.set('code', code);
      if (params.get('state')) destination.searchParams.set('state', params.get('state'));
      destination.searchParams.set('iss', issuer);
      response.writeHead(302, { location: destination.toString(), 'cache-control': 'no-store' });
      response.end();
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/oauth/token') {
      const params = new URLSearchParams(await readBody(request));
      const grantType = params.get('grant_type');
      if (grantType === 'authorization_code') {
        const codeValue = params.get('code');
        const record = codes.get(codeValue);
        codes.delete(codeValue);
        const verifier = params.get('code_verifier') || '';
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (!record || record.expiresAt < Date.now() || record.clientId !== params.get('client_id') || record.redirectUri !== params.get('redirect_uri') || record.resource !== params.get('resource') || !safeEqual(challenge, record.codeChallenge)) {
          json(response, 400, { error: 'invalid_grant' });
          return true;
        }
        const refreshToken = randomToken(40);
        refreshTokens.set(refreshToken, { ...record, expiresAt: Date.now() + 30 * 24 * 60 * 60_000 });
        json(response, 200, {
          access_token: signAccessToken(record),
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: refreshToken,
          scope: record.scopes.join(' '),
        });
        return true;
      }
      if (grantType === 'refresh_token') {
        const oldToken = params.get('refresh_token');
        const record = refreshTokens.get(oldToken);
        refreshTokens.delete(oldToken);
        if (!record || record.expiresAt < Date.now() || record.clientId !== params.get('client_id') || record.resource !== params.get('resource')) {
          json(response, 400, { error: 'invalid_grant' });
          return true;
        }
        const refreshToken = randomToken(40);
        refreshTokens.set(refreshToken, { ...record, expiresAt: Date.now() + 30 * 24 * 60 * 60_000 });
        json(response, 200, {
          access_token: signAccessToken(record), token_type: 'Bearer', expires_in: 3600,
          refresh_token: refreshToken, scope: record.scopes.join(' '),
        });
        return true;
      }
      json(response, 400, { error: 'unsupported_grant_type' });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/mcp/docs') {
      response.writeHead(302, { location: 'https://agnee.agnive.co', 'cache-control': 'no-store' });
      response.end();
      return true;
    }
    return false;
  }

  loadState();
  return { resource, resourceMetadata, verifyAccessToken, challenge, handle, scopes: { read: READ_SCOPE, write: WRITE_SCOPE } };
}

