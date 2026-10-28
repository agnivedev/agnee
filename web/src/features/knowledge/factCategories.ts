export const FACT_CATEGORIES = ['profile', 'product', 'pricing', 'faq', 'funnel', 'objection', 'closing'] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];
