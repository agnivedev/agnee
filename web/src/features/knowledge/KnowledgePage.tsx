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
import { ProductBar, ImportPanel, productQuery, type Product } from './PlaybookProducts';
// Satu renderer sebaris untuk seluruh app; dulu halaman ini punya salinannya sendiri.
import { InlineText } from '@/features/inbox/InlineMarkdown';

/**
 * Semua yang membentuk jawaban AI, di satu tempat. Dulu tersebar di empat
 * layar — playbook di sini, fakta & simulasi (Coach) di Settings, brief & file
 * di Admin, plus playground di Admin yang membangun prompt-nya sendiri —
 * padahal keempatnya digabung ke prompt yang sama.
 */
type Section = 'playbook' | 'coach' | 'brief';
const SECTIONS: Section[] = ['playbook', 'coach', 'brief'];
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
 * Markdown secukupnya untuk membaca playbook.
 *
 * Bukan renderer umum: yang ditampilkan di sini hanya dokumen yang kita tulis
 * sendiri, dan bentuknya terbatas pada heading, daftar, kutipan, tebal, dan
 * kode sebaris. Membangun elemen React — bukan innerHTML — supaya isi dokumen
 * tidak akan pernah menjadi markup, apa pun yang nanti ditempel orang ke sana.
 */
function Markdown({ source }: { source: string }) {
  const blocks = useMemo(() => source.replace(/\r\n/g, '\n').split('\n'), [source]);

  return (
    <div className="grid gap-2">
      {blocks.map((line, index) => {
        const key = `${index}-${line.slice(0, 12)}`;
        const heading = line.match(/^(#{1,4})\s+(.*)$/);
        if (heading) {
          const level = heading[1].length;
          return (
            <p
              key={key}
              className={cn(
                'm-0 font-semibold text-ink',
                level === 1 && 'mt-4 text-[17px]',
                level === 2 && 'mt-4 text-[15px]',
                level >= 3 && 'mt-3 text-[13px] text-ink/75',
              )}
            >
              <InlineText text={heading[2]} />
            </p>
          );
        }
        if (/^>\s?/.test(line)) {
          return (
            <p key={key} className="m-0 border-l-[3px] border-l-green/50 bg-green/6 py-1.5 pl-3 text-[13px] whitespace-pre-wrap">
              <InlineText text={line.replace(/^>\s?/, '')} />
            </p>
          );
        }
        if (/^[-*]\s+/.test(line)) {
          return (
            <p key={key} className="m-0 pl-4 text-[13px] -indent-3">
              <span aria-hidden className="text-muted">• </span>
              <InlineText text={line.replace(/^[-*]\s+/, '')} />
            </p>
          );
        }
        if (/^\d+\.\s+/.test(line)) {
          return (
            <p key={key} className="m-0 pl-4 text-[13px] -indent-4">
              <InlineText text={line} />
            </p>
          );
        }
        if (!line.trim()) return <span key={key} className="block h-1" />;
        return (
          <p key={key} className="m-0 text-[13px] whitespace-pre-wrap">
            <InlineText text={line} />
          </p>
        );
      })}
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

        {section === 'playbook' ? <PlaybookDocs /> : null}
        {section === 'coach' ? <div className="max-w-4xl"><CoachSection /></div> : null}
        {section === 'brief' ? <div className="max-w-4xl"><BriefSection /></div> : null}
      </main>
    </div>
  );
}

function PlaybookDocs() {
  const { t, dateLocale } = useI18n();
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [tab, setTab] = useState<'isi' | 'obrolan'>('isi');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  // Naik tiap kali isi berubah dari luar daftar (impor), supaya daftar dan
  // dokumen yang terbuka dimuat ulang walau produk & jenisnya sama.
  const [revision, setRevision] = useState(0);

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
    setLoading(true);
    void api<{ kinds: Kind[] }>(`/v1/playbooks${productQuery(productId)}`)
      .then((data) => {
        setKinds(data.kinds || []);
        // Buka dokumen pertama yang ada isinya, bukan yang pertama dalam
        // urutan: halaman yang terbuka pada dokumen kosong terlihat rusak.
        setActive((data.kinds || []).find((k) => k.filled)?.kind || data.kinds?.[0]?.kind || null);
      })
      .catch((error) => setStatus(messageFromError(error, t('knowledge.loadFailed'))))
      .finally(() => setLoading(false));
  }, [t, productId, revision]);

  const openDoc = useCallback(async (kind: string) => {
    setActive(kind);
    setDoc(null);
    setTab('isi');
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
  }, [active, productId, revision]);

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

                  <div className="mb-4 flex gap-1.5">
                    {(['isi', 'obrolan'] as const).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={cn(
                          'cursor-pointer rounded-full border px-3 py-1 text-[12px] transition',
                          tab === id ? 'border-green bg-green/10 font-semibold' : 'border-border bg-white/60 hover:border-green/40',
                        )}
                      >
                        {t(id === 'isi' ? 'knowledge.tabContent' : 'knowledge.tabChat')}
                      </button>
                    ))}
                  </div>

                  {tab === 'obrolan' ? (
                    <ChatPanel
                      kind={doc.kind}
                      productId={productId}
                      interview={doc.interview || []}
                      onCompiled={() => void openDoc(doc.kind)}
                    />
                  ) : doc.contentMd.trim() ? (
                    <Markdown source={doc.contentMd} />
                  ) : (
                    <div className="grid gap-3 py-6 text-center">
                      <p className="m-0 text-sm text-muted">{t('knowledge.emptyBody')}</p>
                      <div>
                        <Button size="sm" variant="outline" onClick={() => setTab('obrolan')}>
                          {t('knowledge.startChat')}
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
