import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { subscribeLiveEvent } from '@/lib/live-events';
import type { Proposal } from './types';

/**
 * Usulan knowledge yang masih hidup di satu chat (chip di inbox).
 *
 * Usulan lahir di server saat ringkasan chat dibuat, jadi klien tidak
 * menunggunya: server mengirim event `knowledge` dan daftar ditarik lagi.
 * Chip hanyalah bonus; kegagalan memuatnya tidak boleh mengganggu inbox.
 */
export function useKnowledgeSuggestions(chatId: string | null) {
  const [enabled, setEnabled] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const current = useRef(chatId);
  current.current = chatId;

  const load = useCallback(async () => {
    if (!chatId) {
      setEnabled(false);
      setProposals([]);
      return;
    }
    try {
      const data = await api<{ enabled: boolean; proposals: Proposal[] }>(
        `/v1/chats/${encodeURIComponent(chatId)}/knowledge-suggestions`,
      );
      // Jawaban untuk chat yang sudah ditinggalkan tidak boleh menimpa chat sekarang.
      if (current.current !== chatId) return;
      setEnabled(Boolean(data.enabled));
      setProposals(data.proposals || []);
    } catch {
      /* chip adalah bonus */
    }
  }, [chatId]);

  useEffect(() => {
    setProposals([]);
    void load();
  }, [load]);

  useEffect(() => subscribeLiveEvent('knowledge', (event) => {
    let payload: { chatId?: string } = {};
    try {
      payload = JSON.parse((event as MessageEvent).data || '{}');
    } catch {
      /* frame rusak tidak boleh menjatuhkan aliran */
    }
    if (!payload.chatId || payload.chatId === current.current) void load();
  }), [load]);

  return { enabled, proposals, reload: load };
}
