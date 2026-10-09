import { useRef, useState, type FormEvent } from 'react';
import { Plus, Upload, Pencil, Power, Trash2, FileText, FlaskConical } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { uploadReference } from './BriefSection';

export type Product = {
  id: string;
  name: string;
  description: string;
  active: boolean;
  filledKinds?: number;
};

export const PLAYBOOK_KINDS = ['persona', 'compliance', 'qna', 'discovery', 'objection', 'closing', 'followup', 'handoff'] as const;

/** `?product=` untuk rute /v1/playbooks; kosong = playbook umum. */
export function productQuery(productId: string | null): string {
  return productId ? `?product=${encodeURIComponent(productId)}` : '';
}

/**
 * Baris pemilih produk di atas daftar playbook. "Umum" selalu ada dan berlaku
 * untuk semua produk; tiap produk punya delapan playbook sendiri.
 */
export function ProductBar({ products, active, onSelect, onChanged, onImport, onTest }: {
  products: Product[];
  active: string | null;
  onSelect: (productId: string | null) => void;
  onChanged: (select?: string | null) => void;
  onImport: () => void;
  onTest: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<'new' | 'edit' | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const current = products.find((product) => product.id === active) || null;

  function startNew() {
    setEditing('new');
    setName('');
    setDescription('');
    setStatus('');
  }

  function startEdit() {
    if (!current) return;
    setEditing('edit');
    setName(current.name);
    setDescription(current.description);
    setStatus('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setStatus('');
    try {
      if (editing === 'edit' && current) {
        await api(`/v1/playbook-products/${current.id}`, { method: 'PATCH', body: { name, description } });
        onChanged(current.id);
      } else {
        const { product } = await api<{ product: Product }>('/v1/playbook-products', {
          method: 'POST', body: { name, description },
        });
        onChanged(product.id);
      }
      setEditing(null);
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.product.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!current) return;
    try {
      await api(`/v1/playbook-products/${current.id}`, { method: 'PATCH', body: { active: !current.active } });
      onChanged(current.id);
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.product.saveFailed')));
    }
  }

  async function remove() {
    if (!current) return;
    const ok = await confirm.confirm({
      title: t('knowledge.product.deleteTitle', { name: current.name }),
      message: t('knowledge.product.deleteBody'),
      confirmLabel: t('knowledge.product.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/playbook-products/${current.id}`, { method: 'DELETE' });
      onChanged(null);
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.product.saveFailed')));
    }
  }

  const chip = (selected: boolean) => cn(
    'inline-flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition',
    selected ? 'border-green bg-green/10 font-semibold text-ink' : 'border-border bg-white/60 text-ink/80 hover:border-green/40',
  );

  return (
    <div className="mb-5 grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 font-mono text-[10px] tracking-wider text-muted uppercase">{t('knowledge.product.label')}</span>
        {/* Diklik, bukan di-hover: tooltip hover tidak bisa dibuka di ponsel. */}
        <button
          type="button"
          onClick={() => setHelpOpen((value) => !value)}
          aria-expanded={helpOpen}
          aria-label={t('knowledge.product.whatIs')}
          className={cn(
            'mr-1 grid size-5 cursor-pointer place-items-center rounded-full border p-0 font-mono text-[11px] font-semibold transition',
            helpOpen ? 'border-ink bg-ink text-white' : 'border-ink/25 bg-transparent text-ink/60 hover:border-ink/50 hover:text-ink',
          )}
        >
          ?
        </button>
        <button type="button" className={chip(active === null)} onClick={() => onSelect(null)}>
          {t('knowledge.product.general')}
        </button>
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            className={cn(chip(active === product.id), !product.active && 'opacity-60')}
            onClick={() => onSelect(product.id)}
          >
            {product.name}
            <span className="font-mono text-[9px] text-muted uppercase">
              {product.active ? t('knowledge.product.filled', { count: product.filledKinds || 0 }) : t('knowledge.product.inactive')}
            </span>
          </button>
        ))}
        <Button size="sm" variant="ghost" onClick={startNew}>
          <Plus aria-hidden className="size-4" /> {t('knowledge.product.add')}
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={onImport}>
          <Upload aria-hidden className="size-4" /> {t('knowledge.import.open')}
        </Button>
        <Button size="sm" onClick={onTest}>
          <FlaskConical aria-hidden className="size-4" /> {t('knowledge.test.open')}
        </Button>
      </div>

      {helpOpen ? (
        <p className="m-0 max-w-2xl rounded-[10px] bg-ink/5 px-3 py-2 text-xs leading-[1.55] text-ink/75">{t('knowledge.product.help')}</p>
      ) : null}

      {editing ? (
        <form onSubmit={save} className="grid max-w-2xl gap-2 rounded-xl border border-border bg-white/70 p-4">
          <label className="grid gap-1 text-[12px] font-semibold">
            {t('knowledge.product.name')}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('knowledge.product.namePlaceholder')}
              maxLength={120}
              className="py-2.5"
              autoFocus
            />
          </label>
          <label className="grid gap-1 text-[12px] font-semibold">
            {t('knowledge.product.description')}
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
              className="min-h-16 py-2.5"
            />
            <span className="font-normal text-muted">{t('knowledge.product.descriptionHint')}</span>
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !name.trim()}>{t('knowledge.product.save')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('knowledge.import.cancel')}</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <p className="m-0 max-w-2xl flex-1 text-[12px] text-muted">
            {current ? (current.description || current.name) : t('knowledge.product.generalHint')}
            {current && !current.active ? <><br /><strong className="text-amber-800">{t('knowledge.product.inactiveHint')}</strong></> : null}
          </p>
          {current ? (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={startEdit}><Pencil aria-hidden className="size-3.5" /> {t('knowledge.product.edit')}</Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleActive()}>
                <Power aria-hidden className="size-3.5" /> {current.active ? t('knowledge.product.deactivate') : t('knowledge.product.activate')}
              </Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => void remove()}>
                <Trash2 aria-hidden className="size-3.5" /> {t('knowledge.product.delete')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {status ? <p className="m-0 text-[12px] text-danger">{status}</p> : null}
    </div>
  );
}

type ImportSection = {
  id: string;
  heading: string;
  body: string;
  kind: string | null;
  matchedBy: 'heading' | 'ai' | 'default' | null;
};

type Preview = {
  filename: string;
  title: string | null;
  sections: ImportSection[];
  existing: Record<string, { version: number; updatedAt: string }>;
};

/**
 * Unggah → tinjau → simpan. Server memecah file per judul dan menebak jenis
 * tiap bagian; tidak ada yang tersimpan sampai tombol Simpan ditekan, karena
 * yang ditimpa adalah dokumen yang dibaca AI untuk semua customer.
 */
export function ImportPanel({ productId, targetLabel, initialMode = 'playbook', onDone, onCancel }: {
  productId: string | null;
  /** 'reference' = simpan sebagai file rujukan (hanya untuk Umum: file tidak per topik). */
  initialMode?: 'playbook' | 'reference';
  targetLabel: string;
  onDone: (message: string, mode: 'playbook' | 'reference') => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [kinds, setKinds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState<'playbook' | 'reference'>(productId === null ? initialMode : 'playbook');
  const referenceRef = useRef<HTMLInputElement>(null);

  async function saveReference(file: File) {
    setBusy(true);
    setStatus(t('admin.uploading', { name: file.name }));
    try {
      await uploadReference(file);
      onDone(t('knowledge.import.referenceSaved', { name: file.name }), 'reference');
    } catch (error) {
      setStatus(t('admin.uploadFailed', { name: file.name, message: messageFromError(error, '') }));
    } finally {
      setBusy(false);
      if (referenceRef.current) referenceRef.current.value = '';
    }
  }

  async function read(file: File) {
    setBusy(true);
    setPreview(null);
    setStatus(t('knowledge.import.reading', { name: file.name }));
    const body = new FormData();
    body.append('file', file);
    try {
      const data = await api<Preview>(`/v1/playbooks/import/preview${productQuery(productId)}`, { method: 'POST', body });
      setPreview(data);
      setKinds(Object.fromEntries(data.sections.map((section) => [section.id, section.kind || ''])));
      setStatus('');
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.import.failed')));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const sections = preview?.sections || [];
  const chosen = new Set(sections.map((section) => kinds[section.id]).filter((kind) => kind && kind !== 'skip'));
  const undecided = sections.some((section) => !kinds[section.id]);
  const overwritten = PLAYBOOK_KINDS.filter((kind) => chosen.has(kind) && preview?.existing[kind]);

  async function apply() {
    if (!preview || undecided || !chosen.size) return;
    setBusy(true);
    setStatus('');
    try {
      const result = await api<{ saved: { kind: string }[] }>(`/v1/playbooks/import/apply${productQuery(productId)}`, {
        method: 'POST',
        body: {
          sections: sections.map((section) => ({
            heading: section.heading,
            body: section.body,
            kind: kinds[section.id],
          })),
        },
      });
      onDone(t('knowledge.import.applied', { count: result.saved.length }), 'playbook');
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.import.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  const badge: Record<string, string> = {
    heading: 'bg-green/15 text-green-dark',
    ai: 'bg-amber-100 text-amber-900',
    default: 'bg-ink/8 text-muted',
  };

  return (
    <section className="max-w-4xl rounded-[18px] border border-border bg-white/70 p-5">
      <header className="mb-3 grid gap-1">
        <h2 className="m-0 text-[17px]">{t('knowledge.import.title')}</h2>
        {productId === null ? (
          <div className="my-1 flex flex-wrap gap-1.5" role="group" aria-label={t('knowledge.import.title')}>
            {(['playbook', 'reference'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={busy}
                onClick={() => { setMode(value); setPreview(null); setStatus(''); }}
                className={cn(
                  'cursor-pointer rounded-full border px-3 py-1 text-[12px] transition',
                  mode === value ? 'border-green bg-green/10 font-semibold' : 'border-border bg-white/60 hover:border-green/40',
                )}
              >
                {t(value === 'playbook' ? 'knowledge.import.modePlaybook' : 'knowledge.import.modeReference')}
              </button>
            ))}
          </div>
        ) : null}
        <p className="m-0 text-[12px] text-muted">{t(mode === 'playbook' ? 'knowledge.import.intro' : 'knowledge.import.referenceIntro')}</p>
        {mode === 'playbook' ? (
          <p className="m-0 text-[12px]">
            <span className="text-muted">{t('knowledge.import.target')}: </span>
            <strong>{targetLabel}</strong>
          </p>
        ) : null}
      </header>

      {mode === 'reference' ? (
        <div className="grid gap-3">
          <input
            ref={referenceRef}
            type="file"
            accept=".pdf,.doc,.docx,.md,.markdown,.txt,image/*,video/*,audio/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void saveReference(file);
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={busy} onClick={() => referenceRef.current?.click()}>
              <FileText aria-hidden className="size-4" /> {t('knowledge.import.pick')}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t('knowledge.import.cancel')}</Button>
            <span className="text-[12px] text-muted">{t('admin.dropzoneHint')}</span>
          </div>
          {status ? <p className="m-0 text-[12px] text-muted">{status}</p> : null}
        </div>
      ) : (
      <>

      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.txt,.docx,.pdf,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
        }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" variant={preview ? 'outline' : 'primary'} disabled={busy} onClick={() => fileRef.current?.click()}>
          <FileText aria-hidden className="size-4" /> {preview ? t('knowledge.import.anotherFile') : t('knowledge.import.pick')}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t('knowledge.import.cancel')}</Button>
        {preview ? (
          <span className="text-[12px] text-muted">
            {t('knowledge.import.sections', { count: sections.length, name: preview.filename })}
          </span>
        ) : null}
      </div>

      {sections.length ? (
        <ol className="m-0 grid list-none gap-2 p-0">
          {sections.map((section) => {
            const kind = kinds[section.id] || '';
            return (
              <li
                key={section.id}
                className={cn(
                  'grid gap-2 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-start',
                  !kind ? 'border-amber-400 bg-amber-50/60' : kind === 'skip' ? 'border-border bg-ink/[.03] opacity-70' : 'border-border bg-white',
                )}
              >
                <details className="min-w-0">
                  <summary className="cursor-pointer list-none">
                    <strong className="text-[13px]">{section.heading || t('knowledge.import.untitled')}</strong>
                    <span className="ml-2 font-mono text-[10px] text-muted">
                      {t('knowledge.import.chars', { count: section.body.length.toLocaleString() })}
                    </span>
                    <span className="mt-1 block truncate text-[12px] text-muted">{section.body.slice(0, 160)}</span>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-warm/60 p-3 font-sans text-[12px] whitespace-pre-wrap">{section.body}</pre>
                </details>
                <div className="grid gap-1">
                  <select
                    value={kind}
                    onChange={(event) => setKinds((current) => ({ ...current, [section.id]: event.target.value }))}
                    className="h-9 rounded-[10px] border border-border bg-white px-2 text-[13px]"
                    aria-label={section.heading || t('knowledge.import.untitled')}
                  >
                    <option value="" disabled>{t('knowledge.import.unknown')}</option>
                    {PLAYBOOK_KINDS.map((option) => (
                      <option key={option} value={option}>{t(`playbook.kind.${option}`)}</option>
                    ))}
                    <option value="skip">{t('knowledge.import.skip')}</option>
                  </select>
                  {section.matchedBy && kind === (section.kind || '') ? (
                    <span className={cn('justify-self-start rounded-full px-2 py-0.5 font-mono text-[9px] uppercase', badge[section.matchedBy])}>
                      {t(`knowledge.import.by${section.matchedBy === 'heading' ? 'Heading' : section.matchedBy === 'ai' ? 'Ai' : 'Default'}`)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      {preview ? (
        <div className="mt-4 grid gap-2">
          {overwritten.length ? (
            <p className="m-0 rounded-xl border border-amber-400/50 bg-amber-50 p-3 text-[12px] text-amber-900">
              {t('knowledge.import.overwrite', { kinds: overwritten.map((kind) => t(`playbook.kind.${kind}`)).join(', ') })}
            </p>
          ) : null}
          {undecided ? <p className="m-0 text-[12px] text-amber-900">{t('knowledge.import.needKind')}</p> : null}
          <div>
            <Button size="sm" disabled={busy || undecided || !chosen.size} onClick={() => void apply()}>
              {t('knowledge.import.apply', { count: chosen.size })}
            </Button>
          </div>
        </div>
      ) : null}

      {status ? <p className="mt-3 mb-0 text-[12px] text-muted">{status}</p> : null}
      </>
      )}
    </section>
  );
}
