import { useCallback, useEffect, useState } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { SettingCard, StatusLine } from './parts';

type AuditEntry = {
  id: number;
  action: string;
  entityId: string | null;
  metadata: {
    phone?: string | null;
    contactName?: string | null;
    format?: string | null;
    rows?: number | null;
    fields?: string[] | null;
    email?: string | null;
    role?: string | null;
    integration?: string | null;
    label?: string | null;
    name?: string | null;
    recipients?: number | null;
    sent?: number | null;
    connections?: number | null;
    trial?: boolean | null;
    imported?: number | null;
  } | null;
  createdAt: string;
  actorName: string | null;
};

/**
 * Tindakan yang dicatat, untuk penyaring di bawah. Urutannya sengaja dari yang
 * paling sering ditanyakan supervisor.
 */
const AUDIT_ACTIONS = [
  'contacts.exported',
  'contacts.file_imported',
  'lead.open_in_whatsapp',
  'payment.changed',
  'whatsapp.disconnected',
  'whatsapp.mode_changed',
  'agent_mode.instructions_saved',
  'team.member_added',
  'team.role_changed',
  'team.member_updated',
  'team.member_removed',
  'department.created',
  'department.updated',
  'department.deleted',
  'department.members_set',
  'department.question_answered',
  'third_party.created',
  'third_party.updated',
  'third_party.deleted',
  'template.saved',
  'template.applied',
  'template.deleted',
  'integration.connected',
  'integration.disconnected',
  'contacts.import_started',
  'broadcast.started',
  'broadcast.cancelled',
  'broadcast.opt_out_removed',
  'report.schedule_changed',
  'report.template_changed',
  'delivery.order_placed',
  'delivery.order_canceled',
  'promo.created',
  'promo.updated',
  'promo.enabled',
  'promo.disabled',
  'promo.deleted',
  'knowledge.applied',
  'knowledge.rejected',
  'knowledge.learning_toggled',
] as const;

/**
 * Tindakan yang akibatnya keluar dari Agnee.
 *
 * Daftar ini dulu dipaku ke satu tindakan saja (`lead.open_in_whatsapp`), jadi
 * tindakan lain yang dicatat tidak akan pernah terlihat di sini walau barisnya
 * ada di database. Sekarang semuanya ditampilkan, dengan penyaring per jenis
 * tindakan — karena pertanyaan supervisor biasanya spesifik: "siapa yang
 * mengunduh daftar customer bulan ini".
 */
export function AuditSection() {
  const { t, dateLocale } = useI18n();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [action, setAction] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const query = action ? `?action=${encodeURIComponent(action)}&limit=50` : '?limit=50';
      const data = await api<{ entries: AuditEntry[] }>(`/v1/audit${query}`);
      setEntries(data.entries || []);
      setStatus(data.entries?.length ? '' : t('admin.auditEmpty'));
    } catch (error) {
      setStatus(messageFromError(error, ''));
    }
  }, [t, action]);

  useEffect(() => { void load(); }, [load]);

  /** Satu baris ringkas: apa yang disentuh, bukan seluruh metadata. */
  const rincian = (entry: AuditEntry) => {
    const m = entry.metadata || {};
    if (entry.action === 'contacts.exported') {
      return [m.format?.toUpperCase(), m.rows != null ? `${m.rows} ${t('audit.rows')}` : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'contacts.file_imported') {
      return [m.format?.toUpperCase(), m.imported != null ? `${m.imported}/${m.rows} ${t('audit.rows')}` : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'contacts.import_started') {
      return [m.connections != null ? t('audit.importNumbers', { count: m.connections }) : null, m.trial ? t('audit.importTrial') : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'payment.changed') return (m.fields || []).join(', ');
    if (entry.action.startsWith('integration.')) return m.integration || entry.entityId || '';
    if (entry.action.startsWith('team.')) return [m.email, m.role].filter(Boolean).join(' · ');
    if (entry.action === 'whatsapp.disconnected') return m.label || entry.entityId || '';
    if (entry.action === 'broadcast.started') {
      return [m.name, m.recipients != null ? t('audit.broadcastRecipients', { count: m.recipients }) : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'broadcast.cancelled') {
      return [m.name, m.sent != null ? t('audit.broadcastSent', { count: m.sent }) : null].filter(Boolean).join(' · ');
    }
    if (entry.action === 'broadcast.opt_out_removed') return (entry.entityId || '').replace(/@.*$/, '');
    return m.contactName || m.phone || entry.entityId || '';
  };
  return (
    <SettingCard
      id="auditSection"
      eyebrow={t('admin.auditEyebrow')}
      title={t('admin.auditTitle')}
      description={t('admin.auditCopy')}
    >
      <select
        value={action}
        onChange={(event) => setAction(event.target.value)}
        aria-label={t('admin.auditFilterAll')}
        className="mb-3 rounded-app border border-input bg-white/60 px-3 py-2 text-sm"
      >
        <option value="">{t('admin.auditFilterAll')}</option>
        {AUDIT_ACTIONS.map((item) => (
          <option key={item} value={item}>{t(`audit.${item}`)}</option>
        ))}
      </select>
      {entries.length ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-2 rounded-xl border border-border bg-white p-3 text-[13px]">
              <strong>{entry.actorName || '—'}</strong>
              <span>{t(`audit.${entry.action}`)}</span>
              {rincian(entry) ? <span className="text-muted">{rincian(entry)}</span> : null}
              <span className="flex-1" />
              <time className="font-mono text-[10px] text-muted">
                {new Date(entry.createdAt).toLocaleString(dateLocale)}
              </time>
            </li>
          ))}
        </ul>
      ) : null}
      <StatusLine>{status}</StatusLine>
    </SettingCard>
  );
}
