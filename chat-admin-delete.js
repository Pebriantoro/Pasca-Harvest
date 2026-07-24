/* =====================================================================
   CHAT TIM — HAPUS PESAN (ADMIN ONLY)
   Additif, load PALING TERAKHIR. Tidak ubah app.js.
   - Admin dapat tombol Hapus di tiap bubble pesan.
   - Hapus pesan sinkron realtime ke semua akun yang lagi buka Chat Tim
     (extend channel chat_messages_stream dengan event DELETE).
   CATATAN: butuh RLS Supabase izinkan DELETE di tabel chat_messages utk
   role admin (cek chat_schema.sql / kebijakan RLS-nya kalau masih gagal).
   ===================================================================== */

function isAdminChatDelete(){
  return currentProfile?.role === 'admin';
}

// --- Override renderChatMessages: tambah tombol Hapus utk admin ---
const _prevRenderChatMessages = renderChatMessages;
renderChatMessages = function () {
  _prevRenderChatMessages();
  if (!isAdminChatDelete()) return;
  const wrap = $('#chatMessages');
  if (!wrap) return;
  $all('.chat-msg', wrap).forEach((el, i) => {
    const m = chatMessagesCache[i];
    if (!m || el.querySelector('.chat-delete-btn')) return;
    const metaEl = el.querySelector('.chat-meta');
    if (!metaEl) return;
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline btn-sm chat-delete-btn';
    btn.title = 'Hapus pesan';
    btn.style.cssText = 'padding:1px 6px; font-size:11px; margin-left:6px;';
    btn.textContent = '✕';
    btn.onclick = () => confirmDeleteChatMessage(m.id);
    metaEl.appendChild(btn);
  });
};

function confirmDeleteChatMessage(id) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Pesan?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Pesan akan dihapus permanen dari Chat Tim untuk semua akun.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteChatMessage('${id}')">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function doDeleteChatMessage(id) {
  const { error } = await supa.from('chat_messages').delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if (error) { toast('Gagal menghapus pesan: ' + error.message, true); return; }
  chatMessagesCache = chatMessagesCache.filter(m => m.id !== id);
  renderChatMessages();
  toast('Pesan berhasil dihapus');
}

// --- Override initChat: tambah listener DELETE di channel realtime ---
// (channel sama, cuma nambah handler kedua supaya penghapusan pesan oleh
// admin langsung hilang juga di layar akun lain tanpa refresh)
const _prevInitChat = initChat;
initChat = async function () {
  await loadChatMessages();
  if (chatChannel) return;
  chatChannel = supa.channel('chat_messages_stream')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, (payload) => {
      chatMessagesCache.push(payload.new);
      if (chatMessagesCache.length > CHAT_HISTORY_LIMIT) chatMessagesCache.shift();
      const isOwnMessage = payload.new.sender_id === currentUser?.id;
      if (currentView === 'chat') { renderChatMessages(); scrollChatToBottom(); }
      else if (!isOwnMessage) { chatUnreadCount++; updateChatBadge(); }
      if (!isOwnMessage) playChatSound();
      if (!isOwnMessage && currentView !== 'chat') showChatBubbleNotif(payload.new);
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, (payload) => {
      chatMessagesCache = chatMessagesCache.filter(m => m.id !== payload.old.id);
      if (currentView === 'chat') renderChatMessages();
    })
    .subscribe();
};
