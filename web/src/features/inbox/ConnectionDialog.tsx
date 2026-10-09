import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { isSupervisorRole, useSession } from '@/lib/session';
import { useI18n } from '@/lib/i18n';
import { Dialog, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WhatsappStatus } from './types';

type View =
  | { kind: 'connected'; account: string }
  | { kind: 'qr'; dataUrl?: string; note: string }
  | { kind: 'syncing'; percent?: number; restoring: boolean }
  | { kind: 'error'; detail?: string }
  // Agent boleh melihat status koneksi — header inbox memang menampilkannya —
  // tapi pairing-nya milik supervisor: server menolak /v1/whatsapp/qr,
  // qr-refresh, dan logout untuk peran lain. Tanpa tampilan ini, agent yang
  // membuka dialog ini hanya melihat 403 tanpa keterangan.
  | { kind: 'locked' };

/**
 * WhatsApp pairing. One company can hold several numbers, so `connectionId`
 * decides which one is being paired; without it, the primary number.
 *
 * The QR arrives two ways — the refresh endpoint answers with one, and the
 * server pushes later ones over SSE. Both paths land here.
 */
export function ConnectionDialog({
  open,
  connectionId,
  whatsapp,
  qrFromEvent,
  onClose,
  onReady,
}: {
  open: boolean;
  connectionId: string | null;
  whatsapp: WhatsappStatus | null;
  qrFromEvent: string | null;
  onClose: () => void;
  onReady: () => void;
}) {
  const { t } = useI18n();
  const { user } = useSession();
  const canPair = isSupervisorRole(user);
  const [view, setView] = useState<View>({ kind: 'qr', note: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [changingNumber, setChangingNumber] = useState(false);
  // Tautkan lewat nomor HP: alternatif QR untuk yang memasang dari HP yang sama.
  const [usePhone, setUsePhone] = useState(false);
  const [phone, setPhone] = useState('');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState('');
  const phase = whatsapp?.phase;

  async function requestCode() {
    setCodeBusy(true);
    setCodeError('');
    try {
      const data = await api<{ code?: string }>('/v1/whatsapp/pairing-code', {
        method: 'POST',
        body: connectionId ? { phoneNumber: phone, connectionId } : { phoneNumber: phone },
      });
      setPairingCode(data?.code || null);
    } catch (error) {
      setCodeError(messageFromError(error, t('wa.waiting')));
    } finally {
      setCodeBusy(false);
    }
  }

  // WhatsApp menerbitkan kode baru tiap ±3 menit; ikuti supaya yang tampil
  // selalu yang berlaku.
  useEffect(() => {
    if (!open || !usePhone || !pairingCode) return;
    const timer = setInterval(() => {
      api<{ code?: string }>(`/v1/whatsapp/pairing-code${connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : ''}`)
        .then((data) => { if (data?.code) setPairingCode(data.code); })
        .catch(() => {});
    }, 10_000);
    return () => clearInterval(timer);
  }, [open, usePhone, pairingCode, connectionId]);

  const requestQr = useCallback(async () => {
    setView({ kind: 'qr', note: t('wa.preparing') });
    try {
      const data = await api<{ qrDataUrl?: string; restarting?: boolean }>('/v1/whatsapp/qr-refresh', {
        method: 'POST',
        body: connectionId ? { connectionId } : {},
      });
      if (data?.qrDataUrl) setView({ kind: 'qr', dataUrl: data.qrDataUrl, note: t('wa.updated') });
      else if (data?.restarting) setView({ kind: 'qr', note: t('wa.restarting') });
      else setView({ kind: 'qr', note: t('wa.preparing') });
    } catch (error) {
      // While the phase is still 'syncing' this route answers 404 because there
      // genuinely is no QR yet. Showing the reason beats a button that looks dead.
      setView({ kind: 'qr', note: messageFromError(error, t('wa.waiting')) });
    }
  }, [connectionId, t]);

  // Decide what the dialog shows the moment it opens, from the phase the app
  // already knows — not from a fresh request the operator would have to wait for.
  const opened = useRef(false);
  useEffect(() => {
    if (!open) {
      opened.current = false;
      setUsePhone(false);
      setPairingCode(null);
      setCodeError('');
      return;
    }
    if (opened.current) return;
    // Tunggu keadaan nomor ini diketahui. Tanpa itu `phase` masih kosong dan
    // dialog langsung meminta QR baru — untuk nomor yang sebenarnya tersambung.
    if (!whatsapp) return;
    opened.current = true;

    if (phase === 'ready' || phase === 'demo') {
      setView({ kind: 'connected', account: whatsapp?.account || t('wa.connected') });
      return;
    }
    if (phase === 'starting') {
      setView({ kind: 'syncing', restoring: true });
      return;
    }
    if (phase === 'authenticated' || phase === 'syncing') {
      setView({ kind: 'syncing', percent: whatsapp?.syncPercent, restoring: false });
      return;
    }
    if (phase === 'error') {
      setView({ kind: 'error', detail: whatsapp?.lastError });
      return;
    }
    if (!canPair) {
      setView({ kind: 'locked' });
      return;
    }
    void requestQr();
  }, [open, phase, whatsapp, requestQr, canPair, t]);

  // Follow the live phase while the dialog stays open.
  useEffect(() => {
    if (!open || !opened.current) return;
    if (qrFromEvent) {
      setView((current) => (current.kind === 'qr' ? { ...current, dataUrl: qrFromEvent, note: t('wa.updated') } : current));
    }
    if (phase === 'authenticated') setView({ kind: 'syncing', restoring: false });
    if (phase === 'syncing') setView({ kind: 'syncing', percent: whatsapp?.syncPercent, restoring: false });
    if (phase === 'error') setView({ kind: 'error', detail: whatsapp?.lastError });
    if (phase === 'ready') {
      setView({ kind: 'connected', account: whatsapp?.account || t('wa.connected') });
      onReady();
      // Pairing is done; do not hold the modal hostage to the history load that
      // runs after WhatsApp reports ready.
      const timer = setTimeout(onClose, 900);
      return () => clearTimeout(timer);
    }
  }, [open, phase, qrFromEvent, whatsapp, onClose, onReady, t]);

  async function changeNumber() {
    setChangingNumber(true);
    try {
      // Tanpa connectionId server memutus nomor UTAMA — padahal dialog ini bisa
      // sedang menampilkan nomor kedua.
      await api('/v1/whatsapp/logout', { method: 'POST', body: connectionId ? { connectionId } : {} });
      setView({ kind: 'syncing', restoring: true });
    } catch (error) {
      setView({ kind: 'qr', note: messageFromError(error, t('wa.waiting')) });
    } finally {
      setChangingNumber(false);
    }
  }

  const title =
    view.kind === 'connected'
      ? t('wa.connected')
      : view.kind === 'syncing'
        ? view.restoring
          ? t('wa.restoreTitle')
          : t('wa.syncTitle')
        : view.kind === 'error'
          ? t('wa.connectionSlow')
          : view.kind === 'locked'
            ? t('wa.pairingLocked')
            : t('wa.connect');

  const copy =
    view.kind === 'connected'
      ? t('wa.synced')
      : view.kind === 'syncing'
        ? view.restoring
          ? t('wa.restoring')
          : t('wa.scanned')
        : view.kind === 'error'
          ? view.detail?.trim() || t('wa.connectionSlowCopy')
          : view.kind === 'locked'
            ? t('wa.pairingLockedCopy')
            : usePhone
              ? pairingCode ? t('wa.codeCopy') : t('wa.phoneCopy')
              : t('wa.scan');

  return (
    <Dialog open={open} onClose={onClose} labelledBy="connectionDialogTitle">
      <div className="relative p-[34px] text-center">
        <div className="absolute top-2.5 right-2.5 flex gap-2">
          {view.kind === 'qr' ? (
            <button
              type="button"
              title={t('wa.refreshQr')}
              aria-label={t('wa.refreshQr')}
              disabled={refreshing}
              onClick={async () => {
                setRefreshing(true);
                await requestQr();
                setTimeout(() => setRefreshing(false), 400);
              }}
              className={cn(
                'grid size-9 cursor-pointer place-items-center rounded-lg border-0 bg-green/10 text-lg transition hover:bg-green/18',
                refreshing && 'animate-spin',
              )}
            >
              ⟳
            </button>
          ) : null}
          <DialogClose onClick={onClose} label={t('common.close')} />
        </div>

        <img src="/brand/agnee-mark.svg" alt="" className="mx-auto w-10" />
        <p className="eyebrow mt-4">{t('wa.eyebrow')}</p>
        <h2 id="connectionDialogTitle" className="m-0 text-[26px] tracking-[-.03em]">
          {title}
        </h2>
        <p className="mt-2 text-sm text-muted">{copy}</p>

        {view.kind === 'qr' && usePhone ? (
          <div className="mt-5 grid gap-3">
            {pairingCode ? (
              <div className="rounded-2xl border border-border bg-white/70 p-5">
                <div
                  aria-label={pairingCode}
                  className="font-mono text-[34px] font-bold tracking-[.18em] text-ink select-all"
                >
                  {pairingCode.length === 8 ? `${pairingCode.slice(0, 4)}-${pairingCode.slice(4)}` : pairingCode}
                </div>
                <p className="mt-2 mb-0 text-xs text-muted">{t('wa.codeNote')}</p>
              </div>
            ) : null}
            <label className="grid gap-1.5 text-left text-[13px] font-semibold">
              {t('wa.phoneLabel')}
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={32}
                value={phone}
                placeholder={t('wa.phonePlaceholder')}
                onChange={(event) => setPhone(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && phone.trim() && !codeBusy) void requestCode();
                }}
              />
            </label>
            {codeError ? <p role="alert" className="m-0 text-left text-xs text-danger">{codeError}</p> : null}
            <Button disabled={codeBusy || phone.replace(/\D/g, '').length < 8} onClick={() => void requestCode()}>
              {codeBusy ? t('wa.requestingCode') : pairingCode ? t('wa.requestCodeAgain') : t('wa.requestCode')}
            </Button>
          </div>
        ) : null}

        {view.kind === 'qr' && view.dataUrl && !usePhone ? (
          <div className="mx-auto mt-5 w-[min(100%,260px)] rounded-2xl bg-white p-3 shadow-sm">
            <img src={view.dataUrl} alt={t('wa.qrAlt')} className="w-full" />
          </div>
        ) : null}

        {view.kind === 'syncing' || view.kind === 'error' ? (
          <div
            className={cn(
              'mt-5 grid gap-2 rounded-2xl border p-5',
              view.kind === 'error' ? 'border-danger/25 bg-danger/6' : 'border-border bg-white/70',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'mx-auto grid size-8 place-items-center rounded-full',
                view.kind === 'error'
                  ? 'bg-danger/12 font-bold text-danger'
                  : 'animate-spin border-2 border-green/25 border-t-green',
              )}
            >
              {view.kind === 'error' ? '!' : ''}
            </span>
            <strong className="text-sm">{view.kind === 'error' ? t('wa.connectionSlow') : t('wa.syncing')}</strong>
            <span className="text-xs text-muted">
              {view.kind === 'error'
                ? view.detail?.trim() || t('wa.connectionSlowCopy')
                : Number.isFinite(view.percent)
                  ? t('wa.syncProgress', { percent: Math.round(view.percent as number) })
                  : view.restoring
                    ? t('wa.usuallyQuick')
                    : t('wa.keepOpen')}
            </span>
          </div>
        ) : null}

        {view.kind === 'qr' && canPair ? (
          <button
            type="button"
            onClick={() => { setUsePhone((on) => !on); setCodeError(''); }}
            className="mt-4 cursor-pointer border-0 bg-transparent p-0 text-[13px] font-bold text-green-dark underline underline-offset-2 hover:text-ink"
          >
            {usePhone ? t('wa.useQr') : t('wa.usePhone')}
          </button>
        ) : null}

        <p className="mt-4 mb-0 font-mono text-[11px] text-muted">
          {view.kind === 'qr' && !usePhone ? view.note : view.kind === 'qr' ? '' : view.kind === 'connected' ? view.account : view.kind === 'error' ? t('wa.refresh') : ''}
        </p>

        {view.kind === 'connected' && canPair ? (
          <button
            type="button"
            disabled={changingNumber}
            onClick={() => void changeNumber()}
            className="mt-4 w-full cursor-pointer rounded-app border border-border bg-white/70 px-4 py-3 text-[13px] font-semibold transition hover:border-green"
          >
            {changingNumber ? t('wa.loggingOut') : t('wa.changeNumber')}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
