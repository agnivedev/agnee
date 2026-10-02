import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { formatFileSize } from '@/features/inbox/format';
import { SavedBadge, SettingCard, StatusLine, useSavedFlag } from '@/features/settings/parts';

type Asset = { id: string; filename: string; kind: string; sizeBytes: number; extractionStatus: string };

const KIND_ICON: Record<string, string> = {
  document: '📄',
  image: '🖼',
  video: '🎬',
  audio: '🎵',
  other: '📎',
};

export function BriefSection() {
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
