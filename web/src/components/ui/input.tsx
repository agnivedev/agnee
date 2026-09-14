import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const field =
  'w-full rounded-app border border-input bg-white/60 px-4 py-[15px] text-sm text-ink outline-none transition duration-200 placeholder:text-muted focus:border-green focus:bg-white focus:ring-4 focus:ring-green/12';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(field, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(field, 'min-h-24 resize-y', className)} {...props} />;
}
