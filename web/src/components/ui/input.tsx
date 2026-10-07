import type { ComponentProps, InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-app border border-input bg-white/60 px-4 py-[15px] text-sm text-ink outline-none transition duration-200 placeholder:text-muted focus:border-green focus:bg-white focus:ring-4 focus:ring-green/12';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

// ComponentProps, bukan TextareaHTMLAttributes: di React 19 `ref` adalah prop
// biasa, dan penyusun broadcast perlu posisi kursor untuk menyisipkan {nama}.
export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(field, 'min-h-24 resize-y', className)} {...props} />;
}
