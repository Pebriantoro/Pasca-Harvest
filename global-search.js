/* =====================================================================
   PENCARIAN GLOBAL (additif) — cari petak / staff / kontraktor sekali,
   hasilnya muncul dari SEMUA modul sekaligus.
   Buka: tombol kaca pembesar di topbar, Ctrl+K / Cmd+K, atau tekan "/".
   Cara kerja:
   - Query ke Supabase per modul (ilike, maksimal 6 baris per modul),
     jadi tidak perlu memuat seluruh tabel ke browser.
   - Pembatasan zona & per-orang (Staff/Supervisor) memakai fungsi yang
     sama dengan ensureData() di app.js; menu yang diblokir untuk role
     Staff tidak ikut dicari.
   - Klik hasil -> buka menu modul tsb dengan kotak pencarian modul
     terisi otomatis (filter lain di modul tsb direset supaya hasil
     tidak "hilang" karena filter lama).
   Load SETELAH app.js & modul lain (lihat index.html).
   ===================================================================== */
(function(){
  const PER_SOURCE = 6;
  const MIN_CHARS = 2;
  const STAFF_BLOCKED = ['produktivitas_kontraktor','actual_tk','plan_kedatangan_tk'];

  function escHtml(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function highlight(text, q){
    const t = String(text == null ? '' : text);
    if(!q) return escHtml(t);
    const i = t.toLowerCase().indexOf(q.toLowerCase());
    if(i === -1) return escHtml(t);
    return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
  }
  // Buang karakter yang punya arti khusus di filter .or() PostgREST
  function sanitizeTerm(q){ return q.replace(/[,()%*\\"]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ---------------- DAFTAR SUMBER PENCARIAN ---------------- */
  function buildSources(){
    const sources = [];
    // 1) Semua modul petak (Pasca Harvest, RPC, Extra Planting, Blanking, Ratoon, ...)
    if(typeof TABLES !== 'undefined'){
      Object.keys(TABLES).forEach(key => {
        const cfg = TABLES[key];
        const cols = ['petak','varietas','staff','supervisor','superitendent'].filter(c => (cfg.columns || []).includes(c));
        if(!cols.length) return;
        sources.push({
          table: key, view: key, stateKey: key, label: cfg.label, icon: 'grass',
          cols, zona: true, person: true,
          title: r => r.petak || '—',
          sub: r => [r.zona && ('Zona ' + r.zona), r.staff, r.status_progress].filter(Boolean).join(' · '),
        });
      });
    }
    // 2) Tebang Bibit
    if(typeof TB_TABLE !== 'undefined'){
      sources.push({
        table: TB_TABLE, view: 'tebang_bibit', stateKey: TB_TABLE, label: 'Tebang Bibit', icon: 'content_cut',
        cols: ['petak','tb_varietas','tb_staff','tb_supervisor','tb_superintendent'], zona: true,
        title: r => r.petak || '—',
        sub: r => [r.zona && ('Zona ' + r.zona), r.tb_staff, r.tb_status_tebang_bibit].filter(Boolean).join(' · '),
      });
    }
    // 3) Produktivitas Kontraktor
    if(typeof PK_TABLE !== 'undefined'){
      sources.push({
        table: PK_TABLE, view: 'produktivitas_kontraktor', stateKey: PK_TABLE, label: 'Prod Kontraktor', icon: 'engineering',
        cols: ['kontraktor','kegiatan_pk','ket_hasil'], zona: false,
        title: r => r.kontraktor || '—',
        sub: r => [r.kegiatan_pk, r.luas_bapp != null && (r.luas_bapp + ' ha'), r.ket_hasil].filter(Boolean).join(' · '),
      });
    }
    // 4) Actual TK & Plan Kedatangan TK
    if(typeof ACTUAL_TK_TABLE !== 'undefined'){
      sources.push({
        table: ACTUAL_TK_TABLE, view: 'actual_tk', stateKey: ACTUAL_TK_TABLE, label: 'Actual TK', icon: 'groups',
        cols: ['zona','kontraktor','keterangan_tk'], zona: true,
        title: r => r.kontraktor || '—',
        sub: r => [r.zona && ('Zona ' + r.zona), r.jumlah_aktual_tk != null && ('Aktual ' + r.jumlah_aktual_tk)].filter(Boolean).join(' · '),
      });
    }
    if(typeof PLAN_KEDATANGAN_TABLE !== 'undefined'){
      sources.push({
        table: PLAN_KEDATANGAN_TABLE, view: 'plan_kedatangan_tk', stateKey: PLAN_KEDATANGAN_TABLE, label: 'Plan Kedatangan TK', icon: 'event',
        cols: ['zona','kontraktor','keterangan_tk'], zona: true,
        title: r => r.kontraktor || '—',
        sub: r => [r.zona && ('Zona ' + r.zona), r.tanggal_rencana_tk, r.jumlah_rencana_tk != null && ('Rencana ' + r.jumlah_rencana_tk)].filter(Boolean).join(' · '),
      });
    }
    return sources;
  }

  /* ---------------- QUERY ---------------- */
  async function querySource(src, term){
    const orExpr = src.cols.map(c => `${c}.ilike.%${term}%`).join(',');
    let q = supa.from(src.table).select('*').or(orExpr).limit(PER_SOURCE);
    if(src.zona){
      const zr = getUserZonaRestriction(src.table);
      if(zr) q = q.ilike('zona', zr);
    }
    if(src.person){
      const pr = getUserPersonRestriction();
      if(pr && (TABLES[src.table]?.columns || []).includes(pr.column)) q = q.ilike(pr.column, pr.name);
    }
    const { data, error } = await q;
    if(error) return { src, rows: [], error };
    let rows = data || [];
    // penyaring tambahan di sisi klien (sama seperti ensureData)
    if(src.zona){ const zr = getUserZonaRestriction(src.table); if(zr) rows = rows.filter(r => rowMatchesZona(r, zr)); }
    if(src.person){
      const pr = getUserPersonRestriction();
      if(pr && (TABLES[src.table]?.columns || []).includes(pr.column)) rows = rows.filter(r => rowMatchesPerson(r, pr));
    }
    return { src, rows };
  }

  /* ---------------- UI ---------------- */
  let overlay = null, inputEl = null, listEl = null;
  let items = [], activeIdx = -1, reqId = 0, lastTerm = '';

  function injectStyle(){
    if(document.getElementById('gsStyle')) return;
    const st = document.createElement('style');
    st.id = 'gsStyle';
    st.textContent = `
      .gs-box{ max-width:640px; width:calc(100% - 24px); margin:8vh auto 0; padding:0; overflow:hidden; }
      .gs-input-row{ display:flex; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid var(--border, rgba(128,128,128,.25)); }
      .gs-input-row input{ flex:1; border:none; outline:none; background:transparent; font-size:16px; color:var(--text-primary, inherit); min-width:0; }
      .gs-kbd{ font-size:11px; padding:2px 6px; border-radius:6px; border:1px solid var(--border, rgba(128,128,128,.35)); color:var(--text-muted, #888); }
      .gs-list{ max-height:60vh; overflow-y:auto; padding:6px 0 10px; }
      .gs-group{ padding:10px 16px 4px; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-muted, #888); display:flex; align-items:center; gap:6px; }
      .gs-item{ display:flex; flex-direction:column; gap:2px; padding:8px 16px; cursor:pointer; }
      .gs-item.active, .gs-item:hover{ background:var(--bg-elevated, rgba(128,128,128,.14)); }
      .gs-item-title{ font-weight:600; font-size:14px; color:var(--text-primary, inherit); }
      .gs-item-sub{ font-size:12px; color:var(--text-muted, #888); }
      .gs-more{ color:var(--accent-gold, #D9A94A); font-size:12.5px; font-weight:600; }
      .gs-empty{ padding:28px 16px; text-align:center; color:var(--text-muted, #888); font-size:13.5px; }
      .gs-list mark{ background:rgba(217,169,74,.35); color:inherit; border-radius:3px; padding:0 1px; }
      .gs-trigger-btn{ position:relative; }
    `;
    document.head.appendChild(st);
  }

  function isLoggedIn(){
    try { return typeof currentProfile !== 'undefined' && !!currentProfile; } catch(_e){ return false; }
  }

  function openSearch(){
    if(!isLoggedIn() || overlay) return;
    injectStyle();
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'globalSearchOverlay';
    overlay.innerHTML = `
      <div class="modal-box gs-box anim-scale-in" role="dialog" aria-label="Pencarian global">
        <div class="gs-input-row">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="text" id="gsInput" placeholder="Cari petak, staff, supervisor, kontraktor…" autocomplete="off" spellcheck="false">
          <span class="gs-kbd">Esc</span>
        </div>
        <div class="gs-list" id="gsList"><div class="gs-empty">Ketik minimal ${MIN_CHARS} huruf untuk mencari di semua menu.</div></div>
      </div>`;
    document.body.appendChild(overlay);
    inputEl = overlay.querySelector('#gsInput');
    listEl = overlay.querySelector('#gsList');
    items = []; activeIdx = -1; lastTerm = '';

    overlay.addEventListener('mousedown', e => { if(e.target === overlay) closeSearch(); });
    inputEl.addEventListener('input', debounceLocal(() => runSearch(inputEl.value), 250));
    inputEl.addEventListener('keydown', onKeyDown);
    listEl.addEventListener('click', e => {
      const el = e.target.closest('.gs-item');
      if(el) activate(Number(el.dataset.idx));
    });
    setTimeout(() => inputEl && inputEl.focus(), 0);
  }

  function closeSearch(){
    if(!overlay) return;
    overlay.remove();
    overlay = inputEl = listEl = null;
    items = []; activeIdx = -1; reqId++;
  }

  function debounceLocal(fn, ms){ let t; return function(){ clearTimeout(t); t = setTimeout(fn, ms); }; }

  function onKeyDown(e){
    if(e.key === 'Escape'){ e.preventDefault(); closeSearch(); return; }
    if(e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      if(!items.length) return;
      e.preventDefault();
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      paintActive();
      return;
    }
    if(e.key === 'Enter'){
      e.preventDefault();
      if(activeIdx >= 0) activate(activeIdx);
      else if(items.length) activate(0);
    }
  }

  function paintActive(){
    if(!listEl) return;
    listEl.querySelectorAll('.gs-item').forEach(el => {
      const on = Number(el.dataset.idx) === activeIdx;
      el.classList.toggle('active', on);
      if(on) el.scrollIntoView({ block:'nearest' });
    });
  }

  async function runSearch(raw){
    if(!listEl) return;
    const term = sanitizeTerm(raw || '');
    lastTerm = term;
    if(term.length < MIN_CHARS){
      items = []; activeIdx = -1;
      listEl.innerHTML = `<div class="gs-empty">Ketik minimal ${MIN_CHARS} huruf untuk mencari di semua menu.</div>`;
      return;
    }
    const myReq = ++reqId;
    listEl.innerHTML = '<div class="gs-empty">Mencari…</div>';

    const isStaff = currentProfile?.role === 'staff';
    const sources = buildSources().filter(s => !(isStaff && STAFF_BLOCKED.includes(s.view)));
    const results = await Promise.all(sources.map(s => querySource(s, term).catch(err => ({ src: s, rows: [], error: err }))));
    if(myReq !== reqId || !listEl) return; // ada pencarian yang lebih baru

    items = [];
    let html = '';
    let failed = 0;
    results.forEach(r => {
      if(r.error) failed++;
      if(!r.rows.length) return;
      html += `<div class="gs-group"><span class="material-symbols-outlined" style="font-size:16px;">${r.src.icon}</span>${escHtml(r.src.label)}</div>`;
      r.rows.forEach(row => {
        const idx = items.length;
        items.push({ src: r.src, term: String(r.src.title(row) || '').trim() || term });
        html += `<div class="gs-item" data-idx="${idx}">
          <span class="gs-item-title">${highlight(r.src.title(row), term)}</span>
          <span class="gs-item-sub">${highlight(r.src.sub(row), term)}</span>
        </div>`;
      });
      if(r.rows.length >= PER_SOURCE){
        const idx = items.length;
        items.push({ src: r.src, term });
        html += `<div class="gs-item" data-idx="${idx}"><span class="gs-more">Lihat semua hasil “${escHtml(term)}” di ${escHtml(r.src.label)} →</span></div>`;
      }
    });
    if(!items.length){
      html = `<div class="gs-empty">Tidak ada hasil untuk “${escHtml(term)}”.${failed ? ' (' + failed + ' menu gagal dicari)' : ''}</div>`;
    }
    listEl.innerHTML = html;
    activeIdx = items.length ? 0 : -1;
    paintActive();
  }

  function activate(idx){
    const it = items[idx];
    if(!it) return;
    const { src, term } = it;
    const st = state[src.stateKey];
    if(st){
      st.search = term;
      st.page = 1;
      // reset filter lain di modul tsb supaya hasil tidak tersembunyi filter lama
      Object.keys(st).forEach(k => { if(k.indexOf('filter') === 0 && typeof st[k] === 'string') st[k] = ''; });
    }
    closeSearch();
    navigate(src.view);
  }

  /* ---------------- TOMBOL TOPBAR + SHORTCUT ---------------- */
  function mountButton(){
    const row = document.querySelector('.topbar-icon-row');
    if(!row || document.getElementById('globalSearchBtn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'globalSearchBtn';
    btn.className = 'btn btn-outline btn-icon gs-trigger-btn';
    btn.title = 'Cari di semua menu (Ctrl+K)';
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    btn.addEventListener('click', openSearch);
    row.insertBefore(btn, row.firstChild);
  }

  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable);
    if((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')){
      e.preventDefault();
      overlay ? closeSearch() : openSearch();
      return;
    }
    if(e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey){
      e.preventDefault();
      openSearch();
    }
  });

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton);
  else mountButton();

  window.openGlobalSearch = openSearch;
})();
