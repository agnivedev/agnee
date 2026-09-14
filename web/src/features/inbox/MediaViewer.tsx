import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { MediaTarget } from './types';

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;

/**
 * Full-screen viewer for photos, video, voice notes and PDFs.
 *
 * Zoom and pan are driven by pointer events so a trackpad pinch, a touch pinch
 * and a mouse drag all land in the same code path. The transform is written
 * straight to the element rather than through React state: at 60 drag events a
 * second, re-rendering the tree for each one is visible as lag.
 */
export function MediaViewer({ target, onClose }: { target: MediaTarget | null; onClose: () => void }) {
  const { t } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef({ distance: 0, scale: 1 });
  const [zoomLabel, setZoomLabel] = useState('100%');
  const [downloading, setDownloading] = useState(false);

  const isImage = target?.kind === 'image';

  const applyTransform = useCallback(() => {
    const state = view.current;
    state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale));
    if (state.scale <= 1) {
      state.x = 0;
      state.y = 0;
    }
    if (image.current) {
      image.current.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    }
    setZoomLabel(`${Math.round(state.scale * 100)}%`);
  }, []);

  const zoom = useCallback(
    (next: number) => {
      view.current.scale = next;
      applyTransform();
    },
    [applyTransform],
  );

  const reset = useCallback(() => {
    view.current = { scale: 1, x: 0, y: 0 };
    applyTransform();
  }, [applyTransform]);

  useEffect(() => {
    if (target) reset();
  }, [target, reset]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (!isImage) return;
      if (event.key === '+' || event.key === '=') zoom(view.current.scale + 0.25);
      if (event.key === '-') zoom(view.current.scale - 0.25);
      if (event.key === '0') reset();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [target, isImage, zoom, reset, onClose]);

  // Wheel must be a non-passive listener to be able to preventDefault, which
  // React's onWheel cannot guarantee.
  useEffect(() => {
    const element = stage.current;
    if (!element || !isImage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(view.current.scale + (event.deltaY < 0 ? 0.15 : -0.15));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [isImage, zoom, target]);

  async function download() {
    if (!target) return;
    setDownloading(true);
    try {
      const response = await fetch(target.src);
      if (!response.ok) throw new Error(t('common.downloadFailed'));
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = target.filename || `whatsapp-${Date.now()}`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch {
      setZoomLabel(t('common.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }

  if (!target) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('media.viewer')}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-100 grid grid-rows-[auto_minmax(0,1fr)_auto] bg-[rgba(6,15,11,.92)] text-white"
    >
      <header className="flex items-center justify-between gap-4 px-5 py-3">
        <div className="grid">
          <strong className="text-sm">{target.title}</strong>
          <span className="font-mono text-[10px] text-white/55">
            {isImage ? zoomLabel : target.kind === 'video' ? t('media.video') : target.kind === 'audio' ? t('media.audio') : 'PDF'}
          </span>
        </div>
        <nav aria-label={t('media.controls')} className="flex items-center gap-1.5">
          {isImage ? (
            <>
              <ViewerButton label="−" title={t('media.zoomOut')} onClick={() => zoom(view.current.scale - 0.25)} />
              <ViewerButton label={t('media.fit')} title={t('media.fit')} onClick={reset} />
              <ViewerButton label="＋" title={t('media.zoomIn')} onClick={() => zoom(view.current.scale + 0.25)} />
            </>
          ) : null}
          <ViewerButton label="↓" title={t('media.download')} disabled={downloading} onClick={() => void download()} />
          <ViewerButton label="×" title={t('common.close')} onClick={onClose} />
        </nav>
      </header>

      <div
        ref={stage}
        onDoubleClick={() => isImage && zoom(view.current.scale > 1 ? 1 : 2)}
        onPointerDown={(event) => {
          if (!isImage) return;
          stage.current?.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
          }
        }}
        onPointerMove={(event) => {
          if (!isImage) return;
          const previous = pointers.current.get(event.pointerId);
          if (!previous) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const distance = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinch.current.distance) zoom((pinch.current.scale * distance) / pinch.current.distance);
          } else if (view.current.scale > 1) {
            view.current.x += event.clientX - previous.x;
            view.current.y += event.clientY - previous.y;
            applyTransform();
          }
        }}
        onPointerUp={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current.distance = 0;
        }}
        onPointerCancel={(event) => {
          pointers.current.delete(event.pointerId);
          pinch.current.distance = 0;
        }}
        className={cn('grid min-h-0 place-items-center overflow-hidden px-4', isImage && 'cursor-grab')}
      >
        {target.kind === 'image' ? (
          <img ref={image} src={target.src} alt={target.title} className="max-h-full max-w-full origin-center" />
        ) : target.kind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={target.src} controls playsInline preload="metadata" autoPlay className="max-h-full max-w-full" />
        ) : target.kind === 'audio' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <audio src={target.src} controls preload="metadata" className="w-[min(100%,480px)]" />
        ) : (
          <iframe src={target.src} title={target.title} className="size-full border-0 bg-white" />
        )}
      </div>

      <p className="m-0 px-5 py-3 text-center font-mono text-[10px] text-white/45">
        {isImage ? t('media.help') : target.kind === 'document' ? t('media.documentHelp') : t('media.audioHelp')}
      </p>
    </div>
  );
}

function ViewerButton({
  label,
  title,
  onClick,
  disabled,
}: {
  label: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 min-w-9 cursor-pointer place-items-center rounded-[10px] border border-white/15 bg-white/8 px-2 text-sm text-white transition hover:bg-white/16"
    >
      {label}
    </button>
  );
}
