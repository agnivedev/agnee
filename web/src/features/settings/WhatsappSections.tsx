import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { FieldGrid, Row, SecretField, SettingCard, StatusLine, TextField } from './parts';

type WaNumber = {
  id: string;
  label?: string | null;
  connectionKey: string;
  phoneNumber?: string | null;
  phase: string;
  isActive: boolean;
};

type CloudNumber = {
  id: string;
  label?: string | null;
  displayPhoneNumber?: string | null;
  phoneNumberId: string;
  status: string;
  isActive: boolean;
};

/**
 * WhatsApp Web numbers (the QR path). The pairing itself happens in the inbox,
 * because that is where the pairing dialog lives — the button here only carries
 * the supervisor to that dialog for the chosen number.
 */
export function WhatsappNumbersSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [numbers, setNumbers] = useState<WaNumber[] | null>(null);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [rotasi, setRotasi] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api<{ numbers: WaNumber[] }>('/v1/whatsapp/numbers');
      setNumbers(data.numbers || []);
    } catch {
      setNumbers(null);
    }
    try {
      const config = await api<{ rotationEnabled?: boolean }>('/v1/admin/company');
      setRotasi(config?.rotationEnabled !== false);
    } catch {
      // Saklarnya tetap tampil menyala: itu perilaku bawaannya, dan gagal
      // membaca setelan bukan alasan menampilkan keadaan yang salah.
    }
  }, []);

  async function ubahRotasi(aktif: boolean) {
    setRotasi(aktif);
    setStatus('');
    try {
      await api('/v1/admin/company', { method: 'PATCH', body: { rotationEnabled: aktif } });
    } catch (error) {
      setRotasi(!aktif);
      setStatus(messageFromError(error, ''));
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  if (!numbers) return null;

  const ready = numbers.filter((number) => number.phase === 'ready').length;

  async function add() {
    setBusy(true);
    setStatus('');
    try {
      await api('/v1/whatsapp/numbers', {
        method: 'POST',
        body: label.trim() ? { label: label.trim() } : {},
      });
      setLabel('');
      setStatus(t('wa.numberAdded'));
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingCard
      id="waNumbersSection"
      eyebrow={t('wa.numbersEyebrow')}
      title={t('wa.numbersTitle')}
      badge={t('wa.numbersConnected', { ready, total: numbers.length })}
      description={t('wa.numbersCopy')}
    >
      {/* Label menyebut apa yang terjadi kalau dicentang, bukan status saat ini —
          sama seperti saklar tindak lanjut. */}
      <label className="mb-1.5 flex items-center gap-2.5 text-[13px] font-semibold">
        <input
          type="checkbox"
          checked={rotasi}
          onChange={(event) => void ubahRotasi(event.target.checked)}
          className="size-4 accent-green"
        />
        <span>{t('wa.rotationEnable')}</span>
      </label>
      <p className="mt-0 mb-4 text-[11px] text-muted">{t('wa.rotationHint')}</p>

      <div className="grid gap-2">
        {numbers.map((number) => (
          <Row key={number.id}>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <strong className="truncate text-[13px]">{number.label || number.connectionKey}</strong>
              <small className="truncate font-mono text-[11px] text-muted">
                {[
                  number.phoneNumber ? number.phoneNumber.replace('@c.us', '') : t('wa.notConnected'),
                  number.phase === 'ready' ? t('wa.phaseReady') : number.phase,
                  number.isActive ? t('wa.inRotation') : t('wa.outOfRotation'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                window.location.href = `/?connect=${encodeURIComponent(number.id)}`;
              }}
            >
              {number.phase === 'ready' ? t('wa.changeNumber') : t('wa.scanQr')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  await api(`/v1/whatsapp/numbers/${number.id}`, {
                    method: 'PATCH',
                    body: { isActive: !number.isActive },
                  });
                  await load();
                } catch (error) {
                  await confirm.error(error);
                }
              }}
            >
              {number.isActive ? t('wa.removeFromRotation') : t('wa.addToRotation')}
            </Button>
            {/* The primary number is the company's WhatsApp identity; the server
                refuses to delete it. */}
            {number.connectionKey !== 'whatsapp-main' ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm.confirm({
                    title: t('wa.deleteNumberTitle'),
                    message: t('wa.deleteNumberCopy'),
                    confirmLabel: t('wa.deleteNumberConfirm'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api(`/v1/whatsapp/numbers/${number.id}`, { method: 'DELETE' });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </Row>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={label}
          maxLength={60}
          placeholder={t('wa.numberLabelPlaceholder')}
          onChange={(event) => setLabel(event.target.value)}
          className="min-h-[38px] max-w-xs py-2"
        />
        <Button size="sm" disabled={busy} onClick={() => void add()}>
          {t('wa.addNumber')}
        </Button>
        <StatusLine>{status}</StatusLine>
      </div>
    </SettingCard>
  );
}

/**
 * Cloud API rotator. The add form stays visible at all times: adding a second
 * and third number is the normal flow, not a repair of a broken connection.
 */
export function CloudApiSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [numbers, setNumbers] = useState<CloudNumber[]>([]);
  const [status, setStatus] = useState('');
  const [connecting, setConnecting] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ numbers: CloudNumber[] }>('/v1/whatsapp/cloud-api/numbers');
      setNumbers(data.numbers || []);
    } catch {
      setNumbers([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const element = event.currentTarget;
    setConnecting(true);
    setStatus(t('wa.connecting'));
    try {
      await api('/v1/whatsapp/cloud-api/connect', {
        method: 'POST',
        body: {
          phoneNumberId: String(form.get('phoneNumberId') || '').trim(),
          wabaId: String(form.get('wabaId') || '').trim(),
          accessToken: String(form.get('accessToken') || '').trim(),
          appSecret: String(form.get('appSecret') || '').trim(),
          ...(String(form.get('label') || '').trim() ? { label: String(form.get('label')).trim() } : {}),
        },
      });
      setStatus('');
      // Clear the credentials so the next number is not submitted with the
      // previous number's token.
      element.reset();
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setConnecting(false);
    }
  }

  const active = numbers.filter((number) => number.isActive).length;

  return (
    <SettingCard
      id="waCloudSection"
      eyebrow={t('wa.cloudEyebrow')}
      title={t('wa.cloudTitle')}
      badge={numbers.length ? t('wa.cloudActive', { count: active }) : t('wa.notConnected')}
      badgeTone={numbers.length ? 'on' : 'off'}
      description={t('wa.cloudCopy')}
    >
      {numbers.length ? (
        <div className="mb-5 grid gap-2">
          {numbers.map((number) => (
            <Row key={number.id}>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <strong className="truncate text-[13px]">
                  {number.label || number.displayPhoneNumber || number.phoneNumberId}
                </strong>
                <small className="truncate font-mono text-[11px] text-muted">
                  {[
                    number.displayPhoneNumber && number.label ? number.displayPhoneNumber : '',
                    number.isActive ? t('wa.inRotation') : t('wa.outOfRotation'),
                    number.status === 'connected' ? '' : `status: ${number.status}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await api(`/v1/whatsapp/cloud-api/numbers/${number.id}`, {
                      method: 'PATCH',
                      body: { isActive: !number.isActive },
                    });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {number.isActive ? t('wa.removeFromRotation') : t('wa.addToRotation')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const ok = await confirm.confirm({
                    title: t('wa.deleteNumberTitle'),
                    message: t('wa.deleteCloudNumberCopy'),
                    confirmLabel: t('wa.deleteNumberConfirm'),
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api(`/v1/whatsapp/cloud-api/numbers/${number.id}`, { method: 'DELETE' });
                    await load();
                  } catch (error) {
                    await confirm.error(error);
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </Row>
          ))}
          <p className="m-0 text-[12px] text-muted">
            {t('wa.webhookUrl')}{' '}
            <code className="rounded bg-ink/6 px-1.5 py-0.5 font-mono text-[11px]">
              {`${window.location.origin}/webhook/meta`}
            </code>
          </p>
        </div>
      ) : null}

      <form onSubmit={connect} autoComplete="off">
        <FieldGrid>
          <TextField label={t('wa.cloudLabel')} name="label" maxLength={60} placeholder="CS 1 / Sales / Jakarta" />
          <TextField label={t('wa.phoneNumberId')} name="phoneNumberId" required maxLength={64} placeholder="1234567890123456" />
          <TextField label={t('wa.wabaId')} name="wabaId" required maxLength={64} placeholder="1067460402672812" />
          <SecretField label={t('wa.accessToken')} name="accessToken" required minLength={10} maxLength={512} placeholder="EAABsbCS..." />
          <SecretField label={t('wa.appSecret')} name="appSecret" required minLength={10} maxLength={256} placeholder="abc123..." />
        </FieldGrid>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" size="sm" disabled={connecting}>
            {t('wa.connectCloud')}
          </Button>
          <StatusLine>{status}</StatusLine>
        </div>
      </form>

      {numbers.length ? (
        <Button
          size="sm"
          variant="danger"
          className="mt-4"
          onClick={async () => {
            const ok = await confirm.confirm({
              title: t('dialog.disconnectCloudTitle'),
              message: t('dialog.disconnectCloudCopy'),
              confirmLabel: t('dialog.disconnectCloudConfirm'),
              danger: true,
            });
            if (!ok) return;
            try {
              await api('/v1/whatsapp/cloud-api/connect', { method: 'DELETE' });
              setNumbers([]);
            } catch (error) {
              await confirm.error(error);
            }
          }}
        >
          {t('wa.disconnectCloud')}
        </Button>
      ) : null}
    </SettingCard>
  );
}
