import { useEffect, useRef } from 'react';
import { subscribeLiveEvent, subscribeLiveEvents } from '@/lib/live-events';

export type LiveHandlers = {
  /** message / ack / lead / chat — coalesced into one refresh. */
  onActivity: (payload: { chatId?: string; fromMe?: boolean }, type: string) => void;
  onRouting: () => void;
  onTeam: () => void;
  onWhatsappPhase: (payload: Record<string, unknown>) => void;
};

/**
 * Inbox's view of the shared event stream.
 *
 * The connection itself lives in lib/live-events: the notification bell listens
 * on the same one, and the server caps how many streams may be open at once.
 *
 * Bursts are debounced by 220ms: WhatsApp fires message + ack + chat for a
 * single incoming message, and refreshing three times over would make the list
 * flicker without showing anything new.
 */
export function useLiveEvents(handlers: LiveHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (event: MessageEvent) => {
      let payload: { chatId?: string; fromMe?: boolean } = {};
      try {
        payload = JSON.parse(event.data || '{}');
      } catch {
        /* a malformed frame must not take the stream down */
      }
      clearTimeout(timer);
      const type = event.type;
      timer = setTimeout(() => ref.current.onActivity(payload, type), 220);
    };

    const stops = [
      subscribeLiveEvents(['message', 'ack', 'lead', 'chat'], schedule),
      subscribeLiveEvents(['routing', 'note'], () => ref.current.onRouting()),
      subscribeLiveEvent('team', () => ref.current.onTeam()),
      subscribeLiveEvent('whatsapp_phase', (event: MessageEvent) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(event.data || '{}');
        } catch {
          /* ignore */
        }
        ref.current.onWhatsappPhase(payload);
      }),
    ];

    return () => {
      clearTimeout(timer);
      for (const stop of stops) stop();
    };
  }, []);
}
