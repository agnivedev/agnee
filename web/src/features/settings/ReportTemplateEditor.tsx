import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { StatusLine } from './parts';

type TemplateData = {
  template: string;
  isDefault: boolean;
  defaultTemplate: string;
  maxLength: number;
  placeholders: { key: string; label: string }[];
};

/**
 * Isi pesan laporan supervisor. Satu template per perusahaan; penanda seperti
 * {name} diganti angka sungguhan saat laporan dikirim. Server menolak penanda
 * yang tidak dikenal, jadi typo tidak sampai ke WhatsApp.
 */
export function ReportTemplateEditor() {
  const { t } = useI18n();
  const [data, setData] = useState<TemplateData | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await api<TemplateData>('/v1/reports/template');
      setData(loaded);
      setText(loaded.template);
    } catch (failure) {
      setError(messageFromError(failure, ''));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!data) return error ? <StatusLine tone="error">{error}</StatusLine> : null;

  const dirty = text.replace(/\r\n/g, '\n').trim() !== data.template.trim();

  function insert(key: string) {
    const element = field.current;
    const token = `{${key}}`;
    if (!element) { setText((current) => current + token); return; }
    const start = element.selectionStart ?? text.length;
    const end = element.selectionEnd ?? text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    setPreview('');
    // Kursor setelah penanda yang baru disisipkan, setelah React menulis ulang nilainya.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function run(action: 'save' | 'preview') {
    setError(''); setStatus(''); setBusy(true);
    try {
      if (action === 'preview') {
        const result = await api<{ text: string }>('/v1/reports/template/preview', { method: 'POST', body: { template: text } });
        setPreview(result.text);
      } else {
        await api('/v1/reports/template', { method: 'PUT', body: { template: text } });
        setStatus(t('report.tpl.saved'));
        await load();
      }
    } catch (failure) {
      setError(messageFromError(failure, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-4 rounded-xl border border-border bg-white/60 p-3" open={!data.isDefault || undefined}>
      <summary className="cursor-pointer text-[13px] font-semibold">
        {t('report.tpl.title')}
        <span className="ml-2 rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[10px]">
          {t(data.isDefault ? 'report.tpl.default' : 'report.tpl.custom')}
        </span>
      </summary>
      <p className="mt-2 mb-2 text-[12px] leading-[1.6] text-muted">{t('report.tpl.copy')}</p>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label={t('report.tpl.insert')}>
        {data.placeholders.map((placeholder) => (
          <button
            key={placeholder.key}
            type="button"
            title={placeholder.label}
            onClick={() => insert(placeholder.key)}
            className="min-h-8 cursor-pointer rounded-full border border-border bg-white px-2.5 py-1 font-mono text-[11px] text-ink transition-colors hover:bg-ink/6"
          >
            {`{${placeholder.key}}`}
          </button>
        ))}
      </div>
      <textarea
        ref={field}
        value={text}
        onChange={(event) => { setText(event.target.value); setPreview(''); }}
        rows={11}
        maxLength={data.maxLength + 200}
        spellCheck={false}
        aria-label={t('report.tpl.title')}
        className="w-full resize-y rounded-app border border-input bg-white/70 p-3 font-mono text-[12px] leading-[1.6]"
      />
      <div className="mt-1 text-right font-mono text-[10px] text-muted">{text.length}/{data.maxLength}</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void run('save')} disabled={busy || !dirty || !text.trim()}>
          {busy ? t('common.loading') : t('common.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void run('preview')} disabled={busy || !text.trim()}>
          {t('report.tpl.preview')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setText(data.defaultTemplate); setPreview(''); }}
          disabled={busy || text.trim() === data.defaultTemplate.trim()}
        >
          {t('report.tpl.reset')}
        </Button>
      </div>
      {preview ? (
        <div className="mt-3">
          <p className="m-0 mb-1 font-mono text-[10px] tracking-[.1em] text-muted uppercase">{t('report.tpl.previewTitle')}</p>
          <pre className="m-0 max-h-72 overflow-auto rounded-xl bg-ink/5 p-3 font-sans text-[13px] leading-[1.55] whitespace-pre-wrap">{preview}</pre>
        </div>
      ) : null}
      <div className="mt-2 grid gap-1">
        <StatusLine>{status}</StatusLine>
        <StatusLine tone="error">{error}</StatusLine>
      </div>
    </details>
  );
}
