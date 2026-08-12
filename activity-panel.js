/* =====================================================================
   ACTIVITY PANEL (sidebar kanan)
   Additif, load paling terakhir. Berisi:
   - Pesan, dengan toggle "Chat Langsung" (DM) / "Chat Tim" -- data
     dipakai ulang dari state yang sudah ada di app.js (dmDirectory,
     dmMessagesCache, dmUnreadByUser, chatMessagesCache, isUserOnline).
   - Live Location: posisi terakhir semua akun (tabel baru
     `user_locations`, lihat user_locations_schema.sql). Kalau tabel
     belum dibuat, section ini otomatis sembunyi -- tidak error.
   - Auto-hide: panel geser keluar layar setelah tidak disentuh
     beberapa detik, nyisain tab kecil di tepi kanan. Bisa di-pin
     supaya tetap terbuka.
   ===================================================================== */
(function(){
  const AP_AUTOHIDE_MS = 6000;
  const AP_LOC_UPSERT_MIN_GAP_MS = 8000;
  const AP_LOC_TABLE = 'user_locations';
  const AP_PIN_KEY = 'activityPanelPinned';
  const AP_MAX_ROWS = 8;

  let apReady = false;
  let apState = {
    tab: 'dm',            // 'dm' | 'team'
    pinned: false,
    open: false,
    locations: {},        // user_id -> { lat, lng, updated_at }
    profilesById: {},      // user_id -> profile-ish { full_name, avatar_url }
    locTableMissing: false,
    lastLocSentAt: 0,
    dmThreadUserId: null,  // percakapan DM yang sedang dibuka inline di panel (null = tampil daftar)
    fullMapOpen: false,    // modal peta live location (full) lagi terbuka?
  };
  let apHideTimer = null;
  let apRefreshTimer = null;
  let apLocChannel = null;
  let apGeoWatchId = null;
  let apMap = null;
  let apMarkers = {};
  let apFullMap = null;
  let apFullMarkers = {};

  /* ---------------------------------------------------------------
     0. BOOTSTRAP -- tunggu app shell + login siap, baru pasang panel
     --------------------------------------------------------------- */
  function appIsLive(){
    const shell = document.getElementById('appShell');
    return !!(shell && !shell.classList.contains('hidden') && typeof currentUser !== 'undefined' && currentUser);
  }

  const bootPoll = setInterval(() => {
    if(apReady) { clearInterval(bootPoll); return; }
    if(appIsLive()){ apInit(); clearInterval(bootPoll); }
  }, 1200);

  function apInit(){
    if(apReady) return;
    apReady = true;
    try { apState.pinned = localStorage.getItem(AP_PIN_KEY) === '1'; } catch(_e){}
    apBuildDOM();
    apSetTab('dm', { silent: true });
    apRefreshMessages();
    apInitLocation();

    // Refresh ringan berkala -- cukup buat data pesan tetap terasa hidup
    // tanpa perlu nge-hook semua fungsi render internal app.js.
    apRefreshTimer = setInterval(() => { if(apState.open || apState.pinned) apRefreshMessages(); }, 4000);

    if(apState.pinned) apShow();
    // Kalau tidak di-pin, panel tidak langsung muncul pas baru login --
    // cukup tunggu diklik lewat handle, atau muncul otomatis kalau ada
    // pesan baru (lihat apRenderBadges).
  }

  /* ---------------------------------------------------------------
     1. DOM
     --------------------------------------------------------------- */
  function apBuildDOM(){
    if(document.getElementById('activityPanel')) return;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.id = 'apHandle';
    handle.className = 'ap-handle';
    handle.title = 'Aktivitas';
    handle.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      <span class="ap-handle-badge hidden" id="apHandleBadge">0</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="10" r="3"/><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/></svg>
    `;
    handle.addEventListener('click', () => apState.open ? apHide(true) : apShow());

    const panel = document.createElement('aside');
    panel.id = 'activityPanel';
    panel.className = 'activity-panel';
    panel.innerHTML = `
      <div class="ap-header">
        <span class="ap-header-title">Aktivitas</span>
        <span class="ap-header-online" id="apOnlineBadge" title="Pengguna online sekarang">
          <span class="online-dot" id="apOnlineDot"></span>
          <span id="apOnlineCount">0</span> Online
        </span>
        <div class="ap-header-actions">
          <button type="button" class="ap-icon-btn" id="apPinBtn" title="Sematkan panel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/></svg>
          </button>
          <button type="button" class="ap-icon-btn" id="apCloseBtn" title="Sembunyikan">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </div>

      <div class="ap-tabs">
        <button type="button" class="ap-tab active" data-tab="dm">Chat Langsung <span class="count-badge hidden" id="apDmCount">0</span></button>
        <button type="button" class="ap-tab" data-tab="team">Chat Tim <span class="count-badge hidden" id="apTeamCount">0</span></button>
      </div>

      <div class="ap-list" id="apList"></div>

      <form class="ap-composer" id="apComposer" onsubmit="return false;">
        <textarea class="ap-composer-input" id="apComposerInput" rows="1" placeholder="Tulis pesan…"></textarea>
        <button type="button" class="ap-composer-send" id="apComposerSend" title="Kirim">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>
        </button>
      </form>
      <div class="ap-composer-hint" id="apComposerHint">Pilih percakapan untuk mengirim pesan.</div>

      <div class="ap-loc-section" id="apLocSection" style="display:none;">
        <div class="ap-loc-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 6-9 12-9 12s-9-6-9-12a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          <span>Live Location</span>
          <span class="ap-loc-header-link" id="apLocViewAll">Lihat semua</span>
        </div>
        <div class="ap-map" id="apMap"></div>
        <div class="ap-loc-list" id="apLocList"></div>
      </div>
    `;

    document.body.appendChild(handle);
    document.body.appendChild(panel);

    panel.querySelectorAll('.ap-tab').forEach(btn => {
      btn.addEventListener('click', () => apSetTab(btn.dataset.tab));
    });
    document.getElementById('apCloseBtn').addEventListener('click', () => apHide(true));
    document.getElementById('apPinBtn').addEventListener('click', apTogglePin);
    document.getElementById('apLocViewAll').addEventListener('click', apOpenFullMap);

    const composerInput = document.getElementById('apComposerInput');
    document.getElementById('apComposerSend').addEventListener('click', apComposerSubmit);
    composerInput.addEventListener('keydown', e => {
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); apComposerSubmit(); }
    });
    composerInput.addEventListener('input', () => {
      composerInput.style.height = '';
      composerInput.style.height = Math.min(composerInput.scrollHeight, 90) + 'px';
    });

    // Panel hanya terbuka lewat klik pada tab/pegangan -- tidak lagi
    // otomatis muncul cuma karena kursor lewat di dekatnya.
    ['mousemove', 'click', 'scroll', 'keydown'].forEach(evt => {
      panel.addEventListener(evt, () => { if(apState.open) apScheduleHide(); }, { passive: true });
    });

    apApplyPinUI();
  }

  /* ---------------------------------------------------------------
     2. SHOW / HIDE / PIN
     --------------------------------------------------------------- */
  function apShow(){
    apState.open = true;
    document.getElementById('activityPanel')?.classList.add('ap-open');
    if(apMap) setTimeout(() => apMap.invalidateSize(), 340);
    if(!apState.pinned) apScheduleHide();
  }
  function apHide(force){
    if(apState.pinned && !force) return;
    apState.open = false;
    document.getElementById('activityPanel')?.classList.remove('ap-open');
    clearTimeout(apHideTimer);
  }
  function apScheduleHide(delay){
    clearTimeout(apHideTimer);
    if(apState.pinned) return;
    apHideTimer = setTimeout(() => apHide(), delay || AP_AUTOHIDE_MS);
  }
  function apTogglePin(){
    apState.pinned = !apState.pinned;
    try { localStorage.setItem(AP_PIN_KEY, apState.pinned ? '1' : '0'); } catch(_e){}
    apApplyPinUI();
    if(apState.pinned){ clearTimeout(apHideTimer); apShow(); }
    else apScheduleHide();
  }
  function apApplyPinUI(){
    const btn = document.getElementById('apPinBtn');
    if(!btn) return;
    btn.classList.toggle('on', apState.pinned);
    btn.title = apState.pinned ? 'Lepas sematan' : 'Sematkan panel';
  }

  /* ---------------------------------------------------------------
     3. TABS + PESAN (reuse state punya app.js, tidak duplikasi data)
     --------------------------------------------------------------- */
  function apSetTab(tab, opts){
    apState.tab = tab;
    apState.dmThreadUserId = null; // pindah tab -> balik ke tampilan daftar
    document.querySelectorAll('.ap-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    apRenderMessages();
    if(!opts || !opts.silent) apScheduleHide();
  }

  function apRefreshMessages(){
    apRenderMessages();
    apRenderBadges();
    apUpdateOnlineBadge();
  }

  function apUpdateOnlineBadge(){
    const dot = document.getElementById('apOnlineDot');
    const label = document.getElementById('apOnlineCount');
    if(!dot || !label) return;
    const n = typeof getOnlineUsersList === 'function' ? getOnlineUsersList().length : 0;
    label.textContent = n;
    dot.classList.toggle('online-dot-live', n > 0);
  }

  function apRenderBadges(){
    const dmTotal = Object.values((typeof dmUnreadByUser !== 'undefined' && dmUnreadByUser) || {}).reduce((a,b)=>a+b, 0);
    const teamTotal = (typeof chatUnreadCount !== 'undefined' && chatUnreadCount) || 0;
    const total = dmTotal + teamTotal;

    const dmEl = document.getElementById('apDmCount');
    if(dmEl){ dmEl.textContent = dmTotal > 99 ? '99+' : dmTotal; dmEl.classList.toggle('hidden', !dmTotal); }
    const teamEl = document.getElementById('apTeamCount');
    if(teamEl){ teamEl.textContent = teamTotal > 99 ? '99+' : teamTotal; teamEl.classList.toggle('hidden', !teamTotal); }

    const handleBadge = document.getElementById('apHandleBadge');
    if(handleBadge){ handleBadge.textContent = total > 99 ? '99+' : total; handleBadge.classList.toggle('hidden', !total); }
    const mobileBadge = document.getElementById('apMobileBadge');
    if(mobileBadge){ mobileBadge.textContent = total > 99 ? '99+' : total; mobileBadge.classList.toggle('hidden', !total); }

    // Ping otomatis: kalau ada pesan baru & panel lagi disembunyikan, sembulkan sebentar.
    if(total > 0 && !apState.open && !apState.pinned && apState._lastTotal !== total){
      apShow();
    }
    apState._lastTotal = total;
  }

  function apRenderMessages(){
    const wrap = document.getElementById('apList');
    if(!wrap) return;
    if(apState.tab === 'dm'){
      if(apState.dmThreadUserId) apRenderDMThread(wrap, apState.dmThreadUserId);
      else apRenderDMList(wrap);
    } else {
      apRenderTeamList(wrap);
    }
    apUpdateComposerVisibility();
  }
  window.apRefreshMessages = apRefreshMessages;

  function apRenderDMList(wrap){
    const dir = (typeof dmDirectory !== 'undefined' && dmDirectory) || [];
    if(!dir.length){
      wrap.innerHTML = `<div class="ap-empty">Belum ada rekan kerja terdaftar.</div>`;
      return;
    }
    const cache = (typeof dmMessagesCache !== 'undefined' && dmMessagesCache) || {};
    const unread = (typeof dmUnreadByUser !== 'undefined' && dmUnreadByUser) || {};
    const list = dir.map(u => {
      const msgs = cache[u.id] || [];
      const last = msgs[msgs.length - 1];
      return { ...u, lastMsg: last, lastTime: last ? new Date(last.created_at).getTime() : 0, unread: unread[u.id] || 0 };
    }).sort((a,b) => b.lastTime - a.lastTime || (a.full_name||'').localeCompare(b.full_name||''))
      .slice(0, AP_MAX_ROWS);

    wrap.innerHTML = list.map(u => {
      const online = typeof isUserOnline === 'function' ? isUserOnline(u.id) : false;
      const prefix = u.lastMsg ? (u.lastMsg.sender_id === (typeof currentUser !== 'undefined' && currentUser?.id) ? 'Anda: ' : '') : '';
      const preview = u.lastMsg ? apEsc(prefix + u.lastMsg.message) : 'Belum ada pesan';
      const time = u.lastMsg ? apTimeAgo(u.lastMsg.created_at) : '';
      return `
        <div class="ap-row" onclick="apOpenDMThread('${u.id}')">
          <div class="ap-avatar-wrap">
            <div class="ap-avatar" style="${apAvatarStyle(u.avatar_url)}"></div>
            <span class="ap-online-dot ${online ? 'live' : ''}"></span>
          </div>
          <div class="ap-row-body">
            <div class="ap-row-name">${apEsc(u.full_name || u.email || 'Pengguna')}</div>
            <div class="ap-row-preview">${preview}</div>
          </div>
          <div class="ap-row-meta">
            <span class="ap-row-time">${time}</span>
            ${u.unread ? `<span class="ap-row-badge">${u.unread > 99 ? '99+' : u.unread}</span>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  // Percakapan DM dibuka inline di dalam panel (tanpa pindah halaman)
  // supaya bisa langsung balas dari sini.
  function apRenderDMThread(wrap, userId){
    const dir = (typeof dmDirectory !== 'undefined' && dmDirectory) || [];
    const user = dir.find(u => u.id === userId);
    const msgs = ((typeof dmMessagesCache !== 'undefined' && dmMessagesCache) || {})[userId] || [];
    const meId = typeof currentUser !== 'undefined' && currentUser?.id;
    const bubbles = msgs.slice(-30).map(m => {
      const mine = m.sender_id === meId;
      return `
        <div class="ap-msg ${mine ? 'mine' : ''}">
          <div class="ap-msg-bubble">${apEsc(m.message)}</div>
          <div class="ap-msg-time">${apTimeAgo(m.created_at)}</div>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="ap-thread-header">
        <button type="button" class="ap-icon-btn" onclick="apCloseDMThread()" title="Kembali ke daftar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div class="ap-avatar" style="${apAvatarStyle(user?.avatar_url)}"></div>
        <div class="ap-thread-name">${apEsc(user?.full_name || user?.email || 'Pengguna')}</div>
        <span class="ap-thread-open-full" onclick="apOpenDM('${userId}')">Buka penuh</span>
      </div>
      <div class="ap-thread-msgs" id="apThreadMsgs">${bubbles || '<div class="ap-empty">Belum ada pesan.</div>'}</div>
    `;
    const box = document.getElementById('apThreadMsgs');
    if(box) box.scrollTop = box.scrollHeight;
    if(typeof markDMConversationRead === 'function') markDMConversationRead(userId);
  }

  window.apOpenDMThread = function(userId){
    apState.dmThreadUserId = userId;
    apRenderMessages();
  };
  window.apCloseDMThread = function(){
    apState.dmThreadUserId = null;
    apRenderMessages();
  };

  function apRenderTeamList(wrap){
    const msgs = (typeof chatMessagesCache !== 'undefined' && chatMessagesCache) || [];
    if(!msgs.length){
      wrap.innerHTML = `<div class="ap-empty">Belum ada obrolan tim.</div>`;
      return;
    }
    // Ringkas jadi 1 baris terakhir per pengirim, terbaru di atas.
    const bySender = new Map();
    msgs.forEach(m => bySender.set(m.sender_id, m));
    const list = Array.from(bySender.values())
      .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, AP_MAX_ROWS);

    wrap.innerHTML = list.map(m => {
      const online = typeof isUserOnline === 'function' ? isUserOnline(m.sender_id) : false;
      const mine = m.sender_id === (typeof currentUser !== 'undefined' && currentUser?.id);
      return `
        <div class="ap-row" onclick="apOpenTeamChat()">
          <div class="ap-avatar-wrap">
            <div class="ap-avatar" style="${apAvatarStyle(m.sender_avatar_url)}"></div>
            <span class="ap-online-dot ${online ? 'live' : ''}"></span>
          </div>
          <div class="ap-row-body">
            <div class="ap-row-name">${apEsc(m.sender_name || 'Pengguna')}</div>
            <div class="ap-row-preview">${mine ? 'Anda: ' : ''}${apEsc(m.message || '')}</div>
          </div>
          <div class="ap-row-meta"><span class="ap-row-time">${apTimeAgo(m.created_at)}</span></div>
        </div>`;
    }).join('');
  }

  window.apOpenDM = function(userId){
    if(typeof startDMWith === 'function') startDMWith(userId);
    else if(typeof navigate === 'function') navigate('dm');
    apHide(true);
  };
  window.apOpenTeamChat = function(){
    if(typeof navigate === 'function') navigate('chat');
    apHide(true);
  };

  /* ---------------------------------------------------------------
     3b. KOMPOSER -- kirim pesan langsung dari dalam panel, tanpa
     perlu pindah ke halaman Chat Tim / Pesan Langsung.
     --------------------------------------------------------------- */
  function apUpdateComposerVisibility(){
    const form = document.getElementById('apComposer');
    const hint = document.getElementById('apComposerHint');
    if(!form || !hint) return;
    const canSend = apState.tab === 'team' || (apState.tab === 'dm' && apState.dmThreadUserId);
    form.style.display = canSend ? '' : 'none';
    hint.style.display = canSend ? 'none' : '';
  }

  async function apComposerSubmit(){
    const input = document.getElementById('apComposerInput');
    const text = (input?.value || '').trim();
    if(!text) return;
    input.value = '';
    input.style.height = '';

    if(apState.tab === 'team') await apSendTeamMessage(text);
    else if(apState.tab === 'dm' && apState.dmThreadUserId) await apSendDMMessage(apState.dmThreadUserId, text);
    apRenderMessages();
  }

  async function apSendTeamMessage(text){
    if(typeof supa === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return;
    const { error } = await supa.from('chat_messages').insert({
      sender_id: currentUser.id,
      sender_name: (typeof currentProfile !== 'undefined' && currentProfile?.full_name) || currentUser.email || 'Pengguna',
      sender_role: (typeof currentProfile !== 'undefined' && currentProfile?.role) || null,
      message: text,
    });
    if(error) apToast('Gagal mengirim pesan: ' + error.message, true);
  }

  async function apSendDMMessage(userId, text){
    if(typeof supa === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return;
    const dir = (typeof dmDirectory !== 'undefined' && dmDirectory) || [];
    const recipient = dir.find(u => u.id === userId);
    const { error } = await supa.from('direct_messages').insert({
      sender_id: currentUser.id,
      recipient_id: userId,
      sender_name: (typeof currentProfile !== 'undefined' && currentProfile?.full_name) || currentUser.email || 'Pengguna',
      recipient_name: recipient?.full_name || recipient?.email || 'Pengguna',
      message: text,
    });
    if(error) apToast('Gagal mengirim pesan: ' + error.message, true);
  }

  function apToast(msg, isError){
    if(typeof toast === 'function') toast(msg, isError);
    else console.error(msg);
  }

  /* ---------------------------------------------------------------
     4. LIVE LOCATION -- tabel user_locations (opsional, lihat .sql)
     --------------------------------------------------------------- */
  async function apInitLocation(){
    await apLoadProfilesForLocation();
    await apLoadLocations();
    apSubscribeLocations();
    apStartGeoWatch();
  }

  async function apLoadProfilesForLocation(){
    try{
      if(typeof rkhLoadProfiles === 'function'){
        apState.profilesById = await rkhLoadProfiles();
        return;
      }
    }catch(_e){ /* fallback di bawah */ }
    const map = {};
    ((typeof dmDirectory !== 'undefined' && dmDirectory) || []).forEach(u => map[u.id] = u);
    if(typeof currentUser !== 'undefined' && currentUser && typeof currentProfile !== 'undefined' && currentProfile) map[currentUser.id] = currentProfile;
    apState.profilesById = map;
  }

  async function apLoadLocations(){
    if(typeof supa === 'undefined' || apState.locTableMissing) return;
    try{
      const { data, error } = await supa.from(AP_LOC_TABLE).select('*').limit(500);
      if(error){
        if(apIsMissingTableError(error)) apState.locTableMissing = true;
        return;
      }
      (data || []).forEach(row => { apState.locations[row.user_id] = row; });
      apRenderLocationSection();
    }catch(_e){ /* diam -- fitur opsional */ }
  }

  function apIsMissingTableError(error){
    const msg = (error && (error.message || '')).toLowerCase();
    return error?.code === '42P01' || msg.includes('does not exist') || msg.includes('not find the table');
  }

  function apSubscribeLocations(){
    if(typeof supa === 'undefined' || apState.locTableMissing || apLocChannel) return;
    apLocChannel = supa.channel('user_locations_stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: AP_LOC_TABLE }, p => apOnLocationRow(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: AP_LOC_TABLE }, p => apOnLocationRow(p.new))
      .subscribe();
  }
  function apOnLocationRow(row){
    apState.locations[row.user_id] = row;
    apRenderLocationSection();
  }

  // Minta izin lokasi browser & upsert posisi akun sendiri secara berkala.
  // Ditolak user / tidak didukung browser -> section lokasi akun lain
  // tetap jalan, cuma akun ini saja yang tidak ikut terlacak.
  function apStartGeoWatch(){
    if(!navigator.geolocation || typeof currentUser === 'undefined' || !currentUser || apState.locTableMissing) return;
    apGeoWatchId = navigator.geolocation.watchPosition(
      pos => apMaybeSendLocation(pos),
      () => { /* izin ditolak / gagal -- diam saja */ },
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 }
    );
  }
  async function apMaybeSendLocation(pos){
    const now = Date.now();
    if(now - apState.lastLocSentAt < AP_LOC_UPSERT_MIN_GAP_MS) return;
    apState.lastLocSentAt = now;
    if(typeof supa === 'undefined' || typeof currentUser === 'undefined' || !currentUser || apState.locTableMissing) return;
    const row = {
      user_id: currentUser.id,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy || null,
      updated_at: new Date().toISOString(),
    };
    try{
      const { error } = await supa.from(AP_LOC_TABLE).upsert(row, { onConflict: 'user_id' });
      if(error && apIsMissingTableError(error)){ apState.locTableMissing = true; return; }
      apState.locations[row.user_id] = row;
      apRenderLocationSection();
    }catch(_e){ /* diam -- fitur opsional */ }
  }

  function apRenderLocationSection(){
    const section = document.getElementById('apLocSection');
    if(!section) return;
    const entries = Object.entries(apState.locations);
    if(apState.locTableMissing || !entries.length){
      section.style.display = 'none';
      return;
    }
    section.style.display = '';
    apRenderLocationList(entries);
    apRenderMap(entries);
    if(apState.fullMapOpen) apRenderFullMap(entries);
  }

  function apRenderLocationList(entries){
    const wrap = document.getElementById('apLocList');
    if(!wrap) return;
    const rows = entries
      .map(([uid, loc]) => ({ uid, loc, profile: apState.profilesById[uid] }))
      .sort((a,b) => new Date(b.loc.updated_at) - new Date(a.loc.updated_at))
      .slice(0, AP_MAX_ROWS);

    wrap.innerHTML = rows.map(r => {
      const name = r.profile?.full_name || 'Pengguna';
      const isSelf = r.uid === (typeof currentUser !== 'undefined' && currentUser?.id);
      return `
        <div class="ap-loc-row" onclick="apFocusOnMap('${r.uid}')">
          <div class="ap-avatar" style="${apAvatarStyle(r.profile?.avatar_url)}"></div>
          <div class="ap-loc-name">${apEsc(name)}${isSelf ? ' (Anda)' : ''}</div>
          <span class="ap-loc-time">${apTimeAgo(r.loc.updated_at)}</span>
        </div>`;
    }).join('');
  }

  /* ---------------------------------------------------------------
     4c. LABEL PETAK di marker Live Location -- reuse boundary geojson
     & cache yang sama dipakai menu Peta (peta-gis.js), gak fetch ulang.
     Leaflet gak punya point-in-polygon bawaan, jadi ray-casting manual
     (cukup buat ring terluar, lubang polygon diabaikan -- kasus jarang
     di petak kebun). Async & non-blocking: marker langsung muncul,
     label petak nyusul begitu ketemu.
     --------------------------------------------------------------- */
  function apPointInRing(lat, lng, ring){
    let inside = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const hit = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function apPointInGeometry(lat, lng, geom){
    if(!geom) return false;
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.some(rings => rings[0] && apPointInRing(lat, lng, rings[0]));
  }

  const apPetakCache = {}; // uid -> { lat, lng, petak } -- skip lookup ulang kalau lokasi gak berubah

  async function apPetakAtCached(uid, lat, lng){
    const c = apPetakCache[uid];
    if(c && c.lat === lat && c.lng === lng) return c.petak;
    const petak = await apPetakAt(lat, lng);
    apPetakCache[uid] = { lat, lng, petak };
    return petak;
  }

  async function apPetakAt(lat, lng){
    if(typeof loadPetaGeoJson !== 'function') return null; // peta-gis.js belum ke-load
    try{
      const geojson = await loadPetaGeoJson();
      const f = geojson.features.find(f => apPointInGeometry(lat, lng, f.geometry));
      return f?.properties?.petak || null;
    }catch(e){ return null; } // offline/gagal load boundary -- skip label, jangan ganggu marker
  }

  function apRenderMap(entries){
    if(typeof L === 'undefined') return;
    const container = document.getElementById('apMap');
    if(!container) return;

    if(!apMap){
      apMap = L.map(container, { zoomControl: false, attributionControl: false, scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(apMap);
      apMap.setView([-2.5, 118], 4); // fallback: tengah Indonesia
    }

    const seen = new Set();
    entries.forEach(([uid, loc]) => {
      if(loc.lat == null || loc.lng == null) return;
      seen.add(uid);
      const isSelf = uid === (typeof currentUser !== 'undefined' && currentUser?.id);
      const icon = L.divIcon({ className: '', html: `<div class="ap-leaflet-pin ${isSelf ? 'self' : ''}"></div>`, iconSize: [20,20], iconAnchor: [10,20] });
      if(apMarkers[uid]) apAnimateMarkerTo(apMarkers[uid], loc.lat, loc.lng);
      else apMarkers[uid] = L.marker([loc.lat, loc.lng], { icon }).addTo(apMap);
      const name = apState.profilesById[uid]?.full_name || 'Pengguna';
      apMarkers[uid].bindTooltip(apEsc(name));
      apPetakAtCached(uid, loc.lat, loc.lng).then(petak => {
        if(petak) apMarkers[uid]?.setTooltipContent(`${apEsc(name)} — Petak ${apEsc(petak)}`);
      });
    });
    Object.keys(apMarkers).forEach(uid => { if(!seen.has(uid)){ apMap.removeLayer(apMarkers[uid]); delete apMarkers[uid]; } });

    const pts = Object.values(apMarkers).map(m => m.getLatLng());
    if(pts.length) apMap.fitBounds(L.latLngBounds(pts), { padding: [18,18], maxZoom: 13 });
  }

  function apAnimateMarkerTo(marker, lat, lng, duration){
    if(!marker) return;
    const from = marker.getLatLng();
    if(from.lat === lat && from.lng === lng) return;
    const start = performance.now();
    const dur = duration || 700;
    function step(now){
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
      marker.setLatLng([
        from.lat + (lat - from.lat) * ease,
        from.lng + (lng - from.lng) * ease
      ]);
      if(t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.apFocusOnMap = function(uid){
    const loc = apState.locations[uid];
    if(loc && apMap) apMap.setView([loc.lat, loc.lng], 14);
  };

  /* ---------------------------------------------------------------
     4b. MODAL PETA LIVE LOCATION (full) -- dibuka lewat "Lihat semua".
     Beda sama menu Peta biasa (petak GIS statis): ini nampilin posisi
     akun real-time dari tabel user_locations, kayak apMap tapi gede.
     --------------------------------------------------------------- */
  function apBuildFullMapDOM(){
    if(document.getElementById('apFullMapModal')) return;
    const modal = document.createElement('div');
    modal.id = 'apFullMapModal';
    modal.className = 'ap-fullmap-modal';
    modal.innerHTML = `
      <div class="ap-fullmap-backdrop" id="apFullMapBackdrop"></div>
      <div class="ap-fullmap-panel">
        <div class="ap-fullmap-header">
          <span>Live Location — Semua Akun</span>
          <button type="button" class="ap-icon-btn" id="apFullMapClose" title="Tutup">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="ap-fullmap-body">
          <div class="ap-fullmap-map" id="apFullMap"></div>
          <div class="ap-fullmap-list" id="apFullMapList"></div>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('apFullMapClose').addEventListener('click', apCloseFullMap);
    document.getElementById('apFullMapBackdrop').addEventListener('click', apCloseFullMap);
  }

  function apOpenFullMap(){
    apBuildFullMapDOM();
    apState.fullMapOpen = true;
    document.getElementById('apFullMapModal')?.classList.add('ap-open');
    const entries = Object.entries(apState.locations);
    apRenderFullMap(entries);
    setTimeout(() => apFullMap && apFullMap.invalidateSize(), 60);
  }

  function apCloseFullMap(){
    apState.fullMapOpen = false;
    document.getElementById('apFullMapModal')?.classList.remove('ap-open');
  }

  function apRenderFullMap(entries){
    if(typeof L === 'undefined') return;
    const container = document.getElementById('apFullMap');
    if(!container) return;

    if(!apFullMap){
      apFullMap = L.map(container, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18 }).addTo(apFullMap);
      apFullMap.setView([-2.5, 118], 4);
    }

    const seen = new Set();
    entries.forEach(([uid, loc]) => {
      if(loc.lat == null || loc.lng == null) return;
      seen.add(uid);
      const isSelf = uid === (typeof currentUser !== 'undefined' && currentUser?.id);
      const name = apState.profilesById[uid]?.full_name || 'Pengguna';
      const icon = L.divIcon({ className: '', html: `<div class="ap-leaflet-pin ${isSelf ? 'self' : ''}"></div>`, iconSize: [22,22], iconAnchor: [11,22] });
      if(apFullMarkers[uid]) apAnimateMarkerTo(apFullMarkers[uid], loc.lat, loc.lng);
      else apFullMarkers[uid] = L.marker([loc.lat, loc.lng], { icon }).addTo(apFullMap);
      const popupBase = `<b>${apEsc(name)}${isSelf ? ' (Anda)' : ''}</b><br>${apEsc(apTimeAgo(loc.updated_at))}`;
      const cached = apPetakCache[uid];
      const knownPetak = (cached && cached.lat === loc.lat && cached.lng === loc.lng) ? cached.petak : undefined;
      apFullMarkers[uid].bindPopup(`${popupBase}<br>Petak: <b>${knownPetak !== undefined ? (knownPetak || '–') : '…'}</b>`);
      if(knownPetak === undefined){
        apPetakAtCached(uid, loc.lat, loc.lng).then(petak => {
          apFullMarkers[uid]?.setPopupContent(`${popupBase}<br>Petak: <b>${petak ? apEsc(petak) : '–'}</b>`);
        });
      }
    });
    Object.keys(apFullMarkers).forEach(uid => { if(!seen.has(uid)){ apFullMap.removeLayer(apFullMarkers[uid]); delete apFullMarkers[uid]; } });

    const pts = Object.values(apFullMarkers).map(m => m.getLatLng());
    if(pts.length) apFullMap.fitBounds(L.latLngBounds(pts), { padding: [30,30], maxZoom: 15 });

    apRenderFullMapList(entries);
  }

  function apRenderFullMapList(entries){
    const wrap = document.getElementById('apFullMapList');
    if(!wrap) return;
    const rows = entries
      .filter(([,loc]) => loc.lat != null && loc.lng != null)
      .map(([uid, loc]) => ({ uid, loc, profile: apState.profilesById[uid] }))
      .sort((a,b) => new Date(b.loc.updated_at) - new Date(a.loc.updated_at));

    if(!rows.length){ wrap.innerHTML = `<div class="ap-loc-hint">Belum ada akun yang membagikan lokasi.</div>`; return; }

    wrap.innerHTML = rows.map(r => {
      const name = r.profile?.full_name || 'Pengguna';
      const isSelf = r.uid === (typeof currentUser !== 'undefined' && currentUser?.id);
      return `
        <div class="ap-loc-row" onclick="apFocusOnFullMap('${r.uid}')">
          <div class="ap-avatar" style="${apAvatarStyle(r.profile?.avatar_url)}"></div>
          <div class="ap-loc-name">${apEsc(name)}${isSelf ? ' (Anda)' : ''}</div>
          <span class="ap-loc-time">${apTimeAgo(r.loc.updated_at)}</span>
        </div>`;
    }).join('');
  }

  window.apFocusOnFullMap = function(uid){
    const loc = apState.locations[uid];
    if(loc && apFullMap){ apFullMap.setView([loc.lat, loc.lng], 15); apFullMarkers[uid]?.openPopup(); }
  };

  // Dipanggil dari tombol chat di topbar mobile (di samping tombol notif)
  window.apToggleMobile = function(){
    apState.open ? apHide(true) : apShow();
  };

  /* ---------------------------------------------------------------
     5. HELPERS KECIL (fallback kalau app.js belum load duluan)
     --------------------------------------------------------------- */
  function apEsc(str){
    return typeof escapeHtml === 'function' ? escapeHtml(str) :
      String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function apAvatarStyle(url){
    return typeof avatarBgStyle === 'function' ? avatarBgStyle(url) :
      (url ? `background-image:url('${url}')` : '');
  }
  function apTimeAgo(iso){
    if(!iso) return '';
    return typeof timeAgo === 'function' ? timeAgo(iso) : new Date(iso).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
  }

  window.addEventListener('beforeunload', () => {
    if(apGeoWatchId != null) navigator.geolocation.clearWatch(apGeoWatchId);
  });
})();
