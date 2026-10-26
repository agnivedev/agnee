import { Download, FileSpreadsheet, Inbox, ShoppingCart, Store, Truck, Webhook, type LucideIcon } from 'lucide-react';

/**
 * Integrasi yang bisa dinyalakan tabnya. Kuncinya SAMA dengan
 * INTEGRATION_TAB_KEYS di server (src/server.js): server menolak kunci lain.
 */
export const INTEGRATION_KEYS = ['mayar', 'dealpos', 'lalamove', 'export', 'webhook', 'mcp', 'sources'] as const;
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export const INTEGRATIONS: { key: IntegrationKey; Icon: LucideIcon }[] = [
  { key: 'dealpos', Icon: Store },
  { key: 'lalamove', Icon: Truck },
  { key: 'mayar', Icon: ShoppingCart },
  { key: 'export', Icon: FileSpreadsheet },
  { key: 'webhook', Icon: Webhook },
  { key: 'mcp', Icon: Download },
  { key: 'sources', Icon: Inbox },
];

export const integrationTabId = (key: IntegrationKey) => `int:${key}` as const;
export type IntegrationTabId = ReturnType<typeof integrationTabId>;

/** Bagian lama yang ditautkan dari halaman lain, dan integrasi pemiliknya. */
export const SECTION_INTEGRATION: Record<string, IntegrationKey> = {
  exportSection: 'export',
  mcpSection: 'mcp',
  mayarSection: 'mayar',
  dealposSection: 'dealpos',
  lalamoveSection: 'lalamove',
  leadWebhookSection: 'webhook',
};
