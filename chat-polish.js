/* =====================================================================
   CHAT TIM & PESAN LANGSUNG — POLISH PACK
   Additif, load PALING TERAKHIR (setelah chat-admin-delete.js). Tidak
   mengubah app.js / chat-admin-delete.js.

   Fitur yang ditambahkan:
   1. Reaksi emoji pada pesan (Chat Tim & DM)
   2. Indikator "sedang mengetik" (realtime via Supabase Broadcast)
   3. Grouping pesan beruntun dari pengirim sama + pemisah tanggal
   4. Animasi masuk pesan
   5. Tombol scroll-to-bottom dengan badge pesan baru

   CATATAN SETUP: fitur reaksi butuh kolom `reactions` (jsonb) pada tabel
   `chat_messages` dan `direct_messages`. Jalankan chat-reactions-migration.sql
   di SQL Editor Supabase sebelum memakai fitur reaksi. Fitur lain (mengetik,
   grouping, tanggal, animasi, scroll-to-bottom) langsung jalan tanpa migrasi.
   ===================================================================== */

const CHAT_REACT_EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const CHAT_GROUP_WINDOW_MS = 4 * 60 * 1000; // pesan beruntun dari pengirim sama dalam 4 menit dianggap satu grup

function sameDayPolish(a, b) {
  if (!a || !b) return false;
  return new Date(a).toDateString() === new Date(b).toDateString();
}
function isTodayPolish(iso) {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function isYesterdayPolish(iso) {
  const y = new Date(); y.setDate(y.getDate() - 1);
  return new Date(iso).toDateString() === y.toDateString();
}
function dateSepLabel(iso) {
  if (isTodayPolish(iso)) return 'Hari ini';
  if (isYesterdayPolish(iso)) return 'Kemarin';
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ---------------------------------------------------------------------
   1. REAKSI EMOJI
   --------------------------------------------------------------------- */
let chatOpenPickerId = null;
let dmOpenPickerId = null;

function buildReactionsMarkup(scope, msg) {
  const reactions = msg.reactions || {};
  const entries = Object.entries(reactions).filter(([, uids]) => uids && uids.length);
  const pickerOpen = (scope === 'chat' ? chatOpenPickerId : dmOpenPickerId) === msg.id;
  let html = '';
  if (entries.length) {
    html += `<div class="chat-reactions">` + entries.map(([emoji, uids]) => {
      const mine = uids.includes(currentUser?.id);
      return `<span class="chat-reaction-pill ${mine ? 'mine' : ''}" onclick="event.stopPropagation(); toggleMessageReaction('${scope}','${msg.id}','${emoji}')" title="${uids.length} reaksi">${emoji} <b>${uids.length}</b></span>`;
    }).join('') + `</div>`;
  }
  html += `<button type="button" class="chat-react-trigger" title="Beri reaksi" onclick="event.stopPropagation(); toggleReactPicker('${scope}','${msg.id}')">🙂</button>`;
  if (pickerOpen) {
    html += `<div class="chat-react-picker" onclick="event.stopPropagation()">` +
      CHAT_REACT_EMOJI.map(em => `<button type="button" onclick="toggleMessageReaction('${scope}','${msg.id}','${em}')">${em}</button>`).join('') +
      `</div>`;
  }
  return html;
}

function toggleReactPicker(scope, id) {
  if (scope === 'chat') {
    chatOpenPickerId = (chatOpenPickerId === id) ? null : id;
    renderChatMessages();
  } else {
    dmOpenPickerId = (dmOpenPickerId === id) ? null : id;
    renderDMMessages();
  }
}

async function toggleMessageReaction(scope, id, emoji) {
  const table = scope === 'chat' ? 'chat_messages' : 'direct_messages';
  const cacheArr = scope === 'chat' ? chatMessagesCache : (dmMessagesCache[dmActiveUserId] || []);
  const msg = cacheArr.find(m => m.id === id);
  if (!msg) return;

  // Satu reaksi per orang per pesan: lepas dulu reaksi user ini dari emoji lain.
  const reactions = {};
  Object.entries(msg.reactions || {}).forEach(([key, uids]) => {
    const filtered = (uids || []).filter(uid => uid !== currentUser.id);
    if (filtered.length) reactions[key] = filtered;
  });
  const alreadyThisEmoji = ((msg.reactions || {})[emoji] || []).includes(currentUser.id);
  if (!alreadyThisEmoji) {
    reactions[emoji] = [...(reactions[emoji] || []), currentUser.id];
  }

  msg.reactions = reactions; // optimistic update lokal
  if (scope === 'chat') { chatOpenPickerId = null; renderChatMessages(); }
  else { dmOpenPickerId = null; renderDMMessages(); }

  const { error } = await supa.from(table).update({ reactions }).eq('id', id);
  if (error) {
    console.error('Gagal menyimpan reaksi:', error.message);
    toast('Gagal menyimpan reaksi. Pastikan migrasi kolom reactions sudah dijalankan.', true);
  }
}

// Tutup picker reaksi saat klik di luar area picker/trigger.
document.addEventListener('click', (e) => {
  if (e.target.closest('.chat-react-trigger') || e.target.closest('.chat-react-picker')) return;
  if (chatOpenPickerId) { chatOpenPickerId = null; if (currentView === 'chat') renderChatMessages(); }
  if (dmOpenPickerId) { dmOpenPickerId = null; if (currentView === 'dm') renderDMMessages(); }
});

/* ---------------------------------------------------------------------
   2. GROUPING + PEMISAH TANGGAL + ANIMASI MASUK — override renderChatMessages
   --------------------------------------------------------------------- */
const chatAnimatedIds = new Set();

const _polishPrevRenderChatMessages = renderChatMessages;
renderChatMessages = function () {
  _polishPrevRenderChatMessages();
  const wrap = $('#chatMessages');
  if (!wrap || !chatMessagesCache.length) { chatLastRenderedCount = chatMessagesCache.length || 0; return; }

  const els = $all('.chat-msg', wrap);
  els.forEach((el, i) => {
    const m = chatMessagesCache[i];
    if (!m) return;
    const prev = chatMessagesCache[i - 1];

    if (i === 0 || !sameDayPolish(prev.created_at, m.created_at)) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-sep';
      sep.innerHTML = `<span>${dateSepLabel(m.created_at)}</span>`;
      wrap.insertBefore(sep, el);
    }

    const grouped = prev && prev.sender_id === m.sender_id &&
      sameDayPolish(prev.created_at, m.created_at) &&
      (new Date(m.created_at) - new Date(prev.created_at)) < CHAT_GROUP_WINDOW_MS;
    el.classList.toggle('grouped', !!grouped);

    const animKey = 'chat:' + m.id;
    if (!chatAnimatedIds.has(animKey)) { el.classList.add('msg-anim-in'); chatAnimatedIds.add(animKey); }

    const bubbleWrap = el.querySelector('.chat-bubble-wrap');
    if (bubbleWrap) bubbleWrap.insertAdjacentHTML('beforeend', buildReactionsMarkup('chat', m));
  });

  onChatMessagesRendered();
};

const dmAnimatedIds = new Set();

const _polishPrevRenderDMMessages = renderDMMessages;
renderDMMessages = function () {
  _polishPrevRenderDMMessages();
  const wrap = $('#dmMessages');
  if (!wrap || !dmActiveUserId) return;
  const msgs = dmMessagesCache[dmActiveUserId] || [];
  if (!msgs.length) { dmLastRenderedCount = 0; return; }

  const els = $all('.chat-msg', wrap);
  els.forEach((el, i) => {
    const m = msgs[i];
    if (!m) return;
    const prev = msgs[i - 1];

    if (i === 0 || !sameDayPolish(prev.created_at, m.created_at)) {
      const sep = document.createElement('div');
      sep.className = 'chat-date-sep';
      sep.innerHTML = `<span>${dateSepLabel(m.created_at)}</span>`;
      wrap.insertBefore(sep, el);
    }

    const grouped = prev && prev.sender_id === m.sender_id &&
      sameDayPolish(prev.created_at, m.created_at) &&
      (new Date(m.created_at) - new Date(prev.created_at)) < CHAT_GROUP_WINDOW_MS;
    el.classList.toggle('grouped', !!grouped);

    const animKey = 'dm:' + m.id;
    if (!dmAnimatedIds.has(animKey)) { el.classList.add('msg-anim-in'); dmAnimatedIds.add(animKey); }

    const bubbleWrap = el.querySelector('.chat-bubble-wrap');
    if (bubbleWrap) bubbleWrap.insertAdjacentHTML('beforeend', buildReactionsMarkup('dm', m));
  });

  onDMMessagesRendered();
};

/* ---------------------------------------------------------------------
   3. TOMBOL SCROLL-TO-BOTTOM
   --------------------------------------------------------------------- */
let chatLastRenderedCount = 0;
let chatScrollUnread = 0;
let dmLastRenderedCount = 0;
let dmScrollUnread = 0;

function nearBottom(el) {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function ensureChatScrollWrap() {
  const messagesEl = $('#chatMessages');
  if (!messagesEl) return;
  if (messagesEl.parentElement.classList.contains('chat-scroll-wrap')) return;
  const wrapDiv = document.createElement('div');
  wrapDiv.className = 'chat-scroll-wrap';
  messagesEl.parentElement.insertBefore(wrapDiv, messagesEl);
  wrapDiv.appendChild(messagesEl);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'chat-scroll-btn'; btn.id = 'chatScrollBtn';
  btn.title = 'Ke pesan terbaru';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg><span class="chat-scroll-badge hidden" id="chatScrollBadge">0</span>`;
  btn.onclick = () => { chatScrollUnread = 0; updateChatScrollBadge(); scrollChatToBottom(); handleChatScroll(); };
  wrapDiv.appendChild(btn);
  messagesEl.addEventListener('scroll', handleChatScroll);
}
function handleChatScroll() {
  const wrap = $('#chatMessages'); const btn = $('#chatScrollBtn');
  if (!wrap || !btn) return;
  const atBottom = nearBottom(wrap);
  btn.classList.toggle('show', !atBottom);
  if (atBottom && chatScrollUnread) { chatScrollUnread = 0; updateChatScrollBadge(); }
}
function updateChatScrollBadge() {
  const badge = $('#chatScrollBadge'); if (!badge) return;
  badge.textContent = chatScrollUnread > 9 ? '9+' : String(chatScrollUnread);
  badge.classList.toggle('hidden', chatScrollUnread === 0);
}
function onChatMessagesRendered() {
  const wrap = $('#chatMessages');
  const newCount = chatMessagesCache.length;
  if (wrap && newCount > chatLastRenderedCount && !nearBottom(wrap)) {
    chatScrollUnread += (newCount - chatLastRenderedCount);
    updateChatScrollBadge();
  }
  chatLastRenderedCount = newCount;
  handleChatScroll();
}

function ensureDMScrollWrap() {
  const messagesEl = $('#dmMessages');
  if (!messagesEl) return;
  if (messagesEl.parentElement.classList.contains('chat-scroll-wrap')) return;
  const wrapDiv = document.createElement('div');
  wrapDiv.className = 'chat-scroll-wrap';
  messagesEl.parentElement.insertBefore(wrapDiv, messagesEl);
  wrapDiv.appendChild(messagesEl);
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'chat-scroll-btn'; btn.id = 'dmScrollBtn';
  btn.title = 'Ke pesan terbaru';
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg><span class="chat-scroll-badge hidden" id="dmScrollBadge">0</span>`;
  btn.onclick = () => { dmScrollUnread = 0; updateDMScrollBadge(); scrollDMToBottom(); handleDMScroll(); };
  wrapDiv.appendChild(btn);
  messagesEl.addEventListener('scroll', handleDMScroll);
}
function handleDMScroll() {
  const wrap = $('#dmMessages'); const btn = $('#dmScrollBtn');
  if (!wrap || !btn) return;
  const atBottom = nearBottom(wrap);
  btn.classList.toggle('show', !atBottom);
  if (atBottom && dmScrollUnread) { dmScrollUnread = 0; updateDMScrollBadge(); }
}
function updateDMScrollBadge() {
  const badge = $('#dmScrollBadge'); if (!badge) return;
  badge.textContent = dmScrollUnread > 9 ? '9+' : String(dmScrollUnread);
  badge.classList.toggle('hidden', dmScrollUnread === 0);
}
function onDMMessagesRendered() {
  const wrap = $('#dmMessages');
  const msgs = dmMessagesCache[dmActiveUserId] || [];
  const newCount = msgs.length;
  if (wrap && newCount > dmLastRenderedCount && !nearBottom(wrap)) {
    dmScrollUnread += (newCount - dmLastRenderedCount);
    updateDMScrollBadge();
  }
  dmLastRenderedCount = newCount;
  handleDMScroll();
}

/* ---------------------------------------------------------------------
   4. INDIKATOR "SEDANG MENGETIK" (Supabase Realtime Broadcast)
   --------------------------------------------------------------------- */
const TYPING_STOP_DELAY_MS = 2200;
const TYPING_REMOTE_EXPIRE_MS = 4000;

// --- Chat Tim: satu channel broadcast bersama untuk semua akun ---
let chatTypingChannel = null;
let chatTypingIsSending = false;
let chatTypingSendTimer = null;
const chatTypingRemote = new Map(); // userId -> { name, timer }

function ensureChatTypingChannel() {
  if (chatTypingChannel || !window.supa || !currentUser) return;
  chatTypingChannel = supa.channel('chat_typing_bcast', { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.user_id === currentUser?.id) return;
      const existing = chatTypingRemote.get(payload.user_id);
      if (existing?.timer) clearTimeout(existing.timer);
      if (payload.typing) {
        const timer = setTimeout(() => { chatTypingRemote.delete(payload.user_id); renderChatTypingRow(); }, TYPING_REMOTE_EXPIRE_MS);
        chatTypingRemote.set(payload.user_id, { name: payload.name || 'Seseorang', timer });
      } else {
        chatTypingRemote.delete(payload.user_id);
      }
      renderChatTypingRow();
    })
    .subscribe();
}
function teardownChatTypingChannel() {
  if (chatTypingChannel) { supa.removeChannel(chatTypingChannel); chatTypingChannel = null; }
  chatTypingRemote.forEach(v => v.timer && clearTimeout(v.timer));
  chatTypingRemote.clear();
}
function ensureChatTypingRow() {
  const form = $('#chatForm');
  if (!form || $('#chatTypingRow')) return;
  const row = document.createElement('div');
  row.id = 'chatTypingRow'; row.className = 'chat-typing-row';
  form.parentElement.insertBefore(row, form);
}
function renderChatTypingRow() {
  const row = $('#chatTypingRow'); if (!row) return;
  const names = Array.from(chatTypingRemote.values()).map(v => v.name);
  if (!names.length) { row.classList.remove('show'); row.innerHTML = ''; return; }
  const label = names.length === 1 ? `${escapeHtml(names[0])} sedang mengetik`
    : names.length === 2 ? `${escapeHtml(names[0])} & ${escapeHtml(names[1])} sedang mengetik`
    : `${names.length} orang sedang mengetik`;
  row.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span>${label}…</span>`;
  row.classList.add('show');
}
function handleChatTypingInput() {
  ensureChatTypingChannel();
  if (!chatTypingChannel) return;
  if (!chatTypingIsSending) {
    chatTypingIsSending = true;
    chatTypingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, name: currentProfile?.full_name || currentProfile?.email || 'Pengguna', typing: true } });
  }
  clearTimeout(chatTypingSendTimer);
  chatTypingSendTimer = setTimeout(() => {
    chatTypingIsSending = false;
    chatTypingChannel?.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, typing: false } });
  }, TYPING_STOP_DELAY_MS);
}

// --- DM: satu channel broadcast per pasangan pengguna, dibuat ulang tiap ganti lawan bicara ---
let dmTypingChannel = null;
let dmTypingIsSending = false;
let dmTypingSendTimer = null;
let dmTypingOtherName = null;
let dmTypingRemoteTimer = null;

function dmTypingChannelName(otherId) { return 'dm_typing_' + [currentUser.id, otherId].sort().join('_'); }
function teardownDMTypingChannel() {
  if (dmTypingChannel) { supa.removeChannel(dmTypingChannel); dmTypingChannel = null; }
  if (dmTypingRemoteTimer) { clearTimeout(dmTypingRemoteTimer); dmTypingRemoteTimer = null; }
  dmTypingOtherName = null;
  renderDMTypingRow();
}
function ensureDMTypingChannel(otherId) {
  teardownDMTypingChannel();
  dmTypingChannel = supa.channel(dmTypingChannelName(otherId), { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload || payload.user_id === currentUser?.id) return;
      if (dmTypingRemoteTimer) clearTimeout(dmTypingRemoteTimer);
      if (payload.typing) {
        const user = dmDirectory.find(u => u.id === otherId);
        dmTypingOtherName = user?.full_name || user?.email || 'Pengguna';
        dmTypingRemoteTimer = setTimeout(() => { dmTypingOtherName = null; renderDMTypingRow(); }, TYPING_REMOTE_EXPIRE_MS);
      } else {
        dmTypingOtherName = null;
      }
      renderDMTypingRow();
    })
    .subscribe();
}
function ensureDMTypingRow() {
  const form = $('#dmForm');
  if (!form || $('#dmTypingRow')) return;
  const row = document.createElement('div');
  row.id = 'dmTypingRow'; row.className = 'chat-typing-row';
  form.parentElement.insertBefore(row, form);
}
function renderDMTypingRow() {
  const row = $('#dmTypingRow'); if (!row) return;
  if (!dmTypingOtherName) { row.classList.remove('show'); row.innerHTML = ''; return; }
  row.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span><span>${escapeHtml(dmTypingOtherName)} sedang mengetik…</span>`;
  row.classList.add('show');
}
function handleDMTypingInput() {
  if (!dmActiveUserId || !dmTypingChannel) return;
  if (!dmTypingIsSending) {
    dmTypingIsSending = true;
    dmTypingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, typing: true } });
  }
  clearTimeout(dmTypingSendTimer);
  dmTypingSendTimer = setTimeout(() => {
    dmTypingIsSending = false;
    dmTypingChannel?.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, typing: false } });
  }, TYPING_STOP_DELAY_MS);
}

/* ---------------------------------------------------------------------
   5. SINKRON REAKSI REALTIME UNTUK CHAT TIM
   --------------------------------------------------------------------- */
let chatReactionsChannel = null;
function ensureChatReactionsChannel() {
  if (chatReactionsChannel || !window.supa || !currentUser) return;
  chatReactionsChannel = supa.channel('chat_reactions_stream')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, (payload) => {
      const idx = chatMessagesCache.findIndex(m => m.id === payload.new.id);
      if (idx !== -1) {
        chatMessagesCache[idx] = { ...chatMessagesCache[idx], ...payload.new };
        if (currentView === 'chat') renderChatMessages();
      }
    })
    .subscribe();
}
function teardownChatReactionsChannel() {
  if (chatReactionsChannel) { supa.removeChannel(chatReactionsChannel); chatReactionsChannel = null; }
}

/* ---------------------------------------------------------------------
   6. WIRING — override renderChat, openDMConversation, teardownChat/DM,
      sendChatMessage/sendDMMessage
   --------------------------------------------------------------------- */
const _polishPrevRenderChat = renderChat;
renderChat = async function () {
  await _polishPrevRenderChat();
  ensureChatScrollWrap();
  ensureChatTypingRow();
  ensureChatTypingChannel();
  ensureChatReactionsChannel();
  chatLastRenderedCount = chatMessagesCache.length;
  chatScrollUnread = 0; updateChatScrollBadge(); handleChatScroll();
  renderChatTypingRow();
  const input = $('#chatInput');
  if (input) input.addEventListener('input', handleChatTypingInput);
};

const _polishPrevOpenDMConversation = openDMConversation;
openDMConversation = function (userId) {
  _polishPrevOpenDMConversation(userId);
  ensureDMScrollWrap();
  ensureDMTypingRow();
  ensureDMTypingChannel(userId);
  dmLastRenderedCount = (dmMessagesCache[userId] || []).length;
  dmScrollUnread = 0; updateDMScrollBadge(); handleDMScroll();
  renderDMTypingRow();
  const input = $('#dmInput');
  if (input) input.addEventListener('input', handleDMTypingInput);
};

const _polishPrevSendChatMessage = sendChatMessage;
sendChatMessage = async function (event) {
  clearTimeout(chatTypingSendTimer);
  if (chatTypingIsSending && chatTypingChannel) {
    chatTypingIsSending = false;
    chatTypingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, typing: false } });
  }
  return _polishPrevSendChatMessage(event);
};

const _polishPrevSendDMMessage = sendDMMessage;
sendDMMessage = async function (event) {
  clearTimeout(dmTypingSendTimer);
  if (dmTypingIsSending && dmTypingChannel) {
    dmTypingIsSending = false;
    dmTypingChannel.send({ type: 'broadcast', event: 'typing', payload: { user_id: currentUser.id, typing: false } });
  }
  return _polishPrevSendDMMessage(event);
};

const _polishPrevTeardownChat = teardownChat;
teardownChat = function () {
  _polishPrevTeardownChat();
  teardownChatTypingChannel();
  teardownChatReactionsChannel();
  chatAnimatedIds.clear();
  chatLastRenderedCount = 0; chatScrollUnread = 0;
  chatOpenPickerId = null;
};

const _polishPrevTeardownDM = teardownDM;
teardownDM = function () {
  _polishPrevTeardownDM();
  teardownDMTypingChannel();
  dmAnimatedIds.clear();
  dmLastRenderedCount = 0; dmScrollUnread = 0;
  dmOpenPickerId = null;
};
