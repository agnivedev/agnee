import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { Row, SettingCard, StatusLine } from './parts';

type Templates = { welcomeId: string; welcomeEn: string; confirmId: string; confirmEn: string };
type LeadWebhook = {
  configured?: boolean;
  enabled?: boolean;
  hasLeadSecret?: boolean;
  hasVerifySecret?: boolean;
  leadPath?: string;
  verifyPath?: string;
  templates?: Templates;
};
type Kind = 'lead' | 'verify';

const TEMPLATE_FIELDS: { key: keyof Templates; label: string }[] = [
  { key: 'welcomeId', label: 'leadHook.welcomeId' },
  { key: 'welcomeEn', label: 'leadHook.welcomeEn' },
  { key: 'confirmId', label: 'leadHook.confirmId' },
  { key: 'confirmEn', label: 'leadHook.confirmEn' },
];

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch { /* clipboard diblokir: nilainya tetap terlihat untuk disalin manual */ }
      }}
    >
      {copied ? t('common.copied') : t('common.copy')}
    </Button>
  );
}

/**
 * Pintu masuk lead dari pihak ketiga (website, WordPress, robot, CRM): URL per
 * company, dua secret HMAC (lead dan verifikasi), dan template pesan sambutan
 * serta konfirmasi. Secret hanya tampil sekali, tepat setelah dibuat.
 */
export function LeadWebhookSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [state, setState] = useState<LeadWebhook>({ configured: false });
  const [templates, setTemplates] = useState<Templates>({ welcomeId: '', welcomeEn: '', confirmId: '', confirmEn: '' });
  const [fresh, setFresh] = useState<{ kind: Kind; secret: string } | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<LeadWebhook>('/v1/integrations/lead-webhook');
      setState(data);
      if (data.templates) setTemplates(data.templates);
    } catch {
      setState({ configured: false });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function makeSecret(kind: Kind) {
    if (state[kind === 'lead' ? 'hasLeadSecret' : 'hasVerifySecret']) {
      const ok = await confirm.confirm({
        title: t('leadHook.rotateTitle'),
        message: t('leadHook.rotateCopy'),
        confirmLabel: t('leadHook.rotate'),
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const out = await api<{ kind: Kind; secret: string }>('/v1/integrations/lead-webhook/secret', { method: 'POST', body: { kind } });
      setFresh(out);
      await load();
    } catch (error) {
      await confirm.error(error);
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplates() {
    setBusy(true);
    setStatus('');
    try {
      await api('/v1/integrations/lead-webhook', { method: 'PUT', body: { templates } });
      setStatus(t('leadHook.saved'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const endpoints: { kind: Kind; label: string; path?: string; has?: boolean }[] = [
    { kind: 'lead', label: t('leadHook.leadUrl'), path: state.leadPath, has: state.hasLeadSecret },
    { kind: 'verify', label: t('leadHook.verifyUrl'), path: state.verifyPath, has: state.hasVerifySecret },
  ];

  return (
    <SettingCard
      id="leadWebhookSection"
      eyebrow={t('leadHook.eyebrow')}
      title={t('leadHook.title')}
      description={t('leadHook.copy')}
      badge={state.configured ? (state.enabled ? t('export.on') : t('export.off')) : t('export.notConnected')}
      badgeTone={state.configured && state.enabled ? 'on' : 'off'}
    >
      {!state.configured ? (
        <Button size="sm" disabled={busy} onClick={() => makeSecret('lead')}>{t('leadHook.enable')}</Button>
      ) : (
        <div className="grid gap-4">
          {fresh ? (
            <div className="rounded-xl border border-border bg-white/60 p-4">
              <strong className="text-[13px]">{t('leadHook.freshTitle', { kind: fresh.kind === 'lead' ? t('leadHook.leadShort') : t('leadHook.verifyShort') })}</strong>
              <p className="my-1 text-[12px] text-muted">{t('leadHook.freshCopy')}</p>
              <Row>
                <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{fresh.secret}</code>
                <CopyButton value={fresh.secret} />
              </Row>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setFresh(null)}>{t('leadHook.freshDone')}</Button>
            </div>
          ) : null}

          {endpoints.map(({ kind, label, path, has }) => (
            <div key={kind} className="rounded-xl border border-border bg-white/40 p-4">
              <h3 className="m-0 mb-2 text-[14px]">{label}</h3>
              <Row className="mb-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[12px]">{`${origin}${path ?? ''}`}</code>
                <CopyButton value={`${origin}${path ?? ''}`} />
              </Row>
              <div className="flex flex-wrap items-center gap-3">
                <small className="font-mono text-[11px] text-muted">{has ? t('leadHook.secretSet') : t('leadHook.secretMissing')}</small>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => makeSecret(kind)}>
                  {has ? t('leadHook.rotate') : t('leadHook.createSecret')}
                </Button>
              </div>
            </div>
          ))}

          <div className="rounded-xl border border-border bg-white/40 p-4">
            <h3 className="m-0 mb-1 text-[14px]">{t('leadHook.templatesTitle')}</h3>
            <p className="m-0 mb-3 text-[12px] text-muted">{t('leadHook.templatesCopy')}</p>
            <div className="grid gap-3">
              {TEMPLATE_FIELDS.map(({ key, label }) => (
                <label key={key} className="grid gap-1 text-[12px] font-semibold">
                  {t(label)}
                  <Textarea
                    value={templates[key]}
                    onChange={(event) => setTemplates({ ...templates, [key]: event.target.value })}
                    maxLength={1000}
                    placeholder={t('leadHook.templatePlaceholder')}
                    className="min-h-16 py-2.5 font-normal"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" disabled={busy} onClick={saveTemplates}>{t('common.save')}</Button>
              <StatusLine>{status}</StatusLine>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api('/v1/integrations/lead-webhook', { method: 'PUT', body: { enabled: !state.enabled } });
                  await load();
                } catch (error) {
                  await confirm.error(error);
                }
              }}
            >
              {state.enabled ? t('export.turnOff') : t('export.turnOn')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                const ok = await confirm.confirm({
                  title: t('leadHook.disconnectTitle'),
                  message: t('leadHook.disconnectCopy'),
                  confirmLabel: t('export.disconnect'),
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api('/v1/integrations/lead-webhook', { method: 'DELETE' });
                  setFresh(null);
                  await load();
                } catch (error) {
                  await confirm.error(error);
                }
              }}
            >
              {t('export.disconnect')}
            </Button>
          </div>
        </div>
      )}
    </SettingCard>
  );
}
