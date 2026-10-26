export const PROPOSAL_CATEGORIES = ['profile', 'product', 'pricing', 'faq', 'funnel', 'objection', 'closing'] as const;
export type ProposalCategory = (typeof PROPOSAL_CATEGORIES)[number];
export type ProposalStatus = 'suggested' | 'submitted' | 'applied' | 'rejected' | 'dismissed';

export type SimulationRow = {
  question: string;
  before: string | null;
  after: string | null;
  rules: { passed: boolean; warnings: string[] };
  judge: { overall: number | null; verdict: 'pass' | 'revise'; issues: string[] } | null;
};

export type Proposal = {
  id: string;
  chatId: string;
  sourceMessageId: string | null;
  question: string;
  answer: string;
  customerMessage: string;
  category: ProposalCategory;
  status: ProposalStatus;
  origin: 'auto' | 'manual';
  proposedBy: string | null;
  proposedByName: string | null;
  reviewedByName: string | null;
  rejectReason: string | null;
  conflictStatus: 'new' | 'conflict' | null;
  conflictNote: string | null;
  chatExcerpt: string;
  simulation: { generatedAt: string; rows: SimulationRow[] } | null;
  createdAt: string;
  submittedAt: string | null;
  decidedAt: string | null;
  mine: boolean;
};
