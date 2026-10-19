import { useRef, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose } from '@/components/ui/dialog';

type Mapping = Partial<Record<'phone' | 'name' | 'email' | 'note', number>>;
type Field = keyof Mapping;
const FIELDS: Field[] = ['phone', 'name', 'email', 'note'];

type Problem = { line: number; kind: 'invalid_phone' | 'duplicate_in_file' | 'already_exists'; value: string; firstLine?: number };

type Preview = {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  formulaCells: number;
  mapping: Mapping;
  summary: { total: number; ready: number; invalidPhone: number; duplicateInFile: number; alreadyExists: number; invalidEmail: number } | null;
  problems: Problem[];
  readyPreview: { phone: string; name: string; email: string }[];
  limits: { maxFileMb: number; maxRows: number };
};

type Saved = { imported: number; skipped: { invalidPhone: number; duplicateInFile: number; alreadyExists: number; raced: number } };

/**
 * Impor Lead List dari Excel/CSV: pilih berkas -> pratinjau dan pemetaan
 * kolom -> simpan. Server tidak menyimpan berkasnya di antara langkah, jadi
 * berkas yang sama dikirim ulang tiap kali pemetaan berubah dan saat simpan.
 * Kolom `mapping` harus dikirim SEBELUM berkas dalam form.
 */
export function LeadFileImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<Saved | null>(null);

  function reset() {
    setFile(null); setPreview(null); setMapping({}); setError(''); setSaved(null); setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function close() { reset(); onClose(); }

  function form(chosen: File, map: Mapping | null) {
    const data = new FormData();
    if (map) data.append('mapping', JSON.stringify(map));
    data.append('file', chosen);
    return data;
  }

  async function load(chosen: File, map: Mapping | null) {
    setBusy(true); setError('');
    try {
      const result = await api<Preview>('/v1/leads/import/preview', { method: 'POST', body: form(chosen, map) });
      setPreview(result);
      setMapping(result.mapping);
    } catch (failure) {
      setPreview(null);
      setError(messageFromError(failure, t('leadFile.failed')));
    } finally {
      setBusy(false);
    }
  }

  function choose(chosen: File | undefined) {
    if (!chosen) return;
    setFile(chosen); setSaved(null);
    void load(chosen, null);
  }

  function changeMapping(field: Field, value: string) {
    if (!file) return;
    const next: Mapping = { ...mapping };
    // Satu kolom hanya untuk satu isian: memilihnya di isian lain melepasnya dari yang lama.
    for (const other of FIELDS) if (other !== field && value !== '' && next[other] === Number(value)) delete next[other];
    if (value === '') delete next[field]; else next[field] = Number(value);
    setMapping(next);
    void load(file, next);
  }

  async function save() {
    if (!file || !preview?.summary) return;
    setBusy(true); setError('');
    try {
      setSaved(await api<Saved>('/v1/leads/import', { method: 'POST', body: form(file, mapping) }));
      onImported();
    } catch (failure) {
      setError(messageFromError(failure, t('leadFile.failed')));
    } finally {
      setBusy(false);
    }
  }

  const summary = preview?.summary;

  return (
    <Dialog open={open} onClose={close} labelledBy="lead-file-title" className="w-[min(94vw,720px)] max-h-[90vh]">
      <div className="grid max-h-[90vh] grid-rows-[auto_1fr] overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="eyebrow mb-0">{t('leadFile.eyebrow')}</p>
            <h2 id="lead-file-title" className="m-0 text-lg">{t('leadFile.title')}</h2>
          </div>
          <DialogClose onClick={close} label={t('lead.close')} />
        </div>

        <div className="overflow-y-auto px-6 py-5">
          {saved ? (
            <div role="status" className="grid gap-3 text-[14px]">
              <p className="m-0"><b>{t('leadFile.savedTitle', { count: saved.imported })}</b></p>
              <p className="m-0 text-muted">{t('leadFile.savedSkipped', {
                invalid: saved.skipped.invalidPhone, dupFile: saved.skipped.duplicateInFile, exists: saved.skipped.alreadyExists + saved.skipped.raced,
              })}</p>
              <p className="m-0 text-muted">{t('leadFile.savedBroadcast')}</p>
              <div><Button size="sm" onClick={close}>{t('common.close')}</Button></div>
            </div>
          ) : (
            <div className="grid gap-4">
              <div>
                <p className="m-0 mb-2 text-[13px] text-muted">{t('leadFile.copy', { mb: preview?.limits.maxFileMb ?? 5, rows: (preview?.limits.maxRows ?? 20000).toLocaleString('id-ID') })}</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => choose(event.target.files?.[0])}
                  aria-label={t('leadFile.choose')}
                  className="text-[13px]"
                />
              </div>

              {error ? <p role="alert" className="m-0 text-[13px] text-red-700">{error}</p> : null}
              {busy ? <p className="m-0 text-[13px] text-muted">{t('common.loading')}</p> : null}

              {preview ? (
                <>
                  <section className="grid gap-3 sm:grid-cols-2">
                    {FIELDS.map((field) => (
                      <label key={field} className="grid gap-1 text-[12px] font-semibold">
                        {t(`leadFile.field.${field}`)}{field === 'phone' ? ' *' : ''}
                        <select
                          className="rounded-lg border border-border bg-white px-2 py-2 text-[13px] font-normal"
                          value={mapping[field] ?? ''}
                          onChange={(event) => changeMapping(field, event.target.value)}
                          disabled={busy}
                        >
                          <option value="">{t('leadFile.none')}</option>
                          {preview.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}
                        </select>
                      </label>
                    ))}
                  </section>

                  {preview.formulaCells ? (
                    <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{t('leadFile.formulaNote', { count: preview.formulaCells })}</p>
                  ) : null}

                  {summary ? (
                    <section aria-label={t('leadFile.summary')} className="grid gap-2">
                      <p className="m-0 text-[14px]"><b>{t('leadFile.ready', { ready: summary.ready, total: summary.total })}</b></p>
                      <ul className="m-0 grid list-none gap-1 p-0 text-[13px] text-muted">
                        {summary.invalidPhone ? <li>{t('leadFile.invalidPhone', { count: summary.invalidPhone })}</li> : null}
                        {summary.duplicateInFile ? <li>{t('leadFile.duplicateInFile', { count: summary.duplicateInFile })}</li> : null}
                        {summary.alreadyExists ? <li>{t('leadFile.alreadyExists', { count: summary.alreadyExists })}</li> : null}
                        {summary.invalidEmail ? <li>{t('leadFile.invalidEmail', { count: summary.invalidEmail })}</li> : null}
                      </ul>
                      {preview.problems.length ? (
                        <details className="text-[12px]">
                          <summary className="cursor-pointer text-muted">{t('leadFile.problems')}</summary>
                          <ul className="mt-2 mb-0 grid list-none gap-1 p-0">
                            {preview.problems.map((problem) => (
                              <li key={problem.line}>
                                {t('leadFile.line', { line: problem.line })}: {t(`leadFile.kind.${problem.kind}`)}{problem.value ? ` (${problem.value})` : ''}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </section>
                  ) : <p className="m-0 text-[13px] text-muted">{t('leadFile.pickPhone')}</p>}

                  {preview.readyPreview.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full border-collapse text-left text-[12px]">
                        <thead><tr>{['phone', 'name', 'email'].map((key) => <th key={key} className="border-b border-border py-1 pr-3">{t(`leadFile.field.${key}`)}</th>)}</tr></thead>
                        <tbody>
                          {preview.readyPreview.map((row) => (
                            <tr key={row.phone}><td className="py-1 pr-3 font-mono">{row.phone}</td><td className="py-1 pr-3">{row.name}</td><td className="py-1 pr-3">{row.email}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" onClick={() => void save()} disabled={busy || !summary?.ready}>
                      {t('leadFile.save', { count: summary?.ready ?? 0 })}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={close}>{t('common.cancel')}</Button>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
