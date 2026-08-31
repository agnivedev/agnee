'use strict';

const ui = {
  loginView: document.querySelector('#loginView'),
  appView: document.querySelector('#appView'),
  loginForm: document.querySelector('#loginForm'),
  loginError: document.querySelector('#loginError'),
  chatList: document.querySelector('#chatList'),
  loadMoreChats: document.querySelector('#loadMoreChats'),
  messageList: document.querySelector('#messageList'),
  emptyState: document.querySelector('#emptyState'),
  composer: document.querySelector('#composer'),
  messageInput: document.querySelector('#messageInput'),
  composerStatus: document.querySelector('#composerStatus'),
  activeName: document.querySelector('#activeName'),
  activeMeta: document.querySelector('#activeMeta'),
  activeAvatar: document.querySelector('#activeAvatar'),
  leadSummary: document.querySelector('#leadSummary'),
  leadScore: document.querySelector('#leadScore'),
  leadTitle: document.querySelector('#leadTitle'),
  leadDetail: document.querySelector('#leadDetail'),
  leadStage: document.querySelector('#leadStage'),
  searchInput: document.querySelector('#searchInput'),
  inboxPanel: document.querySelector('#inboxPanel'),
  conversationPanel: document.querySelector('#conversationPanel'),
  connectionButton: document.querySelector('#connectionButton'),
  connectionLabel: document.querySelector('#connectionLabel'),
  connectionDialog: document.querySelector('#connectionDialog'),
  dialogTitle: document.querySelector('#dialogTitle'),
  dialogCopy: document.querySelector('#dialogCopy'),
  qrImage: document.querySelector('#qrImage'),
  qrShell: document.querySelector('.qr-shell'),
  syncShell: document.querySelector('#syncShell'),
  syncProgress: document.querySelector('#syncProgress'),
  qrNote: document.querySelector('#qrNote'),
  changeNumberBtn: document.querySelector('#changeNumberBtn'),
  contextPanel: document.querySelector('#contextPanel'),
  contextToggle: document.querySelector('#contextToggle'),
  contextClose: document.querySelector('#contextClose'),
  filterButtons: [...document.querySelectorAll('.filter[data-filter]')],
  tabButtons: [...document.querySelectorAll('.tab[data-tab]')],
  filterRow: document.querySelector('#filterRow'),
  contactsButton: document.querySelector('#contactsButton'),
  inboxButton: document.querySelector('#inboxButton'),
  funnelButton: document.querySelector('#funnelButton'),
  adminButton: document.querySelector('#adminButton'),
  newConversationButton: document.querySelector('#newConversationButton'),
  newConversationDialog: document.querySelector('#newConversationDialog'),
  newConversationForm: document.querySelector('#newConversationForm'),
  newConversationError: document.querySelector('#newConversationError'),
  conversationMenuButton: document.querySelector('#conversationMenuButton'),
  utilityDialog: document.querySelector('#utilityDialog'),
  utilityEyebrow: document.querySelector('#utilityEyebrow'),
  utilityTitle: document.querySelector('#utilityTitle'),
  utilityContent: document.querySelector('#utilityContent'),
  handoffButton: document.querySelector('#handoffButton'),
  replyBar: document.querySelector('#replyBar'),
  replyLabel: document.querySelector('#replyLabel'),
  replyText: document.querySelector('#replyText'),
  attachmentButton: document.querySelector('#attachmentButton'),
  attachmentInput: document.querySelector('#attachmentInput'),
  attachmentBar: document.querySelector('#attachmentBar'),
  attachmentName: document.querySelector('#attachmentName'),
  pinnedBar: document.querySelector('#pinnedBar'),
  pinnedLabel: document.querySelector('#pinnedLabel'),
  pinnedSummary: document.querySelector('#pinnedSummary'),
  pinnedCount: document.querySelector('#pinnedCount'),
  mediaViewer: document.querySelector('#mediaViewer'),
  mediaStage: document.querySelector('#mediaStage'),
  mediaViewerImage: document.querySelector('#mediaViewerImage'),
  mediaViewerVideo: document.querySelector('#mediaViewerVideo'),
  mediaViewerTitle: document.querySelector('#mediaViewerTitle'),
  mediaZoomLabel: document.querySelector('#mediaZoomLabel'),
  mediaDownload: document.querySelector('#mediaDownload'),
};

const state = {
  chats: [],
  activeChat: null,
  whatsapp: null,
  chatPageSize: 12,
  hasMoreChats: false,
  messageLimit: 30,
  hasMoreMessages: false,
  loadingChats: false,
  pendingChatReset: false,
  loadingMessages: false,
  sending: false,
  pendingRequestId: null,
  pendingText: null,
  replyingTo: null,
  attachment: null,
  pinnedMessages: [],
  media: { src: '', filename: '', kind: 'image', scale: 1, x: 0, y: 0, pointers: new Map(), pinchDistance: 0, pinchScale: 1 },
  activeTab: 'inbox',
  activeFilter: 'all',
  connectionTimer: null,
  workspaceTimer: null,
  eventSource: null,
  searchTimer: null,
  liveRefreshTimer: null,
  locallyReadChats: new Set(),
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['content-type'] = 'application/json';
  const response = await fetch(path, {
    ...options,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

let transitionInProgress = false;
function transition(fn) {
  if (transitionInProgress) {
    fn();
    return;
  }
  if (document.startViewTransition) {
    transitionInProgress = true;
    const t = document.startViewTransition(fn);
    t.finished.finally(() => { transitionInProgress = false; });
    return t;
  }
  fn();
}

function renderMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^### (.*?)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*?)$/gm, '<h1>$1</h1>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n\d+\. /g, '<br>');

  return html;
}

function showApp() {
  transition(() => {
    ui.loginView.hidden = true;
    ui.appView.hidden = false;
  });
  loadWorkspace();
  connectEvents();
  clearInterval(state.workspaceTimer);
  state.workspaceTimer = setInterval(refreshEmptyInbox, 5000);
}

function showLogin() {
  clearInterval(state.workspaceTimer);
  state.workspaceTimer = null;
  state.eventSource?.close();
  state.eventSource = null;
  transition(() => {
    ui.appView.hidden = true;
    ui.loginView.hidden = false;
  });
}

async function refreshEmptyInbox() {
  try {
    const whatsapp = await api('/v1/whatsapp/status');
    state.whatsapp = whatsapp;
    renderConnection(whatsapp);
    if (whatsapp.phase === 'ready' && state.chats.length === 0) {
      await loadChats(true);
      if (state.chats[0] && !state.activeChat) await selectChat(state.chats[0]);
    }
  } catch {
    // A later poll retries without interrupting the current conversation.
  }
}

function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase();
}

function fillAvatar(container, chat) {
  container.replaceChildren(document.createTextNode(initials(chat.name)));
  if (!chat.id || state.whatsapp?.demoMode) return;
  const image = document.createElement('img');
  image.alt = '';
  image.loading = 'lazy';
  image.decoding = 'async';
  const avatarUrl = `/v1/chats/${encodeURIComponent(chat.id)}/avatar`;
  image.src = avatarUrl;
  image.addEventListener('error', () => {
    if (image.dataset.retried) {
      image.remove();
      return;
    }
    image.dataset.retried = 'true';
    setTimeout(() => {
      if (image.isConnected) image.src = `${avatarUrl}?retry=${Date.now()}`;
    }, 1500);
  });
  container.append(image);
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  if (!total) return '';
  const minutes = Math.floor(total / 60);
  const remainder = Math.floor(total % 60);
  return minutes ? `${minutes} mnt ${String(remainder).padStart(2, '0')} dtk` : `${remainder} dtk`;
}

function callDescription(message) {
  const result = String(message.call?.result || '').toLowerCase();
  const missed = /miss|reject|decline|no.?answer/.test(result);
  if (missed) return message.fromMe ? 'Panggilan tidak dijawab' : 'Panggilan tak terjawab';
  return message.fromMe ? 'Panggilan keluar' : 'Panggilan masuk';
}

function messagePreview(message) {
  const body = String(message?.body || '').trim();
  if (body && !/^\/9j\/[A-Za-z0-9+/=]{80,}$/.test(body)) return body;
  return ({ image: 'Foto', video: 'Video', sticker: 'Stiker', audio: 'Audio', ptt: 'Pesan suara', document: 'Dokumen', interactive: 'Pesan interaktif' }[message?.type] || 'Pesan WhatsApp');
}

function dayKey(timestamp) {
  return new Date(Number(timestamp || 0) * 1000).toDateString();
}

function dayLabel(timestamp) {
  const date = new Date(Number(timestamp || 0) * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Hari ini';
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function renderChats() {
  if (!state.chatNodeMap) state.chatNodeMap = new Map();
  const nodeMap = state.chatNodeMap;
  if (!state.chats.length) {
    nodeMap.clear();
    const empty = document.createElement('div');
    empty.className = 'inbox-empty';
    empty.textContent = ui.searchInput.value.trim()
      ? 'Percakapan tidak ditemukan.'
      : state.activeTab === 'archived'
        ? 'Belum ada percakapan yang diarsipkan.'
        : state.activeFilter === 'qualified'
          ? 'Belum ada lead qualified.'
          : state.activeFilter === 'unread'
            ? 'Semua percakapan sudah dibaca.'
            : 'Belum ada percakapan.';
    ui.chatList.replaceChildren(empty);
    return;
  }
  const usedIds = new Set();
  let prevNode = null;
  for (const chat of state.chats) {
    usedIds.add(chat.id);
    let button = nodeMap.get(chat.id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = `
        <span class="avatar"></span>
        <span class="chat-copy"><strong></strong><span></span></span>
        <span class="chat-meta"><time></time><span class="chat-flags"></span></span>`;
      fillAvatar(button.querySelector('.avatar'), chat);
      button.addEventListener('click', () => selectChat(button._chat));
      nodeMap.set(chat.id, button);
    }
    button._chat = chat;
    button.className = `chat-item${state.activeChat?.id === chat.id ? ' active' : ''}`;
    button.querySelector('strong').textContent = chat.name;
    button.querySelector('.chat-copy span').textContent = chat.preview || 'Belum ada pesan';
    button.querySelector('time').textContent = formatTime(chat.timestamp);
    button.querySelector('.chat-flags').innerHTML = `${chat.pinned ? '<span class="chat-pin" title="Chat disematkan" aria-label="Chat disematkan"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10l-2 3v5l3 4v2H6v-2l3-4V6L7 3Zm5 14v4"/></svg></span>' : ''}${chat.unreadCount ? `<b class="unread">${chat.unreadCount}</b>` : ''}`;
    if (prevNode) {
      if (prevNode.nextSibling !== button) ui.chatList.insertBefore(button, prevNode.nextSibling);
    } else if (ui.chatList.firstChild !== button) {
      ui.chatList.insertBefore(button, ui.chatList.firstChild);
    }
    prevNode = button;
  }
  for (const [id, node] of nodeMap) {
    if (!usedIds.has(id)) {
      node.remove();
      nodeMap.delete(id);
    }
  }
}

function ackLabel(ack) {
  if (ack === 4) return { text: '✓✓', state: 'played', label: 'Diputar' };
  if (ack === 3) return { text: '✓✓', state: 'read', label: 'Dibaca' };
  if (ack === 2) return { text: '✓✓', state: 'delivered', label: 'Terkirim ke perangkat' };
  if (ack === 1) return { text: '✓', state: 'sent', label: 'Terkirim ke server' };
  if (ack === -1) return { text: '!', state: 'error', label: 'Gagal dikirim' };
  return { text: '◷', state: 'pending', label: 'Menunggu dikirim' };
}

function startReply(message) {
  state.replyingTo = message;
  ui.replyLabel.textContent = message.fromMe ? 'Membalas pesan Anda' : 'Membalas pelanggan';
  ui.replyText.textContent = message.body || ({ image: 'Foto', video: 'Video', sticker: 'Stiker', document: 'Dokumen' }[message.type] || 'Pesan');
  ui.replyBar.hidden = false;
  state.pendingRequestId = null;
  state.pendingText = null;
  ui.messageInput.focus();
}

function cancelReply() {
  state.replyingTo = null;
  ui.replyBar.hidden = true;
  state.pendingRequestId = null;
  state.pendingText = null;
}

function clearAttachment() {
  state.attachment = null;
  ui.attachmentInput.value = '';
  ui.attachmentBar.hidden = true;
  state.pendingRequestId = null;
  state.pendingText = null;
}

function renderMediaTransform() {
  const media = state.media;
  media.scale = Math.min(5, Math.max(0.5, media.scale));
  if (media.scale <= 1) {
    media.x = 0;
    media.y = 0;
  }
  ui.mediaViewerImage.style.transform = `translate(${media.x}px, ${media.y}px) scale(${media.scale})`;
  ui.mediaZoomLabel.textContent = `${Math.round(media.scale * 100)}%`;
  ui.mediaStage.classList.toggle('can-pan', media.scale > 1);
}

function setMediaZoom(scale) {
  state.media.scale = scale;
  renderMediaTransform();
}

function resetMediaViewer() {
  state.media.scale = 1;
  state.media.x = 0;
  state.media.y = 0;
  renderMediaTransform();
}

function openMediaViewer({ src, alt, filename }) {
  state.media.src = src;
  state.media.filename = filename;
  state.media.kind = 'image';
  ui.mediaViewer.classList.remove('video-mode');
  ui.mediaViewerVideo.hidden = true;
  ui.mediaViewerImage.hidden = false;
  for (const control of ui.mediaViewer.querySelectorAll('.image-control')) control.hidden = false;
  ui.mediaViewerImage.src = src;
  ui.mediaViewerImage.alt = alt || 'Foto WhatsApp';
  ui.mediaViewerTitle.textContent = alt || 'Foto WhatsApp';
  resetMediaViewer();
  ui.mediaViewer.showModal();
}

function openVideoViewer({ src, title, filename }) {
  state.media.src = src;
  state.media.filename = filename;
  state.media.kind = 'video';
  ui.mediaViewer.classList.add('video-mode');
  ui.mediaViewerImage.hidden = true;
  ui.mediaViewerVideo.hidden = false;
  ui.mediaViewerVideo.src = src;
  ui.mediaViewerTitle.textContent = title || 'Video WhatsApp';
  ui.mediaZoomLabel.textContent = 'Video';
  for (const control of ui.mediaViewer.querySelectorAll('.image-control')) control.hidden = true;
  ui.mediaViewer.showModal();
  ui.mediaViewerVideo.play().catch(() => { /* browser may require a second explicit tap */ });
}

async function downloadCurrentMedia() {
  const original = ui.mediaDownload.textContent;
  ui.mediaDownload.disabled = true;
  ui.mediaDownload.textContent = '…';
  try {
    const response = await fetch(state.media.src);
    if (!response.ok) throw new Error('Download gagal');
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = state.media.filename || `whatsapp-image-${Date.now()}.jpg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  } finally {
    ui.mediaDownload.disabled = false;
    ui.mediaDownload.textContent = original;
  }
}

function updateMessageRow(row, message) {
  if (message.type === 'call_log') return;
  if (message.fromMe && row._ackEl) {
    const delivery = ackLabel(Number(message.ack));
    row._ackEl.className = `message-ack ${delivery.state}`;
    row._ackEl.textContent = delivery.text;
    row._ackEl.title = delivery.label;
    row._ackEl.setAttribute('aria-label', delivery.label);
  }
}

function createMessageRow(message) {
  {
    const row = document.createElement('div');
    row.className = `message-row${message.fromMe ? ' mine' : ''}`;
    if (message.id) row.dataset.messageId = message.id;
    if (message.type === 'call_log') {
      row.classList.add('call-event-row');
      const event = document.createElement('div');
      event.className = 'call-event';
      const icon = document.createElement('span');
      icon.className = 'call-event-icon';
      icon.textContent = message.call?.isVideo ? '▣' : '☎';
      const copy = document.createElement('span');
      copy.className = 'call-event-copy';
      const title = document.createElement('strong');
      title.textContent = callDescription(message);
      const details = document.createElement('span');
      const duration = formatDuration(message.call?.duration);
      details.textContent = `${message.call?.isVideo ? 'Video' : 'Suara'} · ${formatTime(message.timestamp)}${duration ? ` · ${duration}` : ''}`;
      copy.append(title, details);
      event.append(icon, copy);
      row.append(event);
      return row;
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (state.activeChat?.isGroup && !message.fromMe && message.senderName) {
      const sender = document.createElement('strong');
      sender.className = 'message-sender';
      sender.textContent = message.senderName;
      bubble.append(sender);
    }
    if (message.quoted) {
      const quote = document.createElement('button');
      quote.type = 'button';
      quote.className = 'quoted-message';
      const quoteLabel = document.createElement('strong');
      quoteLabel.textContent = message.quoted.fromMe ? 'Anda' : 'Balasan';
      const quoteBody = document.createElement('span');
      quoteBody.textContent = message.quoted.body || ({ image: 'Foto', video: 'Video', document: 'Dokumen' }[message.quoted.type] || 'Pesan');
      quote.append(quoteLabel, quoteBody);
      if (message.quoted.id) {
        quote.setAttribute('aria-label', 'Buka pesan yang dibalas');
        quote.title = 'Buka pesan yang dibalas';
        quote.addEventListener('click', (event) => {
          event.stopPropagation();
          void focusMessageById(message.quoted.id);
        });
      } else {
        quote.disabled = true;
        quote.title = 'Pesan asli tidak tersedia';
      }
      bubble.append(quote);
    }
    const text = document.createElement('p');
    const mediaLabels = { image: '▧ Foto', video: '▷ Video', sticker: '◇ Stiker', audio: '♪ Audio', ptt: '◖ Pesan suara', document: '▤ Dokumen', interactive: 'Pesan interaktif WhatsApp' };
    const messageText = messagePreview(message) || mediaLabels[message.type] || 'Pesan tidak didukung';
    text.innerHTML = renderMarkdown(messageText);
    const time = document.createElement('time');
    time.textContent = formatTime(message.timestamp);
    if (message.fromMe) {
      const delivery = ackLabel(Number(message.ack));
      const mark = document.createElement('span');
      mark.className = `message-ack ${delivery.state}`;
      mark.textContent = delivery.text;
      mark.title = delivery.label;
      mark.setAttribute('aria-label', delivery.label);
      time.append(' ', mark);
      row._ackEl = mark;
    }
    if (message.type === 'video' && message.id) {
      const videoButton = document.createElement('button');
      videoButton.type = 'button';
      videoButton.className = 'video-preview';
      videoButton.setAttribute('aria-label', 'Putar video WhatsApp');
      if (message.inlineImage) {
        const thumbnail = document.createElement('img');
        thumbnail.alt = '';
        thumbnail.loading = 'lazy';
        thumbnail.src = message.inlineImage;
        videoButton.append(thumbnail);
      }
      const play = document.createElement('span');
      play.className = 'video-play';
      play.textContent = '▶';
      videoButton.append(play);
      videoButton.addEventListener('click', () => openVideoViewer({
        src: `/v1/messages/${encodeURIComponent(message.id)}/media`,
        title: message.body || 'Video WhatsApp',
        filename: `video-${String(message.id).replace(/[^a-z0-9_-]/gi, '_')}.mp4`,
      }));
      bubble.append(videoButton);
      if (!message.body) text.hidden = true;
    } else if (message.inlineImage || (message.id && ['image', 'sticker'].includes(message.type))) {
      const media = document.createElement('img');
      media.className = `bubble-media ${message.inlineImage ? 'interactive-image' : message.type}`;
      media.alt = message.type === 'sticker' ? 'Stiker WhatsApp' : message.body || (message.inlineImage ? 'Gambar pesan interaktif WhatsApp' : 'Foto WhatsApp');
      media.loading = 'lazy';
      media.decoding = 'async';
      media.src = message.inlineImage || `/v1/messages/${encodeURIComponent(message.id)}/media`;
      media.addEventListener('load', () => { if (!message.body) text.hidden = true; });
      media.addEventListener('error', () => media.remove());
      media.tabIndex = 0;
      media.setAttribute('role', 'button');
      media.setAttribute('aria-label', `Buka ${media.alt}`);
      const openImage = () => openMediaViewer({
        src: media.src,
        alt: media.alt,
        filename: `${message.type}-${String(message.id).replace(/[^a-z0-9_-]/gi, '_')}.${message.inlineImageExtension || (message.type === 'sticker' ? 'webp' : 'jpg')}`,
      });
      media.addEventListener('click', openImage);
      media.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImage();
        }
      });
      bubble.append(media);
    }
    bubble.append(text, time);
    row.append(bubble);
    const quickReply = document.createElement('button');
    quickReply.type = 'button';
    quickReply.className = 'quick-reply';
    quickReply.textContent = '↩';
    quickReply.setAttribute('aria-label', 'Reply to message');
    quickReply.addEventListener('click', (event) => {
      event.stopPropagation();
      startReply(message);
    });
    row.append(quickReply);
    row.addEventListener('dblclick', () => startReply(message));
    return row;
  }
}

function renderMessages(messages, hasMore) {
  if (!state.messageNodeMap) state.messageNodeMap = new Map();
  const nodeMap = state.messageNodeMap;
  const usedKeys = new Set();

  // First pass: mark which keys will be used so we know what to keep
  usedKeys.add(hasMore ? 'older' : null);
  let previousDay = '';
  messages.forEach((message, index) => {
    const currentDay = dayKey(message.timestamp);
    if (currentDay !== previousDay) {
      usedKeys.add(`divider:${currentDay}`);
      previousDay = currentDay;
    }
    const key = message.id ? `msg:${message.id}` : `msg:idx:${index}:${message.timestamp}:${message.fromMe ? 1 : 0}`;
    usedKeys.add(key);
  });

  // Prune stale nodes from DOM BEFORE placement to avoid muddying nextSibling references
  for (const [key, node] of nodeMap) {
    if (!usedKeys.has(key)) {
      node.remove();
      nodeMap.delete(key);
    }
  }

  let prevNode = null;
  const place = (key, node) => {
    if (prevNode) {
      if (prevNode.nextSibling !== node) ui.messageList.insertBefore(node, prevNode.nextSibling);
    } else if (ui.messageList.firstChild !== node) {
      ui.messageList.insertBefore(node, ui.messageList.firstChild);
    }
    prevNode = node;
  };

  if (hasMore) {
    let older = nodeMap.get('older');
    if (!older) {
      older = document.createElement('button');
      older.type = 'button';
      older.className = 'older-messages';
      older.textContent = 'Muat pesan sebelumnya';
      older.addEventListener('click', loadOlderMessages);
      nodeMap.set('older', older);
    }
    place('older', older);
  }

  previousDay = '';
  messages.forEach((message, index) => {
    const currentDay = dayKey(message.timestamp);
    if (currentDay !== previousDay) {
      const dividerKey = `divider:${currentDay}`;
      let divider = nodeMap.get(dividerKey);
      if (!divider) {
        divider = document.createElement('div');
        divider.className = 'date-divider message-enter';
        divider.textContent = dayLabel(message.timestamp);
        nodeMap.set(dividerKey, divider);
      }
      place(dividerKey, divider);
      previousDay = currentDay;
    }

    const key = message.id ? `msg:${message.id}` : `msg:idx:${index}:${message.timestamp}:${message.fromMe ? 1 : 0}`;
    let row = nodeMap.get(key);
    if (row) {
      updateMessageRow(row, message);
    } else {
      row = createMessageRow(message);
      row.classList.add('message-enter');
      nodeMap.set(key, row);
    }
    place(key, row);
  });
}

async function loadMessages(mode = 'bottom') {
  if (!state.activeChat || state.loadingMessages) return;
  state.loadingMessages = true;
  const requestedChatId = state.activeChat.id;
  const previousHeight = ui.messageList.scrollHeight;
  const previousTop = ui.messageList.scrollTop;
  try {
    const data = await api(`/v1/chats/${encodeURIComponent(requestedChatId)}/messages?limit=${state.messageLimit}`);
    if (state.activeChat?.id !== requestedChatId) return;
    state.hasMoreMessages = Boolean(data.hasMore) && state.messageLimit < 600;
    // Skip view transition for message updates to prevent flickering
    transitionInProgress = true;
    renderMessages(data.messages, state.hasMoreMessages);
    transitionInProgress = false;
    if (mode === 'bottom') ui.messageList.scrollTop = ui.messageList.scrollHeight;
    if (mode === 'preserve') ui.messageList.scrollTop = previousTop + (ui.messageList.scrollHeight - previousHeight);
    if (mode === 'stay') ui.messageList.scrollTop = previousTop;
  } finally {
    state.loadingMessages = false;
  }
}

async function loadOlderMessages() {
  if (!state.hasMoreMessages || state.loadingMessages) return;
  state.messageLimit = Math.min(state.messageLimit + 30, 600);
  await loadMessages('preserve');
}

async function selectChat(chat, resetLimit = true) {
  if (state.activeChat?.id !== chat.id) {
    state.messageNodeMap?.clear();
    ui.messageList.replaceChildren();
  }
  state.activeChat = chat;
  if (resetLimit) state.messageLimit = 30;
  cancelReply();
  clearAttachment();
  state.pinnedMessages = [];
  ui.pinnedBar.hidden = true;
  sessionStorage.setItem('agnee_active_chat', chat.id);
  state.locallyReadChats.add(chat.id);
  chat.unreadCount = 0;
  if (state.activeFilter === 'unread' && state.activeTab === 'inbox') {
    state.chats = state.chats.filter((item) => item.id !== chat.id);
  }
  api(`/v1/chats/${encodeURIComponent(chat.id)}/mark-read`, { method: 'POST' }).catch(() => {});
  renderChats();
  ui.activeName.textContent = chat.name;
  ui.activeMeta.textContent = chat.isGroup ? 'WhatsApp grup' : 'WhatsApp · lead aktif';
  fillAvatar(ui.activeAvatar, chat);
  ui.leadSummary.textContent = chat.preview || 'Belum ada ringkasan.';
  if (state.whatsapp?.demoMode) {
    ui.leadScore.textContent = '72';
    ui.leadTitle.textContent = 'Warm lead';
    ui.leadDetail.textContent = 'Menanyakan paket multi-cabang.';
    ui.leadStage.textContent = 'Qualified';
  } else {
    ui.leadScore.textContent = '—';
    ui.leadTitle.textContent = 'Belum dikualifikasi';
    ui.leadDetail.textContent = 'Belum dianalisis oleh AI.';
    ui.leadStage.textContent = 'Inbox';
  }
  ui.emptyState.hidden = true;
  ui.messageList.hidden = false;
  ui.composer.hidden = false;
  if (window.matchMedia('(max-width: 760px)').matches) {
    ui.inboxPanel.classList.add('mobile-hidden');
    ui.conversationPanel.classList.remove('mobile-hidden');
  }
  await Promise.all([loadMessages('bottom'), loadLead(chat.id), loadPinned(chat.id)]);
}

async function loadPinned(chatId) {
  try {
    const data = await api(`/v1/chats/${encodeURIComponent(chatId)}/pinned`);
    if (state.activeChat?.id !== chatId) return;
    state.pinnedMessages = [...(data.messages || [])].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    if (!state.pinnedMessages.length) {
      ui.pinnedBar.hidden = true;
      return;
    }
    const latest = state.pinnedMessages[0];
    ui.pinnedLabel.textContent = state.pinnedMessages.length === 1 ? 'Pesan disematkan' : `${state.pinnedMessages.length} pesan disematkan`;
    ui.pinnedSummary.textContent = messagePreview(latest);
    ui.pinnedCount.textContent = String(state.pinnedMessages.length);
    ui.pinnedBar.hidden = false;
  } catch {
    state.pinnedMessages = [];
    ui.pinnedBar.hidden = true;
  }
}

async function focusMessageById(messageId) {
  state.messageLimit = 600;
  await loadMessages('stay');
  const row = [...ui.messageList.querySelectorAll('.message-row')].find((item) => item.dataset.messageId === messageId);
  if (!row) {
    ui.composerStatus.className = 'composer-status error';
    ui.composerStatus.textContent = 'Pesan asli tidak tersedia di riwayat.';
    return false;
  }
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('message-highlight');
  requestAnimationFrame(() => row.classList.add('message-highlight'));
  setTimeout(() => row.classList.remove('message-highlight'), 1800);
  return true;
}

async function focusPinnedMessage(message) {
  ui.utilityDialog.close();
  await focusMessageById(message.id);
}

function openPinnedMessages() {
  if (!state.pinnedMessages.length) return;
  openUtility('Pesan disematkan', 'CHAT INI');
  for (const message of state.pinnedMessages) {
    const who = message.fromMe ? 'Anda' : message.senderName || state.activeChat?.name || 'Pelanggan';
    ui.utilityContent.append(utilityAction(
      messagePreview(message),
      `${who} · ${formatTime(message.timestamp)}`,
      () => focusPinnedMessage(message),
    ));
  }
}

async function loadLead(chatId) {
  if (state.whatsapp?.demoMode) return;
  try {
    const lead = await api(`/v1/chats/${encodeURIComponent(chatId)}/lead`);
    if (state.activeChat?.id !== chatId) return;
    ui.leadScore.textContent = lead.score ?? '—';
    ui.leadTitle.textContent = lead.title;
    ui.leadDetail.textContent = lead.detail;
    ui.leadStage.textContent = lead.stage === 'assigned' ? 'Diteruskan' : lead.stage === 'qualified' ? 'Qualified' : 'Inbox';
    ui.handoffButton.disabled = lead.stage === 'assigned';
    ui.handoffButton.firstChild.textContent = lead.stage === 'assigned' ? `Diteruskan ke: ${lead.assignee} ` : 'Teruskan ke sales ';
  } catch { /* keep the neutral context state */ }
}

async function loadChats(reset = false) {
  if (state.loadingChats) {
    if (reset) state.pendingChatReset = true;
    return;
  }
  state.loadingChats = true;
  try {
    const offset = reset ? 0 : state.chats.length;
    const filter = state.activeTab === 'archived'
      ? 'archived'
      : state.activeFilter === 'all' ? 'inbox' : state.activeFilter;
    const params = new URLSearchParams({
      limit: String(state.chatPageSize),
      offset: String(offset),
      q: ui.searchInput.value.trim(),
      filter,
    });
    const data = await api(`/v1/chats?${params}`);
    const receivedChats = (data.chats || []).map((chat) => state.locallyReadChats.has(chat.id)
      ? { ...chat, unreadCount: 0 }
      : chat);
    const newChats = reset ? receivedChats : [...state.chats, ...receivedChats];
    state.hasMoreChats = Boolean(data.hasMore);
    ui.loadMoreChats.hidden = !state.hasMoreChats;
    state.chats = newChats;
    renderChats();
  } catch (error) {
    if (reset) {
      ui.chatList.textContent = `Chat belum dapat dimuat: ${error.message}`;
      ui.loadMoreChats.hidden = true;
    }
    throw error;
  } finally {
    state.loadingChats = false;
    if (state.pendingChatReset) {
      state.pendingChatReset = false;
      void loadChats(true);
    }
  }
}

async function loadWorkspace() {
  try {
    const whatsapp = await api('/v1/whatsapp/status');
    state.whatsapp = whatsapp;
    renderConnection(whatsapp);
    const preferredId = state.activeChat?.id || sessionStorage.getItem('agnee_active_chat');
    await loadChats(true);
    const preferred = state.chats.find((chat) => chat.id === preferredId);
    if (preferred) await selectChat(preferred);
    else if (state.chats[0] && !state.activeChat) await selectChat(state.chats[0]);
  } catch (error) {
    if (error.status === 401) showLogin();
  }
}

function connectEvents() {
  state.eventSource?.close();
  const events = new EventSource('/v1/events');
  state.eventSource = events;
  const schedule = (event) => {
    let payload = {};
    try { payload = JSON.parse(event.data || '{}'); } catch { /* ignore malformed event */ }
    clearTimeout(state.liveRefreshTimer);
    state.liveRefreshTimer = setTimeout(async () => {
      const activeId = state.activeChat?.id;
      const wasAtBottom = ui.messageList.scrollHeight - ui.messageList.clientHeight - ui.messageList.scrollTop < 80;
      await loadChats(true);
      const refreshed = state.chats.find((chat) => chat.id === activeId);
      if (refreshed) state.activeChat = refreshed;
      renderChats();
      if (activeId && (!payload.chatId || payload.chatId === activeId || event.type === 'ack')) {
        await Promise.all([loadMessages(wasAtBottom ? 'bottom' : 'stay'), loadPinned(activeId)]);
      }
    }, 220);
  };
  events.addEventListener('message', schedule);
  events.addEventListener('ack', schedule);
  events.addEventListener('lead', schedule);
  events.addEventListener('chat', schedule);
  events.addEventListener('whatsapp_phase', async (event) => {
    let payload = {};
    try { payload = JSON.parse(event.data || '{}'); } catch { /* ignore */ }
    state.whatsapp = { phase: payload.phase, account: payload.account };
    renderConnection(state.whatsapp);
    if (payload.phase === 'waiting_for_qr' && payload.qrDataUrl) {
      if (ui.connectionDialog.open && ui.qrShell.hidden) {
        showDialogQr();
        ui.qrNote.textContent = 'QR diperbarui otomatis oleh adapter.';
      }
      ui.qrImage.src = payload.qrDataUrl;
    }
    if (payload.phase === 'authenticated') {
      if (ui.connectionDialog.open) {
        showDialogSyncing();
      }
    }
    if (payload.phase === 'syncing' && ui.connectionDialog.open) {
      showDialogSyncing(payload.percent);
    }
    if (payload.phase === 'ready') {
      if (ui.connectionDialog.open) {
        ui.dialogTitle.textContent = 'WhatsApp terhubung';
        ui.dialogCopy.textContent = 'Mengambil percakapan terbaru…';
        ui.qrNote.textContent = payload.account || '';
      }
      await loadWorkspace();
      ui.connectionDialog.classList.add('is-closing');
      setTimeout(() => {
        ui.connectionDialog.classList.remove('is-closing');
        ui.connectionDialog.close();
      }, 300);
    }
  });
  events.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data || '{}');
      if (payload.chatId && !payload.fromMe) state.locallyReadChats.delete(payload.chatId);
    } catch { /* ignore malformed event */ }
  });
}

function openUtility(title, eyebrow = 'WORKSPACE') {
  ui.utilityTitle.textContent = title;
  ui.utilityEyebrow.textContent = eyebrow;
  ui.utilityContent.replaceChildren();
  ui.utilityDialog.showModal();
}

function utilityAction(title, detail, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'utility-action';
  const copy = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = detail;
  copy.append(strong, small);
  button.append(copy, document.createTextNode('→'));
  button.addEventListener('click', handler);
  return button;
}

function openContacts() {
  openUtility('Kontak', 'DIREKTORI');
  if (!state.chats.length) {
    ui.utilityContent.textContent = 'Belum ada kontak yang dimuat.';
    return;
  }
  for (const chat of state.chats) {
    ui.utilityContent.append(utilityAction(chat.name, chat.isGroup ? 'WhatsApp grup' : chat.preview || 'WhatsApp', async () => {
      ui.utilityDialog.close();
      await selectChat(chat);
    }));
  }
}

async function openFunnel() {
  openUtility('Qualified leads', 'FUNNEL');
  ui.utilityContent.textContent = 'Memuat lead…';
  try {
    const data = await api('/v1/chats?limit=50&offset=0&filter=qualified');
    ui.utilityContent.replaceChildren();
    if (!data.chats.length) {
      const empty = document.createElement('p');
      empty.className = 'utility-empty';
      empty.textContent = 'Belum ada lead qualified atau assigned.';
      ui.utilityContent.append(empty);
      return;
    }
    for (const chat of data.chats) {
      ui.utilityContent.append(utilityAction(chat.name, 'Qualified / assigned', async () => {
        ui.utilityDialog.close();
        await selectChat(chat);
      }));
    }
  } catch (error) {
    ui.utilityContent.textContent = error.message;
  }
}

function openConversationMenu() {
  if (!state.activeChat) return;
  openUtility('Aksi percakapan', 'CHAT INI');
  ui.utilityContent.append(
    utilityAction(
      state.activeChat.archived ? 'Kembalikan ke Inbox' : 'Archive conversation',
      state.activeChat.archived ? 'Pindahkan percakapan ini kembali ke Inbox' : 'Pindahkan percakapan ini ke Archived',
      async () => {
        const chat = state.activeChat;
        const archived = !chat.archived;
        await api(`/v1/chats/${encodeURIComponent(chat.id)}/archive`, {
          method: 'POST',
          body: JSON.stringify({ archived }),
        });
        ui.utilityDialog.close();
        chat.archived = archived;
        state.chats = state.chats.filter((item) => item.id !== chat.id);
        state.activeChat = null;
        ui.activeName.textContent = 'Pilih percakapan';
        ui.activeMeta.textContent = 'WhatsApp';
        ui.messageList.hidden = true;
        ui.composer.hidden = true;
        ui.emptyState.hidden = false;
        await loadChats(true);
      },
    ),
    utilityAction('Refresh conversation', 'Ambil pesan terbaru dari WhatsApp', async () => {
      ui.utilityDialog.close();
      await loadMessages('bottom');
    }),
    utilityAction('Lead context', 'Buka qualification dan handoff', () => {
      ui.utilityDialog.close();
      ui.contextPanel.classList.add('open');
      ui.appView.classList.remove('context-hidden');
    }),
    utilityAction('Copy chat reference', 'Salin ID teknis percakapan', async () => {
      const chatId = state.activeChat.id;
      try {
        await navigator.clipboard.writeText(chatId);
        ui.utilityContent.replaceChildren();
        const notice = document.createElement('p');
        notice.className = 'utility-success';
        notice.textContent = `Tersalin: ${chatId}`;
        ui.utilityContent.append(notice);
      } catch {
        ui.utilityContent.replaceChildren();
        const field = document.createElement('input');
        field.className = 'copy-field';
        field.value = chatId;
        field.readOnly = true;
        ui.utilityContent.append(field);
        field.select();
      }
    }),
  );
}

function fileToAttachment(file) {
  return new Promise((resolve, reject) => {
    if (file.size > 6 * 1024 * 1024) {
      reject(new Error('Ukuran lampiran maksimal 6 MB.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Lampiran tidak dapat dibaca.'));
    reader.onload = () => resolve({
      data: String(reader.result).split(',')[1],
      mimetype: file.type || 'application/octet-stream',
      filename: file.name,
      filesize: file.size,
    });
    reader.readAsDataURL(file);
  });
}

function renderConnection(whatsapp) {
  const ready = whatsapp.phase === 'ready' || whatsapp.phase === 'demo';
  ui.connectionButton.className = `connection-pill ${ready ? whatsapp.phase : ''}`;
  ui.connectionLabel.textContent = whatsapp.phase === 'demo' ? 'Demo' : ready ? 'Terhubung' : 'Hubungkan';
}

function showDialogQr() {
  ui.qrShell.hidden = false;
  ui.syncShell.hidden = true;
  ui.changeNumberBtn.hidden = true;
  ui.dialogTitle.textContent = 'Hubungkan WhatsApp';
  ui.dialogCopy.textContent = 'Buka WhatsApp → Linked Devices, lalu scan kode ini.';
}

function showDialogSyncing(percent) {
  ui.qrImage.removeAttribute('src');
  ui.qrShell.hidden = true;
  ui.syncShell.hidden = false;
  ui.changeNumberBtn.hidden = true;
  ui.dialogTitle.textContent = 'Menyinkronkan WhatsApp';
  ui.dialogCopy.textContent = 'QR berhasil dipindai. Kami sedang mengambil percakapan Anda.';
  ui.syncProgress.textContent = Number.isFinite(percent)
    ? `Menyinkronkan pesan ${Math.round(percent)}%`
    : 'Mohon biarkan WhatsApp tetap terbuka.';
  ui.qrNote.textContent = '';
}

async function openConnection() {
  ui.connectionDialog.showModal();
  ui.qrImage.removeAttribute('src');
  ui.qrShell.hidden = true;
  ui.syncShell.hidden = true;
  ui.changeNumberBtn.hidden = true;

  const phase = state.whatsapp?.phase;

  if (phase === 'ready' || phase === 'demo') {
    ui.dialogTitle.textContent = 'WhatsApp terhubung';
    ui.dialogCopy.textContent = 'Sesi aktif dan percakapan tersinkron dengan Customer Desk.';
    ui.qrNote.textContent = state.whatsapp.account || 'Terhubung';
    ui.changeNumberBtn.hidden = false;
    return;
  }

  if (phase === 'starting' || phase === 'authenticated' || phase === 'syncing') {
    showDialogSyncing(state.whatsapp?.syncPercent);
    clearInterval(state.connectionTimer);
    state.connectionTimer = setInterval(checkConnection, 5000);
    return;
  }

  // waiting_for_qr / disconnected / auth_failure / error — genuinely needs scan
  showDialogQr();
  ui.qrNote.textContent = 'Menyiapkan QR…';
  try {
    const data = await api('/v1/whatsapp/qr');
    ui.qrImage.src = data.qrDataUrl;
    ui.qrNote.textContent = data.demoMode ? 'Demo QR untuk menguji alur UI. Nonaktifkan WA_DEMO_MODE untuk pairing nyata.' : 'QR diperbarui otomatis oleh adapter.';
  } catch {
    ui.qrNote.textContent = 'Menunggu QR dari WhatsApp…';
  }
  clearInterval(state.connectionTimer);
  state.connectionTimer = setInterval(checkConnection, 15000);
}

async function checkConnection() {
  try {
    const whatsapp = await api('/v1/whatsapp/status');
    state.whatsapp = whatsapp;
    renderConnection(whatsapp);
    if (whatsapp.phase === 'ready') {
      clearInterval(state.connectionTimer);
      state.connectionTimer = null;
      ui.dialogTitle.textContent = 'WhatsApp terhubung';
      ui.dialogCopy.textContent = 'Mengambil percakapan terbaru…';
      ui.qrNote.textContent = whatsapp.account || '';
      await loadWorkspace();
      ui.connectionDialog.classList.add('is-closing');
      setTimeout(() => {
        ui.connectionDialog.classList.remove('is-closing');
        ui.connectionDialog.close();
      }, 300);
      return;
    }
    if (whatsapp.phase === 'authenticated' || whatsapp.phase === 'syncing') {
      showDialogSyncing(whatsapp.syncPercent);
      return;
    }
    if (whatsapp.hasQr && !whatsapp.demoMode && ui.connectionDialog.open) {
      if (ui.qrShell.hidden) {
        showDialogQr();
        ui.qrNote.textContent = 'QR diperbarui otomatis oleh adapter.';
      }
      const data = await api('/v1/whatsapp/qr');
      if (ui.qrImage.src !== data.qrDataUrl) ui.qrImage.src = data.qrDataUrl;
    }
  } catch (error) {
    ui.qrNote.textContent = error.message;
  }
}

ui.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  ui.loginError.textContent = '';
  const form = new FormData(ui.loginForm);
  try {
    await api('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) });
    showApp();
  } catch (error) {
    ui.loginError.textContent = error.message;
  }
});

ui.composer.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = ui.messageInput.value.trim();
  if ((!text && !state.attachment) || !state.activeChat || state.sending) return;
  state.sending = true;
  if (state.pendingText !== text) {
    state.pendingRequestId = crypto.randomUUID();
    state.pendingText = text;
  }
  const sendButton = ui.composer.querySelector('.send-button');
  sendButton.disabled = true;
  ui.composerStatus.className = 'composer-status sending';
  ui.composerStatus.textContent = 'Mengirim…';
  try {
    await api('/v1/messages/send', { method: 'POST', body: JSON.stringify({
      chatId: state.activeChat.id,
      text,
      clientRequestId: state.pendingRequestId,
      quotedMessageId: state.replyingTo?.id || undefined,
      attachment: state.attachment || undefined,
    }) });
    ui.messageInput.value = '';
    state.pendingRequestId = null;
    state.pendingText = null;
    cancelReply();
    clearAttachment();
    ui.composerStatus.className = 'composer-status success';
    ui.composerStatus.textContent = 'Terkirim';
    await loadMessages('bottom');
    setTimeout(() => {
      if (ui.composerStatus.textContent === 'Terkirim') ui.composerStatus.textContent = '';
    }, 1600);
  } catch {
    // A network/serialization failure can happen after WhatsApp has accepted
    // the message. Reconcile before offering retry to avoid duplicates.
    let confirmed = false;
    try {
      const recent = await api(`/v1/chats/${encodeURIComponent(state.activeChat.id)}/messages?limit=30`);
      const now = Date.now() / 1000;
      confirmed = recent.messages.some((message) => message.fromMe
        && (text ? message.body === text : message.type === state.attachment?.mimetype.split('/')[0])
        && now - Number(message.timestamp || 0) < 90);
    } catch { /* keep the original send error */ }
    if (confirmed) {
      ui.messageInput.value = '';
      state.pendingRequestId = null;
      state.pendingText = null;
      cancelReply();
      clearAttachment();
      ui.composerStatus.className = 'composer-status success';
      ui.composerStatus.textContent = 'Terkirim';
      await loadMessages('bottom');
    } else {
      ui.composerStatus.className = 'composer-status error';
      ui.composerStatus.textContent = 'Belum terkonfirmasi. Tekan kirim untuk mencoba lagi.';
      ui.messageInput.focus();
    }
  } finally {
    state.sending = false;
    sendButton.disabled = false;
  }
});

ui.messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    ui.composer.requestSubmit();
  }
});
ui.messageInput.addEventListener('input', () => {
  if (!state.sending && ui.messageInput.value.trim() !== state.pendingText) {
    state.pendingRequestId = null;
    state.pendingText = null;
    if (ui.composerStatus.classList.contains('error')) ui.composerStatus.textContent = '';
  }
});
document.querySelector('#cancelReply').addEventListener('click', cancelReply);
document.querySelector('#cancelAttachment').addEventListener('click', clearAttachment);
ui.attachmentButton.addEventListener('click', () => ui.attachmentInput.click());
ui.attachmentInput.addEventListener('change', async () => {
  const file = ui.attachmentInput.files?.[0];
  if (!file) return;
  try {
    state.attachment = await fileToAttachment(file);
    state.pendingRequestId = null;
    state.pendingText = null;
    ui.attachmentName.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    ui.attachmentBar.hidden = false;
    ui.composerStatus.textContent = '';
  } catch (error) {
    clearAttachment();
    ui.composerStatus.className = 'composer-status error';
    ui.composerStatus.textContent = error.message;
  }
});
ui.searchInput.addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => loadChats(true), 250);
});
for (const button of ui.tabButtons) {
  button.addEventListener('click', async () => {
    state.activeTab = button.dataset.tab;
    for (const item of ui.tabButtons) item.classList.toggle('active', item === button);
    ui.filterRow.hidden = state.activeTab === 'archived';
    document.querySelector('.inbox-head h1').textContent = state.activeTab === 'archived' ? 'Archived' : 'Inbox';
    await loadChats(true);
  });
}
for (const button of ui.filterButtons) {
  button.addEventListener('click', async () => {
    state.activeFilter = button.dataset.filter;
    for (const item of ui.filterButtons) item.classList.toggle('active', item === button);
    await loadChats(true);
  });
}
ui.loadMoreChats.addEventListener('click', () => loadChats(false));
ui.chatList.addEventListener('scroll', () => {
  const nearEnd = ui.chatList.scrollHeight - ui.chatList.clientHeight - ui.chatList.scrollTop < 100;
  if (nearEnd && state.hasMoreChats) loadChats(false);
});
ui.messageList.addEventListener('scroll', () => {
  if (ui.messageList.scrollTop < 100 && state.hasMoreMessages) loadOlderMessages();
});
ui.connectionButton.addEventListener('click', openConnection);
ui.inboxButton.addEventListener('click', async () => {
  state.activeTab = 'inbox';
  state.activeFilter = 'all';
  for (const item of ui.tabButtons) item.classList.toggle('active', item.dataset.tab === 'inbox');
  for (const item of ui.filterButtons) item.classList.toggle('active', item.dataset.filter === 'all');
  ui.filterRow.hidden = false;
  document.querySelector('.inbox-head h1').textContent = 'Inbox';
  ui.searchInput.value = '';
  await loadChats(true);
  if (window.matchMedia('(max-width: 760px)').matches) {
    ui.conversationPanel.classList.add('mobile-hidden');
    ui.inboxPanel.classList.remove('mobile-hidden');
  }
});
ui.contactsButton.addEventListener('click', openContacts);
ui.funnelButton.addEventListener('click', openFunnel);
ui.adminButton.addEventListener('click', () => { window.location.href = '/admin.html'; });
ui.conversationMenuButton.addEventListener('click', openConversationMenu);
ui.pinnedBar.addEventListener('click', openPinnedMessages);
ui.newConversationButton.addEventListener('click', () => {
  ui.newConversationForm.reset();
  ui.newConversationError.textContent = '';
  ui.newConversationDialog.showModal();
});
document.querySelector('#closeNewConversation').addEventListener('click', () => ui.newConversationDialog.close());
document.querySelector('#closeUtilityDialog').addEventListener('click', () => ui.utilityDialog.close());
document.querySelector('#mediaClose').addEventListener('click', () => ui.mediaViewer.close());
document.querySelector('#mediaZoomIn').addEventListener('click', () => setMediaZoom(state.media.scale + 0.25));
document.querySelector('#mediaZoomOut').addEventListener('click', () => setMediaZoom(state.media.scale - 0.25));
document.querySelector('#mediaReset').addEventListener('click', resetMediaViewer);
ui.mediaDownload.addEventListener('click', () => downloadCurrentMedia().catch(() => {
  ui.mediaZoomLabel.textContent = 'Download gagal';
}));
ui.mediaViewer.addEventListener('click', (event) => {
  if (event.target === ui.mediaViewer) ui.mediaViewer.close();
});
ui.mediaStage.addEventListener('wheel', (event) => {
  if (state.media.kind !== 'image') return;
  event.preventDefault();
  setMediaZoom(state.media.scale + (event.deltaY < 0 ? 0.15 : -0.15));
}, { passive: false });
ui.mediaStage.addEventListener('dblclick', () => {
  if (state.media.kind === 'image') setMediaZoom(state.media.scale > 1 ? 1 : 2);
});
ui.mediaStage.addEventListener('pointerdown', (event) => {
  if (state.media.kind !== 'image') return;
  ui.mediaStage.setPointerCapture(event.pointerId);
  state.media.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.media.pointers.size === 2) {
    const [a, b] = [...state.media.pointers.values()];
    state.media.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
    state.media.pinchScale = state.media.scale;
  }
});
ui.mediaStage.addEventListener('pointermove', (event) => {
  if (state.media.kind !== 'image') return;
  const previous = state.media.pointers.get(event.pointerId);
  if (!previous) return;
  state.media.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (state.media.pointers.size === 2) {
    const [a, b] = [...state.media.pointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (state.media.pinchDistance) setMediaZoom(state.media.pinchScale * distance / state.media.pinchDistance);
  } else if (state.media.scale > 1) {
    state.media.x += event.clientX - previous.x;
    state.media.y += event.clientY - previous.y;
    renderMediaTransform();
  }
});
const releaseMediaPointer = (event) => {
  state.media.pointers.delete(event.pointerId);
  state.media.pinchDistance = 0;
};
ui.mediaStage.addEventListener('pointerup', releaseMediaPointer);
ui.mediaStage.addEventListener('pointercancel', releaseMediaPointer);
ui.mediaViewer.addEventListener('close', () => {
  state.media.pointers.clear();
  ui.mediaViewerImage.removeAttribute('src');
  ui.mediaViewerVideo.pause();
  ui.mediaViewerVideo.removeAttribute('src');
  ui.mediaViewerVideo.load();
  ui.mediaViewer.classList.remove('video-mode');
  resetMediaViewer();
});
document.addEventListener('keydown', (event) => {
  if (!ui.mediaViewer.open || state.media.kind !== 'image') return;
  if (event.key === '+' || event.key === '=') setMediaZoom(state.media.scale + 0.25);
  if (event.key === '-') setMediaZoom(state.media.scale - 0.25);
  if (event.key === '0') resetMediaViewer();
});
ui.newConversationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(ui.newConversationForm);
  const submit = ui.newConversationForm.querySelector('[type="submit"]');
  submit.disabled = true;
  ui.newConversationError.textContent = 'Mengirim…';
  try {
    await api('/v1/messages/send', { method: 'POST', body: JSON.stringify({
      to: form.get('to'),
      text: String(form.get('text') || '').trim(),
      clientRequestId: crypto.randomUUID(),
    }) });
    ui.newConversationDialog.close();
    await loadChats(true);
  } catch (error) {
    ui.newConversationError.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});
ui.handoffButton.addEventListener('click', async () => {
  if (!state.activeChat || ui.handoffButton.disabled) return;
  ui.handoffButton.disabled = true;
  const original = ui.handoffButton.firstChild.textContent;
  ui.handoffButton.firstChild.textContent = 'Assigning… ';
  try {
    await api(`/v1/chats/${encodeURIComponent(state.activeChat.id)}/assign`, {
      method: 'POST',
      body: JSON.stringify({ assignee: 'Sales team' }),
    });
    await loadLead(state.activeChat.id);
  } catch {
    ui.handoffButton.disabled = false;
    ui.handoffButton.firstChild.textContent = original;
  }
});
ui.contextToggle.addEventListener('click', () => {
  ui.contextPanel.classList.add('open');
  ui.appView.classList.remove('context-hidden');
});
ui.contextClose.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 1120px)').matches) ui.contextPanel.classList.remove('open');
  else ui.appView.classList.add('context-hidden');
});
document.querySelector('#closeDialog').addEventListener('click', () => {
  clearInterval(state.connectionTimer);
  state.connectionTimer = null;
  ui.connectionDialog.close();
});

const refreshQrBtn = document.querySelector('#refreshQr');
if (refreshQrBtn) {
  refreshQrBtn.addEventListener('click', async () => {
    if (refreshQrBtn.disabled) return;
    refreshQrBtn.disabled = true;
    refreshQrBtn.classList.add('loading');
    try {
      const data = await api('/v1/whatsapp/qr-refresh', { method: 'POST' });
      if (data?.qrDataUrl) {
        ui.qrImage.src = data.qrDataUrl;
        setTimeout(() => { refreshQrBtn.classList.remove('loading'); refreshQrBtn.disabled = false; }, 400);
      }
    } catch (err) {
      console.warn('QR refresh failed:', err.message);
      refreshQrBtn.classList.remove('loading');
      refreshQrBtn.disabled = false;
    }
  });
}

ui.changeNumberBtn.addEventListener('click', async () => {
  ui.changeNumberBtn.disabled = true;
  ui.changeNumberBtn.textContent = 'Memutus sesi…';
  try {
    await api('/v1/whatsapp/logout', { method: 'POST' });
    state.whatsapp = { phase: 'starting' };
    ui.dialogTitle.textContent = 'Memutus sesi…';
    ui.dialogCopy.textContent = 'WhatsApp sedang logout, QR baru akan muncul sebentar.';
    ui.qrShell.hidden = true;
    ui.changeNumberBtn.hidden = true;
    clearInterval(state.connectionTimer);
    state.connectionTimer = setInterval(checkConnection, 5000);
  } catch (error) {
    ui.changeNumberBtn.textContent = 'Ganti Nomor WhatsApp';
    ui.changeNumberBtn.disabled = false;
    ui.qrNote.textContent = error.message;
  }
});
document.querySelector('#mobileBack').addEventListener('click', () => {
  ui.conversationPanel.classList.add('mobile-hidden');
  ui.inboxPanel.classList.remove('mobile-hidden');
});
document.querySelector('#logoutButton').addEventListener('click', async () => {
  await api('/v1/auth/logout', { method: 'POST' });
  showLogin();
});

window.addEventListener('resize', () => {
  if (!window.matchMedia('(max-width: 1120px)').matches) ui.contextPanel.classList.remove('open');
});

api('/v1/auth/session').then(showApp).catch(showLogin);
