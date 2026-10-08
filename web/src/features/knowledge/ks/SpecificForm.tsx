import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { KsCategory, KsField, KsRecord, KsSpecific } from './types';

const SELECT_CLASS =
  'font-normal w-full rounded-app border border-input bg-white/60 px-4 py-[15px] text-sm text-ink outline-none transition duration-200 focus:border-green focus:bg-white focus:ring-4 focus:ring-green/12';

function isRequired(field: KsField, record: KsRecord) {
  if (field.required) return true;
  if (!field.requiredWhen) return false;
  return Object.entries(field.requiredWhen).every(([key, expected]) => record[key] === expected);
}

function formatMoney(value: string | number | undefined) {
  return typeof value === 'number' ? value.toLocaleString('id-ID') : '';
}

function FieldInput({
  field, record, onChange,
}: { field: KsField; record: KsRecord; onChange: (value: string | number | undefined) => void }) {
  const { t } = useI18n();
  const value = record[field.key];

  if (field.type === 'enum') {
    return (
      <select
        className={SELECT_CLASS}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        <option value="">{t('ks.choose')}</option>
        {(field.values ?? []).map((option) => (
          <option key={option} value={option}>{t(`ks.enum.${option}`)}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'money') {
    return (
      <Input
        className="font-normal"
        inputMode="numeric"
        placeholder="0"
        value={formatMoney(value)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '');
          onChange(digits ? Number(digits) : undefined);
        }}
      />
    );
  }
  if (field.type === 'text' && (field.max ?? 0) > 120) {
    return (
      <Textarea
        className="font-normal"
        rows={3}
        maxLength={field.max}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  return (
    <Input
      className="font-normal"
      type={field.type === 'url' ? 'url' : 'text'}
      maxLength={field.max}
      placeholder={field.type === 'url' ? 'https://' : undefined}
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RecordFields({
  fields, record, onChange,
}: { fields: KsField[]; record: KsRecord; onChange: (next: KsRecord) => void }) {
  const { t } = useI18n();
  return (
    <div className="grid gap-4">
      {fields.map((field) => (
        <label key={field.key} className="grid content-start gap-1.5 text-[13px] font-semibold">
          <span>
            {field.label}
            {isRequired(field, record) ? <span className="ml-1 text-danger" title={t('ks.required')}>*</span> : null}
          </span>
          <FieldInput
            field={field}
            record={record}
            onChange={(value) => {
              const next = { ...record };
              if (value === undefined || value === '') delete next[field.key];
              else next[field.key] = value;
              onChange(next);
            }}
          />
        </label>
      ))}
    </div>
  );
}

function ListCategory({
  category, rows, onChange,
}: { category: KsCategory; rows: KsRecord[]; onChange: (next: KsRecord[]) => void }) {
  const { t } = useI18n();
  const max = category.max ?? 99;
  const label = category.rowLabel || t('ks.row');

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  }

  return (
    <div className="grid gap-3">
      {rows.map((row, index) => (
        <div key={index} className="rounded-app border border-border bg-white/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <strong className="text-sm">{label} {index + 1}</strong>
            <div className="flex gap-1">
              <Button size="icon" variant="ghost" aria-label={t('ks.moveUp')} disabled={index === 0} onClick={() => move(index, -1)}>
                <ChevronUp className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t('ks.moveDown')} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                <ChevronDown className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label={t('ks.removeRow')} onClick={() => onChange(rows.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
          <RecordFields
            fields={category.fields}
            record={row}
            onChange={(next) => onChange(rows.map((item, i) => (i === index ? next : item)))}
          />
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" disabled={rows.length >= max} onClick={() => onChange([...rows, {}])}>
          <Plus className="size-4" /> {t('ks.addRow', { label })}
        </Button>
      </div>
    </div>
  );
}

/** Form dari skema isian paket: tidak ada yang ditulis tangan per template. */
export function SpecificForm({
  categories, value, problems, onChange,
}: {
  categories: KsCategory[];
  value: KsSpecific;
  problems: string[];
  onChange: (next: KsSpecific) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-6">
      {categories.map((category) => (
        <fieldset key={category.key} className="m-0 grid gap-3 border-0 p-0">
          <legend className="mb-1 p-0 text-[15px] font-bold">{category.title}</legend>
          {category.help ? <p className="m-0 text-[12.5px] leading-[1.6] text-muted">{category.help}</p> : null}
          {category.type === 'list' ? (
            <ListCategory
              category={category}
              rows={(value[category.key] as KsRecord[] | undefined) ?? []}
              onChange={(rows) => onChange({ ...value, [category.key]: rows })}
            />
          ) : (
            <RecordFields
              fields={category.fields}
              record={(value[category.key] as KsRecord | undefined) ?? {}}
              onChange={(record) => onChange({ ...value, [category.key]: record })}
            />
          )}
        </fieldset>
      ))}
      {problems.length ? (
        <div className={cn('rounded-app border border-amber-300/60 bg-amber-50 p-4 text-[13px]')}>
          <strong>{t('ks.problemsTitle')}</strong>
          <ul className="mt-2 mb-0 grid gap-1 pl-5">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
