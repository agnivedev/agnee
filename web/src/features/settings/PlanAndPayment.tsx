import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';
import { Field, FieldGrid, SavedBadge, SettingCard, TextField, useSavedFlag } from './parts';

type Company = {
  plan?: string;
  planStatus?: string;
  aiMessageLimit?: number;
  aiMessageCount?: number;
  limits?: { aiMessages?: number };
  counts?: { aiMessages?: number };
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

  const limit = company?.aiMessageLimit ?? company?.limits?.aiMessages ?? 500;
  const count = company?.aiMessageCount ?? company?.counts?.aiMessages ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((count / limit) * 100)) : 0;
  const plan = company?.plan === 'company' ? 'Company' : 'Personal';

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
        {limit > 0 ? (
          <div className="mb-5">
            <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] text-muted">
              <span>{t('settings.usageText', { count: count.toLocaleString(), limit: limit.toLocaleString() })}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-ink/8">
              <div
                className={cn(
                  'h-full rounded-full transition-[width] duration-500',
                  pct >= 90 ? 'bg-danger' : pct >= 70 ? 'bg-[#d59b34]' : 'bg-green',
                  // Width comes from one of eleven fixed classes rather than an
                  // inline style: the CSP forbids style attributes.
                  WIDTH_CLASSES[Math.round(pct / 10)],
                )}
              />
            </div>
          </div>
        ) : null}

        <FieldGrid>
          <TextField label={t('settings.knowledgeClient')} value={company?.knowledgeClient || '—'} disabled readOnly />
          <TextField label={t('settings.aiLimit')} value={String(limit)} disabled readOnly />
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

// Tailwind needs literal class names; a computed `w-[${pct}%]` is never emitted.
const WIDTH_CLASSES = [
  'w-0',
  'w-[10%]',
  'w-[20%]',
  'w-[30%]',
  'w-[40%]',
  'w-[50%]',
  'w-[60%]',
  'w-[70%]',
  'w-[80%]',
  'w-[90%]',
  'w-full',
];
