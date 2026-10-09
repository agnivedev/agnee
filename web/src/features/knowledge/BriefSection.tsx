import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/features/inbox/format';
import { SavedBadge, StatusLine, useSavedFlag } from '@/features/settings/parts';

type Asset = { id: string; filename: string; kind: string; sizeBytes: number; extractionStatus: string };

const KIND_ICON: Record<string, string> = {
  document: '📄',
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  other: '📎',
};

/** Satu pintu unggah untuk file rujukan: dipakai ImportPanel (mode "file rujukan"). */
export async function uploadReference(file: File) {
  const body = new FormData();
  body.append('file', file);
  await api('/v1/admin/playbook/assets', { method: 'POST', body });
}

/**
 * Ringkasan perusahaan + daftar file rujukan, bagian dari "Bahan umum" di layar
 * Playbook. Tidak punya tombol unggah sendiri: mengunggah lewat satu pintu yang
 * sama dengan unggah playbook, yang bertanya tujuannya.
 */
export function BriefPanel({ reloadKey, onUpload }: { reloadKey: number; onUpload: () => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [brief, setBrief] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const { saved, flash } = useSavedFlag();

  const load = useCallback(async () => {
    try {
      const data = await api<{ brief?: string; assets?: Asset[] }>('/v1/admin/playbook');
      setBrief(data.brief || '');
      setAssets(data.assets || []);
    } catch (error) {
      setStatus(t('admin.playbookLoadFailed', { message: messageFromError(error, '') }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  return (
    <div>
      <header className="mb-4 grid gap-1 border-b border-border pb-3">
        <h2 className="m-0 text-[17px]">{t('knowledge.brief.title')}</h2>
        <p className="m-0 text-[12px] leading-[1.55] text-muted">{t('knowledge.brief.copy')}</p>
      </header>
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

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <h3 className="m-0 text-[13px]">{t('knowledge.brief.files')}</h3>
        <Button size="sm" variant="outline" onClick={onUpload}>{t('knowledge.brief.upload')}</Button>
      </div>

      <StatusLine tone="error">{status}</StatusLine>

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
    </div>
  );
}
