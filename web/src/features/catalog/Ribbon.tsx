import { cn } from '@/lib/utils';
import { TAG_CLASS, type ItemTag } from './types';

export function Ribbon({ tag, className }: { tag: Pick<ItemTag, 'name' | 'color'>; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ring-1 ring-inset', TAG_CLASS[tag.color] || TAG_CLASS.slate, className)}>
      {tag.name}
    </span>
  );
}
