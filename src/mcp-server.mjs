import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

const apiBaseUrl = (process.env.MCP_API_BASE_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
const apiKey = process.env.API_KEY || 'dev-api-key';

async function agneeApi(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Agnee API returned HTTP ${response.status}`);
  return data;
}

function result(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

export function buildMcpServer() {
  const server = new McpServer(
    { name: 'agnee-whatsapp', version: '0.2.0' },
    { instructions: 'Read a conversation before replying. Ask for confirmation before sending consequential or promotional messages.' },
  );

  server.registerTool('whatsapp_status', {
    title: 'WhatsApp status',
    description: 'Check whether the Agnee WhatsApp adapter is connected and ready.',
    annotations: { readOnlyHint: true },
  }, async () => result(await agneeApi('/v1/whatsapp/status')));

  server.registerTool('list_conversations', {
    title: 'List conversations',
    description: 'List recent WhatsApp conversations with compact previews.',
    inputSchema: z.object({ limit: z.number().int().min(1).max(30).default(10) }),
    annotations: { readOnlyHint: true },
  }, async ({ limit }) => result(await agneeApi(`/v1/chats?limit=${limit}`)));

  server.registerTool('read_conversation', {
    title: 'Read conversation',
    description: 'Read the latest messages from one WhatsApp conversation.',
    inputSchema: z.object({
      chatId: z.string().min(1).max(128),
      limit: z.number().int().min(1).max(100).default(30),
    }),
    annotations: { readOnlyHint: true },
  }, async ({ chatId, limit }) => result(await agneeApi(`/v1/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}`)));

  server.registerTool('send_whatsapp_message', {
    title: 'Send WhatsApp message',
    description: 'Send a plain-text WhatsApp message to an existing chat or phone number.',
    inputSchema: z.object({
      chatId: z.string().min(1).max(128).optional(),
      to: z.string().min(1).max(128).optional(),
      text: z.string().min(1).max(4096),
      clientRequestId: z.string().min(8).max(100).optional().describe('Stable idempotency key to safely retry the same send.'),
    }).refine((value) => value.chatId || value.to, { message: 'chatId or to is required' }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ chatId, to, text, clientRequestId }) => result(await agneeApi('/v1/messages/send', {
    method: 'POST',
    body: JSON.stringify({ ...(chatId ? { chatId } : { to }), text, clientRequestId: clientRequestId || crypto.randomUUID() }),
  })));

  return server;
}
