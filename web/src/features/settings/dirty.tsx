import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useI18n } from '@/lib/i18n';
import { messageFromError } from '@/lib/api';

/**
 * Satu "Simpan perubahan" untuk seluruh Pengaturan. Tiap bagian berbasis form
 * mendaftarkan status dirty, fungsi simpan, dan fungsi batalnya lewat
 * `useDirtySection`. Bar di bawah menyimpan semua bagian yang dirty berurutan
 * (beberapa bagian menulis ke endpoint yang sama, jadi tidak paralel). Yang
 * gagal tetap dirty dan dilaporkan per bagian; yang berhasil menjadi bersih.
 */

type Registration = {
  label: string;
  save: () => Promise<void>;
  reset: () => void;
};

type Failure = { id: string; label: string; message: string };

type DirtyApi = {
  setDirty: (id: string, dirty: boolean) => void;
  entries: React.MutableRefObject<Map<string, Registration>>;
  dirtyIds: string[];
  saving: boolean;
  failures: Failure[];
  savedAt: number;
  saveAll: () => Promise<void>;
  resetAll: () => void;
  /** Tanya pengguna bila ada perubahan belum tersimpan; true = boleh lanjut. */
  confirmLeave: () => Promise<boolean>;
};

const DirtyContext = createContext<DirtyApi | null>(null);

export function SettingsDirtyProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const entries = useRef(new Map<string, Registration>());
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [savedAt, setSavedAt] = useState(0);
  const dirtyRef = useRef<string[]>([]);
  dirtyRef.current = dirtyIds;

  const setDirty = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      const has = current.includes(id);
      if (dirty === has) return current;
      return dirty ? [...current, id] : current.filter((item) => item !== id);
    });
    if (!dirty) setFailures((current) => current.filter((item) => item.id !== id));
  }, []);

  const saveAll = useCallback(async () => {
    const ids = [...dirtyRef.current];
    if (!ids.length) return;
    setSaving(true);
    setFailures([]);
    const failed: Failure[] = [];
    for (const id of ids) {
      const entry = entries.current.get(id);
      if (!entry) continue;
      try {
        await entry.save();
      } catch (error) {
        failed.push({ id, label: entry.label, message: messageFromError(error, t('dialog.errorFallback')) });
      }
    }
    setFailures(failed);
    if (failed.length < ids.length) setSavedAt(Date.now());
    setSaving(false);
  }, [t]);

  const resetAll = useCallback(() => {
    for (const id of dirtyRef.current) entries.current.get(id)?.reset();
    setFailures([]);
  }, []);

  const confirmLeave = useCallback(async () => {
    if (!dirtyRef.current.length) return true;
    return confirm.confirm({
      title: t('settings.unsavedTitle'),
      message: t('settings.unsavedCopy'),
      confirmLabel: t('settings.unsavedLeave'),
      cancelLabel: t('settings.unsavedStay'),
      danger: true,
    });
  }, [confirm, t]);

  // Tutup tab / muat ulang / tautan keluar dari aplikasi.
  useEffect(() => {
    if (!dirtyIds.length) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirtyIds.length]);

  // Pindah halaman lewat tautan di dalam aplikasi (sidebar). BrowserRouter tidak
  // punya blocker, jadi klik pada tautan internal yang berganti path dicegat.
  useEffect(() => {
    if (!dirtyIds.length) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank') return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      void confirmLeave().then((ok) => {
        if (ok) navigate(url.pathname + url.search + url.hash);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [dirtyIds.length, confirmLeave, navigate]);

  const value = useMemo<DirtyApi>(
    () => ({ setDirty, entries, dirtyIds, saving, failures, savedAt, saveAll, resetAll, confirmLeave }),
    [setDirty, dirtyIds, saving, failures, savedAt, saveAll, resetAll, confirmLeave],
  );

  return <DirtyContext.Provider value={value}>{children}</DirtyContext.Provider>;
}

export function useSettingsDirty(): DirtyApi {
  const ctx = useContext(DirtyContext);
  if (!ctx) throw new Error('useSettingsDirty must be used inside SettingsDirtyProvider');
  return ctx;
}

/**
 * Daftarkan satu bagian. `save` harus melempar galat bila gagal (supaya bar
 * bisa melaporkannya) dan menjadikan keadaan sekarang sebagai dasar baru.
 */
export function useDirtySection(id: string, label: string, dirty: boolean, save: () => Promise<void>, reset: () => void) {
  const { setDirty, entries } = useSettingsDirty();
  // Selalu simpan versi terbaru fungsi, tanpa memicu pendaftaran ulang.
  entries.current.set(id, { label, save, reset });
  useEffect(() => {
    setDirty(id, dirty);
  }, [id, dirty, setDirty]);
  useEffect(
    () => () => {
      entries.current.delete(id);
      setDirty(id, false);
    },
    [id, entries, setDirty],
  );
}

/**
 * Nilai form + dasar yang tersimpan. `dirty` = nilai sekarang berbeda dari
 * dasar; `load` mengisi keduanya (dari server), `commit` menjadikan nilai
 * yang baru disimpan sebagai dasar, `reset` membuang perubahan.
 */
export function useFormState<T extends object>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [baseline, setBaseline] = useState<T | null>(null);
  const dirty = baseline !== null && JSON.stringify(values) !== JSON.stringify(baseline);
  return {
    values,
    baseline,
    loaded: baseline !== null,
    dirty,
    set: (patch: Partial<T>) => setValues((current) => ({ ...current, ...patch })),
    load: (next: T) => {
      setValues(next);
      setBaseline(next);
    },
    commit: (next: T) => setBaseline(next),
    reset: () => baseline && setValues(baseline),
  };
}

export function SaveBar() {
  const { t } = useI18n();
  const { dirtyIds, saving, failures, savedAt, saveAll, resetAll, entries } = useSettingsDirty();
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (!savedAt) return undefined;
    setShowSaved(true);
    const timer = setTimeout(() => setShowSaved(false), 2500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  if (!dirtyIds.length && !failures.length) {
    return showSaved ? (
      <div role="status" className="sticky bottom-4 z-30 mt-6 flex justify-center">
        <span className="rounded-full border border-green/40 bg-white px-4 py-2 font-mono text-[12px] font-semibold text-green-dark shadow-lg">
          {t('settings.saved')}
        </span>
      </div>
    ) : null;
  }

  return (
    <div
      role="region"
      aria-label={t('settings.saveBarLabel')}
      className="sticky bottom-4 z-30 mt-6 rounded-2xl border border-border bg-white p-3 shadow-lg"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-0 min-w-0 flex-1 text-[13px] font-medium">
          {t('settings.unsavedCount', { count: dirtyIds.length })}
          <span className="ml-1 text-[11px] text-muted">
            {dirtyIds.map((id) => entries.current.get(id)?.label).filter(Boolean).join(' · ')}
          </span>
        </p>
        <Button variant="outline" size="sm" disabled={saving} onClick={resetAll}>
          {t('common.cancel')}
        </Button>
        <Button size="sm" disabled={saving || !dirtyIds.length} onClick={() => void saveAll()}>
          {saving ? t('common.loading') : t('settings.saveAll')}
        </Button>
      </div>
      {failures.length ? (
        <ul role="alert" className="m-0 mt-2 grid list-none gap-1 p-0">
          {failures.map((failure) => (
            <li key={failure.id} className="text-[12px] text-danger">
              <b>{failure.label}:</b> {failure.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
