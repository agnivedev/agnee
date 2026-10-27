import { useCallback, useEffect, useRef, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useConfirm } from '@/components/ui/confirm';
import { rupiah } from '@/features/catalog/types';

type Order = {
  id: string;
  orderId: string;
  environment: 'sandbox' | 'production';
  serviceType: string;
  status: string;
  shareLink: string | null;
  total: number | null;
  dropoffAddress: string | null;
  recipientName: string;
};
type DeliveryInfo = {
  available: boolean;
  environment?: 'sandbox' | 'production';
  vehicles: { key: string; description: string }[];
  defaultService: string | null;
  pickups: { id: string; name: string; isPickup: boolean; hasContact: boolean }[];
  orders: Order[];
};
type Quote = {
  quotationId: string;
  total: number;
  serviceType: string;
  distanceKm: number | null;
  pickupName: string;
  dropoffAddress: string;
  environment: 'sandbox' | 'production';
};

const FINAL = new Set(['COMPLETED', 'CANCELED', 'REJECTED', 'EXPIRED']);

/** Nomor dari id chat WhatsApp biasa (62xxx@c.us); id @lid bukan nomor telepon. */
function phoneOfChat(chatId: string): string {
  const match = /^(\d{8,15})@c\.us$/.exec(chatId);
  return match ? `0${match[1].replace(/^62/, '')}` : '';
}

/**
 * Pesan kurir Lalamove dari percakapan: hitung ongkir ke titik customer,
 * konfirmasi, pesan, lalu pantau atau batalkan. Link pelacakan disisipkan ke
 * kotak balasan; agen yang mengirimnya ke customer.
 */
export function DeliveryMenu({ chatId, onInsert }: { chatId: string; onInsert: (text: string) => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<DeliveryInfo | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const base = `/v1/chats/${encodeURIComponent(chatId)}/delivery`;

  const load = useCallback(async () => {
    try {
      setInfo(await api<DeliveryInfo>(base));
    } catch (error) {
      setMessage(messageFromError(error, ''));
    }
  }, [base]);

  useEffect(() => {
    setQuote(null);
    setMessage('');
    setInfo(null);
    setOpen(false);
  }, [chatId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function getQuote(form: FormData) {
    setBusy(true);
    setMessage('');
    setQuote(null);
    try {
      const vehicle = String(form.get('vehicle') || '');
      const locationId = String(form.get('locationId') || '');
      setQuote(
        await api<Quote>(`${base}/quote`, {
          method: 'POST',
          body: {
            destination: String(form.get('destination') || '').trim(),
            ...(vehicle ? { vehicle } : {}),
            ...(locationId ? { locationId } : {}),
          },
        }),
      );
    } catch (error) {
      setMessage(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(form: FormData) {
    if (!quote) return;
    const sandbox = quote.environment === 'sandbox';
    const ok = await confirm.confirm({
      title: t('delivery.confirmTitle'),
      message: t(sandbox ? 'delivery.confirmSandbox' : 'delivery.confirmProduction', {
        price: rupiah(quote.total),
        from: quote.pickupName,
      }),
      confirmLabel: t('delivery.order'),
      danger: !sandbox,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api(`${base}/orders`, {
        method: 'POST',
        body: {
          quotationId: quote.quotationId,
          recipientName: String(form.get('recipientName') || '').trim(),
          recipientPhone: String(form.get('recipientPhone') || '').trim(),
          confirmed: true,
        },
      });
      setQuote(null);
      setMessage(t('delivery.ordered'));
      await load();
    } catch (error) {
      setMessage(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(order: Order) {
    const ok = await confirm.confirm({
      title: t('delivery.cancelTitle'),
      message: t('delivery.cancelCopy', { id: order.orderId }),
      confirmLabel: t('delivery.cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`${base}/orders/${order.id}/cancel`, { method: 'POST' });
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  const input = 'h-9 w-full rounded-[10px] border border-border bg-white px-3 text-[13px] outline-none';
  const button = 'h-9 cursor-pointer rounded-[10px] border-0 bg-green-dark px-3 text-xs font-bold text-white disabled:opacity-50';

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('delivery.open')}
        aria-expanded={open}
        className="size-[38px] cursor-pointer rounded-xl border-0 bg-transparent text-lg text-muted"
      >
        🚚
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 grid max-h-[70vh] w-[min(380px,calc(100vw-2rem))] gap-3 overflow-y-auto rounded-panel border border-border bg-white p-3 shadow-[0_14px_35px_rgba(28,50,42,.16)]">
          {info && !info.available ? <p className="m-0 text-xs text-muted">{t('delivery.notConnected')}</p> : null}
          {info?.available ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[13px]">{t('delivery.title')}</strong>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${info.environment === 'sandbox' ? 'bg-amber-100 text-amber-900' : 'bg-green/14 text-green-dark'}`}>
                  {info.environment === 'sandbox' ? t('delivery.sandbox') : t('delivery.production')}
                </span>
              </div>
              <form
                className="grid gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void getQuote(new FormData(event.currentTarget));
                }}
              >
                <input name="destination" required maxLength={600} placeholder={t('delivery.destination')} className={input} />
                {info.pickups.length > 1 ? (
                  <select name="locationId" defaultValue={info.pickups.find((p) => p.isPickup)?.id} className={input}>
                    {info.pickups.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : null}
                {info.vehicles.length ? (
                  <select name="vehicle" defaultValue={info.defaultService || ''} className={input}>
                    {info.vehicles.map((v) => (
                      <option key={v.key} value={v.key}>{v.description || v.key}</option>
                    ))}
                  </select>
                ) : null}
                <button type="submit" disabled={busy} className={button}>{t('delivery.getQuote')}</button>
              </form>
              {quote ? (
                <form
                  className="grid gap-2 rounded-[12px] bg-ink/[.045] p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void placeOrder(new FormData(event.currentTarget));
                  }}
                >
                  <strong className="text-[15px]">{rupiah(quote.total)}</strong>
                  <span className="text-xs text-muted">
                    {quote.serviceType}{quote.distanceKm !== null ? ` · ${quote.distanceKm} km` : ''} · {quote.pickupName} → {quote.dropoffAddress}
                  </span>
                  <input name="recipientName" required maxLength={120} placeholder={t('delivery.recipientName')} className={input} />
                  <input name="recipientPhone" required maxLength={30} defaultValue={phoneOfChat(chatId)} placeholder={t('delivery.recipientPhone')} className={input} />
                  <button type="submit" disabled={busy} className={button}>{t('delivery.order')}</button>
                </form>
              ) : null}
              {info.orders.length ? (
                <div className="grid gap-2">
                  <strong className="text-[12px] text-muted">{t('delivery.orders')}</strong>
                  {info.orders.map((order) => (
                    <div key={order.id} className="grid gap-1 rounded-[10px] border border-border p-2 text-xs">
                      <span>
                        <strong>{t(`delivery.status.${order.status}`) !== `delivery.status.${order.status}` ? t(`delivery.status.${order.status}`) : order.status}</strong>
                        {order.total !== null ? ` · ${rupiah(order.total)}` : ''} · {order.serviceType}
                        {order.environment === 'sandbox' ? ` · ${t('delivery.sandbox')}` : ''}
                      </span>
                      <span className="truncate text-muted">{order.recipientName} · {order.dropoffAddress}</span>
                      <span className="flex gap-2">
                        {order.shareLink ? (
                          <button
                            type="button"
                            className="cursor-pointer rounded-[8px] border-0 bg-ink/6 px-2 py-1 text-[11px] font-bold"
                            onClick={() => { onInsert(t('delivery.trackingText', { link: order.shareLink || '' })); setOpen(false); }}
                          >
                            {t('delivery.insertLink')}
                          </button>
                        ) : null}
                        {!FINAL.has(order.status) ? (
                          <button type="button" className="cursor-pointer rounded-[8px] border-0 bg-ink/6 px-2 py-1 text-[11px] font-bold text-danger" onClick={() => void cancel(order)}>
                            {t('delivery.cancel')}
                          </button>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {message ? <p role="status" className="m-0 text-xs text-danger">{message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
