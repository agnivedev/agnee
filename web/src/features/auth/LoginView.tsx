import { useState, type FormEvent } from 'react';
import { api, messageFromError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Mode = 'login' | 'signup';
type Plan = 'personal' | 'company';

export function LoginView({ onAuthenticated }: { onAuthenticated: () => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('login');

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-ink lg:grid-cols-[minmax(0,1.35fr)_minmax(390px,.65fr)] lg:grid-rows-1">
      <Story />
      <section className="m-0 grid place-items-center bg-[#ebe9e2] px-6 py-10 sm:px-12 lg:my-[22px] lg:mr-[22px] lg:py-12 lg:rounded-l-[38px] lg:rounded-r-[14px] lg:shadow-rail">
        {mode === 'login' ? (
          <LoginForm onAuthenticated={onAuthenticated} onSwitch={() => setMode('signup')} />
        ) : (
          <SignupForm onAuthenticated={onAuthenticated} onSwitch={() => setMode('login')} />
        )}
      </section>
      <p className="sr-only">{t('login.note')}</p>
    </main>
  );
}

function Story() {
  const { t } = useI18n();
  return (
    <section
      aria-label={t('login.intro')}
      className="relative flex min-h-[310px] flex-col justify-between overflow-hidden rounded-b-[36px_12px] bg-ink bg-[radial-gradient(circle_at_18%_18%,rgba(199,255,53,.26),transparent_28%)] px-7 py-7 text-white lg:min-h-[680px] lg:rounded-none lg:px-[7vw] lg:py-12"
    >
      <img
        src="/brand/agnee-logo-primary.svg"
        alt="Agnee by beweix"
        className="w-40 brightness-0 invert lg:w-52"
      />
      <div className="relative z-10 max-w-[640px]">
        <p className="eyebrow text-lime">{t('login.eyebrow')}</p>
        <h1 className="m-0 text-[clamp(38px,9vw,86px)] font-semibold leading-[.96] tracking-[-.055em]">
          <Headline />
        </h1>
        <p className="mt-7 hidden max-w-[520px] text-lg leading-[1.55] text-white/70 lg:block">{t('login.description')}</p>
      </div>
      <div className="hidden w-max rounded-full border border-white/15 bg-white/5 px-3.5 py-2.5 text-[13px] backdrop-blur-md lg:block">
        <span className="mr-2 inline-block size-2 rounded-full bg-lime shadow-[0_0_18px_var(--color-lime)]" />
        <b>{t('login.ready')}</b>
      </div>
      <span
        aria-hidden
        className="absolute -right-20 -bottom-[150px] hidden size-[430px] -rotate-[18deg] rounded-[46%_54%_62%_38%] border border-lime/30 lg:block"
      />
    </section>
  );
}

/** The headline is the one string with markup in it; rendered as elements rather than raw HTML. */
function Headline() {
  const { t } = useI18n();
  const [first, second] = t('login.headline')
    .replace(/<\/?span>/g, '')
    .split('<br>');
  return (
    <>
      {first}
      <br />
      <span className="text-lime">{second}</span>
    </>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="grid gap-2 text-[13px] font-semibold">
      <span>{label}</span>
      <Input {...props} />
    </label>
  );
}

/** Sama seperti `Field`, plus mata untuk tampil/sembunyi — pola yang sama dengan `SecretField` di settings/parts.tsx. */
function PasswordField({ label, ...props }: { label: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <label className="grid gap-2 text-[13px] font-semibold">
      <span>{label}</span>
      <span className="relative flex">
        <Input {...props} type={visible ? 'text' : 'password'} className="pr-11" />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? t('settings.hideSecret') : t('settings.showSecret')}
          className="absolute inset-y-0 right-0 w-11 cursor-pointer rounded-r-app border-0 bg-transparent text-sm"
        >
          {visible ? '🙈' : '👁'}
        </button>
      </span>
    </label>
  );
}

function FormError({ children }: { children?: string }) {
  return (
    <p role="alert" className="-my-2.5 min-h-[18px] text-[13px] text-danger">
      {children}
    </p>
  );
}

function SubmitButton({ children, pending }: { children: string; pending: boolean }) {
  return (
    <Button type="submit" size="lg" disabled={pending} className="justify-between">
      <span>{children}</span>
      <span aria-hidden>→</span>
    </Button>
  );
}

function LoginForm({ onAuthenticated, onSwitch }: { onAuthenticated: () => void; onSwitch: () => void }) {
  const { t } = useI18n();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      await api('/v1/auth/login', {
        method: 'POST',
        body: { email: form.get('email'), password: form.get('password') },
      });
      onAuthenticated();
    } catch (caught) {
      setError(messageFromError(caught, t('error.loginFailed')));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid w-[min(100%,390px)] gap-[22px]">
      <div>
        <p className="eyebrow">{t('login.welcome')}</p>
        <h2 className="m-0 text-[34px] tracking-[-.04em]">{t('login.heading')}</h2>
        <p className="mt-2 text-muted">{t('login.subtitle')}</p>
      </div>
      <Field label={t('login.email')} name="email" type="email" autoComplete="username" required />
      <PasswordField
        label={t('login.password')}
        name="password"
        autoComplete="current-password"
        minLength={6}
        required
      />
      <FormError>{error}</FormError>
      <SubmitButton pending={pending}>{t('login.submit')}</SubmitButton>
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-muted">
        {t('login.signupPrompt')}{' '}
        <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={onSwitch}>
          {t('login.signup')}
        </Button>
      </p>
    </form>
  );
}

function SignupForm({ onAuthenticated, onSwitch }: { onAuthenticated: () => void; onSwitch: () => void }) {
  const { t } = useI18n();
  const [plan, setPlan] = useState<Plan>('personal');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      await api('/v1/auth/signup', {
        method: 'POST',
        body: {
          plan,
          companyName: form.get('companyName'),
          displayName: form.get('displayName'),
          email: form.get('email'),
          password: form.get('password'),
        },
      });
      onAuthenticated();
    } catch (caught) {
      setError(messageFromError(caught, t('error.signupFailed')));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid w-[min(100%,390px)] gap-[22px]">
      <div>
        <p className="eyebrow">{t('signup.eyebrow')}</p>
        <h2 className="m-0 text-[34px] tracking-[-.04em]">{t('signup.heading')}</h2>
        <p className="mt-2 text-muted">{t('signup.subtitle')}</p>
      </div>

      <div role="radiogroup" aria-label={t('signup.choosePlan')} className="flex gap-2">
        {(['personal', 'company'] as const).map((option) => (
          <label
            key={option}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border p-2.5 text-[13px] font-semibold transition-colors',
              plan === option ? 'border-green bg-green/8' : 'border-input',
            )}
          >
            <input
              type="radio"
              name="plan"
              value={option}
              checked={plan === option}
              onChange={() => setPlan(option)}
              className="m-0 accent-green"
            />
            <span className="capitalize">{option}</span>
          </label>
        ))}
      </div>

      <Field
        label={t('signup.companyName')}
        name="companyName"
        type="text"
        minLength={2}
        maxLength={150}
        placeholder={t('signup.companyPlaceholder')}
        required
      />
      <Field
        label={t('signup.yourName')}
        name="displayName"
        type="text"
        minLength={2}
        maxLength={100}
        autoComplete="name"
        required
      />
      <Field label={t('login.email')} name="email" type="email" autoComplete="username" required />
      <PasswordField
        label={t('login.password')}
        name="password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <FormError>{error}</FormError>
      <SubmitButton pending={pending}>{t('signup.submit')}</SubmitButton>
      <p className="m-0 font-mono text-[11px] leading-[1.5] text-muted">
        {t('signup.loginPrompt')}{' '}
        <Button variant="link" size="sm" className="h-auto p-0 text-[11px]" onClick={onSwitch}>
          {t('signup.login')}
        </Button>
      </p>
    </form>
  );
}
