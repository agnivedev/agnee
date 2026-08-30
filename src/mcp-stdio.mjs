import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { buildMcpServer } from './mcp-server.mjs';

void serveStdio(buildMcpServer);
console.error('Agnee MCP is listening on stdio');
