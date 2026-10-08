import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { LoaderCircle, Play, TriangleAlert } from 'lucide-react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { SettingCard } from '@/features/settings/parts';
import { SpecificForm } from './SpecificForm';
import { SimulationResults } from './SimulationResults';
import type { KsCatalogEntry, KsInstall, KsJob, KsSpecific } from './types';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-6 border-t border-border pt-5 first:mt-0 first:border-t-0 first:pt-0">
      <h3 className="m-0 mb-3 flex items-center gap-2.5 text-[15px] font-bold">
        <span className="grid size-6 place-items-center rounded-full bg-ink text-[12px] text-white">{n}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function InstallPanel({
  install, onChanged, onReload, onRemoved,
}: {
  install: KsInstall;
  onChanged: (next: KsInstall) => void;
  onReload: () => Promise<void>;
  onRemoved: () => Promise<void>;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const savedKey = JSON.stringify(install.specific);
  const [draft, setDraft] = useState<KsSpecific>(install.specific);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<KsJob | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => { setDraft(JSON.parse(savedKey) as KsSpecific); }, [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;
  const running = job?.status === 'running';

  // Simulasi berjalan di server; satu halaman yang dibuka ulang harus
  // melanjutkan memantaunya, bukan mengira tidak ada yang berjalan.
  useEffect(() => {
    let cancelled = false;
    api<{ job: KsJob | null }>(`/v1/ks/installs/${install.id}/simulation`)
      .then((res) => { if (!cancelled) setJob(res.job); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [install.id]);

  useEffect(() => {
    if (!running) return undefined;
    const timer = window.setInterval(() => {
      api<{ job: KsJob | null }>(`/v1/ks/installs/${install.id}/simulation`)
        .then(async (res) => {
          setJob(res.job);
          if (res.job?.status !== 'running') await onReload();
        })
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [running, install.id, onReload]);

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    setMessage('');
    try {
      return await action();
    } catch (error) {
      setMessage(messageFromError(error, t('ks.actionFailed')));
      return null;
    }
  }

  async function save() {
    setSaving(true);
    const res = await run(() => api<{ install: KsInstall }>(`/v1/ks/installs/${install.id}/specific`, {
      method: 'PUT', body: { specific: draft },
    }));
    setSaving(false);
    if (res) { setJob(null); onChanged(res.install); }
  }

  async function simulate() {
    const res = await run(() => api<{ job: KsJob }>(`/v1/ks/installs/${install.id}/simulate`, { method: 'POST' }));
    if (res) setJob(res.job);
  }

  async function setActive(active: boolean) {
    if (active) {
      const ok = await confirm.confirm({
        title: t('ks.activateTitle'), message: t('ks.activateMessage'), confirmLabel: t('ks.activate'),
      });
      if (!ok) return;
    }
    const res = await run(() => api<{ install: KsInstall }>(`/v1/ks/installs/${install.id}/activate`, {
      method: 'POST', body: { active },
    }));
    if (res) onChanged(res.install);
  }

  async function remove() {
    const ok = await confirm.confirm({
      title: t('ks.removeTitle'), message: t('ks.removeMessage', { name: install.name }), confirmLabel: t('ks.remove'), danger: true,
    });
    if (!ok) return;
    const done = await run(() => api(`/v1/ks/installs/${install.id}`, { method: 'DELETE' }).then(() => true));
    if (done) await onRemoved();
  }

  return (
    <SettingCard
      eyebrow={t('ks.eyebrow')}
      title={`${install.name} · v${install.version}`}
      badge={install.active ? t('ks.active') : t('ks.inactive')}
      badgeTone={install.active ? 'on' : 'off'}
      description={install.summary}
    >
      <Step n={1} title={t('ks.step1')}>
        <SpecificForm
          categories={install.specificSchema.categories}
          value={draft}
          problems={dirty ? [] : install.problems}
          onChange={setDraft}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {t('ks.save')}
          </Button>
          {install.example ? (
            <Button variant="outline" onClick={() => setDraft(install.example as KsSpecific)}>{t('ks.fillExample')}</Button>
          ) : null}
        </div>
        {install.example ? <p className="mt-2 mb-0 text-[12px] text-muted">{t('ks.exampleHint')}</p> : null}
        {install.active || install.simulation ? (
          <p className="mt-2 mb-0 text-[12px] text-muted">{t('ks.editResets')}</p>
        ) : null}
      </Step>

      <Step n={2} title={t('ks.step2')}>
        <p className="mt-0 mb-3 text-[13px] leading-[1.6] text-muted">{t('ks.step2Copy')}</p>
        <Button variant="outline" onClick={simulate} disabled={dirty || running || install.problems.length > 0}>
          {running ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          {running ? t('ks.simRunning', { done: job?.done ?? 0, total: job?.total ?? 0 }) : t('ks.simRun')}
        </Button>
        {dirty ? <p className="mt-2 mb-0 text-[12px] text-muted">{t('ks.saveFirst')}</p> : null}
        {!dirty && install.problems.length > 0 ? <p className="mt-2 mb-0 text-[12px] text-muted">{t('ks.completeFirst')}</p> : null}
        {running ? <progress className="mt-3 block h-2 w-full max-w-sm accent-green" max={job?.total ?? 1} value={job?.done ?? 0} /> : null}
        {job?.status === 'failed' ? <p role="alert" className="mt-3 mb-0 text-[13px] text-danger">{job.error || t('ks.simFailed')}</p> : null}
        {install.simulation ? <div className="mt-4"><SimulationResults simulation={install.simulation} /></div> : null}
      </Step>

      <Step n={3} title={t('ks.step3')}>
        {install.active ? (
          <>
            <p className="mt-0 mb-3 text-[13px] leading-[1.6]">{t('ks.activeCopy')}</p>
            <Button variant="outline" onClick={() => setActive(false)}>{t('ks.deactivate')}</Button>
          </>
        ) : (
          <>
            <p className="mt-0 mb-3 text-[13px] leading-[1.6] text-muted">{t('ks.step3Copy')}</p>
            {install.blockedReason || dirty ? (
              <p className="mt-0 mb-3 flex items-start gap-2 text-[13px]">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                <span>{dirty ? t('ks.saveFirst') : t(`ks.blocked.${install.blockedCode ?? 'problems'}`, { n: install.simulation?.failed ?? 0 })}</span>
              </p>
            ) : null}
            <Button onClick={() => setActive(true)} disabled={dirty || Boolean(install.blockedReason)}>{t('ks.activate')}</Button>
          </>
        )}
      </Step>

      {message ? <p role="alert" className="mt-5 mb-0 text-[13px] text-danger">{message}</p> : null}

      <details className="mt-6 border-t border-border pt-4">
        <summary className="cursor-pointer text-[13px] font-semibold">{t('ks.viewContent')}</summary>
        <p className="mt-2 mb-3 text-[12px] text-muted">{t('ks.viewContentCopy')}</p>
        <div className="grid gap-4">
          {install.general.map((doc) => (
            <div key={doc.file}>
              <p className="mt-0 mb-1 text-[11px] font-semibold tracking-[.06em] text-muted uppercase">{t(`ks.doc.${doc.title}`)}</p>
              <p className="m-0 text-[13px] leading-[1.65] whitespace-pre-wrap">{doc.content}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="mt-5">
        <Button variant="ghost" size="sm" onClick={remove}>{t('ks.remove')}</Button>
      </div>
    </SettingCard>
  );
}

export function KsSection() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<KsCatalogEntry[]>([]);
  const [installs, setInstalls] = useState<KsInstall[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState('');

  const load = useCallback(async () => {
    try {
      const [cat, ins] = await Promise.all([
        api<{ packages: KsCatalogEntry[] }>('/v1/ks/catalog'),
        api<{ installs: KsInstall[] }>('/v1/ks/installs'),
      ]);
      setCatalog(cat.packages);
      setInstalls(ins.installs);
      setStatus('ready');
    } catch (err) {
      setError(messageFromError(err, t('ks.loadFailed')));
      setStatus('error');
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  async function install(code: string) {
    setInstalling(code);
    setError('');
    try {
      await api('/v1/ks/installs', { method: 'POST', body: { code } });
      await load();
    } catch (err) {
      setError(messageFromError(err, t('ks.actionFailed')));
    } finally {
      setInstalling('');
    }
  }

  function replace(next: KsInstall) {
    setInstalls((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  if (status === 'loading') return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (status === 'error') return <p role="alert" className="text-sm text-danger">{error}</p>;

  const occupiedKinds = new Set(installs.map((item) => item.kind));
  const available = catalog.filter((entry) => !entry.installed);

  return (
    <div>
      <p className="mt-0 mb-2 max-w-2xl text-[13.5px] leading-[1.65] text-muted">{t('ks.intro')}</p>
      {error ? <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p> : null}

      {installs.map((item) => (
        <InstallPanel key={item.id} install={item} onChanged={replace} onReload={load} onRemoved={load} />
      ))}

      {installs.length === 0 || available.length > 0 ? (
      <SettingCard eyebrow={t('ks.eyebrow')} title={t('ks.catalogTitle')} description={installs.length ? undefined : t('ks.catalogEmptyCopy')}>
        {available.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">{t('ks.catalogNone')}</p>
        ) : (
          <div className="grid gap-3">
            {available.map((entry) => (
              <div key={entry.code} className="flex flex-wrap items-start justify-between gap-3 rounded-app border border-border bg-white/50 p-4">
                <div className="max-w-xl">
                  <strong className="text-sm">{entry.name} <span className="font-normal text-muted">v{entry.version}</span></strong>
                  <p className="mt-1 mb-0 text-[13px] leading-[1.6] text-muted">{entry.summary}</p>
                  {occupiedKinds.has(entry.kind) ? (
                    <p className="mt-1.5 mb-0 text-[12px] text-muted">{t('ks.kindTaken')}</p>
                  ) : null}
                </div>
                <Button size="sm" onClick={() => install(entry.code)} disabled={occupiedKinds.has(entry.kind) || installing === entry.code}>
                  {installing === entry.code ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
                  {t('ks.install')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingCard>
      ) : null}
    </div>
  );
}
