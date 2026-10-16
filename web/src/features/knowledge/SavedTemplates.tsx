import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Template potret konfigurasi company: simpan (menimpa), simpan sebagai baru,
 * pasang. Memasang hanya menambah dan menimpa isi, tidak menghapus.
 */

const SECTIONS = ['playbook', 'facts', 'brief', 'departments', 'identity'] as const;
type Section = (typeof SECTIONS)[number];

type Row = {
  id: string; name: string; version: number; updatedAt: string;
  contents: { playbook?: number; facts?: number; brief?: number; departments?: number; identity?: string };
};
type Changes = Partial<Record<Section, Record<string, unknown>>>;

function SectionPicker({ picked, onChange, available }: { picked: Section[]; onChange: (next: Section[]) => void; available?: Section[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTIONS.filter((s) => !available || available.includes(s)).map((section) => {
        const on = picked.includes(section);
        return (
          <button
            key={section} type="button" aria-pressed={on}
            onClick={() => onChange(on ? picked.filter((s) => s !== section) : [...picked, section])}
            className={cn('cursor-pointer rounded-full border px-2.5 py-1 text-[12px]', on ? 'border-green bg-green/10 font-medium' : 'border-border bg-white text-muted')}
          >
            {t(`savedTpl.section.${section}`)}
          </button>
        );
      })}
    </div>
  );
}

export function SavedTemplates({ onApplied }: { onApplied: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<Section[]>([...SECTIONS]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [opened, setOpened] = useState<{ row: Row; changes: Changes; sections: Section[] } | null>(null);

  const load = useCallback(async () => {
    try { setRows((await api<{ templates: Row[] }>('/v1/templates')).templates); } catch (e) { setError(messageFromError(e, t('savedTpl.failed'))); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  async function run(job: () => Promise<void>, done: string) {
    setBusy(true); setError(''); setNote('');
    try { await job(); setNote(done); await load(); } catch (e) { setError(messageFromError(e, t('savedTpl.failed'))); } finally { setBusy(false); }
  }

  const saveNew = () => run(async () => {
    await api('/v1/templates', { method: 'POST', body: { name: name.trim(), sections: picked } });
    setName('');
  }, t('savedTpl.saved'));

  const overwrite = (row: Row) => run(async () => {
    await api(`/v1/templates/${row.id}`, { method: 'PUT', body: { sections: picked } });
  }, t('savedTpl.overwritten'));

  const remove = (row: Row) => run(async () => { await api(`/v1/templates/${row.id}`, { method: 'DELETE' }); }, t('savedTpl.deleted'));

  async function review(row: Row) {
    setBusy(true); setError(''); setNote('');
    try {
      const res = await api<{ changes: Changes }>(`/v1/templates/${row.id}/preview`);
      setOpened({ row, changes: res.changes, sections: Object.keys(res.changes) as Section[] });
    } catch (e) { setError(messageFromError(e, t('savedTpl.failed'))); } finally { setBusy(false); }
  }

  async function install() {
    if (!opened) return;
    const { row, sections } = opened;
    await run(async () => {
      await api(`/v1/templates/${row.id}/apply`, { method: 'POST', body: { sections } });
      setOpened(null);
      onApplied();
    }, t('savedTpl.applied'));
  }

  const line = (section: Section, value: Record<string, unknown>) => {
    const show = (k: string, v: unknown) => (typeof v === 'boolean' ? t(v ? 'savedTpl.yes' : 'savedTpl.no') : k === 'to' ? t(`savedTpl.identity.${String(v)}`) : String(v));
    const parts = Object.entries(value).map(([k, v]) => `${t(`savedTpl.diff.${k}`)}: ${show(k, v)}`);
    return `${t(`savedTpl.section.${section}`)} · ${parts.join(', ')}`;
  };

  return (
    <section className="mb-6 grid gap-3 rounded-2xl border border-border bg-white/60 p-4">
      <div>
        <h3 className="m-0 text-[15px]">{t('savedTpl.title')}</h3>
        <p className="m-0 mt-1 text-[12px] text-muted">{t('savedTpl.intro')}</p>
      </div>

      <div className="grid gap-2">
        <SectionPicker picked={picked} onChange={setPicked} />
        <div className="flex flex-wrap gap-2">
          <input
            value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('savedTpl.namePlaceholder')}
            className="min-w-[200px] flex-1 rounded-xl border border-border bg-white px-3 py-2 text-[13px]"
          />
          <Button size="sm" disabled={busy || name.trim().length < 2 || !picked.length} onClick={() => void saveNew()}>{t('savedTpl.saveNew')}</Button>
        </div>
      </div>

      {rows.length === 0 ? <p className="m-0 text-[12px] text-muted">{t('savedTpl.empty')}</p> : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {rows.map((row) => (
            <li key={row.id} className="grid gap-1.5 rounded-xl border border-border bg-white p-3 text-[12px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong className="text-[13px]">{row.name}</strong>
                <span className="font-mono text-[10px] text-muted">v{row.version} · {new Date(row.updatedAt).toLocaleDateString()}</span>
              </div>
              <span className="text-muted">
                {SECTIONS.filter((s) => row.contents[s] !== undefined).map((s) => t(`savedTpl.count.${s}`, { n: String(row.contents[s]) })).join(' · ')}
              </span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void review(row)}>{t('savedTpl.install')}</Button>
                <Button size="sm" variant="outline" disabled={busy || !picked.length} onClick={() => void overwrite(row)}>{t('savedTpl.overwrite')}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(row)}>{t('savedTpl.delete')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {rows.length ? <p className="m-0 text-[11px] text-muted">{t('savedTpl.overwriteHint')}</p> : null}

      {opened ? (
        <div className="grid gap-2 rounded-xl border border-green/40 bg-green/5 p-3 text-[12px]">
          <strong>{t('savedTpl.reviewTitle', { name: opened.row.name })}</strong>
          <SectionPicker picked={opened.sections} available={Object.keys(opened.changes) as Section[]} onChange={(next) => setOpened({ ...opened, sections: next })} />
          <ul className="m-0 grid gap-0.5 pl-4">
            {(Object.keys(opened.changes) as Section[]).map((s) => <li key={s} className={opened.sections.includes(s) ? '' : 'text-muted line-through'}>{line(s, opened.changes[s] || {})}</li>)}
          </ul>
          <p className="m-0 text-[11px] text-amber-900/80">{t('savedTpl.liveWarn')}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || !opened.sections.length} onClick={() => void install()}>{t('savedTpl.apply')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpened(null)}>{t('savedTpl.cancel')}</Button>
          </div>
        </div>
      ) : null}

      {note ? <p className="m-0 text-[12px] font-medium text-green-dark">✓ {note}</p> : null}
      {error ? <p className="m-0 text-[12px] text-danger">{error}</p> : null}
    </section>
  );
}
