import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, messageFromError } from '@/lib/api';
import { subscribeLiveEvent } from '@/lib/live-events';
import { notificationHref, type NotificationKind } from '@/lib/notification-link';

export type Notification = {
  id: number;
  kind: NotificationKind;
  chatId: string | null;
  chatName: string | null;
  actorName: string | null;
  actorKind: 'human' | 'ai' | 'system';
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

/**
 * Daftar notifikasi, hitungan belum dibaca, dan dua tindakannya — satu
 * implementasi untuk lonceng dan halaman "lihat semua", yang dulu menyalin
 * tipe, pemuatan, dan "tandai dibaca lalu buka" masing-masing.
 *
 * Diperbarui lewat aliran SSE yang sama dengan inbox; frame-nya tidak membawa
 * isi, jadi daftarnya tetap ditarik lewat rute yang memeriksa pemanggilnya.
 */
export function useNotifications(limit: number) {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ notifications: Notification[]; unread: number }>(`/v1/notifications?limit=${limit}`);
      setItems(data.notifications || []);
      setUnread(data.unread || 0);
      setError('');
    } catch (caught) {
      setError(messageFromError(caught, ''));
    } finally {
      setLoaded(true);
    }
  }, [limit]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => subscribeLiveEvent('notification', () => { void load(); }), [load]);

  const markAllRead = useCallback(async () => {
    await api('/v1/notifications/read', { method: 'POST', body: {} }).catch(() => {});
    await load();
  }, [load]);

  const openItem = useCallback((item: Notification) => {
    void api('/v1/notifications/read', { method: 'POST', body: { ids: [item.id] } })
      .catch(() => {})
      .then(load);
    if (item.chatId) navigate(notificationHref(item.chatId, item.chatName));
  }, [load, navigate]);

  return { items, unread, error, loaded, load, markAllRead, openItem };
}
