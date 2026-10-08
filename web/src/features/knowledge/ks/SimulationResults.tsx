import { CircleCheck, CircleMinus, CircleX } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { KsCheck, KsScenario, KsSimulation } from './types';

function CheckRow({ check }: { check: KsCheck }) {
  const { t } = useI18n();
  const Icon = check.ok === true ? CircleCheck : check.ok === false ? CircleX : CircleMinus;
  const label = t(`ks.check.${check.type}`, { tier: check.tier ?? '' });
  return (
    <li className="flex items-start gap-2 text-[12.5px]">
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          check.ok === true && 'text-green-dark',
          check.ok === false && 'text-danger',
          check.ok === null && 'text-muted',
        )}
        aria-hidden
      />
      <span>
        {label}
        {check.ok === false && check.detail ? <span className="block text-danger">{check.detail}</span> : null}
        {check.ok === null ? <span className="block text-muted">{t('ks.skipped')}</span> : null}
      </span>
    </li>
  );
}

function ScenarioRow({ scenario }: { scenario: KsScenario }) {
  const { t } = useI18n();
  return (
    <details className="rounded-app border border-border bg-white/50 px-4 py-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        {scenario.pass
          ? <CircleCheck className="size-4 shrink-0 text-green-dark" aria-hidden />
          : <CircleX className="size-4 shrink-0 text-danger" aria-hidden />}
        <span>{scenario.name}</span>
        <span className="ml-auto font-mono text-[10px] tracking-[.06em] text-muted uppercase">
          {scenario.pass ? t('ks.pass') : t('ks.fail')}
        </span>
      </summary>
      <ul className="mt-3 mb-3 grid gap-1.5 pl-0 [list-style:none]">
        {scenario.checks.map((check, index) => <CheckRow key={index} check={check} />)}
      </ul>
      <p className="mt-0 mb-2 text-[11px] font-semibold tracking-[.06em] text-muted uppercase">{t('ks.transcript')}</p>
      <div className="grid gap-1.5">
        {scenario.transcript.map((turn, index) => (
          <p
            key={index}
            className={cn(
              'm-0 max-w-[88%] rounded-[12px] px-3 py-2 text-[13px] leading-[1.5] whitespace-pre-wrap',
              turn.role === 'customer' ? 'justify-self-start bg-ink/6' : 'justify-self-end bg-green/14',
            )}
          >
            {turn.text}
          </p>
        ))}
      </div>
    </details>
  );
}

export function SimulationResults({ simulation }: { simulation: KsSimulation }) {
  const { t, locale } = useI18n();
  const total = simulation.passed + simulation.failed;
  const when = new Date(simulation.at).toLocaleString(locale === 'en' ? 'en-GB' : 'id-ID', {
    dateStyle: 'medium', timeStyle: 'short',
  });
  return (
    <div className="grid gap-3">
      <p className="m-0 text-sm">
        <strong>{t('ks.simSummary', { passed: simulation.passed, total })}</strong>
        <span className="ml-2 text-[12px] text-muted">{when}</span>
      </p>
      {simulation.scenarios.map((scenario) => <ScenarioRow key={scenario.id} scenario={scenario} />)}
    </div>
  );
}
