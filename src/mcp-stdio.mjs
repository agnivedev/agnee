import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildMcpServer } from './mcp-server.mjs';
import { setProcessIdentity, READ_SCOPE, WRITE_SCOPE } from './mcp-context.mjs';

// Local use only: the person running this process names who they act as.
setProcessIdentity({
  userId: process.env.AGNEE_USER_ID || '',
  companyId: process.env.AGNEE_COMPANY || '',
  scopes: [READ_SCOPE, WRITE_SCOPE],
});
void serveStdio(buildMcpServer);
console.error('Agnee MCP is listening on stdio');
