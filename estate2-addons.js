/* =====================================================================
   ESTATE2 ADDONS — Target vs Actual, Preview Sebelum Commit, PWA/Offline.
   File ini di-load SETELAH app.js (lihat index.html), jadi semua fungsi
   & variabel global app.js (supa, state, TABLES, FIELD_META, esc, toast,
   $, $all, isAdminRole, dst) sudah tersedia dan dipakai ulang di sini.
   Didesain ADDITIVE: tidak mengubah app.js. Fungsi seperti saveRecord,
   doDelete, dan navigate di-override (ditimpa) di file ini.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. STYLE TAMBAHAN (disuntik sekali, tidak menyentuh styles.css)
   --------------------------------------------------------------------- */
(function injectAddonStyles(){
  const css = `
    .diff-table{ width:100%; border-collapse:collapse; font-size:12.5px; }
    .diff-table th{ text-align:left; padding:7px 10px; color:var(--text-faint); font-weight:600; border-bottom:1px solid var(--border-soft); }
    .diff-table td{ padding:6px 10px; border-bottom:1px solid rgba(147,167,154,.08); vertical-align:top; }
    .diff-row-changed td{ background:rgba(217,169,74,.09); }
    .diff-old{ color:var(--text-faint); text-decoration:line-through; }
    .diff-new{ color:var(--accent-gold, #D9A94A); font-weight:600; }
    .validation-box{ background:var(--accent-red-soft); color:var(--accent-red-text); padding:9px 12px; border-radius:8px; font-size:12.5px; margin-bottom:14px; }
    .offline-banner{ position:fixed; top:0; left:0; right:0; z-index:500; background:#C1543C; color:#fff; text-align:center;
      font-size:12.5px; font-weight:600; padding:7px 10px; font-family:'IBM Plex Mono', monospace; display:none;
      line-height:1.4; }
    .offline-banner.show{ display:block; }
    /* Saat banner offline tampil, dorong topbar & sidebar turun sejauh tinggi
       banner (diukur via JS ke --offline-banner-h) supaya topbar TETAP terlihat
       di bawah banner, tidak ketutupan olehnya. */
    html{ --offline-banner-h: 0px; }
    body.has-offline-banner{ padding-top: var(--offline-banner-h); transition: padding-top .18s ease; }
    body.has-offline-banner .topbar{ top: var(--offline-banner-h); transition: top .18s ease; }
    body.has-offline-banner .sidebar{ top: var(--offline-banner-h); transition: top .18s ease; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

/* ---------------------------------------------------------------------
   1. ANTREAN OFFLINE (IndexedDB)
   Menyimpan aksi simpan/hapus yang gagal terkirim karena sedang offline,
   lalu mengirim ulang otomatis begitu koneksi kembali.
   --------------------------------------------------------------------- */
const OFFLINE_DB_NAME = 'estate2_offline';
const OFFLINE_STORE = 'queue';

function openOfflineDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(OFFLINE_STORE)){
        db.createObjectStore(OFFLINE_STORE, { keyPath:'localId', autoIncrement:true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function queueOfflineAction(entry){
  try{
    const db = await openOfflineDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).add({ ...entry, queuedAt: new Date().toISOString() });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    updateOfflineBadge();
  }catch(e){ console.error('Gagal menyimpan antrean offline:', e); }
}
async function getOfflineQueue(){
  try{
    const db = await openOfflineDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }catch(e){ return []; }
}
async function removeOfflineItem(localId){
  try{
    const db = await openOfflineDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_STORE).delete(localId);
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  }catch(e){ console.error(e); }
}
async function updateOfflineBadge(){
  const q = await getOfflineQueue();
  const el = $('#offlineQueueBadge');
  if(el) el.textContent = q.length ? `${q.length} perubahan menunggu sinkron` : '';
}
async function flushOfflineQueue(){
  if(!navigator.onLine) return;
  const q = await getOfflineQueue();
  if(!q.length) return;
  toast(`Menyinkronkan ${q.length} perubahan offline…`);
  for(const item of q){
    try{
      let res;
      if(item.action === 'insert') res = await supa.from(item.table).insert(item.payload).select();
      else if(item.action === 'update') res = await supa.from(item.table).update(item.payload).eq('id', item.recordId).select();
      else if(item.action === 'delete') res = await supa.from(item.table).delete().eq('id', item.recordId);
      if(res && res.error){ console.error('Sinkron gagal untuk item offline:', res.error.message); continue; }
      await removeOfflineItem(item.localId);
    }catch(e){ console.error('Gagal sinkron item offline:', e); }
  }
  await updateOfflineBadge();
  Object.keys(TABLES).forEach(t => { state[t].loaded = false; });
  if(TABLES[currentView]){ await ensureData(currentView); paintTablePage(currentView, state[currentView].data); }
  refreshAllCounts();
  toast('Sinkronisasi offline selesai');
}

/* Indikator status koneksi di bagian atas layar */
(function setupOfflineBanner(){
  const banner = document.createElement('div');
  banner.className = 'offline-banner';
  banner.id = 'offlineBanner';
  banner.innerHTML = `Anda sedang offline — perubahan akan disimpan lokal & disinkronkan otomatis saat online kembali. <span id="offlineQueueBadge" style="margin-left:8px; opacity:.85;"></span>`;
  document.body.prepend(banner);
  function applyBannerOffset(){
    // Ukur tinggi banner sesungguhnya (bisa 1 atau 2 baris tergantung lebar layar)
    // lalu dorong topbar & sidebar turun sejumlah itu, supaya topbar tetap terlihat
    // penuh di bawah banner, bukan ketutupan olehnya.
    const isShown = banner.classList.contains('show');
    document.body.classList.toggle('has-offline-banner', isShown);
    document.documentElement.style.setProperty('--offline-banner-h', isShown ? banner.offsetHeight + 'px' : '0px');
  }
  function refresh(){
    banner.classList.toggle('show', !navigator.onLine);
    applyBannerOffset();
    updateOfflineBadge();
  }
  window.addEventListener('online', () => { refresh(); flushOfflineQueue(); });
  window.addEventListener('offline', refresh);
  window.addEventListener('resize', () => { if(banner.classList.contains('show')) applyBannerOffset(); });
  refresh();
})();

/* ---------------------------------------------------------------------
   3. PREVIEW SEBELUM COMMIT (validasi + diff, generik untuk modul master)
   --------------------------------------------------------------------- */
function validatePayload(cfg, payload){
  const errors = [];
  cfg.columns.forEach(col => {
    const meta = FIELD_META[col];
    if(meta.required && (payload[col] === null || payload[col] === undefined || payload[col] === '')){
      errors.push(`${meta.label} wajib diisi.`);
    }
    if(meta.type === 'number' && payload[col] !== null && payload[col] !== undefined && isNaN(payload[col])){
      errors.push(`${meta.label} harus berupa angka.`);
    }
  });
  return errors;
}

function showPreviewModal({ title, subtitle, diffCols, before, after, errors, onConfirm, confirmLabel }){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'previewOverlay';
  const hasErrors = errors && errors.length > 0;
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${esc(title)}</div>
        <button class="btn btn-outline btn-icon" onclick="$('#previewOverlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        ${subtitle ? `<p style="font-size:12.5px; color:var(--text-faint); margin-top:-4px;">${subtitle}</p>` : ''}
        ${hasErrors ? `<div class="validation-box"><b>Data belum bisa disimpan:</b><ul style="margin:6px 0 0 18px;">${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <table class="diff-table">
          <thead><tr><th>Kolom</th><th>Sebelum</th><th>Sesudah</th></tr></thead>
          <tbody>
            ${diffCols.map(col => {
              const b = before ? before[col] : undefined;
              const a = after ? after[col] : undefined;
              const changed = (b ?? '') !== (a ?? '');
              if(!before && (a===null||a===undefined||a==='')) return ''; // data baru & kolom kosong: skip biar ringkas
              return `<tr class="${changed?'diff-row-changed':''}">
                <td>${FIELD_META[col]?.label || col}</td>
                <td class="${changed && before ?'diff-old':''}">${before ? esc(b ?? '–') : '<span style="color:var(--text-faint)">(baris baru)</span>'}</td>
                <td class="${changed?'diff-new':''}">${esc(a ?? '–')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="$('#previewOverlay').remove()">Kembali Edit</button>
        ${!hasErrors ? `<button class="btn btn-primary" id="previewConfirmBtn">${esc(confirmLabel || 'Konfirmasi & Simpan')}</button>` : ''}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  if(!hasErrors){
    $('#previewConfirmBtn').addEventListener('click', async () => {
      $('#previewConfirmBtn').disabled = true;
      $('#previewConfirmBtn').textContent = 'Menyimpan…';
      await onConfirm();
      $('#previewOverlay')?.remove();
    });
  }
}

/* ---------------------------------------------------------------------
   4. OVERRIDE saveRecord() — 5 modul master (Pasca Harvest, RPC After
   Giling, Extra Planting After Giling, Blanking, Ratoon) yang memakai
   config generik TABLES. Menambahkan: preview diff, validasi, dan
   antrean offline. Fungsi asli app.js DITIMPA di sini (dipanggil dari
   tombol "Simpan Data" yang sama di openRecordModal).
   --------------------------------------------------------------------- */
saveRecord = async function(table, id){
  const form = $('#recordForm');
  const cfg = TABLES[table];
  const payload = {};
  cfg.columns.forEach(col => {
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  const errors = validatePayload(cfg, payload);
  const before = id ? (state[table].data.find(r => r.id === id) || null) : null;

  showPreviewModal({
    title: (id ? 'Pratinjau Perubahan' : 'Pratinjau Data Baru') + ' — ' + cfg.label,
    subtitle: id ? 'Periksa kolom yang berubah (ditandai kuning) sebelum menyimpan ke database.' : 'Periksa data sebelum ditambahkan ke database.',
    diffCols: cfg.columns,
    before, after: payload, errors,
    confirmLabel: id ? 'Simpan Perubahan' : 'Tambahkan Data',
    onConfirm: async () => {
      const hasAudit = cfg.hasAuditColumns !== false;
      const finalPayload = { ...payload };
      if(hasAudit) finalPayload.updated_by = currentUser.id;
      if(!id && hasAudit) finalPayload.created_by = currentUser.id;

      if(!navigator.onLine){
        await queueOfflineAction({ table, action: id ? 'update' : 'insert', payload: finalPayload, recordId: id || null, before });
        toast('Offline — data disimpan lokal, akan disinkron otomatis saat online kembali', true);
        closeModal();
        return;
      }

      let res;
      if(id) res = await supa.from(table).update(finalPayload).eq('id', id).select();
      else res = await supa.from(table).insert(finalPayload).select();
      if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }

      toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
      await logNotification({ table, action: id ? 'edit' : 'tambah', petakList: [finalPayload.petak], zona: finalPayload.zona });
      closeModal();
      state[table].loaded = false;
      await ensureData(table);
      paintTablePage(table, state[table].data);
      refreshAllCounts();
    }
  });
};

/* ---------------------------------------------------------------------
   5. OVERRIDE confirmDelete()/doDelete() — tambah pratinjau baris yang
   akan dihapus.
   --------------------------------------------------------------------- */
confirmDelete = function(table, id){
  const rec = state[table].data.find(r => r.id === id);
  const cfg = TABLES[table];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  const previewFields = cfg ? cfg.listColumns : Object.keys(rec || {}).slice(0, 6);
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:460px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body">
        <p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris berikut akan dihapus permanen:</p>
        <table class="diff-table">
          <tbody>
            ${rec ? previewFields.map(c => `<tr><td>${FIELD_META[c]?.label || c}</td><td class="diff-old">${esc(rec[c] ?? '–')}</td></tr>`).join('') : '<tr><td>Data tidak ditemukan di cache lokal.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDelete('${table}', ${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};

doDelete = async function(table, id){
  const rec = state[table].data.find(r => r.id === id);
  if(!navigator.onLine){
    await queueOfflineAction({ table, action:'delete', recordId:id, before: rec || null });
    $('#confirmOverlay')?.remove();
    toast('Offline — penghapusan disimpan lokal, akan disinkron otomatis saat online kembali', true);
    return;
  }
  const { error } = await supa.from(table).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table, action:'hapus', petakList: [rec?.petak], zona: rec?.zona });
  state[table].loaded = false;
  await ensureData(table);
  paintTablePage(table, state[table].data);
  refreshAllCounts();
};

/* ---------------------------------------------------------------------
   6. TARGET VS ACTUAL
   ---------------------------------------------------------------------
   Target & Actual dihitung otomatis langsung dari data petak — TIDAK lagi
   dari input target manual — sesuai definisi tiap modul:
     - Pasca Harvest: Target = total luas SEMUA petak (385 petak).
       Actual = total luas petak yang Kategori Pasca Harvest-nya SUDAH ada
       nilai (Baik/Cukup/Kurang) — "Not Yet" tidak dihitung.
     - RPC After Giling / Extra Planting After Giling / Blanking:
       Target = total luas semua petak modul tsb.
       Actual = total luas petak yang Status Planting = "Done".
     - Ratoon: Target = total luas semua petak Ratoon.
       Actual = total luas petak yang Status Progress = "Done" (sudah tebang).
   --------------------------------------------------------------------- */
const TARGET_MODULES = {
  pasca_harvest: {
    label:'Pasca Harvest', areaField:'size_rkt',
    actualWhen: r => { const k = (r.kategori_pasca_harvest||'').trim(); return !!k && k !== 'Not Yet'; },
  },
  rpc_after_giling: {
    label:'RPC After Giling', areaField:'luas_rpc',
    actualWhen: r => (r.status_planting||'').trim() === 'Done',
  },
  extra_planting_after_giling: {
    label:'Extra Planting After Giling', areaField:'luas_rpc',
    actualWhen: r => (r.status_planting||'').trim() === 'Done',
  },
  blanking: {
    label:'Blanking', areaField:'luas_blanking',
    actualWhen: r => (r.status_planting||'').trim() === 'Done',
  },
  ratoon: {
    label:'Ratoon', areaField:'size_rkt',
    actualWhen: r => (r.status_progress||'').trim() === 'Done',
  },
};
const ZONA_LIST = ['A','B'];
const TARGET_STATE = { module:'pasca_harvest', tahun:new Date().getFullYear(), bulan:'' };

async function renderTargetActual(){
  $('#pageEyebrow').textContent = 'KONTROL & JEJAK AKTIVITAS';
  $('#pageTitle').textContent = 'Target vs Actual';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  const rows = await ensureData(TARGET_STATE.module);
  const cfg = TARGET_MODULES[TARGET_STATE.module];
  const bulan = TARGET_STATE.bulan;

  const actualByZona = {}; const targetByZona = {};
  ZONA_LIST.forEach(z => {
    const zonaRows = rows.filter(r => (r.zona||'').toUpperCase() === z && (!bulan || r.phasing_2026 === bulan));
    targetByZona[z] = zonaRows.reduce((sum, r) => sum + (parseFloat(r[cfg.areaField]) || 0), 0);
    actualByZona[z] = zonaRows.filter(cfg.actualWhen).reduce((sum, r) => sum + (parseFloat(r[cfg.areaField]) || 0), 0);
  });
  const totalActual = ZONA_LIST.reduce((s,z)=>s+actualByZona[z],0);
  const totalTarget = ZONA_LIST.reduce((s,z)=>s+targetByZona[z],0);
  const pct = totalTarget ? Math.round(totalActual/totalTarget*100) : 0;

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="table-toolbar">
        <select class="input" style="max-width:280px;" id="targetModuleSelect">
          ${Object.keys(TARGET_MODULES).map(m => `<option value="${m}" ${TARGET_STATE.module===m?'selected':''}>${TARGET_MODULES[m].label}</option>`).join('')}
        </select>
        <select class="input" style="max-width:150px;" id="targetBulanSelect">
          <option value="" ${!bulan?'selected':''}>Semua Bulan (Season)</option>
          ${MONTHS.map(m => `<option value="${m}" ${bulan===m?'selected':''}>${m}</option>`).join('')}
        </select>
        <input class="input" style="max-width:110px;" type="number" id="targetTahunInput" value="${TARGET_STATE.tahun}">
      </div>
    </div>

    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:14px; margin-bottom:16px;">
      ${kpiCard('Target (Ha)', fmtNum(totalTarget), cfg.label, '#D9A94A')}
      ${kpiCard('Actual (Ha)', fmtNum(totalActual), cfg.label, '#5FAE7D')}
      ${kpiCard('Pencapaian', pct + '%', totalActual >= totalTarget && totalTarget ? 'Tercapai' : 'Belum tercapai', pct>=100?'#5FAE7D':'#C1543C')}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Target vs Actual per Zona (${cfg.label}${bulan ? ' — '+bulan : ' — Season '+TARGET_STATE.tahun})</span></div>
      <div style="height:280px; padding:14px;"><canvas id="chart_target_actual"></canvas></div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Detail per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th>Target (Ha)</th><th>Actual (Ha)</th><th>Selisih</th><th>Capaian</th></tr></thead>
          <tbody>
            ${ZONA_LIST.map(z => {
              const t = targetByZona[z], a = actualByZona[z];
              const diff = a - t;
              const p = t ? Math.round(a/t*100) : 0;
              return `<tr>
                <td><span class="petak-tag">Zona ${z}</span></td>
                <td>${fmtNum(t)}</td>
                <td>${fmtNum(a)}</td>
                <td style="color:${diff>=0?'#5FAE7D':'#C1543C'}">${diff>=0?'+':''}${fmtNum(diff)}</td>
                <td>${badgeForStatus(p>=100?'Baik':(p>=70?'Cukup':'Kurang'))} <span style="font-size:11px; color:var(--text-faint);">${p}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  drawGroupedBar('chart_target_actual', ZONA_LIST.map(z=>'Zona '+z),
    { Target: ZONA_LIST.map(z=>targetByZona[z]), Actual: ZONA_LIST.map(z=>actualByZona[z]) },
    ['#D9A94A', '#5FAE7D']);

  $('#targetModuleSelect').addEventListener('change', function(){ TARGET_STATE.module = this.value; renderTargetActual(); });
  $('#targetBulanSelect').addEventListener('change', function(){ TARGET_STATE.bulan = this.value; renderTargetActual(); });
  $('#targetTahunInput').addEventListener('change', function(){ TARGET_STATE.tahun = parseInt(this.value) || TARGET_STATE.tahun; renderTargetActual(); });
}

/* ---------------------------------------------------------------------
   7. OVERRIDE navigate() — tambah routing utk 'target_actual'
   --------------------------------------------------------------------- */
const _origNavigate = navigate;
navigate = async function(view){
  if(view === 'target_actual'){
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const activeItem = $all('.nav-item').find(el => el.dataset.view === view);
    const parentSection = activeItem?.closest('.nav-section');
    if(parentSection && parentSection.classList.contains('collapsed')){
      parentSection.classList.remove('collapsed');
      const key = parentSection.id.replace('navSection_', '');
      const btn = parentSection.querySelector('.nav-section-label');
      if(btn) btn.setAttribute('aria-expanded', 'true');
      saveNavSectionState(key, false);
    }
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderTargetActual();
    return;
  }
  return _origNavigate(view);
};

/* ---------------------------------------------------------------------
   9. PWA — registrasi service worker
   --------------------------------------------------------------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(e => console.error('Gagal mendaftarkan service worker:', e));
  });
}
