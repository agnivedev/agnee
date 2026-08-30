import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const url = new URL(process.env.MCP_URL || 'http://127.0.0.1:4200/mcp');
const token = process.env.MCP_BEARER_TOKEN || 'dev-mcp-token';
const client = new Client({ name: 'agnee-smoke-test', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});

const unauthorized = await fetch(url, { method: 'POST' });
if (unauthorized.status !== 401 || !unauthorized.headers.get('www-authenticate')?.includes('resource_metadata=')) {
  throw new Error(`Expected OAuth discovery challenge, got HTTP ${unauthorized.status}`);
}
const metadataUrl = new URL('/.well-known/oauth-protected-resource', url);
const metadata = await fetch(metadataUrl).then((response) => response.json());
if (!metadata.authorization_servers?.length) throw new Error('OAuth protected-resource metadata is incomplete');

await client.connect(transport);
const tools = await client.listTools();
console.log(`Tools: ${tools.tools.map((tool) => tool.name).join(', ')}`);
const status = await client.callTool({ name: 'whatsapp_status', arguments: {} });
if (status.isError) throw new Error(`whatsapp_status failed: ${status.content?.[0]?.text || 'unknown error'}`);
console.log(`Status: ${status.content[0].text}`);
const conversations = await client.callTool({ name: 'list_conversations', arguments: { limit: 3 } });
if (conversations.isError) throw new Error(`list_conversations failed: ${conversations.content?.[0]?.text || 'unknown error'}`);
const list = conversations.structuredContent?.chats || conversations.structuredContent?.items || [];
console.log(`Read-only conversation sample: ${list.length} item(s)`);
if (list[0]?.id) {
  const messages = await client.callTool({ name: 'read_conversation', arguments: { chatId: list[0].id, limit: 5 } });
  if (messages.isError) throw new Error(`read_conversation failed: ${messages.content?.[0]?.text || 'unknown error'}`);
  const rows = messages.structuredContent?.messages || messages.structuredContent?.items || [];
  console.log(`Read-only message sample: ${rows.length} item(s)`);
}
await client.close();
