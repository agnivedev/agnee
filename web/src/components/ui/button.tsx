import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans font-semibold transition-[transform,background-color,border-color,box-shadow] duration-200 outline-none focus-visible:ring-4 focus-visible:ring-green/25 disabled:pointer-events-none disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-ink text-white hover:-translate-y-0.5 hover:bg-ink-soft',
        lime: 'bg-lime text-ink hover:-translate-y-0.5 hover:brightness-105',
        outline: 'border border-ink/15 bg-white/60 text-ink hover:border-green hover:bg-white',
        ghost: 'text-ink/70 hover:bg-ink/[.06] hover:text-ink',
        danger: 'bg-danger text-white hover:-translate-y-0.5 hover:brightness-110',
        link: 'font-bold text-green-dark underline underline-offset-2 hover:text-ink',
      },
      size: {
        sm: 'h-9 rounded-[10px] px-3 text-[13px]',
        md: 'h-11 rounded-app px-4 text-sm',
        lg: 'h-[52px] rounded-app px-5 text-[15px]',
        icon: 'size-9 rounded-[10px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
