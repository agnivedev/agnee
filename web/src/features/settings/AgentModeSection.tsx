import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { SettingCard, StatusLine } from './parts';

type ModeId = 'standard' | 'sales' | 'cs' | 'internal_ops';

type ModeRow = {
  id: ModeId;
  configurable: boolean;
  instructions: string;
  numbers: number;
};

type BuiltinTemplate = { code: string; mode: ModeId; name: string; description: string; departments: string[] };

type ModesResponse = { maxInstructions: number; modes: ModeRow[]; templates: BuiltinTemplate[] };

/**
 * Panduan tambahan per mode agent, dan template bawaan untuk mode operasi
 * antar-departemen. Mode dipilih per nomor di kartu nomor WhatsApp; kartu ini
 * mengatur isi tiap mode, yang dipakai semua nomor ber-mode sama.
 */
export function AgentModeSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [data, setData] = useState<ModesResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const next = await api<ModesResponse>('/v1/agent-modes');
      setData(next);
      setDrafts(Object.fromEntries(next.modes.map((mode) => [mode.id, mode.instructions])));
    } catch {
      setData(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!data) return null;

  async function save(mode: ModeRow) {
    setBusy(mode.id);
    setStatus('');
    try {
      await api(`/v1/agent-modes/${mode.id}/instructions`, {
        method: 'PUT',
        body: { instructions: drafts[mode.id] ?? '' },
      });
      setStatus(t('mode.saved'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy('');
    }
  }

  async function applyTemplate(template: BuiltinTemplate) {
    const ok = await confirm.confirm({
      title: t('mode.tpl.confirmTitle'),
      message: t('mode.tpl.confirmCopy', { departments: template.departments.join(', ') }),
      confirmLabel: t('mode.tpl.apply'),
    });
    if (!ok) return;
    setBusy(template.code);
    setStatus('');
    try {
      const result = await api<{ applied: { departments?: number; modes?: number; skipped?: { departments: number; modes: number } } }>(
        `/v1/agent-modes/templates/${template.code}/apply`,
        { method: 'POST', body: {} },
      );
      const done = result.applied;
      setStatus(
        t('mode.tpl.done', {
          departments: done.departments ?? 0,
          skipped: (done.skipped?.departments ?? 0) + (done.skipped?.modes ?? 0),
        }),
      );
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy('');
    }
  }

  return (
    <SettingCard
      id="agentModeSection"
      eyebrow={t('mode.eyebrow')}
      title={t('mode.title')}
      description={t('mode.copy')}
    >
      <div className="grid gap-4">
        {data.modes.map((mode) => (
          <div key={mode.id} className="rounded-app border border-border bg-white/50 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <strong className="text-[14px]">{t(`mode.${mode.id}.label`)}</strong>
              <small className="font-mono text-[11px] text-muted">{t('mode.numbers', { count: mode.numbers })}</small>
            </div>
            <p className="mt-1 mb-0 text-[12px] leading-[1.6] text-muted">{t(`mode.${mode.id}.desc`)}</p>
            {mode.configurable ? (
              <>
                <textarea
                  value={drafts[mode.id] ?? ''}
                  onChange={(event) => setDrafts((current) => ({ ...current, [mode.id]: event.target.value }))}
                  rows={mode.id === 'internal_ops' ? 9 : 4}
                  maxLength={data.maxInstructions}
                  placeholder={t('mode.placeholder')}
                  spellCheck={false}
                  aria-label={t(`mode.${mode.id}.label`)}
                  className="mt-3 w-full resize-y rounded-app border border-input bg-white/70 p-3 text-[12px] leading-[1.6]"
                />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busy === mode.id || (drafts[mode.id] ?? '') === mode.instructions}
                    onClick={() => void save(mode)}
                  >
                    {busy === mode.id ? t('common.loading') : t('common.save')}
                  </Button>
                  {mode.id === 'internal_ops'
                    ? data.templates
                        .filter((template) => template.mode === mode.id)
                        .map((template) => (
                          <Button
                            key={template.code}
                            size="sm"
                            variant="outline"
                            disabled={busy === template.code}
                            onClick={() => void applyTemplate(template)}
                          >
                            {t('mode.tpl.use')}
                          </Button>
                        ))
                    : null}
                </div>
              </>
            ) : null}
          </div>
        ))}
      </div>
      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}
