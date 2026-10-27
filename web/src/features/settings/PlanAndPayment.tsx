import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { QuotaBar } from '@/components/QuotaBar';
import { planLabel } from '@/lib/plan';
import { Field, FieldGrid, SavedBadge, SettingCard, TextField, useSavedFlag } from './parts';

type Company = {
  plan?: string;
  planStatus?: string;
  aiMessageLimit?: number;
  aiMessageCount?: number;
  trialEndsAt?: string | null;
  maxUsers?: number;
  maxWhatsapp?: number;
  usage?: { currentUsers?: number; currentWhatsapp?: number };
  creditMode?: boolean;
  knowledgeClient?: string;
  paymentMethod?: string;
  paymentLink?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  paymentNotes?: string;
  paymentProofCheck?: boolean;
};


type PaymentAccount = {
  id: string; bankName: string; accountNumber: string; accountHolder: string | null; status: 'active' | 'retired';
};

/** Rekening resmi + saklar pemeriksaan bukti transfer. Rekening aktif diberikan AI saat closing. */
function PaymentAccountsCard({ proofCheck, onProofCheck }: { proofCheck: boolean; onProofCheck: (on: boolean) => void }) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [bank, setBank] = useState('');
  const [number, setNumber] = useState('');
  const [holder, setHolder] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<{ accounts: PaymentAccount[] }>('/v1/payment-accounts').then((d) => setAccounts(d.accounts)).catch(() => { /* kartu tetap tampil kosong */ });
  useEffect(() => { void load(); }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); await load(); } catch (error) { await confirm.error(error); } finally { setBusy(false); }
  }
  const add = () => run(async () => {
    await api('/v1/payment-accounts', { method: 'POST', body: { bankName: bank.trim(), accountNumber: number.trim(), accountHolder: holder.trim() } });
    setBank(''); setNumber(''); setHolder('');
  });
  const setStatus = (a: PaymentAccount, status: 'active' | 'retired') => run(() => api(`/v1/payment-accounts/${a.id}`, {
    method: 'PUT', body: { bankName: a.bankName, accountNumber: a.accountNumber, accountHolder: a.accountHolder || '', status },
  }));
  const remove = (a: PaymentAccount) => run(() => api(`/v1/payment-accounts/${a.id}`, { method: 'DELETE' }));
  const toggleProof = (on: boolean) => run(async () => {
    await api('/v1/admin/company', { method: 'PATCH', body: { paymentProofCheck: on } });
    onProofCheck(on);
  });

  return (
    <SettingCard id="accountsSection" eyebrow={t('settings.paymentEyebrow')} title={t('settings.accountsTitle')}>
      <p className="mb-3 text-[13px] text-muted">{t('settings.accountsHint')}</p>
      {accounts.length === 0 ? <p className="mb-3 text-[13px] text-muted">{t('settings.accountsEmpty')}</p> : (
        <ul className="mb-4 divide-y divide-input rounded-app border border-input">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className={a.status === 'retired' ? 'text-muted line-through' : ''}>
                <strong>{a.bankName}</strong> {a.accountNumber}{a.accountHolder ? ` · a.n. ${a.accountHolder}` : ''}
                {a.status === 'retired' ? <em className="ml-2 text-[12px] not-italic">({t('settings.accountRetired')})</em> : null}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus(a, a.status === 'active' ? 'retired' : 'active')}>
                  {a.status === 'active' ? t('settings.accountRetire') : t('settings.accountReactivate')}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove(a)}>{t('settings.accountDelete')}</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <FieldGrid>
        <TextField label={t('settings.accountBank')} maxLength={60} value={bank} placeholder="BCA" onChange={(e) => setBank(e.target.value)} />
        <TextField label={t('settings.accountNumber')} maxLength={40} value={number} placeholder="172 172 6989" onChange={(e) => setNumber(e.target.value)} />
        <TextField label={t('settings.accountHolder')} maxLength={100} value={holder} placeholder="PT Nama Perusahaan" onChange={(e) => setHolder(e.target.value)} />
      </FieldGrid>
      <div className="mt-3">
        <Button size="sm" disabled={busy || !bank.trim() || !number.trim()} onClick={() => void add()}>{t('settings.accountAdd')}</Button>
      </div>
      <label className="mt-5 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={proofCheck} disabled={busy} onChange={(e) => void toggleProof(e.target.checked)} />
        <span>
          <strong>{t('settings.proofCheckLabel')}</strong>
          <span className="block text-[13px] text-muted">{t('settings.proofCheckHint')}</span>
        </span>
      </label>
    </SettingCard>
  );
}

type PaymentMethod = 'none' | 'link' | 'bank_transfer' | 'both';

type CreditInfo = {
  creditMode: boolean;
  planLabel?: string;
  planBalance?: number;
  topupBalance?: number;
  total?: number;
  periodEnd?: string | null;
  lastGrant?: number;
  alertPercents?: number[];
  ledger?: { id: number; kind: string; amount: number; note: string | null; createdAt: string }[];
};

const LEDGER_KIND: Record<string, string> = {
  subscription: 'Langganan', topup: 'Top-up', usage: 'Pemakaian AI', adjust: 'Koreksi', expire: 'Hangus',
};

/** Saldo credit company ini. Tidak menampilkan model atau harga model. */
function CreditBalance() {
  const { dateLocale } = useI18n();
  const [info, setInfo] = useState<CreditInfo | null>(null);
  useEffect(() => {
    void api<CreditInfo>('/v1/admin/credit').then(setInfo).catch(() => { /* kartu tetap tampil tanpa saldo */ });
  }, []);
  if (!info?.creditMode) return null;
  const fmt = new Intl.NumberFormat(dateLocale);
  const total = info.total ?? 0;
  const lowLine = (info.lastGrant ?? 0) * ((info.alertPercents?.[0] ?? 20) / 100);
  const state = total <= 0 ? 'habis' : total <= lowLine ? 'hampir habis' : null;
  return (
    <div className="mb-5 rounded-app border border-input p-4">
      <p className="mb-1.5 font-mono text-[10px] tracking-[.1em] text-muted uppercase">Credit AI</p>
      <p className="m-0 text-2xl font-semibold">{fmt.format(Math.round(total))}</p>
      <p className="mt-1 mb-0 text-[13px] text-muted">
        Paket {fmt.format(Math.round(info.planBalance ?? 0))} · Top-up {fmt.format(Math.round(info.topupBalance ?? 0))}
        {info.periodEnd ? ` · periode sampai ${new Date(info.periodEnd).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' })}` : ''}
      </p>
      {state ? (
        <p className="mt-2 mb-0 text-[13px] font-semibold text-danger">
          {state === 'habis'
            ? 'Credit habis, AI berhenti membalas. Hubungi tim Agnee untuk top-up.'
            : 'Credit hampir habis. Top-up sebelum habis agar AI tidak berhenti.'}
        </p>
      ) : null}
      {info.ledger?.length ? (
        <ul className="mt-3 mb-0 grid gap-1 p-0 text-[12px] text-muted">
          {info.ledger.slice(0, 8).map((row) => (
            <li key={row.id} className="flex justify-between gap-3 list-none">
              <span>{new Date(row.createdAt).toLocaleDateString(dateLocale)} · {LEDGER_KIND[row.kind] || row.kind}</span>
              <span className="font-mono">{row.amount > 0 ? '+' : ''}{fmt.format(Math.round(row.amount * 100) / 100)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function PlanAndPayment() {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [company, setCompany] = useState<Company | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('none');
  const [link, setLink] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankHolder, setBankHolder] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const { saved, flash } = useSavedFlag();

  useEffect(() => {
    void api<Company>('/v1/admin/company')
      .then((data) => {
        setCompany(data);
        setMethod((data.paymentMethod as PaymentMethod) || 'none');
        setLink(data.paymentLink || '');
        setBankName(data.bankName || '');
        setBankAccount(data.bankAccount || '');
        setBankHolder(data.bankHolder || '');
        setNotes(data.paymentNotes || '');
      })
      .catch(() => {
        /* the session guard above already handles a signed-out state */
      });
  }, []);

  // Plafon 0 berarti tanpa batas — bukan 500 seperti tebakan lama di sini.
  const limit = company?.aiMessageLimit ?? 0;
  const count = company?.aiMessageCount ?? 0;
  const plan = planLabel(company?.plan);
  const { dateLocale } = useI18n();
  const trialEnds = company?.planStatus === 'trial' && company.trialEndsAt
    ? new Date(company.trialEndsAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // 'both' shows both groups at once — a company may take a checkout link and a
  // bank transfer side by side.
  const usesLink = method === 'link' || method === 'both';
  const usesBank = method === 'bank_transfer' || method === 'both';

  async function savePayment() {
    setSaving(true);
    try {
      await api('/v1/admin/company', {
        method: 'PATCH',
        body: {
          paymentMethod: method,
          // Checking against 'link'/'bank_transfer' exactly would save both
          // groups empty whenever the supervisor picks "both".
          paymentLink: usesLink ? link.trim() : '',
          bankName: usesBank ? bankName.trim() : '',
          bankAccount: usesBank ? bankAccount.trim() : '',
          bankHolder: usesBank ? bankHolder.trim() : '',
          paymentNotes: notes.trim(),
        },
      });
      flash();
    } catch (error) {
      await confirm.error(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingCard
        id="planSection"
        eyebrow={t('settings.planEyebrow')}
        title={t('settings.planTitle')}
        badge={`${plan} · ${company?.planStatus || 'beta'}`}
      >
        {/* Hanya-baca: paket dan plafonnya diubah tim Agnee dari konsol
            platform. Semua plafon tampil di sini, bukan cuma kuota AI. */}
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="mb-1.5 font-mono text-[10px] tracking-[.1em] text-muted uppercase">{t('settings.quotaAi')}</p>
            <QuotaBar used={count} limit={limit} />
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10px] tracking-[.1em] text-muted uppercase">{t('settings.quotaUsers')}</p>
            <QuotaBar used={company?.usage?.currentUsers ?? 0} limit={company?.maxUsers ?? 0} />
          </div>
          <div>
            <p className="mb-1.5 font-mono text-[10px] tracking-[.1em] text-muted uppercase">{t('settings.quotaWhatsapp')}</p>
            <QuotaBar used={company?.usage?.currentWhatsapp ?? 0} limit={company?.maxWhatsapp ?? 0} />
          </div>
        </div>
        {company?.creditMode ? <CreditBalance /> : null}
        {trialEnds ? <p className="mb-4 text-[13px] text-muted">{t('settings.trialEndsOn', { date: trialEnds })}</p> : null}

        <FieldGrid>
          <TextField label={t('settings.knowledgeClient')} value={company?.knowledgeClient || '—'} disabled readOnly />
        </FieldGrid>
      </SettingCard>

      <SettingCard id="paymentSection" eyebrow={t('settings.paymentEyebrow')} title={t('settings.paymentTitle')}>
        <FieldGrid>
          <Field label={t('settings.paymentMethod')}>
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as PaymentMethod)}
              className="w-full rounded-app border border-input bg-white/60 px-3 py-2.5 text-sm outline-none focus:border-green"
            >
              <option value="none">{t('settings.paymentNone')}</option>
              <option value="link">{t('settings.paymentLinkOption')}</option>
              <option value="bank_transfer">{t('settings.paymentBankOption')}</option>
              <option value="both">{t('settings.paymentBothOption')}</option>
            </select>
          </Field>

          {usesLink ? (
            <TextField
              label={t('settings.paymentLinkLabel')}
              type="url"
              maxLength={500}
              value={link}
              placeholder="https://app.mayar.id/pl/..."
              onChange={(event) => setLink(event.target.value)}
            />
          ) : null}

          {usesBank ? (
            <>
              <TextField
                label={t('settings.bankName')}
                maxLength={100}
                value={bankName}
                placeholder="BCA / BRI / Mandiri"
                onChange={(event) => setBankName(event.target.value)}
              />
              <TextField
                label={t('settings.bankAccount')}
                maxLength={50}
                value={bankAccount}
                placeholder="1234567890"
                onChange={(event) => setBankAccount(event.target.value)}
              />
              <TextField
                label={t('settings.bankHolder')}
                maxLength={100}
                value={bankHolder}
                placeholder="PT Nama Perusahaan"
                onChange={(event) => setBankHolder(event.target.value)}
              />
            </>
          ) : null}

          <TextField
            label={t('settings.paymentNotes')}
            maxLength={500}
            value={notes}
            placeholder={t('settings.paymentNotesPlaceholder')}
            onChange={(event) => setNotes(event.target.value)}
            className="md:col-span-2"
          />
        </FieldGrid>

        <div className="mt-4 flex items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => void savePayment()}>
            {t('settings.savePayment')}
          </Button>
          <SavedBadge shown={saved} />
        </div>
      </SettingCard>
      <PaymentAccountsCard
        proofCheck={Boolean(company?.paymentProofCheck)}
        onProofCheck={(on) => setCompany((prev) => ({ ...(prev || {}), paymentProofCheck: on }))}
      />
    </>
  );
}
