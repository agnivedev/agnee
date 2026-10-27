import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Field, FieldGrid, Row, SelectField, SettingCard, StatusLine, TextField } from './parts';

export type CompanyLocation = {
  id: string;
  name: string;
  kind: 'store' | 'warehouse';
  address: string;
  lat: number;
  lng: number;
  mapsUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  openingHours: string | null;
  openToCustomers: boolean;
  isPickup: boolean;
  notes: string | null;
};

/**
 * Toko dan gudang company. Bukan integrasi: satu daftar alamat yang dipakai
 * Lalamove sebagai titik jemput, dan fitur lain kelak (AI menyebut alamat,
 * toko terdekat). Titik peta wajib, dari link Google Maps atau koordinat.
 */
export function LocationsSection() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [loaded, setLoaded] = useState(false);
  // null = form tertutup, 'new' = tambah, selain itu id lokasi yang diubah.
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ locations: CompanyLocation[] }>('/v1/locations');
      setLocations(data.locations || []);
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const current = editing && editing !== 'new' ? locations.find((l) => l.id === editing) : undefined;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (key: string) => String(form.get(key) || '').trim();
    const place = value('place');
    setBusy(true);
    setStatus(place ? t('locations.reading') : '');
    try {
      await api(current ? `/v1/locations/${current.id}` : '/v1/locations', {
        method: current ? 'PUT' : 'POST',
        body: {
          name: value('name'),
          kind: value('kind') || 'store',
          ...(place || !current ? { place } : {}),
          address: value('address'),
          contactName: value('contactName'),
          contactPhone: value('contactPhone'),
          openingHours: value('openingHours'),
          notes: value('notes'),
          openToCustomers: form.get('openToCustomers') === 'on',
          isPickup: form.get('isPickup') === 'on',
        },
      });
      setStatus('');
      setEditing(null);
      await load();
    } catch (error) {
      setStatus(messageFromError(error, ''));
    } finally {
      setBusy(false);
    }
  }

  async function makePickup(location: CompanyLocation) {
    try {
      await api(`/v1/locations/${location.id}`, { method: 'PUT', body: { name: location.name, kind: location.kind, isPickup: true } });
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  async function remove(location: CompanyLocation) {
    const ok = await confirm.confirm({
      title: t('locations.deleteTitle', { name: location.name }),
      message: location.isPickup ? t('locations.deletePickupCopy') : t('locations.deleteCopy'),
      confirmLabel: t('locations.delete'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/v1/locations/${location.id}`, { method: 'DELETE' });
      if (editing === location.id) setEditing(null);
      await load();
    } catch (error) {
      await confirm.error(error);
    }
  }

  const form = editing ? (
    // key: form tak terkendali, jadi berganti lokasi harus memasang ulang nilai awalnya.
    <form key={editing} onSubmit={save} autoComplete="off" className="mt-3 rounded-xl border border-border bg-white/40 p-4">
      <h3 className="m-0 mb-3 text-[15px]">{current ? t('locations.editTitle', { name: current.name }) : t('locations.addTitle')}</h3>
      <FieldGrid>
        <TextField label={t('locations.name')} name="name" required maxLength={120} defaultValue={current?.name} placeholder={t('locations.namePlaceholder')} />
        <SelectField
          label={t('locations.kind')}
          name="kind"
          defaultValue={current?.kind ?? 'store'}
          onChange={(event) => {
            // Lokasi baru: gudang bawaannya tidak menerima kunjungan. Yang sudah ada tidak diubah diam-diam.
            if (current) return;
            const box = event.currentTarget.form?.elements.namedItem('openToCustomers');
            if (box instanceof HTMLInputElement) box.checked = event.currentTarget.value === 'store';
          }}
        >
          <option value="store">{t('locations.kind.store')}</option>
          <option value="warehouse">{t('locations.kind.warehouse')}</option>
        </SelectField>
        <TextField
          label={t('locations.place')}
          name="place"
          required={!current}
          maxLength={600}
          placeholder={t('locations.placePlaceholder')}
          hint={current ? t('locations.placeNow', { coords: `${current.lat},${current.lng}` }) : t('locations.placeHint')}
          className="md:col-span-2"
        />
        <TextField
          label={t('locations.address')}
          name="address"
          maxLength={500}
          defaultValue={current?.address}
          hint={t('locations.addressHint')}
          className="md:col-span-2"
        />
        <TextField label={t('locations.contactName')} name="contactName" maxLength={120} defaultValue={current?.contactName ?? ''} />
        <TextField
          label={t('locations.contactPhone')}
          name="contactPhone"
          inputMode="tel"
          maxLength={30}
          defaultValue={current?.contactPhone ?? ''}
          placeholder="081234567890"
          hint={t('locations.contactHint')}
        />
        <TextField
          label={t('locations.hours')}
          name="openingHours"
          maxLength={300}
          defaultValue={current?.openingHours ?? ''}
          placeholder={t('locations.hoursPlaceholder')}
          className="md:col-span-2"
        />
        <Field label={t('locations.notes')} className="md:col-span-2">
          <textarea
            name="notes"
            maxLength={1000}
            rows={2}
            defaultValue={current?.notes ?? ''}
            placeholder={t('locations.notesPlaceholder')}
            className="w-full rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm font-normal outline-none focus:border-green"
          />
        </Field>
      </FieldGrid>
      <div className="mt-4 grid gap-2.5">
        <label className="flex items-start gap-2.5 text-[13px]">
          <input type="checkbox" name="openToCustomers" defaultChecked={current ? current.openToCustomers : true} className="mt-0.5 size-4 accent-green" />
          <span className="grid gap-0.5">
            <strong>{t('locations.openToCustomers')}</strong>
            <small className="text-[12px] text-muted">{t('locations.openToCustomersHint')}</small>
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-[13px]">
          <input
            type="checkbox"
            name="isPickup"
            defaultChecked={current ? current.isPickup : locations.length === 0}
            className="mt-0.5 size-4 accent-green"
          />
          <span className="grid gap-0.5">
            <strong>{t('locations.isPickup')}</strong>
            <small className="text-[12px] text-muted">{t('locations.isPickupHint')}</small>
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={busy}>{t('common.save')}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(null); setStatus(''); }}>
          {t('locations.cancel')}
        </Button>
        <StatusLine tone={busy ? 'muted' : 'error'}>{status}</StatusLine>
      </div>
    </form>
  ) : null;

  return (
    <SettingCard id="locationsSection" eyebrow={t('locations.eyebrow')} title={t('locations.title')} description={t('locations.copy')}>
      {loaded && !locations.length && !editing ? (
        <p className="m-0 mb-3 text-[13px] text-muted">{t('locations.empty')}</p>
      ) : null}
      <div className="grid gap-2">
        {locations.map((location) => (
          <div key={location.id}>
            <Row className="items-start">
              {/* Lebar minimum: di ponsel tombol turun ke baris berikutnya, bukan menindih nama. */}
              <span className="grid min-w-[14rem] flex-1 gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <strong className="text-[14px]">{location.name}</strong>
                  <span className="rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[10px] font-semibold">
                    {t(`locations.kind.${location.kind}`)}
                  </span>
                  {location.isPickup ? (
                    <span className="rounded-full bg-green/14 px-2 py-0.5 font-mono text-[10px] font-semibold text-green-dark">
                      {t('locations.pickupBadge')}
                    </span>
                  ) : null}
                  {!location.openToCustomers ? (
                    <span className="rounded-full bg-ink/8 px-2 py-0.5 font-mono text-[10px] font-semibold text-muted">
                      {t('locations.closedBadge')}
                    </span>
                  ) : null}
                </span>
                <small className="text-[12px] leading-[1.5]">{location.address}</small>
                {location.openingHours ? <small className="text-[12px] text-muted">{location.openingHours}</small> : null}
                {location.contactName || location.contactPhone ? (
                  <small className="text-[12px] text-muted">
                    {[location.contactName, location.contactPhone ? `+${location.contactPhone}` : null].filter(Boolean).join(' · ')}
                  </small>
                ) : null}
                <a
                  href={location.mapsUrl || `https://www.google.com/maps?q=${location.lat},${location.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-fit text-[12px] font-semibold text-green-dark underline-offset-2 hover:underline"
                >
                  {t('locations.openMap')}
                </a>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {!location.isPickup ? (
                  <Button size="sm" variant="outline" onClick={() => void makePickup(location)}>{t('locations.makePickup')}</Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => { setEditing(location.id); setStatus(''); }}>{t('locations.edit')}</Button>
                <Button size="sm" variant="ghost" onClick={() => void remove(location)}>{t('locations.delete')}</Button>
              </span>
            </Row>
            {editing === location.id ? form : null}
          </div>
        ))}
      </div>
      {editing === 'new' ? form : null}
      {!editing ? (
        <Button size="sm" className="mt-3" onClick={() => { setEditing('new'); setStatus(''); }}>
          {t('locations.add')}
        </Button>
      ) : null}
    </SettingCard>
  );
}
