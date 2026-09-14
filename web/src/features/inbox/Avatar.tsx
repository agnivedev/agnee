import { useState } from 'react';
import { cn } from '@/lib/utils';
import { initials } from './format';

/**
 * WhatsApp avatars 404 while the profile picture is still being fetched, so a
 * single failure is retried once before the image is given up on and the
 * initials underneath are left to stand.
 */
export function Avatar({
  name,
  isGroup,
  src,
  className,
  fallbackClassName,
}: {
  name?: string | null;
  isGroup?: boolean;
  src?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={cn(
        'relative grid size-[38px] place-items-center overflow-hidden rounded-[50%_50%_44%_56%] bg-[#dcebdc] text-[13px] font-bold text-green-dark',
        className,
      )}
    >
      {isGroup ? (
        <svg viewBox="0 0 24 24" aria-hidden className={cn('size-[58%] fill-current', fallbackClassName)}>
          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-.32 0-.63.05-.91.14A5 5 0 0 1 16 8c0 1.07-.34 2.06-.91 2.86.28.09.59.14.91.14Zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm8 2c-.29 0-.62.02-.97.05 1.2.87 1.97 2.08 1.97 3.45V19h5v-2.5c0-1.93-3.33-3.5-6-3.5Zm-8 0c-2.67 0-6 1.57-6 3.5V19h12v-2.5C14 14.57 10.67 13 8 13Z" />
        </svg>
      ) : (
        <span className={fallbackClassName}>{initials(name)}</span>
      )}
      {src && !failed ? (
        <img
          src={attempt ? `${src}?retry=${attempt}` : src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          onError={() => {
            if (attempt) setFailed(true);
            else setAttempt(Date.now());
          }}
        />
      ) : null}
    </span>
  );
}
