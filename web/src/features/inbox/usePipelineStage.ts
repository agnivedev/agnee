import { api, messageFromError } from '@/lib/api';
import type { Lead, PipelineStage } from './types';

export const PIPELINE_STAGES: PipelineStage[] = ['cold', 'warm', 'hot', 'closing', 'lost', 'on_hold'];

/**
 * Panggilan PATCH/DELETE pipeline-stage yang sama dipakai ContextPanel (satu
 * chat aktif) dan board Kanban (banyak chat sekaligus) — satu sumber supaya
 * perilaku "AI usul, manusia konfirmasi" tidak diduplikasi dan bisa diam-diam
 * berbeda di dua tempat. `chatId` diteruskan per panggilan, bukan diikat saat
 * hook dipanggil, supaya satu instance bisa dipakai untuk banyak lead.
 */
export function usePipelineStage(onUpdated: (lead: Lead) => void, onError?: (message: string) => void) {
  async function setStage(chatId: string | null, stage: PipelineStage, accepted: boolean) {
    if (!chatId) return;
    try {
      const refreshed = await api<Lead>(`/v1/chats/${encodeURIComponent(chatId)}/pipeline-stage`, {
        method: 'PATCH',
        body: { stage, accepted },
      });
      onUpdated(refreshed);
    } catch (error) {
      onError?.(messageFromError(error, ''));
    }
  }

  async function dismissSuggestion(chatId: string | null) {
    if (!chatId) return;
    try {
      const refreshed = await api<Lead>(`/v1/chats/${encodeURIComponent(chatId)}/pipeline-stage/suggestion`, {
        method: 'DELETE',
      });
      onUpdated(refreshed);
    } catch (error) {
      onError?.(messageFromError(error, ''));
    }
  }

  return { setStage, dismissSuggestion };
}
