import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n, usePageTitle } from '@/lib/i18n';
import { AppSidebar } from '@/components/AppSidebar';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { InlineMarkdown } from '@/features/inbox/InlineMarkdown';
import { formatFileSize } from '@/features/inbox/format';
import { SavedBadge, SettingCard, StatusLine, useSavedFlag } from '@/features/settings/parts';
import { TeamSection } from '@/features/settings/TeamSection';
import { AVAILABLE_MODELS, MODEL_SLOT_COUNT, findModel } from './models';

type Config = {
  model: string;
  llmEnabled: boolean;
  database: { connected: boolean; driver: string };
  knowledgeClients: { id: string; name: string }[];
  defaultKnowledgeClient: string;
};

type Reply = {
  reply: string;
  model: string;
  elapsedMs: number;
  matchedFaqs: { id: string; source: string; score: number }[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };
  style: { passed: boolean; warnings: string[] };
  persistence?: { saved?: boolean };
};

type Run = {
  createdAt: string;
  clientId: string;
  message: string;
  totalTokens: number;
  costUsd: number;
  stylePassed: boolean;
};

const formatUsd = (value: number | undefined) => `$${Number(value || 0).toFixed(8)}`;

export function AdminPage() {
  const { t, locale } = useI18n();
  usePageTitle('admin.title');
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await api<Config>('/v1/admin/config'));
      setConfigError('');
    } catch (error) {
      setConfigError(messageFromError(error, ''));
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig, locale]);

  return (
    <div className="flex min-h-dvh flex-col bg-background md:flex-row">
      <AppSidebar />

      <main className="min-w-0 flex-1 px-5 py-8 sm:px-10">
        <header className="flex flex-wrap items-start justify-between gap-4 pr-20 xl:pr-0">
          <div>
            <p className="eyebrow">{t('admin.eyebrow')}</p>
            <h1 className="m-0 text-[28px] tracking-[-.03em]">{t('admin.heading')}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted">{t('admin.subtitle')}</p>
          </div>
          <a href="/" className="text-sm font-semibold text-green-dark no-underline hover:underline">
            ← {t('conversation.back')}
          </a>
        </header>

        <div className="max-w-4xl">
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <StatusTile label={t('admin.model')} value={config?.model || t('common.loading')} />
            <StatusTile
              label={t('admin.aiService')}
              value={config ? (config.llmEnabled ? t('admin.active') : t('admin.inactive')) : t('common.checking')}
              tone={config ? (config.llmEnabled ? 'ok' : 'bad') : 'neutral'}
            />
            <StatusTile
              label={t('admin.storage')}
              value={config ? (config.database.connected ? t('admin.storageActive') : t('admin.storageTemporary')) : t('common.checking')}
              tone={config ? (config.database.connected ? 'ok' : 'bad') : 'neutral'}
            />
          </div>
          <StatusLine tone="error">{configError}</StatusLine>

          <AiSettings />
          <PlaybookSection />
          <CoachLinkCard />
          <Playground config={config} />
          <TeamSection />
          <AuditSection />
        </div>
      </main>
    </div>
  );
}

type AuditEntry = {
  id: number;
  action: string;
  entityId: string | null;
  metadata: {
    phone?: string | null;
    contactName?: string | null;
    format?: string | null;
    rows?: number | null;
    fields?: string[] | null;
    email?: string | null;
    role?: string | null;
    integration?: string | null;
    label?: string | null;
  } | null;
  createdAt: string;
  actorName: string | null;
};

/**
 * Tindakan yang dicatat, untuk penyaring di bawah. Urutannya sengaja dari yang
 * paling sering ditanyakan supervisor.
 */
const AUDIT_ACTIONS = [
  'contacts.exported',
  'lead.open_in_whatsapp',
  'payment.changed',
  'whatsapp.disconnected',
  'team.member_added',
  'team.role_changed',
  'team.member_removed',
  'integration.connected',
  'integration.disconnected',
] as const;

/**
 * Tindakan yang akibatnya keluar dari Agnee.
 *
 * Daftar ini dulu dipaku ke satu tindakan saja (`lead.open_in_whatsapp`), jadi
 * tindakan lain yang dicatat tidak akan pernah terlihat di sini walau barisnya
 * ada di database. Sekarang semuanya ditampilkan, dengan penyaring per jenis
 * tindakan — karena pertanyaan supervisor biasanya spesifik: "siapa yang
 * mengunduh daftar customer bulan ini".
 */
function AuditSection() {
  const { t, locale } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const query = action ? `?action=${encodeURIComponent(action)}&limit=50` : '?limit=50';
      const data = await api<{ entries: AuditEntry[] }>(`/v1/audit${query}`);
      setEntries(data.entries || []);
      setStatus(data.entries?.length ? '' : t('admin.auditEmpty'));
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [t, action]);

  useEffect(() => { void load(); }, [load]);

  /** Satu baris ringkas: apa yang disentuh, bukan seluruh metadata. */
  const rincian = (entry: AuditEntry) => {
    const m = entry.metadata || {};
    if (entry.action === 'contacts.exported') {
      return [m.format?.toUpperCase(), m.rows != null ? `${m.rows} ${t('audit.rows')}` : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'payment.changed') return (m.fields || []).join(', ');
    if (entry.action.startsWith('integration.')) return m.integration || entry.entityId || '';
    if (entry.action.startsWith('team.')) return [m.email, m.role].filter(Boolean).join(' · ');
    if (entry.action === 'whatsapp.disconnected') return m.label || entry.entityId || '';
    return m.contactName || m.phone || entry.entityId || '';
  };

  const dateLocale = locale === 'en' ? 'en-US' : 'id-ID';
  return (
    <SettingCard
      eyebrow={t('admin.auditEyebrow')}
      title={t('admin.auditTitle')}
      description={t('admin.auditCopy')}
    >
      <select
        value={action}
        onChange={(event) => setAction(event.target.value)}
        aria-label={t('admin.auditFilterAll')}
        className="mb-3 rounded-app border border-input bg-white/60 px-3 py-2 text-sm"
      >
        <option value="">{t('admin.auditFilterAll')}</option>
        {AUDIT_ACTIONS.map((item) => (
          <option key={item} value={item}>{t(`audit.${item}`)}</option>
        ))}
      </select>
      {entries.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-2 rounded-xl border border-border bg-white p-3 text-[13px]">
              <strong>{entry.actorName || '—'}</strong>
              <span>{t(`audit.${entry.action}`)}</span>
              {rincian(entry) ? <span className="text-muted">{rincian(entry)}</span> : null}
              <span className="flex-1" />
              <time className="font-mono text-[10px] text-muted">
                {new Date(entry.createdAt).toLocaleString(dateLocale)}
              </time>
            </li>
          ))}
        </ul>
      ) : null}
      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}

function StatusTile({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'ok' | 'bad' | 'neutral' }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <small className="font-mono text-[10px] tracking-[.1em] text-muted uppercase">{label}</small>
      <strong
        className={cn(
          'mt-1 block truncate text-[13px]',
          tone === 'ok' && 'text-green-dark',
          tone === 'bad' && 'text-danger',
        )}
      >
        {value}
      </strong>
    </div>
  );
}

// ── AI settings ─────────────────────────────────────────────────────────────

function AiSettings() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [enabled, setEnabled] = useState(false);
  const [chain, setChain] = useState<string[]>(Array(MODEL_SLOT_COUNT).fill(''));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    void api<{ enabled: boolean; modelChain: string[]; defaultModel: string }>('/v1/admin/ai-settings')
      .then((data) => {
        setEnabled(data.enabled);
        // An empty chain still shows the default in the primary slot, so the
        // page never implies "no model configured" when one is in use.
        const current = data.modelChain.length ? data.modelChain : [data.defaultModel];
        setChain(Array.from({ length: MODEL_SLOT_COUNT }, (_, index) => current[index] || ''));
      })
      .catch(() => setStatus(t('admin.loadFailed')));
  }, [t]);

  async function save() {
    setSaving(true);
    try {
      await api('/v1/admin/ai-settings', {
        method: 'PATCH',
        body: { enabled, modelChain: chain.filter(Boolean) },
      });
      flash();
    } catch (error) {
      await confirm.alert({
        title: t('admin.saveFailedTitle'),
        message: t('admin.saveFailed', { message: messageFromError(error, '') }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingCard
      eyebrow={t('admin.settingsEyebrow')}
      title={t('admin.settingsTitle')}
      description={t('admin.settingsCopy')}
      badge={enabled ? t('admin.aiOn') : t('admin.aiOff')}
      badgeTone={enabled ? 'on' : 'off'}
    >
      <label className="mb-4 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          className="size-4 accent-green"
        />
        <span>{enabled ? t('admin.aiOn') : t('admin.aiOff')}</span>
      </label>

      <div className="grid gap-2">
        {chain.map((value, index) => {
          const known = findModel(value);
          return (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'w-28 shrink-0 rounded-full px-2.5 py-1 text-center font-mono text-[10px] font-semibold',
                  index === 0 ? 'bg-ink text-white' : 'bg-ink/8 text-muted',
                )}
              >
                {index === 0 ? t('admin.primary') : t('admin.nextModel', { number: index })}
              </span>
              <select
                value={known ? known.value : value}
                aria-label={index === 0 ? t('admin.primary') : t('admin.nextModel', { number: index })}
                onChange={(event) =>
                  setChain((current) => current.map((slot, slotIndex) => (slotIndex === index ? event.target.value : slot)))
                }
                className="min-w-0 flex-1 rounded-app border border-input bg-white/60 px-3 py-2 text-[13px]"
              >
                {/* A model id saved before this list existed must stay selectable,
                    otherwise opening the page silently rewrites the chain. */}
                {value && !known ? <option value={value}>{`${value}  ·  (${t('admin.custom')})`}</option> : null}
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model.value || 'none'} value={model.value}>
                    {model.labelKey ? t(model.labelKey) : model.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {t('admin.save')}
        </Button>
        <SavedBadge shown={saved} />
        <StatusLine>{status}</StatusLine>
      </div>
    </SettingCard>
  );
}

// ── Playbook ────────────────────────────────────────────────────────────────

type Asset = { id: string; filename: string; kind: string; sizeBytes: number; extractionStatus: string };

const KIND_ICON: Record<string, string> = {
  document: '📄',
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  other: '📎',
};

function PlaybookSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [brief, setBrief] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { saved, flash } = useSavedFlag();

  const load = useCallback(async () => {
    try {
      const data = await api<{ brief?: string; assets?: Asset[] }>('/v1/admin/playbook');
      setBrief(data.brief || '');
      setAssets(data.assets || []);
    } catch (error) {
      setStatusIsError(true);
      setStatus(t('admin.playbookLoadFailed', { message: messageFromError(error, '') }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setStatusIsError(false);
    setStatus(t('admin.uploading', { name: file.name }));
    const body = new FormData();
    body.append('file', file);
    try {
      await api('/v1/admin/playbook/assets', { method: 'POST', body });
      setStatus(t('admin.uploaded', { name: file.name }));
      await load();
    } catch (error) {
      setStatusIsError(true);
      setStatus(t('admin.uploadFailed', { name: file.name, message: messageFromError(error, '') }));
    }
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void upload(file);
  }

  return (
    <SettingCard eyebrow={t('admin.playbookEyebrow')} title={t('admin.playbookTitle')} description={t('admin.playbookCopy')}>
      <textarea
        rows={6}
        value={brief}
        placeholder={t('admin.briefPlaceholder')}
        onChange={(event) => setBrief(event.target.value)}
        className="w-full rounded-app border border-input bg-white/60 p-3 text-sm leading-[1.6] outline-none focus:border-green"
      />
      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await api('/v1/admin/playbook', { method: 'PUT', body: { brief } });
              flash();
            } catch (error) {
              await confirm.error(error);
            } finally {
              setSaving(false);
            }
          }}
        >
          {t('admin.saveBrief')}
        </Button>
        <SavedBadge shown={saved} />
      </div>

      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'mt-5 grid cursor-pointer place-items-center rounded-panel border-2 border-dashed p-7 text-center transition-colors',
          dragging ? 'border-green bg-green/6' : 'border-border bg-white/40 hover:border-green/50',
        )}
      >
        <strong className="text-[13px]">{t('admin.dropzoneTitle')}</strong>
        <small className="mt-1 text-[11px] text-muted">{t('admin.dropzoneHint')}</small>
        <input
          ref={fileInput}
          type="file"
          accept=".pdf,.doc,.docx,.md,.markdown,.txt,image/*,video/*,audio/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </label>

      <StatusLine tone={statusIsError ? 'error' : 'muted'}>{status}</StatusLine>

      <div className="mt-3 grid gap-2">
        {assets.length ? (
          assets.map((asset) => (
            <div key={asset.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white/60 p-3">
              <span aria-hidden className="text-xl">
                {KIND_ICON[asset.kind] || '📎'}
              </span>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">{asset.filename}</strong>
                <small className="font-mono text-[11px] text-muted">{formatFileSize(asset.sizeBytes)}</small>
              </span>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold',
                  asset.extractionStatus === 'ready' && 'bg-green/14 text-green-dark',
                  asset.extractionStatus === 'failed' && 'bg-danger/12 text-danger',
                  asset.extractionStatus === 'unsupported' && 'bg-ink/8 text-muted',
                )}
              >
                {t(`admin.assetStatus.${asset.extractionStatus}`)}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm.confirm({
                    title: t('dialog.deleteFileTitle'),
                    message: t('dialog.deleteFileCopy'),
                    confirmLabel: t('dialog.deleteConfirm'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api(`/v1/admin/playbook/assets/${asset.id}`, { method: 'DELETE' });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </div>
          ))
        ) : (
          <p className="m-0 text-[13px] text-muted">{t('admin.noAssets')}</p>
        )}
      </div>
    </SettingCard>
  );
}

function CoachLinkCard() {
  const { t } = useI18n();
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-panel bg-ink p-6 text-white">
      <div>
        <p className="eyebrow text-lime">{t('admin.coachEyebrow')}</p>
        <h2 className="m-0 text-xl tracking-[-.02em]">{t('admin.coachTitle')}</h2>
        <p className="mt-1.5 mb-0 max-w-xl text-[13px] text-white/65">{t('admin.coachCopy')}</p>
      </div>
      <a
        href="/settings#coachSection"
        className="rounded-app bg-lime px-4 py-2.5 text-[13px] font-semibold text-ink no-underline"
      >
        {t('admin.coachAction')}
      </a>
    </section>
  );
}

// ── Playground ──────────────────────────────────────────────────────────────

const QUICK_MESSAGES = ['pg.msgGreeting', 'pg.msgPrice', 'pg.msgTrial', 'pg.msgSignup'] as const;
const QUICK_TEXT: Record<string, string> = {
  'pg.msgGreeting': 'Halo, saya mau tanya tentang produk',
  'pg.msgPrice': 'Berapa harganya per bulan?',
  'pg.msgTrial': 'Apakah ada trial gratis?',
  'pg.msgSignup': 'Bagaimana cara daftarnya?',
};

function Playground({ config }: { config: Config | null }) {
  const { t, locale } = useI18n();
  const [clientId, setClientId] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Reply | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [historyNote, setHistoryNote] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const numberLocale = locale === 'en' ? 'en-US' : 'id-ID';

  useEffect(() => {
    if (config && !clientId) setClientId(config.defaultKnowledgeClient || config.knowledgeClients[0]?.id || '');
  }, [config, clientId]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await api<{ runs: Run[]; database: { driver: string } }>('/v1/admin/playground/runs?limit=20');
      setRuns(data.runs);
      setHistoryNote(
        data.runs.length ? '' : data.database.driver !== 'postgresql' ? t('admin.historyTemporary') : t('admin.noHistory'),
      );
    } catch (caught) {
      setRuns([]);
      setHistoryNote(messageFromError(caught, ''));
    }
  }, [t]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    setResult(null);
    try {
      const data = await api<Reply>('/v1/admin/playground/auto-reply', {
        method: 'POST',
        body: { message: message.trim(), clientId },
      });
      setResult(data);
      await loadHistory();
    } catch (caught) {
      setError(messageFromError(caught, ''));
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <SettingCard eyebrow={t('admin.input')} title={t('admin.customerMessage')}>
        <form onSubmit={submit} className="grid gap-3">
          {/* Pelanggan hanya punya satu pack — miliknya sendiri — jadi tidak ada
              yang bisa dipilih. Pemilihnya hanya muncul untuk staf platform,
              yang memang boleh menguji pack mana pun. */}
          {(config?.knowledgeClients.length ?? 0) > 1 && (
            <select
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              required
              aria-label={t('admin.knowledgeClient')}
              className="rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm"
            >
              {config?.knowledgeClients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            rows={6}
            maxLength={2000}
            required
            value={message}
            placeholder={t('admin.example')}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit(event);
              }
            }}
            className="w-full rounded-app border border-input bg-white/60 p-3 text-sm outline-none focus:border-green"
          />
          <div className="flex flex-wrap gap-1.5">
            {QUICK_MESSAGES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMessage(QUICK_TEXT[key])}
                className="cursor-pointer rounded-[9px] border border-border bg-white/60 px-2.5 py-1.5 text-[11px] hover:border-green"
              >
                {t(key)}
              </button>
            ))}
          </div>
          <StatusLine tone="error">{error}</StatusLine>
          <Button type="submit" size="sm" disabled={loading || !config?.llmEnabled} className="justify-self-start">
            {loading ? t('admin.generating') : t('admin.generate')}
          </Button>
        </form>
      </SettingCard>

      <SettingCard eyebrow={t('admin.output')} title={t('admin.replyPreview')}>
        {result ? (
          <div aria-live="polite">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {result.matchedFaqs.length ? (
                result.matchedFaqs.map((faq) => (
                  <span
                    key={faq.id}
                    title={`${faq.source} · score ${faq.score}`}
                    className="rounded-[7px] bg-warm px-2 py-1 font-mono text-[10px]"
                  >
                    {faq.id}
                  </span>
                ))
              ) : (
                <span className="font-mono text-[10px] text-muted">{t('admin.noMatch')}</span>
              )}
            </div>

            <div className="rounded-[8px_18px_18px_18px] bg-white p-3.5 shadow-sm">
              <p className="m-0 text-sm leading-[1.5] whitespace-pre-wrap">
                <InlineMarkdown text={result.reply} />
              </p>
            </div>

            <p
              className={cn(
                'mt-3 mb-0 text-[12px]',
                result.style.passed ? 'text-green-dark' : 'text-[#a6791f]',
              )}
            >
              {result.style.passed
                ? t('admin.stylePassed', { saved: result.persistence?.saved ? t('admin.styleSaved') : '' })
                : t('admin.styleWarning', { warnings: result.style.warnings.join('; ') })}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="INPUT" value={result.usage.inputTokens.toLocaleString(numberLocale)} unit="tokens" />
              <Metric label="OUTPUT" value={result.usage.outputTokens.toLocaleString(numberLocale)} unit="tokens" />
              <Metric label="TOTAL" value={result.usage.totalTokens.toLocaleString(numberLocale)} unit="tokens" />
              <Metric label="COST" value={formatUsd(result.usage.costUsd)} unit="USD" />
            </div>

            <footer className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[10px] text-muted">
              <span>{result.model}</span>
              <span>{t('admin.seconds', { seconds: (result.elapsedMs / 1000).toFixed(1) })}</span>
            </footer>

            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={async () => {
                await navigator.clipboard.writeText(result.reply);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}
            >
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted">{loading ? t('pg.processing') : t('admin.emptyResult')}</p>
        )}
      </SettingCard>

      <SettingCard eyebrow={t('admin.historyEyebrow')} title={t('admin.history')}>
        <div className="mb-3">
          <Button size="sm" variant="outline" onClick={() => void loadHistory()}>
            {t('common.refresh')}
          </Button>
        </div>
        {runs.length ? (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr>
                  {[t('admin.colTime'), t('admin.colClient'), t('admin.colMessage'), t('admin.colTokens'), t('admin.colCost'), t('admin.colStyle')].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="border-b border-border bg-[#eef2ec] px-3 py-2 text-left font-mono text-[10px] tracking-[.04em] text-[#285248] uppercase"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((run, index) => (
                  <tr key={index}>
                    <td className="border-b border-border px-3 py-2 whitespace-nowrap">
                      {new Date(run.createdAt).toLocaleString(numberLocale)}
                    </td>
                    <td className="border-b border-border px-3 py-2">{run.clientId}</td>
                    <td className="max-w-[280px] truncate border-b border-border px-3 py-2">{run.message}</td>
                    <td className="border-b border-border px-3 py-2">{Number(run.totalTokens).toLocaleString(numberLocale)}</td>
                    <td className="border-b border-border px-3 py-2">{formatUsd(run.costUsd)}</td>
                    <td className={cn('border-b border-border px-3 py-2', run.stylePassed ? 'text-green-dark' : 'text-[#a6791f]')}>
                      {run.stylePassed ? t('admin.pass') : t('admin.warn')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="m-0 text-[13px] text-muted">{historyNote}</p>
        )}
      </SettingCard>
    </>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-border bg-white/60 p-2.5 text-center">
      <small className="font-mono text-[9px] tracking-[.1em] text-muted">{label}</small>
      <strong className="mt-0.5 block text-sm">{value}</strong>
      <span className="font-mono text-[9px] text-muted">{unit}</span>
    </div>
  );
}
