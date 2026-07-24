/* =====================================================================
   RENCANA KERJA HARIAN (RKH) ADDON
   Di-load PALING TERAKHIR (setelah app.js & semua addon lain). Sepenuhnya
   ADDITIF: tidak mengubah app.js, hanya menambah menu baru "Rencana Kerja
   Harian" + menambah blok Timeline & Summary di Dashboard Gabungan
   (Beranda) + menambah 2 kolom (Supervisor, Superintendent) di Kelola
   Pengguna.

   Alur:
   - Staff  -> input RKH (Tanggal, Petak, Aktivitas, Kontraktor, Jumlah TK,
     Keterangan). Kolom Superintendent & Supervisor terisi OTOMATIS dari
     hubungan atasan yang diset Admin di akun staff tsb (Kelola Pengguna).
   - Supervisor -> Verifikasi 1 (approve/reject) RKH staff di bawahnya.
   - Superintendent -> Verifikasi 2 / approval final (approve/reject).
   - Admin & Manager -> hanya melihat SUMMARY (tanpa aksi approve/reject).
   - Semua role (kecuali Viewer) melihat ringkasan RKH hari ini + timeline
     di menu Beranda (Dashboard Gabungan).

   Butuh tabel `rencana_kerja_harian` + kolom `supervisor_id`/
   `superintendent_id` di `profiles` — lihat rkh_schema.sql (WAJIB
   dijalankan sekali di Supabase SQL Editor sebelum menu ini bisa dipakai).
   ===================================================================== */

const RKH_TABLE = 'rencana_kerja_harian';
const RKH_STATUS = {
  PENDING_SUPERVISOR: 'Menunggu Verifikasi Supervisor',
  PENDING_SUPERINTENDENT: 'Menunggu Approval Superintendent',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

let rkhProfilesCache = null; // Map id -> profile ringkas
let rkhState = {
  tab: 'aksi',        // 'aksi' | 'tim' | 'saya'
  filterDate: todayISO(),
  useDateFilter: true,
  rows: [],
};

function todayISO(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function fmtTanggalRKH(iso){
  if(!iso) return '–';
  try{
    return new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
  }catch(_e){ return iso; }
}
function fmtJamRKH(iso){
  if(!iso) return '';
  try{ return new Date(iso).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }); }catch(_e){ return ''; }
}

/* ---------------------------------------------------------------------
   1. PROFIL & PETAK HELPERS
   --------------------------------------------------------------------- */
async function rkhLoadProfiles(){
  if(rkhProfilesCache) return rkhProfilesCache;
  const { data, error } = await supa.from('profiles').select('*').order('created_at', { ascending:false });
  if(error){ toast('Gagal memuat data pengguna: ' + error.message, true); return {}; }
  rkhProfilesCache = {};
  (data||[]).forEach(p => rkhProfilesCache[p.id] = p);
  return rkhProfilesCache;
}
function rkhResetProfilesCache(){ rkhProfilesCache = null; }

async function rkhGetHierarchyFor(profile){
  const profiles = await rkhLoadProfiles();
  const supervisor = profile.supervisor_id ? profiles[profile.supervisor_id] : null;
  const superintendent = profile.superintendent_id ? profiles[profile.superintendent_id] : null;
  return {
    supervisor_id: profile.supervisor_id || null,
    supervisor_name: supervisor ? supervisor.full_name : null,
    superintendent_id: profile.superintendent_id || null,
    superintendent_name: superintendent ? superintendent.full_name : null,
  };
}

async function rkhGetPetakOptions(){
  const rows = await ensureData('pasca_harvest'); // otomatis sudah dibatasi sesuai zona akun (lihat app.js ensureData())
  const set = new Set();
  rows.forEach(r => { const p = (r.petak||'').toString().trim(); if(p) set.add(p); });
  return Array.from(set).sort();
}

/* ---------------------------------------------------------------------
   1b. HELPER BERSAMA (dipakai juga oleh pra-spa.js & qc-by-proses.js,
   load setelah file ini): validasi format kode petak PNS/KDS+6 digit,
   dan cari supervisor default staff (profile.supervisor_id) dari daftar
   supervisor zona untuk auto-select dropdown "Spv".
   --------------------------------------------------------------------- */
function isValidPetakFormat(val){
  return /^(PNS|KDS)\d{6}$/i.test((val || '').toString().trim());
}
function petakFormatWarnHTML(id){
  return `<div id="${id}" class="hidden" style="color:#F0A392; font-size:11.5px; margin-top:4px;">⚠️ Format kode petak harus diawali "PNS" atau "KDS" + 6 digit angka, contoh: PNS051902 / KDS074802</div>`;
}
function checkPetakFormatInput(inputEl, warnId){
  const warn = document.getElementById(warnId);
  if(!warn) return;
  const val = (inputEl.value || '').trim();
  warn.classList.toggle('hidden', !val || isValidPetakFormat(val));
}
function defaultSupervisorIdFor(supervisors){
  // Akun staff punya supervisor_id bawaan (mis. diisi Admin) — kalau
  // supervisor itu ada di daftar supervisor zona ybs, auto-select dia.
  const assignedId = currentProfile?.supervisor_id;
  if(assignedId && supervisors.some(sv => sv.id === assignedId)) return assignedId;
  return '';
}

/* ---------------------------------------------------------------------
   2. DATA FETCH (dibatasi sesuai peran)
   --------------------------------------------------------------------- */
function rkhScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(RKH_TABLE).select('*').order('created_at', { ascending:false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor') q = q.eq('supervisor_id', currentUser.id);
  else if(role === 'superintendent') q = q.eq('superintendent_id', currentUser.id);
  // admin & manager: tanpa filter (lihat semua)
  return q;
}
async function rkhFetchRows({ dateFrom, dateTo } = {}){
  let q = rkhScopedQuery();
  if(dateFrom) q = q.gte('tanggal', dateFrom);
  if(dateTo) q = q.lte('tanggal', dateTo);
  const { data, error } = await q.limit(500);
  if(error){
    toast('Gagal memuat Rencana Kerja Harian: ' + error.message, true);
    return [];
  }
  return data || [];
}

/* ---------------------------------------------------------------------
   3. BADGE STATUS
   --------------------------------------------------------------------- */
function rkhBadge(status){
  const map = {
    [RKH_STATUS.PENDING_SUPERVISOR]: 'badge-neutral',
    [RKH_STATUS.PENDING_SUPERINTENDENT]: 'badge-progress',
    [RKH_STATUS.APPROVED]: 'badge-done',
    [RKH_STATUS.REJECTED]: 'badge-rejected',
  };
  return `<span class="badge badge-stamp ${map[status] || 'badge-neutral'}">${esc(status || '–')}</span>`;
}

/* ---------------------------------------------------------------------
   4. RINGKASAN (dipakai di halaman RKH & di Beranda)
   --------------------------------------------------------------------- */
function rkhSummarize(rows){
  const s = {
    total: rows.length,
    pendingSupervisor: 0,
    pendingSuperintendent: 0,
    approved: 0,
    rejected: 0,
    totalTK: 0,
  };
  rows.forEach(r => {
    if(r.status === RKH_STATUS.PENDING_SUPERVISOR) s.pendingSupervisor++;
    else if(r.status === RKH_STATUS.PENDING_SUPERINTENDENT) s.pendingSuperintendent++;
    else if(r.status === RKH_STATUS.APPROVED) s.approved++;
    else if(r.status === RKH_STATUS.REJECTED) s.rejected++;
    s.totalTK += parseInt(r.jumlah_tk, 10) || 0;
  });
  return s;
}
function rkhSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total RKH', s.total, 'baris hari ini', 'var(--accent-gold)')}
    ${kpiCard('Menunggu Verifikasi', s.pendingSupervisor, 'tahap Supervisor', 'var(--accent-red)')}
    ${kpiCard('Menunggu Approval', s.pendingSuperintendent, 'tahap Superintendent', 'var(--accent-gold)')}
    ${kpiCard('Disetujui', s.approved, 'sudah final', 'var(--accent-green)')}
    ${kpiCard('Total Tenaga Kerja', s.totalTK, 'orang direncanakan', 'var(--accent-blue)')}
  </div>`;
}

function rkhTimelineHTML(rows, limit){
  const list = limit ? rows.slice(0, limit) : rows;
  if(!list.length) return `<div class="empty-state">Belum ada Rencana Kerja Harian.</div>`;
  return `<div class="rkh-timeline">${list.map(r => `
    <div class="rkh-timeline-item">
      <div class="rkh-timeline-dot"></div>
      <div class="rkh-timeline-content">
        <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <b>${esc(r.petak)} — ${esc(r.aktivitas)}</b>
          ${rkhBadge(r.status)}
        </div>
        <div style="color:var(--text-muted); margin-top:2px;">
          ${esc(r.staff_name||'-')} · Kontraktor ${esc(r.kontraktor||'-')} · ${esc(r.jumlah_tk ?? '-')} TK
          ${r.keterangan ? ' · ' + esc(r.keterangan) : ''}
        </div>
        <div style="color:var(--text-faint); font-size:11px; margin-top:2px;">
          ${esc(fmtTanggalRKH(r.tanggal))} · dibuat ${esc(fmtJamRKH(r.created_at))}
          ${r.status===RKH_STATUS.REJECTED && r.rejection_reason ? ` · Alasan ditolak: ${esc(r.rejection_reason)}` : ''}
        </div>
      </div>
    </div>
  `).join('')}</div>`;
}

/* ---------------------------------------------------------------------
   5. HALAMAN UTAMA "Rencana Kerja Harian"
   --------------------------------------------------------------------- */
async function renderRKH(){
  $('#pageEyebrow').textContent = 'PERENCANAAN';
  $('#pageTitle').textContent = 'Rencana Kerja Harian';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  if(role === 'staff') return renderRKHStaff();
  if(role === 'supervisor') return renderRKHAtasan('supervisor');
  if(role === 'superintendent') return renderRKHAtasan('superintendent');
  return renderRKHSummaryOnly(); // admin & manager
}

/* --- 5a. STAFF -------------------------------------------------------- */
async function renderRKHStaff(){
  const hier = await rkhGetHierarchyFor(currentProfile);
  if(!hier.supervisor_id || !hier.superintendent_id){
    $('#pageContent').innerHTML = `<div class="card"><div class="card-body" style="padding:18px;">
      <p style="color:var(--text-muted);">Akun Anda belum diatur <b>Supervisor</b> dan/atau <b>Superintendent</b> oleh Admin.
      Silakan hubungi Admin untuk melengkapi ini di menu Kelola Pengguna sebelum bisa mengisi Rencana Kerja Harian.</p>
    </div></div>`;
    return;
  }
  const rows = await rkhFetchRows({ dateFrom: rkhState.useDateFilter ? rkhState.filterDate : null, dateTo: rkhState.useDateFilter ? rkhState.filterDate : null });
  rkhState.rows = rows;
  const s = rkhSummarize(rows.filter(r=>r.tanggal === todayISO()));

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted); display:flex; gap:18px; flex-wrap:wrap;">
        <span>Supervisor: <b style="color:var(--text-strong,#fff);">${esc(hier.supervisor_name)}</b></span>
        <span>Superintendent: <b style="color:var(--text-strong,#fff);">${esc(hier.superintendent_name)}</b></span>
      </div>
    </div>
    ${rkhSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input Rencana Kerja Harian</span>
        <button class="btn btn-primary btn-sm" onclick="openRKHFormModal()">+ Tambah RKH</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Riwayat RKH Saya (${rows.length})</span>
        <input type="date" class="input" style="max-width:170px;" value="${esc(rkhState.filterDate)}" onchange="rkhState.filterDate=this.value; renderRKHStaff();">
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Petak</th><th>Aktivitas</th><th>Kontraktor</th><th>Jml TK</th><th>Keterangan</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td><span class="petak-tag">${esc(r.petak)}</span></td>
                <td>${esc(r.aktivitas)}</td>
                <td>${esc(r.kontraktor||'-')}</td>
                <td>${esc(r.jumlah_tk ?? '-')}</td>
                <td>${esc(r.keterangan||'-')}</td>
                <td>${rkhBadge(r.status)}${r.status===RKH_STATUS.REJECTED && r.rejection_reason ? `<div style="font-size:11px; color:var(--accent-red-text); margin-top:3px;">${esc(r.rejection_reason)}</div>` : ''}</td>
                <td>${(r.status===RKH_STATUS.PENDING_SUPERVISOR || r.status===RKH_STATUS.REJECTED) ? `<button class="btn btn-outline btn-sm" onclick="openRKHFormModal(${r.id})">Edit</button>` : '–'}</td>
              </tr>
            `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data untuk tanggal ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* --- 5b. SUPERVISOR / SUPERINTENDENT ----------------------------------- */
function rkhStageFor(role){
  return role === 'supervisor'
    ? { pendingStatus: RKH_STATUS.PENDING_SUPERVISOR, actionLabel: 'Verifikasi', actionFn: 'rkhVerify', columnId: 'supervisor_id' }
    : { pendingStatus: RKH_STATUS.PENDING_SUPERINTENDENT, actionLabel: 'Approve Final', actionFn: 'rkhApprove', columnId: 'superintendent_id' };
}
function rkhExportRows(rows){
  return rows.map(r => ({
    'Tanggal': fmtTanggalRKH(r.tanggal),
    'Superintendent': r.superintendent_name || '-',
    'Supervisor': r.supervisor_name || '-',
    'Staff': r.staff_name || '-',
    'Petak': r.petak,
    'Aktivitas': r.aktivitas,
    'Kontraktor': r.kontraktor || '-',
    'Jumlah TK': r.jumlah_tk ?? '-',
    'Keterangan': r.keterangan || '-',
    'Status': r.status,
  }));
}
let rkhLastExportRows = [];
function rkhSetExportRows(rows){ rkhLastExportRows = rows; }
function rkhExportPDF(){ exportDataToPDF(rkhExportRows(rkhLastExportRows), 'Rencana Kerja Harian', 'rkh'); }
function rkhExportJPEG(){
  openExportDateRangeModal({ rows: rkhLastExportRows, dateField: 'tanggal', mapRow: r => rkhExportRows([r])[0], title: 'Rencana Kerja Harian', filePrefix: 'rkh' });
}
function rkhExportBtnsHTML(){
  return `
    <button class="btn btn-outline btn-sm" onclick="rkhExportPDF()">Export PDF</button>
    <button class="btn btn-outline btn-sm" onclick="rkhExportJPEG()">Export JPEG</button>
  `;
}
async function renderRKHAtasan(role){
  const stage = rkhStageFor(role);
  const rows = await rkhFetchRows({});
  rkhState.rows = rows;
  const todays = rows.filter(r => r.tanggal === todayISO());
  const s = rkhSummarize(todays);
  const perluAksi = rows.filter(r => r.status === stage.pendingStatus);
  const filteredTim = rkhState.useDateFilter ? rows.filter(r => r.tanggal === rkhState.filterDate) : rows;
  const exportSource = rkhState.tab === 'aksi' ? perluAksi : filteredTim;
  rkhSetExportRows(exportSource.filter(r => r.status === RKH_STATUS.APPROVED));

  $('#pageContent').innerHTML = `
    ${rkhSummaryCards(s)}
    <div class="rkh-tabs" style="margin-top:16px;">
      <button class="btn btn-sm ${rkhState.tab==='aksi'?'btn-primary':'btn-outline'}" onclick="rkhState.tab='aksi'; renderRKHAtasan('${role}');">Perlu ${esc(stage.actionLabel)} (${perluAksi.length})</button>
      <button class="btn btn-sm ${rkhState.tab==='tim'?'btn-primary':'btn-outline'}" onclick="rkhState.tab='tim'; renderRKHAtasan('${role}');">Semua RKH Tim Saya</button>
    </div>
    ${rkhState.tab==='aksi' ? `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Menunggu ${esc(stage.actionLabel)} Anda</span>
          <div style="display:flex; gap:8px;">${rkhExportBtnsHTML()}</div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Petak</th><th>Aktivitas</th><th>Kontraktor</th><th>Jml TK</th><th>Keterangan</th><th>Aksi</th></tr></thead>
            <tbody>
              ${perluAksi.length ? perluAksi.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td><span class="petak-tag">${esc(r.petak)}</span></td>
                  <td>${esc(r.aktivitas)}</td>
                  <td>${esc(r.kontraktor||'-')}</td>
                  <td>${esc(r.jumlah_tk ?? '-')}</td>
                  <td>${esc(r.keterangan||'-')}</td>
                  <td style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn btn-primary btn-sm" onclick="${stage.actionFn}(${r.id}, '${role}')">${esc(stage.actionLabel)}</button>
                    <button class="btn btn-danger btn-sm" onclick="openRKHRejectModal(${r.id}, '${role}')">Tolak</button>
                  </td>
                </tr>
              `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada yang perlu ditindaklanjuti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Semua RKH Tim Saya (${filteredTim.length})</span>
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
            <input type="date" class="input" style="max-width:170px;" value="${esc(rkhState.filterDate)}" onchange="rkhState.filterDate=this.value; renderRKHAtasan('${role}');">
            ${rkhExportBtnsHTML()}
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Petak</th><th>Aktivitas</th><th>Kontraktor</th><th>Jml TK</th><th>Status</th></tr></thead>
            <tbody>
              ${filteredTim.length ? filteredTim.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td><span class="petak-tag">${esc(r.petak)}</span></td>
                  <td>${esc(r.aktivitas)}</td>
                  <td>${esc(r.kontraktor||'-')}</td>
                  <td>${esc(r.jumlah_tk ?? '-')}</td>
                  <td>${rkhBadge(r.status)}</td>
                </tr>
              `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada data untuk tanggal ini.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

/* --- 5c. ADMIN / MANAGER (hanya summary) -------------------------------- */
async function renderRKHSummaryOnly(){
  const rows = await rkhFetchRows({ dateFrom: rkhState.filterDate, dateTo: rkhState.filterDate });
  const s = rkhSummarize(rows);
  const perZona = {};
  rows.forEach(r => { const z = r.zona || '–'; perZona[z] = perZona[z] || rkhSummarize([]); });
  Object.keys(perZona).forEach(z => { perZona[z] = rkhSummarize(rows.filter(r => (r.zona||'–') === z)); });

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <span class="card-title">Ringkasan Rencana Kerja Harian</span>
        <input type="date" class="input" style="max-width:170px;" value="${esc(rkhState.filterDate)}" onchange="rkhState.filterDate=this.value; renderRKHSummaryOnly();">
      </div>
    </div>
    ${rkhSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th style="text-align:center;">Total</th><th style="text-align:center;">Menunggu Verifikasi</th><th style="text-align:center;">Menunggu Approval</th><th style="text-align:center;">Disetujui</th><th style="text-align:center;">Ditolak</th><th style="text-align:center;">Total TK</th></tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => `
              <tr>
                <td><b>${esc(z)}</b></td>
                <td style="text-align:center;">${perZona[z].total}</td>
                <td style="text-align:center;">${perZona[z].pendingSupervisor}</td>
                <td style="text-align:center;">${perZona[z].pendingSuperintendent}</td>
                <td style="text-align:center;">${perZona[z].approved}</td>
                <td style="text-align:center;">${perZona[z].rejected}</td>
                <td style="text-align:center;">${perZona[z].totalTK}</td>
              </tr>
            `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data untuk tanggal ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Aktivitas Terbaru</span></div>
      <div class="card-body">${rkhTimelineHTML(rows, 20)}</div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   6. FORM TAMBAH / EDIT (Staff)
   --------------------------------------------------------------------- */
async function openRKHFormModal(id){
  const existing = id ? rkhState.rows.find(r => r.id === id) : null;
  const petakOptions = await rkhGetPetakOptions();
  const hier = await rkhGetHierarchyFor(currentProfile);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${existing ? 'Edit' : 'Tambah'} Rencana Kerja Harian</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px; display:flex; gap:14px; flex-wrap:wrap;">
          <span>Superintendent: <b>${esc(hier.superintendent_name)}</b></span>
          <span>Supervisor: <b>${esc(hier.supervisor_name)}</b></span>
        </div>
        <form id="rkhForm" class="form-grid">
          <div><label class="field-label">Tanggal RKH</label><input class="input" type="date" name="tanggal" value="${esc(existing ? existing.tanggal : todayISO())}" required></div>
          <div><label class="field-label">Petak</label>
            <input class="input" name="petak" list="rkhPetakList" autocomplete="off" placeholder="Ketik kode petak, mis. PNS052101" value="${esc(existing?.petak||'')}" required oninput="checkPetakFormatInput(this,'rkhPetakWarn')">
            <datalist id="rkhPetakList">
              ${petakOptions.map(p => `<option value="${esc(p)}">`).join('')}
            </datalist>
            ${petakFormatWarnHTML('rkhPetakWarn')}
          </div>
          <div><label class="field-label">Aktivitas</label><input class="input" name="aktivitas" value="${esc(existing?.aktivitas||'')}" required></div>
          <div><label class="field-label">Kontraktor</label><input class="input" name="kontraktor" value="${esc(existing?.kontraktor||'')}"></div>
          <div><label class="field-label">Jumlah Tenaga Kerja</label><input class="input" type="number" min="0" name="jumlah_tk" value="${esc(existing?.jumlah_tk ?? '')}"></div>
          <div><label class="field-label">Keterangan</label><input class="input" name="keterangan" value="${esc(existing?.keterangan||'')}" placeholder="START / PROGRESS / PRA SPA / SERVIS / dll"></div>
        </form>
        <div id="rkhFormError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="rkhSaveBtn" onclick="submitRKHForm(${existing ? existing.id : 'null'})">${existing ? 'Simpan Perubahan' : 'Tambahkan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function submitRKHForm(id){
  const form = $('#rkhForm');
  if(!form.reportValidity()) return;
  if(!isValidPetakFormat(form.elements.petak.value)){ toast('Format kode petak harus diawali "PNS" atau "KDS" + 6 digit angka, mis. PNS051902', true); return; }
  const btn = $('#rkhSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  $('#rkhFormError').classList.add('hidden');

  const hier = await rkhGetHierarchyFor(currentProfile);
  if(!hier.supervisor_id || !hier.superintendent_id){
    $('#rkhFormError').textContent = 'Akun Anda belum punya Supervisor/Superintendent. Hubungi Admin.';
    $('#rkhFormError').classList.remove('hidden');
    btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
    return;
  }

  const payload = {
    tanggal: form.elements.tanggal.value,
    zona: currentProfile.zona || null,
    staff_id: currentUser.id,
    staff_name: currentProfile.full_name,
    supervisor_id: hier.supervisor_id,
    supervisor_name: hier.supervisor_name,
    superintendent_id: hier.superintendent_id,
    superintendent_name: hier.superintendent_name,
    petak: form.elements.petak.value.trim(),
    aktivitas: form.elements.aktivitas.value.trim(),
    kontraktor: form.elements.kontraktor.value.trim() || null,
    jumlah_tk: form.elements.jumlah_tk.value === '' ? null : parseInt(form.elements.jumlah_tk.value, 10),
    keterangan: form.elements.keterangan.value.trim() || null,
    status: RKH_STATUS.PENDING_SUPERVISOR,
    rejection_reason: null,
    rejected_by_stage: null,
    verified_by_id: null, verified_by_name: null, verified_at: null,
    approved_by_id: null, approved_by_name: null, approved_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supa.from(RKH_TABLE).update(payload).eq('id', id)
    : await supa.from(RKH_TABLE).insert(payload);

  btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
  if(error){
    $('#rkhFormError').textContent = 'Gagal menyimpan: ' + error.message;
    $('#rkhFormError').classList.remove('hidden');
    return;
  }
  toast(id ? 'Rencana Kerja Harian diperbarui, menunggu verifikasi ulang' : 'Rencana Kerja Harian ditambahkan');
  closeModal();
  renderRKHStaff();
}

/* ---------------------------------------------------------------------
   7. VERIFIKASI / APPROVE / TOLAK (Supervisor & Superintendent)
   --------------------------------------------------------------------- */
async function rkhVerify(id){
  const { error } = await supa.from(RKH_TABLE).update({
    status: RKH_STATUS.PENDING_SUPERINTENDENT,
    verified_by_id: currentUser.id,
    verified_by_name: currentProfile.full_name,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal verifikasi: ' + error.message, true); return; }
  toast('RKH diverifikasi, diteruskan ke Superintendent');
  renderRKHAtasan('supervisor');
}
async function rkhApprove(id){
  const { error } = await supa.from(RKH_TABLE).update({
    status: RKH_STATUS.APPROVED,
    approved_by_id: currentUser.id,
    approved_by_name: currentProfile.full_name,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal approve: ' + error.message, true); return; }
  toast('RKH disetujui (final)');
  renderRKHAtasan('superintendent');
}

function openRKHRejectModal(id, role){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'rkhRejectOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><div class="card-title">Tolak Rencana Kerja Harian</div></div>
      <div class="modal-body">
        <label class="field-label">Alasan Penolakan</label>
        <textarea class="input" id="rkhRejectReason" rows="3" placeholder="Jelaskan alasan penolakan agar staff bisa merevisi…" required></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('rkhRejectOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="submitRKHReject(${id}, '${role}')">Tolak</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function submitRKHReject(id, role){
  const reason = $('#rkhRejectReason').value.trim();
  if(!reason){ toast('Alasan penolakan wajib diisi', true); return; }
  const { error } = await supa.from(RKH_TABLE).update({
    status: RKH_STATUS.REJECTED,
    rejection_reason: reason,
    rejected_by_stage: role,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  $('#rkhRejectOverlay')?.remove();
  if(error){ toast('Gagal menolak: ' + error.message, true); return; }
  toast('Rencana Kerja Harian ditolak, staff akan merevisi');
  renderRKHAtasan(role);
}

/* ---------------------------------------------------------------------
   8. BLOK RINGKASAN & TIMELINE DI BERANDA (Dashboard Gabungan)
   --------------------------------------------------------------------- */
const _rkhPrevRenderDashboard = renderDashboard;
renderDashboard = async function(){
  await _rkhPrevRenderDashboard();
  if(currentProfile?.role === 'viewer') return;
  const rows = await rkhFetchRows({ dateFrom: todayISO(), dateTo: todayISO() });
  const s = rkhSummarize(rows);
  const block = `
    <div class="card" style="margin-top:20px;">
      <div class="card-header">
        <span class="card-title">Rencana Kerja Harian — Hari Ini</span>
        <button class="btn btn-outline btn-sm" onclick="navigate('rkh')">Lihat Semua →</button>
      </div>
      <div class="card-body">
        ${rkhSummaryCards(s)}
        <div style="margin-top:16px;">${rkhTimelineHTML(rows, 10)}</div>
      </div>
    </div>
  `;
  $('#pageContent').insertAdjacentHTML('beforeend', block);
};

/* ---------------------------------------------------------------------
   9. NAVIGASI: tambah view 'rkh'
   --------------------------------------------------------------------- */
const _rkhPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'rkh'){
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
    await renderRKH();
    return;
  }
  return _rkhPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   10. SEMBUNYIKAN MENU RKH UNTUK VIEWER
   --------------------------------------------------------------------- */
const _rkhPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _rkhPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="rkh"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};

/* ---------------------------------------------------------------------
   11. KELOLA PENGGUNA — tambah kolom Supervisor & Superintendent
   --------------------------------------------------------------------- */
async function renderUsers(){
  $('#pageEyebrow').textContent = 'ADMINISTRASI';
  $('#pageTitle').textContent = 'Kelola Pengguna';
  if(!isAdminRole()){
    $('#pageContent').innerHTML = `<div class="empty-state">Halaman ini hanya dapat diakses oleh Admin.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  rkhResetProfilesCache();
  const profiles = await rkhLoadProfiles();
  const list = Object.values(profiles); // sudah terurut created_at terbaru dulu (lihat rkhLoadProfiles)
  const supervisors = list.filter(p => p.role === 'supervisor');
  const superintendents = list.filter(p => p.role === 'superintendent');

  $('#pageContent').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Daftar Pengguna (${list.length})</span>
        <button class="btn btn-primary btn-sm" onclick="openCreateUserModal()">+ Tambah Pengguna</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Zona</th><th>Supervisor</th><th>Superintendent</th><th>Online</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${list.map(p=>`
              <tr>
                <td>${esc(p.full_name)}</td>
                <td><span class="petak-tag">${esc((p.email||'').split('@')[0])}</span></td>
                <td>
                  <select class="input" style="padding:5px 8px; font-size:12px;" id="role_${p.id}" ${p.id===currentUser.id?'disabled':''}>
                    ${['admin','manager','superintendent','supervisor','staff','viewer'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td><input class="input" style="padding:5px 8px; font-size:12px; width:70px;" id="zona_${p.id}" value="${esc(p.zona)}"></td>
                <td>
                  ${p.role === 'staff' ? `
                    <select class="input" style="padding:5px 8px; font-size:12px; max-width:150px;" id="supervisor_${p.id}">
                      <option value="">— Pilih —</option>
                      ${supervisors.map(sv => `<option value="${sv.id}" ${p.supervisor_id===sv.id?'selected':''}>${esc(sv.full_name)}</option>`).join('')}
                    </select>` : '<span style="color:var(--text-faint);">–</span>'}
                </td>
                <td>
                  ${(p.role === 'staff' || p.role === 'supervisor') ? `
                    <select class="input" style="padding:5px 8px; font-size:12px; max-width:150px;" id="superintendent_${p.id}">
                      <option value="">— Pilih —</option>
                      ${superintendents.map(su => `<option value="${su.id}" ${p.superintendent_id===su.id?'selected':''}>${esc(su.full_name)}</option>`).join('')}
                    </select>` : '<span style="color:var(--text-faint);">–</span>'}
                </td>
                <td>
                  <span class="user-online-status" id="userOnlineStatus_${p.id}">
                    <span class="online-dot" id="onlineDot_${p.id}"></span>
                    <span id="onlineLabel_${p.id}">Offline</span>
                  </span>
                </td>
                <td>
                  <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
                    <input type="checkbox" id="active_${p.id}" ${p.is_active?'checked':''} ${p.id===currentUser.id?'disabled':''}> Aktif
                  </label>
                </td>
                <td style="display:flex; gap:6px; flex-wrap:wrap; align-items:flex-start; min-width:230px;">
                  <button class="btn btn-primary btn-sm" style="white-space:nowrap;" onclick="saveUser('${p.id}')" ${p.id===currentUser.id?'disabled':''}>Simpan</button>
                  ${p.role === 'admin' ? `
                    <button class="btn btn-outline btn-sm" style="white-space:nowrap;" onclick="openChangePasswordModal('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}', '${p.role}')">Ubah Password</button>
                    <button class="btn btn-danger btn-sm" style="white-space:nowrap;" onclick="confirmDeleteUser('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}')" ${p.id===currentUser.id?'disabled':''}>Hapus</button>
                  ` : `
                    <button class="btn btn-outline btn-sm" style="white-space:nowrap;" onclick="openChangePasswordModal('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}', '${p.role}')">Ubah Password</button>
                    <button class="btn btn-danger btn-sm" style="white-space:nowrap;" onclick="confirmDeleteUser('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}')" ${p.id===currentUser.id?'disabled':''}>Hapus</button>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <p style="color:var(--text-faint); font-size:12px; margin-top:12px;">Gunakan "Tambah Pengguna" untuk membuatkan akun baru (fitur pendaftaran mandiri sudah dinonaktifkan). Kolom Supervisor/Superintendent menentukan auto-isi Rencana Kerja Harian.</p>
  `;
  updateUsersOnlineIndicators();
}

async function saveUser(id){
  const role = $('#role_'+id).value;
  const zona = $('#zona_'+id).value || null;
  const is_active = $('#active_'+id).checked;
  const payload = { role, zona, is_active };
  const supervisorEl = $('#supervisor_'+id);
  const superintendentEl = $('#superintendent_'+id);
  if(supervisorEl) payload.supervisor_id = supervisorEl.value || null;
  if(superintendentEl) payload.superintendent_id = superintendentEl.value || null;
  const { error } = await supa.from('profiles').update(payload).eq('id', id);
  if(error){ toast('Gagal memperbarui pengguna: ' + error.message, true); return; }
  toast('Data pengguna diperbarui');
  rkhResetProfilesCache();
}
