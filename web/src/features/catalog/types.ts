export type TagColor = 'amber' | 'rose' | 'emerald' | 'sky' | 'violet' | 'slate';
export type AutoRule = 'best_seller' | 'promo' | 'new';

export type CatalogTag = {
  id: string;
  name: string;
  color: TagColor;
  autoRule: AutoRule | null;
  highlight: boolean;
  aiNote: string;
  active: boolean;
  sortOrder: number;
  itemCount: number;
};

/** Ribbon pada satu item: `manual` dipasang tim, `auto` dipasang sinkron POS. */
export type ItemTag = { id: string; name: string; color: TagColor; manual: boolean; auto: boolean };

export type CatalogItem = {
  id: string;
  source: 'manual' | 'dealpos';
  externalId: string | null;
  kind: 'product' | 'service';
  name: string;
  code: string | null;
  category: string | null;
  unit: string | null;
  price: number | null;
  priceNote: string | null;
  discountPct: number;
  description: string;
  imageUrl: string | null;
  active: boolean;
  missingFromSource: boolean;
  releasedAt: string | null;
  soldQty: number | null;
  syncedAt: string | null;
  tags: ItemTag[];
};

export type CatalogSettings = {
  aiEnabled: boolean;
  bestSellerCount: number;
  bestSellerDays: number;
  newDays: number;
  posSyncedAt: string | null;
  posError: string | null;
};

export type CatalogSummary = {
  settings: CatalogSettings;
  tags: CatalogTag[];
  counts: { total: number; manual: number; dealpos: number };
  canEdit: boolean;
  pos: { provider: 'dealpos'; host: string; enabled: boolean; syncing: boolean } | null;
};

export const TAG_COLORS: TagColor[] = ['amber', 'rose', 'emerald', 'sky', 'violet', 'slate'];

// Kelas lengkap ditulis apa adanya: Tailwind hanya membangun kelas yang muncul
// utuh di sumber, dan CSP melarang warna lewat atribut style.
export const TAG_CLASS: Record<TagColor, string> = {
  amber: 'bg-amber-100 text-amber-900 ring-amber-300',
  rose: 'bg-rose-100 text-rose-900 ring-rose-300',
  emerald: 'bg-emerald-100 text-emerald-900 ring-emerald-300',
  sky: 'bg-sky-100 text-sky-900 ring-sky-300',
  violet: 'bg-violet-100 text-violet-900 ring-violet-300',
  slate: 'bg-slate-100 text-slate-800 ring-slate-300',
};

export const SWATCH_CLASS: Record<TagColor, string> = {
  amber: 'bg-amber-400',
  rose: 'bg-rose-400',
  emerald: 'bg-emerald-400',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
  slate: 'bg-slate-400',
};

export const rupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;
