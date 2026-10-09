import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  UserRound,
  ShieldAlert,
  MessagesSquare,
  Search,
  ShieldQuestion,
  BadgeCheck,
  Repeat,
  ArrowRightLeft,
  type LucideIcon,
} from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CoachSection } from './CoachSection';
import { BriefSection } from './BriefSection';
import { KsSection } from './ks/KsSection';
import { ProductBar, ImportPanel, productQuery, type Product } from './PlaybookProducts';
import { Markdown, diffLines } from './DocMarkdown';
import { TrainAssistant } from './TrainAssistant';

/**
 * Semua yang membentuk jawaban AI, di satu tempat. Dulu tersebar di empat
 * layar — playbook di sini, fakta & simulasi (Coach) di Settings, brief & file
 * di Admin, plus playground di Admin yang membangun prompt-nya sendiri —
 * padahal keempatnya digabung ke prompt yang sama.
 */
type Section = 'playbook' | 'template' | 'coach' | 'brief';
const SECTIONS: Section[] = ['playbook', 'template', 'coach', 'brief'];
function sectionFromHash(): Section {
  const hash = window.location.hash.replace('#', '');
  return (SECTIONS as string[]).includes(hash) ? (hash as Section) : 'playbook';
}

/** One icon per document kind, so the list reads at a glance, not just by label text. */
const KIND_ICON: Record<string, LucideIcon> = {
  persona: UserRound,
  compliance: ShieldAlert,
  qna: MessagesSquare,
  discovery: Search,
  objection: ShieldQuestion,
  closing: BadgeCheck,
  followup: Repeat,
  handoff: ArrowRightLeft,
};

type Kind = {
  kind: string;
  brief: string;
  filled: boolean;
  version: number;
  updatedAt: string | null;
};

type Turn = { role: 'user' | 'assistant'; content: string };

type Doc = {
  kind: string;
  brief: string;
  contentMd: string;
  interview?: Turn[];
  version: number;
  updatedAt: string | null;
};

/**
 * Edit langsung. Teks mentah Markdown di kiri, pratinjau lewat tab "Pratinjau".
 * Menyimpan memakai PUT yang sudah ada; riwayat obrolan tidak tersentuh.
 */
function DocEditor({ kind, productId, initial, onSaved, onCancel }: {
  kind: string;
  productId: string | null;
  initial: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(initial);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const dirty = text !== initial;

  async function simpan() {
    setBusy(true);
    setStatus('');
    try {
      await api(`/v1/playbooks/${encodeURIComponent(kind)}${productQuery(productId)}`, { method: 'PUT', body: { contentMd: text } });
      onSaved();
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.saveFailed')));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {([false, true] as const).map((showPreview) => (
            <button
              key={String(showPreview)}
              type="button"
              onClick={() => setPreview(showPreview)}
              className={cn(
                'cursor-pointer rounded-full border px-3 py-1 text-[12px] transition',
                preview === showPreview ? 'border-green bg-green/10 font-semibold' : 'border-border bg-white/60 hover:border-green/40',
              )}
            >
              {t(showPreview ? 'knowledge.editPreview' : 'knowledge.editWrite')}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>{t('knowledge.cancel')}</Button>
          <Button size="sm" disabled={busy || !dirty} onClick={() => void simpan()}>
            {busy ? t('knowledge.saving') : t('knowledge.save')}
          </Button>
        </div>
      </div>

      {preview ? (
        <div className="min-h-[200px] rounded-xl bg-warm/40 p-3"><Markdown source={text} /></div>
      ) : (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={40000}
          spellCheck={false}
          aria-label={t(`playbook.kind.${kind}`)}
          className="min-h-[50vh] w-full resize-y rounded-xl border border-border bg-white p-3 font-mono text-[12.5px] leading-relaxed"
        />
      )}

      <p className="m-0 text-[11px] text-muted">{t('knowledge.editHint')}</p>
      {status ? <p className="m-0 text-[12px] text-danger">{status}</p> : null}
    </div>
  );
}

/**
 * Mengubah dokumen yang sudah ada lewat perintah biasa.
 *
 * AI hanya MENGUSULKAN: hasilnya ditampilkan dengan baris baru ditandai, dan
 * baru tersimpan setelah supervisor menekan Terapkan. Alasannya sama dengan
 * "Susun jadi dokumen" — dokumen ini yang dibaca AI untuk semua customer.
 */
function RevisePanel({ kind, productId, current, onApplied }: {
  kind: string;
  productId: string | null;
  current: string;
  onApplied: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [proposal, setProposal] = useState<string | null>(null);
  const [lastAsk, setLastAsk] = useState('');

  useEffect(() => { setProposal(null); setStatus(''); setDraft(''); }, [kind, productId]);

  const diff = useMemo(() => (proposal === null ? null : diffLines(current, proposal)), [current, proposal]);

  async function usulkan(event: FormEvent) {
    event.preventDefault();
    const ask = draft.trim();
    if (!ask || busy) return;
    setBusy(true);
    setStatus('');
    try {
      const hasil = await api<{ contentMd: string }>(
        `/v1/playbooks/${encodeURIComponent(kind)}/revise${productQuery(productId)}`, { method: 'POST', body: { instruction: ask } },
      );
      if (hasil.contentMd.trim() === current.trim()) {
        setProposal(null);
        setStatus(t('knowledge.reviseNoChange'));
      } else {
        setProposal(hasil.contentMd);
        setLastAsk(ask);
        setDraft('');
      }
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.reviseFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function terapkan() {
    if (proposal === null) return;
    setBusy(true);
    setStatus('');
    try {
      await api(`/v1/playbooks/${encodeURIComponent(kind)}${productQuery(productId)}`, { method: 'PUT', body: { contentMd: proposal } });
      setProposal(null);
      onApplied();
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.saveFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[11px] text-muted">{t('knowledge.reviseIntro')}</p>

      <form onSubmit={usulkan} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('knowledge.revisePlaceholder')}
          maxLength={4000}
          disabled={busy}
          className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3 py-2 text-[13px]"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          {busy ? t('common.loading') : t('knowledge.reviseSend')}
        </Button>
      </form>

      {status ? <p className="m-0 text-[12px] text-muted">{status}</p> : null}

      {proposal !== null && diff ? (
        <div className="grid gap-3 rounded-xl border border-green/40 bg-green/5 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-[12px]">{t('knowledge.reviseProposal')}</strong>
            <span className="font-mono text-[11px] text-muted">
              +{diff.added.size} {t('knowledge.reviseAdded')} · −{diff.removed} {t('knowledge.reviseRemoved')}
            </span>
          </div>
          <p className="m-0 text-[11px] text-muted">“{lastAsk}”</p>
          <div className="max-h-[46vh] overflow-y-auto rounded-lg bg-white p-3">
            <Markdown source={proposal} added={diff.added} />
          </div>
          <p className="m-0 text-[11px] text-amber-900/80">{t('knowledge.reviseWarn')}</p>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void terapkan()}>{t('knowledge.reviseApply')}</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setProposal(null)}>{t('knowledge.reviseDiscard')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Menyusun dokumen lewat obrolan.
 *
 * Mesinnya sudah lama ada di server — `/chat` menyimpan tiap giliran, `/compile`
 * mengubah seluruh obrolan jadi markdown — tapi tidak pernah punya tombol.
 * Supervisor yang ingin menambah aturan harus menulis markdown sendiri.
 *
 * Menyusun TIDAK otomatis: setiap kali obrolan bertambah, tombolnya muncul dan
 * menunggu. Menimpa dokumen yang dibaca AI ke semua customer adalah hal yang
 * harus diputuskan orang, bukan efek samping dari mengetik.
 */
function ChatPanel({ kind, productId, interview, onCompiled }: {
  kind: string;
  productId: string | null;
  interview: Turn[];
  onCompiled: () => void;
}) {
  const { t } = useI18n();
  const [turns, setTurns] = useState<Turn[]>(interview);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setTurns(interview); setStatus(''); }, [interview, kind]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  async function kirim(event: FormEvent) {
    event.preventDefault();
    const pesan = draft.trim();
    if (!pesan || busy) return;
    setBusy(true);
    setStatus('');
    setDraft('');
    setTurns((current) => [...current, { role: 'user', content: pesan }]);
    try {
      const hasil = await api<{ reply: string; interview: Turn[] }>(
        `/v1/playbooks/${encodeURIComponent(kind)}/chat${productQuery(productId)}`, { method: 'POST', body: { message: pesan } },
      );
      setTurns(hasil.interview || []);
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.chatFailed')));
    } finally {
      setBusy(false);
    }
  }

  async function susun() {
    setBusy(true);
    setStatus('');
    try {
      await api(`/v1/playbooks/${encodeURIComponent(kind)}/compile${productQuery(productId)}`, { method: 'POST' });
      setStatus(t('knowledge.compiled'));
      onCompiled();
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.compileFailed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <p className="m-0 text-[11px] text-muted">{t('knowledge.chatIntro')}</p>

      <div ref={listRef} className="grid max-h-[46vh] gap-2 overflow-y-auto rounded-xl bg-warm/50 p-3">
        {!turns.length ? (
          <p className="m-0 py-6 text-center text-[13px] text-muted">{t('knowledge.chatEmpty')}</p>
        ) : turns.map((turn, index) => (
          <div
            key={`${index}-${turn.content.slice(0, 10)}`}
            className={cn(
              'max-w-[85%] rounded-[14px] px-3 py-2 text-[13px] whitespace-pre-wrap',
              turn.role === 'user' ? 'justify-self-end bg-[#d9ffd6]' : 'justify-self-start bg-white',
            )}
          >
            {turn.content}
          </div>
        ))}
      </div>

      <form onSubmit={kirim} className="flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('knowledge.chatPlaceholder')}
          maxLength={4000}
          className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3 py-2 text-[13px]"
        />
        <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
          {busy ? t('common.loading') : t('common.send')}
        </Button>
      </form>

      {turns.length ? (
        <div className="grid gap-1.5 rounded-xl border border-amber-400/50 bg-amber-50 p-3">
          <strong className="text-[12px] text-amber-900">{t('knowledge.compileAsk')}</strong>
          <p className="m-0 text-[11px] text-amber-900/80">{t('knowledge.compileWarn')}</p>
          <div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void susun()}>
              {t('knowledge.compile')}
            </Button>
          </div>
        </div>
      ) : null}

      {status ? <p className="m-0 text-[11px] text-muted">{status}</p> : null}
    </div>
  );
}

export function KnowledgePage() {
  const { t } = useI18n();
  usePageTitle(t('knowledge.title'));
  const [section, setSection] = useState<Section>(sectionFromHash);
  // Naik tiap kali asisten chat menerapkan usulan, supaya tab yang terbuka memuat ulang.
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const follow = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, []);

  function select(next: Section) {
    setSection(next);
    window.history.replaceState({}, '', `${window.location.pathname}#${next}`);
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />
      <main className="min-w-0 flex-1 px-4 py-7 sm:px-8">
        <p className="eyebrow">{t('knowledge.eyebrow')}</p>
        <h1 className="mt-1 mb-1 text-[26px] tracking-[-.03em]">{t('knowledge.title')}</h1>
        <p className="mt-1.5 mb-5 max-w-2xl text-sm text-muted">{t('knowledge.intro')}</p>

        <div role="tablist" aria-label={t('knowledge.title')} className="mb-6 flex flex-wrap gap-1 border-b border-border">
          {SECTIONS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={section === id}
              onClick={() => select(id)}
              className={cn(
                'cursor-pointer border-0 border-b-2 bg-transparent px-4 py-3 text-[13px] font-medium transition-colors',
                section === id ? 'border-b-green text-ink' : 'border-b-transparent text-muted hover:text-ink',
              )}
            >
              {t(`knowledge.section.${id}`)}
            </button>
          ))}
        </div>

        {section === 'playbook' ? <PlaybookDocs refreshKey={refreshKey} /> : null}
        {section === 'template' ? <div className="max-w-4xl"><KsSection key={refreshKey} /></div> : null}
        {section === 'coach' ? <div className="max-w-4xl"><CoachSection key={refreshKey} /></div> : null}
        {section === 'brief' ? <div className="max-w-4xl"><BriefSection key={refreshKey} /></div> : null}
      </main>
      <TrainAssistant onChanged={() => setRefreshKey((value) => value + 1)} />
    </div>
  );
}

function PlaybookDocs({ refreshKey }: { refreshKey: number }) {
  const { t, dateLocale } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [tab, setTab] = useState<'isi' | 'obrolan' | 'ubah'>('isi');
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  // Naik tiap kali isi berubah dari luar daftar (impor), supaya daftar dan
  // dokumen yang terbuka dimuat ulang walau produk & jenisnya sama.
  const [revision, setRevision] = useState(0);
  const shownProduct = useRef<string | null | undefined>(undefined);
  const reload = revision + refreshKey;

  const loadProducts = useCallback(async (select?: string | null) => {
    try {
      const data = await api<{ products: Product[] }>('/v1/playbook-products');
      setProducts(data.products || []);
      if (select !== undefined) setProductId(select);
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.loadFailed')));
    }
  }, [t]);

  useEffect(() => { void loadProducts(); }, [loadProducts]);

  useEffect(() => {
    // Pemuatan ulang karena isi berubah (simpan, terapkan, susun, impor) harus
    // tetap di dokumen yang sedang dibuka dan tidak mengosongkan layar; hanya
    // pergantian produk yang memulai dari dokumen pertama yang terisi.
    const sameProduct = shownProduct.current === productId;
    shownProduct.current = productId;
    if (!sameProduct) setLoading(true);
    void api<{ kinds: Kind[] }>(`/v1/playbooks${productQuery(productId)}`)
      .then((data) => {
        const list = data.kinds || [];
        setKinds(list);
        // Buka dokumen pertama yang ada isinya, bukan yang pertama dalam
        // urutan: halaman yang terbuka pada dokumen kosong terlihat rusak.
        const first = list.find((k) => k.filled)?.kind || list[0]?.kind || null;
        setActive((current) => (sameProduct && current && list.some((k) => k.kind === current) ? current : first));
      })
      .catch((error) => setStatus(messageFromError(error, t('knowledge.loadFailed'))))
      .finally(() => setLoading(false));
  }, [t, productId, reload]);

  const openDoc = useCallback(async (kind: string) => {
    setActive(kind);
    setDoc(null);
    setTab('isi');
    setEditing(false);
    try {
      setDoc(await api<Doc>(`/v1/playbooks/${encodeURIComponent(kind)}${productQuery(productId)}`));
    } catch (error) {
      setStatus(messageFromError(error, t('knowledge.loadFailed')));
    }
  }, [t, productId]);

  useEffect(() => {
    if (active) void openDoc(active);
    // openDoc sengaja tidak jadi dependency: ia berubah tiap render dan akan
    // memicu pengambilan ulang tanpa henti.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, productId, reload]);

  const currentProduct = products.find((product) => product.id === productId) || null;

  return (
      <>
        <ProductBar
          products={products}
          active={productId}
          onSelect={(next) => { setProductId(next); setImporting(false); setNotice(''); }}
          onChanged={(select) => void loadProducts(select)}
          onImport={() => { setImporting(true); setNotice(''); }}
        />
        {notice ? <p className="mb-4 rounded-xl bg-green/10 px-3 py-2 text-[13px] text-green-dark">{notice}</p> : null}
        {status ? <p className="mb-4 text-[13px] text-danger">{status}</p> : null}

        {importing ? (
          <ImportPanel
            productId={productId}
            targetLabel={currentProduct ? currentProduct.name : t('knowledge.product.general')}
            onCancel={() => setImporting(false)}
            onDone={(message) => {
              setImporting(false);
              setNotice(message);
              setRevision((value) => value + 1);
              void loadProducts();
            }}
          />
        ) : null}

        {!importing && loading ? <p className="font-mono text-sm text-muted">{t('common.loading')}</p> : null}

        {!importing && !loading && kinds.length ? (
          <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* Sticky under the page header on wide screens, with its own scroll
                once the list outgrows the viewport — eight kinds fit today, but
                the list should not push the document panel down if it grows. */}
            <nav
              className="grid content-start gap-1.5 self-start lg:sticky lg:top-7 lg:max-h-[calc(100dvh-3.5rem)] lg:overflow-y-auto lg:pr-1"
              aria-label={t('knowledge.title')}
            >
              {kinds.map((k) => {
                const Icon = KIND_ICON[k.kind] ?? MessagesSquare;
                return (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => void openDoc(k.kind)}
                    className={cn(
                      'grid w-full cursor-pointer grid-cols-[auto_1fr] items-start gap-x-2.5 gap-y-0.5 rounded-xl border px-3 py-2.5 text-left transition',
                      active === k.kind ? 'border-green bg-green/8' : 'border-border bg-white/60 hover:border-green/40',
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn('mt-0.5 size-4 shrink-0', active === k.kind ? 'text-green-dark' : 'text-muted')}
                    />
                    <span className="flex items-center justify-between gap-2">
                      <strong className="text-[13px]">{t(`playbook.kind.${k.kind}`)}</strong>
                      {k.filled ? (
                        <span className="rounded-full bg-green/15 px-2 py-0.5 font-mono text-[9px] text-green-dark uppercase">
                          v{k.version}
                        </span>
                      ) : (
                        <span className="rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[9px] text-muted uppercase">
                          {t('knowledge.empty')}
                        </span>
                      )}
                    </span>
                    <span className="col-start-2 text-[11px] text-muted">{k.brief}</span>
                  </button>
                );
              })}
            </nav>

            <section className="min-w-0 rounded-[18px] border border-border bg-white/70 p-5">
              {!doc ? (
                <p className="font-mono text-sm text-muted">{t('common.loading')}</p>
              ) : (
                <>
                  <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3">
                    <h2 className="m-0 text-[17px]">{t(`playbook.kind.${doc.kind}`)}</h2>
                    <span className="font-mono text-[11px] text-muted">
                      {doc.contentMd.trim() ? t('knowledge.version', { version: doc.version }) : t('knowledge.empty')}
                      {doc.updatedAt ? ` · ${new Date(doc.updatedAt).toLocaleString(dateLocale)}` : ''}
                    </span>
                  </header>

                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {(['isi', 'ubah', 'obrolan'] as const)
                      // "Ubah lewat obrolan" mengedit dokumen yang sudah ada; di dokumen kosong
                      // yang masuk akal hanya menyusun dari nol.
                      .filter((id) => id !== 'ubah' || doc.contentMd.trim())
                      .map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setTab(id)}
                          className={cn(
                            'cursor-pointer rounded-full border px-3 py-1 text-[12px] transition',
                            tab === id ? 'border-green bg-green/10 font-semibold' : 'border-border bg-white/60 hover:border-green/40',
                          )}
                        >
                          {t(id === 'isi' ? 'knowledge.tabContent' : id === 'ubah' ? 'knowledge.tabEditChat' : 'knowledge.tabChat')}
                        </button>
                      ))}
                  </div>

                  {tab === 'obrolan' ? (
                    <ChatPanel
                      kind={doc.kind}
                      productId={productId}
                      interview={doc.interview || []}
                      onCompiled={() => setRevision((value) => value + 1)}
                    />
                  ) : tab === 'ubah' ? (
                    <RevisePanel
                      kind={doc.kind}
                      productId={productId}
                      current={doc.contentMd}
                      onApplied={() => { setTab('isi'); setRevision((value) => value + 1); }}
                    />
                  ) : editing ? (
                    <DocEditor
                      kind={doc.kind}
                      productId={productId}
                      initial={doc.contentMd}
                      onCancel={() => setEditing(false)}
                      onSaved={() => { setEditing(false); setRevision((value) => value + 1); }}
                    />
                  ) : doc.contentMd.trim() ? (
                    <div className="grid gap-3">
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{t('knowledge.edit')}</Button>
                      </div>
                      <Markdown source={doc.contentMd} />
                    </div>
                  ) : (
                    <div className="grid gap-3 py-6 text-center">
                      <p className="m-0 text-sm text-muted">{t('knowledge.emptyBody')}</p>
                      <div className="flex justify-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setTab('obrolan')}>
                          {t('knowledge.startChat')}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                          {t('knowledge.edit')}
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        ) : null}
      </>
  );
}
