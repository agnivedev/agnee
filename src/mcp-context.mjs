import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Who a tool call is acting for: the Agnee member who connected the MCP client,
 * their company, and the scopes their token carries. Set once per request by
 * the HTTP gateway (from the access token) or once per process by stdio (from
 * env), read by every tool. A call with no identity reaches no data.
 */
export const mcpContext = new AsyncLocalStorage();

export const READ_SCOPE = 'whatsapp:read';
export const WRITE_SCOPE = 'whatsapp:write';

// Satu-satunya identitas yang berlaku seumur proses: transport stdio (satu
// orang, satu proses). Konteks per-request tetap menang. Tanpa cadangan ini,
// identitas dari enterWith() hilang di callback stdin dan setiap alat menjawab
// "tidak ada akun". Mode HTTP tidak pernah mengisinya, jadi request tanpa token
// tetap tidak punya identitas.
let processIdentity = null;
export const setProcessIdentity = (identity) => { processIdentity = identity; };
export const currentIdentity = () => mcpContext.getStore() ?? processIdentity ?? undefined;
