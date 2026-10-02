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
  knowledgeClient?: string;
  paymentMethod?: string;
  paymentLink?: string;
  bankName?: string;
  bankAccount?: string;
  bankHolder?: string;
  paymentNotes?: string;
};

type PaymentMethod = 'none' | 'link' | 'bank_transfer' | 'both';

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
  const { locale } = useI18n();
  const trialEnds = company?.planStatus === 'trial' && company.trialEndsAt
    ? new Date(company.trialEndsAt).toLocaleDateString(locale === 'en' ? 'en-GB' : 'id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
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
    </>
  );
}
