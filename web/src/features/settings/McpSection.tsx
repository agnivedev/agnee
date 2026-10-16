import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { SettingCard } from './parts';

// Endpoint MCP tetap per deployment (lihat deploy/nginx/agnee.conf).
const MCP_URL = 'https://mcp.agnee.agnive.co/mcp';

function CopyUrl({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[13px] whitespace-nowrap">
        {value}
      </code>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          } catch { /* clipboard diblokir: URL tetap terlihat untuk disalin manual */ }
        }}
      >
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  );
}

function Steps({ title, keys }: { title: string; keys: string[] }) {
  const { t } = useI18n();
  return (
    <div className="mt-5">
      <h3 className="m-0 mb-2 text-sm">{title}</h3>
      <ol className="m-0 grid gap-1.5 pl-5 text-[13px] leading-[1.6] text-muted">
        {keys.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Cara menyambungkan Agnee ke ChatGPT atau Claude lewat MCP. Tidak ada secret
 * di sini: klien masuk lewat OAuth dengan akun Agnee, aksesnya sama dengan
 * akses akun itu di aplikasi.
 */
export function McpSection() {
  const { t } = useI18n();
  return (
    <SettingCard id="mcpSection" eyebrow={t('mcp.eyebrow')} title={t('mcp.title')} description={t('mcp.description')}>
      <p className="mt-0 mb-2 text-[13px] font-semibold">{t('mcp.urlLabel')}</p>
      <CopyUrl value={MCP_URL} />
      <Steps title={t('mcp.chatgptTitle')} keys={['mcp.chatgpt1', 'mcp.chatgpt2', 'mcp.chatgpt3', 'mcp.chatgpt4']} />
      <Steps title={t('mcp.claudeTitle')} keys={['mcp.claude1', 'mcp.claude2', 'mcp.claude3']} />
      <p className="mt-5 mb-0 text-[12px] leading-[1.6] text-muted">{t('mcp.note')}</p>
    </SettingCard>
  );
}
