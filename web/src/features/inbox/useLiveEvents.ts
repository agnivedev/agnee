import { useEffect, useRef } from 'react';

export type LiveHandlers = {
  /** message / ack / lead / chat — coalesced into one refresh. */
  onActivity: (payload: { chatId?: string; fromMe?: boolean }, type: string) => void;
  onRouting: () => void;
  onTeam: () => void;
  onWhatsappPhase: (payload: Record<string, unknown>) => void;
};

/**
 * One EventSource for the whole inbox.
 *
 * Bursts are debounced by 220ms: WhatsApp fires message + ack + chat for a
 * single incoming message, and refreshing three times over would make the list
 * flicker without showing anything new.
 */
export function useLiveEvents(handlers: LiveHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const events = new EventSource('/v1/events');
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

    for (const name of ['message', 'ack', 'lead', 'chat']) {
      events.addEventListener(name, schedule as EventListener);
    }
    const routing = () => ref.current.onRouting();
    events.addEventListener('routing', routing);
    events.addEventListener('note', routing);
    events.addEventListener('team', () => ref.current.onTeam());
    events.addEventListener('whatsapp_phase', ((event: MessageEvent) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(event.data || '{}');
      } catch {
        /* ignore */
      }
      ref.current.onWhatsappPhase(payload);
    }) as EventListener);

    return () => {
      clearTimeout(timer);
      events.close();
    };
  }, []);
}
