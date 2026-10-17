export type Mentionable = {
  /** `__ai__` untuk asisten; selain itu id pengguna. */
  id: string;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  /** Departemen: memberi tahu semua anggotanya. */
  kind?: 'department';
};

/**
 * `user` memicu notifikasi ke rekan sekerja. `chat` hanya tautan navigasi ke
 * percakapan lain — customer tidak pernah diberi tahu tentang catatan internal.
 */
export type Mention =
  | { kind: 'user'; id: string }
  | { kind: 'chat'; chatId: string }
  | { kind: 'ai' }
  | { kind: 'department'; id: string; name?: string };

export type NoteItem = {
  id: number;
  body: string;
  createdAt: string;
  parentId?: number | null;
  authorName?: string | null;
  authorUserId?: string | null;
  authorKind?: 'human' | 'ai';
  kind?: 'note' | 'handover';
  mentions?: Mention[];
};
