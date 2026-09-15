export type Chat = {
  id: string;
  name: string;
  preview: string;
  lastSenderName?: string | null;
  timestamp: number;
  unreadCount: number;
  isGroup: boolean;
  pinned: boolean;
  archived: boolean;
};

export type QuotedMessage = {
  id: string | null;
  body: string;
  type: string;
  fromMe: boolean;
  senderName?: string | null;
  senderId?: string | null;
};

export type Message = {
  id: string;
  body: string;
  caption?: string;
  mimetype?: string | null;
  fromMe: boolean;
  timestamp: number;
  type: string;
  ack: number;
  senderName?: string | null;
  senderId?: string | null;
  inlineImage?: string | null;
  inlineImageExtension?: string | null;
  /** Untuk pesan keluar: disusun AI, atau diketik anggota tim yang mana. */
  authorKind?: 'ai' | 'human';
  authorName?: string | null;
  quoted?: QuotedMessage | null;
  call?: { isVideo: boolean; result: string | null; duration: number | null } | null;
};

export type WhatsappStatus = {
  phase: string;
  account?: string | null;
  hasQr?: boolean;
  demoMode?: boolean;
  syncPercent?: number;
  lastError?: string;
};

export type Routing = {
  mode: 'ai' | 'human';
  assigneeUserId: string | null;
};

export type Handoff = {
  toMode: string;
  toName?: string | null;
  fromName?: string | null;
  createdByName?: string | null;
  note?: string | null;
  createdAt: string;
};

export type Note = {
  authorName?: string | null;
  body: string;
  createdAt: string;
};

export type TeamMember = {
  id: string;
  displayName?: string | null;
  email: string;
  role: string;
  status: string;
  presence?: string;
};

export type Lead = {
  chatId: string;
  stage?: string | null;
  score?: number | string | null;
  title?: string | null;
  detail?: string | null;
  assignee?: string | null;
};

export type Attachment = {
  data: string;
  mimetype: string;
  filename: string;
  filesize: number;
};

export type MediaTarget = {
  src: string;
  title: string;
  filename: string;
  kind: 'image' | 'video' | 'audio' | 'document';
};
