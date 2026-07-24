/* =====================================================================
   DATA POSISI UNIT ADDON
   Di-load PALING TERAKHIR (setelah app.js, rkh.js, pra-spa.js & qc-by-proses.js).
   Sepenuhnya ADDITIF: hanya menambah menu baru "Data Posisi Unit" di
   section "Menu Data" + 1 modul baru di Peta (lihat peta-gis.js).

   Alur:
   - Staff input: Tanggal, Jenis Unit (SK-75/WT/Dozer/SK-130), Kode Unit
     (bebas), Petak (bebas), Keterangan.
   - LANGKAH 1 (satu-satunya langkah): SEMUA akun Supervisor di zona yang
     sama boleh verifikasi -> status "Terverifikasi". Tidak ada tahap
     Superintendent di modul ini.
   - Admin, Superintendent, dan Manager: hanya lihat ringkasan (summary),
     Superintendent otomatis dibatasi zonanya sendiri, Admin & Manager
     lihat semua zona.

   Butuh tabel `posisi_unit` — lihat posisi_unit_schema.sql (WAJIB
   dijalankan sekali di Supabase SQL Editor sebelum menu ini dipakai).
   ===================================================================== */

const PU_TABLE = 'posisi_unit';
const PU_STATUS_PENDING = 'Menunggu Verifikasi Supervisor';
const PU_STATUS_VERIFIED = 'Terverifikasi';
const PU_JENIS_UNIT = ['SK-75', 'WT', 'Dozer', 'SK-130'];

let puCache = null; // cache buat dipakai bareng modul Peta (ensurePosisiUnitData)
let puState = { tab: 'aksi', rows: [], filters: { tanggal: '', petak: '', jenisUnit: '', staffId: '', supervisorId: '' } };

/* ---------------------------------------------------------------------
   0b. EXPORT JPEG (pakai html2canvas, lazy-load lewat peta-export.js)
   --------------------------------------------------------------------- */
async function puExportJPEG(){
  const btn = document.getElementById('puExportJpegBtn');
  const original = btn ? btn.textContent : '';
  try{
    if(btn){ btn.disabled = true; btn.textContent = 'Memproses…'; }
    const allRows = puState.rows || [];
    const rows = puApplyFilters(allRows);
    const s = puSummarize(rows);
    const zonaSet = new Set(rows.map(r => r.zona || '–'));
    const perZona = {};
    zonaSet.forEach(z => { perZona[z] = puSummarize(rows.filter(r => (r.zona||'–') === z)); });
    const data = Object.keys(perZona).sort().map(z => {
      const row = { 'Zona': z, 'Total': perZona[z].total, 'Menunggu Verifikasi': perZona[z].pending, 'Terverifikasi': perZona[z].verified };
      PU_JENIS_UNIT.forEach(j => row[j] = perZona[z].byJenis[j]);
      return row;
    });
    if(!data.length){ toast('Tidak ada data untuk diekspor', true); return; }
    await exportDataToJPEG(data, 'Ringkasan Data Posisi Unit', 'posisi_unit_ringkasan');
  }catch(err){
    console.error('Export JPEG Data Posisi Unit gagal:', err);
    toast('Gagal export JPEG: ' + err.message, true);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = original || 'Export JPEG'; }
  }
}
function puExportBtnHTML(){
  return `<button class="btn btn-outline btn-sm" id="puExportJpegBtn" type="button" onclick="puExportJPEG()">Export JPEG</button>`;
}

/* ---------------------------------------------------------------------
   0c. EXPORT JPEG STAFF — modal pilih tanggal + tabel rapi, pola sama
   persis kayak Rencana Kerja Harian (lihat rkh.js: rkhExportRows /
   rkhExportJPEG / openExportDateRangeModal di export-menu.js).
   Cuma dipakai di renderPuStaff(); role lain tetap pakai puExportJPEG()
   lama (screenshot #pageContent apa adanya).
   --------------------------------------------------------------------- */
function puExportRows(rows){
  return rows.map(r => ({
    'Tanggal': fmtTanggalRKH(r.tanggal),
    'Jenis Unit': r.jenis_unit,
    'Kode Unit': r.kode_unit,
    'Petak': r.petak || '-',
    'Keterangan': r.keterangan || '-',
    'Status': r.status,
  }));
}
let puLastExportRows = [];
function puSetExportRows(rows){ puLastExportRows = rows; }
function puExportJPEGStaff(){
  openExportDateRangeModal({ rows: puLastExportRows, dateField: 'tanggal', mapRow: r => puExportRows([r])[0], title: 'Data Posisi Unit', filePrefix: 'posisi_unit' });
}
function puExportBtnStaffHTML(){
  return `<button class="btn btn-outline btn-sm" type="button" onclick="puExportJPEGStaff()">Export JPEG</button>`;
}

/* ---------------------------------------------------------------------
   1. DATA HELPERS
   --------------------------------------------------------------------- */
async function puSupervisorsInZona(zona){
  const profiles = await rkhLoadProfiles();
  const z = (zona || '').toString().trim().toUpperCase();
  return Object.values(profiles).filter(p => p.role === 'supervisor' && (p.zona || '').toString().trim().toUpperCase() === z);
}
function puScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(PU_TABLE).select('*').order('created_at', { ascending: false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor' || role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim();
    if(z) q = q.ilike('zona', z);
  }
  return q;
}
async function puFetchRows(){
  const { data, error } = await puScopedQuery().limit(1000);
  if(error){ toast('Gagal memuat Data Posisi Unit: ' + error.message, true); return []; }
  let rows = data || [];
  if(currentProfile?.role === 'supervisor' || currentProfile?.role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim().toUpperCase();
    if(z) rows = rows.filter(r => (r.zona || '').toString().trim().toUpperCase() === z);
  }
  return rows;
}
// Dipakai modul "Data Posisi Unit" di Peta (peta-gis.js). Cache sederhana di
// memori, bukan lewat `state[...]` generik app.js supaya addon ini berdiri
// sendiri (tidak perlu registrasi TABLES).
async function ensurePosisiUnitData(){
  if(puCache) return puCache;
  const { data, error } = await supa.from(PU_TABLE).select('*').limit(2000);
  if(error){ console.error('Gagal memuat Data Posisi Unit utk Peta:', error.message); return []; }
  const zonaRestrict = (typeof getUserZonaRestriction === 'function') ? getUserZonaRestriction() : null;
  puCache = zonaRestrict ? (data || []).filter(r => (r.zona||'').toString().trim().toUpperCase() === zonaRestrict.toString().trim().toUpperCase()) : (data || []);
  return puCache;
}
function puApplyFilters(rows){
  const f = puState.filters;
  return rows.filter(r => {
    if(f.tanggal && r.tanggal !== f.tanggal) return false;
    if(f.petak && !(r.petak||'').toLowerCase().includes(f.petak.toLowerCase())) return false;
    if(f.jenisUnit && r.jenis_unit !== f.jenisUnit) return false;
    if(f.staffId && r.staff_id !== f.staffId) return false;
    if(f.supervisorId && r.supervisor_id !== f.supervisorId) return false;
    return true;
  });
}

/* ---------------------------------------------------------------------
   2. BADGE & RINGKASAN
   --------------------------------------------------------------------- */
function puBadge(status){
  return status === PU_STATUS_VERIFIED
    ? `<span class="badge badge-done">${esc(status)}</span>`
    : `<span class="badge badge-neutral">${esc(status||'-')}</span>`;
}
function puSummarize(rows){
  const s = { total: rows.length, pending: 0, verified: 0, byJenis: {} };
  PU_JENIS_UNIT.forEach(j => s.byJenis[j] = 0);
  rows.forEach(r => {
    if(r.status === PU_STATUS_VERIFIED) s.verified++; else s.pending++;
    if(s.byJenis[r.jenis_unit] !== undefined) s.byJenis[r.jenis_unit]++;
  });
  return s;
}
function puSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total Data Posisi Unit', s.total, 'baris', 'var(--accent-gold)')}
    ${kpiCard('Menunggu Verifikasi', s.pending, 'perlu diverifikasi Supervisor', 'var(--accent-red)')}
    ${kpiCard('Terverifikasi', s.verified, 'sudah final', 'var(--accent-green)')}
    ${kpiCard('Sebaran Jenis Unit', PU_JENIS_UNIT.map(j => `${j}:${s.byJenis[j]}`).join(' · '), 'jumlah baris per jenis', 'var(--accent-blue)')}
  </div>`;
}

/* ---------------------------------------------------------------------
   3. FILTER BAR
   --------------------------------------------------------------------- */
function puFilterBarHTML(rows, rerenderFn){
  const staffOpts = Array.from(new Map(rows.filter(r=>r.staff_id).map(r => [r.staff_id, r.staff_name])).entries());
  const svOpts = Array.from(new Map(rows.filter(r=>r.supervisor_id).map(r => [r.supervisor_id, r.supervisor_name])).entries());
  const f = puState.filters;
  return `
    <div class="card" style="display:flex; gap:8px; flex-wrap:wrap; align-items:end; padding:12px 14px; margin-bottom:14px;">
      <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;"><label class="field-label">Tanggal</label><input class="input" type="date" value="${esc(f.tanggal)}" onchange="puState.filters.tanggal=this.value; ${rerenderFn}"></div>
      <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;"><label class="field-label">Petak</label><input class="input" placeholder="Cari petak…" value="${esc(f.petak)}" oninput="puState.filters.petak=this.value; ${rerenderFn}"></div>
      <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;"><label class="field-label">Jenis Unit</label><select class="input" onchange="puState.filters.jenisUnit=this.value; ${rerenderFn}">
        <option value="">Semua Jenis Unit</option>
        ${PU_JENIS_UNIT.map(j => `<option value="${esc(j)}" ${f.jenisUnit===j?'selected':''}>${esc(j)}</option>`).join('')}
      </select></div>
      <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;"><label class="field-label">Staff</label><select class="input" onchange="puState.filters.staffId=this.value; ${rerenderFn}">
        <option value="">Semua Staff</option>
        ${staffOpts.map(([id,name]) => `<option value="${id}" ${f.staffId===id?'selected':''}>${esc(name)}</option>`).join('')}
      </select></div>
      <div style="display:flex; flex-direction:column; gap:4px; min-width:140px;"><label class="field-label">Supervisor</label><select class="input" onchange="puState.filters.supervisorId=this.value; ${rerenderFn}">
        <option value="">Semua Supervisor</option>
        ${svOpts.map(([id,name]) => `<option value="${id}" ${f.supervisorId===id?'selected':''}>${esc(name)}</option>`).join('')}
      </select></div>
      <div><button class="btn btn-outline btn-sm" onclick="puState.filters={tanggal:'',petak:'',jenisUnit:'',staffId:'',supervisorId:''}; ${rerenderFn}">Reset Filter</button></div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   4. HALAMAN UTAMA
   --------------------------------------------------------------------- */
async function renderPosisiUnit(){
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'Data Posisi Unit';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  if(role === 'staff') return renderPuStaff();
  if(role === 'supervisor') return renderPuAtasan();
  return renderPuSummaryOnly(); // superintendent, admin, manager
}

/* --- 4a. STAFF ---------------------------------------------------------- */
async function renderPuStaff(){
  if(!(currentProfile.zona || '').toString().trim()){
    $('#pageContent').innerHTML = `<div class="card"><div class="card-body" style="padding:18px;">
      <p style="color:var(--text-muted);">Akun Anda belum diatur <b>Zona</b> oleh Admin. Silakan hubungi Admin
      untuk melengkapi ini sebelum bisa mengisi Data Posisi Unit.</p>
    </div></div>`;
    return;
  }
  const allRows = await puFetchRows();
  puState.rows = allRows;
  const rows = puApplyFilters(allRows);
  const s = puSummarize(rows);
  puSetExportRows(rows);

  $('#pageContent').innerHTML = `
    ${puSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input Data Posisi Unit</span>
        <div style="display:flex; gap:8px;">${puExportBtnStaffHTML()}<button class="btn btn-primary btn-sm" onclick="openPuFormModal()">+ Tambah Data Posisi Unit</button></div>
      </div>
    </div>
    ${puFilterBarHTML(allRows, 'renderPuStaff()')}
    <div class="card">
      <div class="card-header"><span class="card-title">Riwayat Data Posisi Unit Saya (${rows.length})</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Jenis Unit</th><th>Kode Unit</th><th>Petak</th><th>Keterangan</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td>${esc(r.jenis_unit)}</td>
                <td>${esc(r.kode_unit)}</td>
                <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                <td>${esc(r.keterangan||'-')}</td>
                <td>${puBadge(r.status)}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  ${r.status===PU_STATUS_PENDING ? `<button class="btn btn-outline btn-sm" onclick="openPuFormModal(${r.id})">Edit</button><button class="btn btn-danger btn-sm" onclick="puDeleteRow(${r.id})">Hapus</button>` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
async function puDeleteRow(id){
  if(!confirm('Hapus data posisi unit ini? Tindakan tidak bisa dibatalkan.')) return;
  const { data, error } = await supa.from(PU_TABLE).delete().eq('id', id).eq('staff_id', currentUser.id).select('id');
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  if(!data || !data.length){ toast('Gagal menghapus: ditolak server (cek RLS delete policy tabel posisi_unit)', true); return; }
  toast('Data Posisi Unit dihapus');
  puCache = null;
  renderPuStaff();
}

/* --- 4b. SUPERVISOR ------------------------------------------------------ */
async function renderPuAtasan(){
  const allRows = await puFetchRows();
  puState.rows = allRows;
  const s = puSummarize(allRows);
  const perluVerif = allRows.filter(r => r.status === PU_STATUS_PENDING);
  const filteredTim = puApplyFilters(allRows);

  $('#pageContent').innerHTML = `
    ${puSummaryCards(s)}
    <div class="rkh-tabs" style="margin-top:16px; display:flex; justify-content:space-between; align-items:center;">
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm ${puState.tab==='aksi'?'btn-primary':'btn-outline'}" onclick="puState.tab='aksi'; renderPuAtasan();">Perlu Verifikasi (${perluVerif.length})</button>
        <button class="btn btn-sm ${puState.tab==='tim'?'btn-primary':'btn-outline'}" onclick="puState.tab='tim'; renderPuAtasan();">Semua Data Posisi Unit Zona Saya</button>
      </div>
      ${puExportBtnHTML()}
    </div>
    ${puState.tab==='aksi' ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Menunggu Verifikasi Anda</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Jenis Unit</th><th>Kode Unit</th><th>Petak</th><th>Keterangan</th><th>Aksi</th></tr></thead>
            <tbody>
              ${perluVerif.length ? perluVerif.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.jenis_unit)}</td>
                  <td>${esc(r.kode_unit)}</td>
                  <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                  <td>${esc(r.keterangan||'-')}</td>
                  <td><button class="btn btn-primary btn-sm" onclick="puVerify(${r.id})">Verifikasi</button></td>
                </tr>
              `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada yang perlu diverifikasi.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      ${puFilterBarHTML(allRows, `renderPuAtasan()`)}
      <div class="card">
        <div class="card-header"><span class="card-title">Semua Data Posisi Unit Zona Saya (${filteredTim.length})</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Jenis Unit</th><th>Kode Unit</th><th>Petak</th><th>Keterangan</th><th>Status</th></tr></thead>
            <tbody>
              ${filteredTim.length ? filteredTim.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.jenis_unit)}</td>
                  <td>${esc(r.kode_unit)}</td>
                  <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                  <td>${esc(r.keterangan||'-')}</td>
                  <td>${puBadge(r.status)}</td>
                </tr>
              `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada data sesuai filter.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}
async function puVerify(id){
  const { error } = await supa.from(PU_TABLE).update({
    status: PU_STATUS_VERIFIED,
    verified_by_id: currentUser.id,
    verified_by_name: currentProfile.full_name,
    verified_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal verifikasi: ' + error.message, true); return; }
  toast('Data Posisi Unit diverifikasi');
  puCache = null;
  renderPuAtasan();
}

/* --- 4c. SUPERINTENDENT / ADMIN / MANAGER (ringkasan saja) --------------- */
async function renderPuSummaryOnly(){
  const allRows = await puFetchRows();
  puState.rows = allRows;
  const rows = puApplyFilters(allRows);
  const s = puSummarize(rows);
  const zonaSet = new Set(rows.map(r => r.zona || '–'));
  const perZona = {};
  zonaSet.forEach(z => { perZona[z] = puSummarize(rows.filter(r => (r.zona||'–') === z)); });
  const zonaLabel = (currentProfile?.role === 'superintendent' && currentProfile.zona) ? ` — Zona ${esc(currentProfile.zona)}` : ' — Semua Zona';

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;"><div class="card-header"><span class="card-title">Ringkasan Data Posisi Unit${zonaLabel}</span>${puExportBtnHTML()}</div></div>
    ${puFilterBarHTML(allRows, 'renderPuSummaryOnly()')}
    ${puSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th>Total</th><th>Menunggu Verifikasi</th><th>Terverifikasi</th>${PU_JENIS_UNIT.map(j=>`<th>${esc(j)}</th>`).join('')}</tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => `
              <tr>
                <td><b>${esc(z)}</b></td>
                <td>${perZona[z].total}</td>
                <td>${perZona[z].pending}</td>
                <td>${perZona[z].verified}</td>
                ${PU_JENIS_UNIT.map(j=>`<td>${perZona[z].byJenis[j]}</td>`).join('')}
              </tr>
            `).join('') : `<tr><td colspan="${4+PU_JENIS_UNIT.length}" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   5. FORM TAMBAH / EDIT (Staff)
   --------------------------------------------------------------------- */
async function openPuFormModal(id){
  const existing = id ? puState.rows.find(r => r.id === id) : null;
  const supervisors = await puSupervisorsInZona(currentProfile.zona);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:640px;">
      <div class="modal-header">
        <div class="card-title">${existing ? 'Edit' : 'Tambah'} Data Posisi Unit</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="puForm" class="form-grid">
          <div><label class="field-label">Tanggal</label><input class="input" type="date" name="tanggal" value="${esc(existing ? existing.tanggal : todayISO())}" required></div>
          <div>
            <label class="field-label">Jenis Unit</label>
            <select class="input" name="jenis_unit" required>
              <option value="">— Pilih Jenis Unit —</option>
              ${PU_JENIS_UNIT.map(j => `<option value="${esc(j)}" ${existing && existing.jenis_unit===j ? 'selected':''}>${esc(j)}</option>`).join('')}
            </select>
          </div>
          <div><label class="field-label">Kode Unit</label><input class="input" name="kode_unit" value="${esc(existing?.kode_unit||'')}" required></div>
          <div><label class="field-label">Petak</label><input class="input" name="petak" value="${esc(existing?.petak||'')}" required></div>
          <div style="grid-column:1/-1;"><label class="field-label">Keterangan</label><textarea class="input" name="keterangan" rows="3">${esc(existing?.keterangan||'')}</textarea></div>
          <div>
            <label class="field-label">Supervisor</label>
            <select class="input" name="supervisor_id" required>
              <option value="">— Pilih Supervisor (Zona ${esc(currentProfile.zona||'-')}) —</option>
              ${supervisors.map(sv => `<option value="${sv.id}" ${existing && existing.supervisor_id===sv.id ? 'selected':''}>${esc(sv.full_name)}</option>`).join('')}
            </select>
            ${!supervisors.length ? `<div style="font-size:11.5px; color:var(--accent-red-text); margin-top:4px;">Belum ada akun Supervisor di zona ini. Hubungi Admin.</div>` : ''}
          </div>
        </form>
        <div id="puFormError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="puSaveBtn" onclick="submitPuForm(${existing ? existing.id : 'null'})">${existing ? 'Simpan Perubahan' : 'Tambahkan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}
async function submitPuForm(id){
  const form = $('#puForm');
  if(!form.reportValidity()) return;
  const btn = $('#puSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  $('#puFormError').classList.add('hidden');

  const supervisorId = form.elements.supervisor_id.value;
  const supervisors = await puSupervisorsInZona(currentProfile.zona);
  const supervisorProfile = supervisors.find(sv => sv.id === supervisorId);

  const payload = {
    tanggal: form.elements.tanggal.value,
    zona: currentProfile.zona || null,
    jenis_unit: form.elements.jenis_unit.value,
    kode_unit: form.elements.kode_unit.value.trim(),
    petak: form.elements.petak.value.trim(),
    keterangan: form.elements.keterangan.value.trim() || null,
    supervisor_id: supervisorId || null,
    supervisor_name: supervisorProfile ? supervisorProfile.full_name : null,
    staff_id: currentUser.id,
    staff_name: currentProfile.full_name,
    status: PU_STATUS_PENDING,
    verified_by_id: null, verified_by_name: null, verified_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supa.from(PU_TABLE).update(payload).eq('id', id)
    : await supa.from(PU_TABLE).insert(payload);

  btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
  if(error){
    $('#puFormError').textContent = 'Gagal menyimpan: ' + error.message;
    $('#puFormError').classList.remove('hidden');
    return;
  }
  toast(id ? 'Data Posisi Unit diperbarui, menunggu verifikasi ulang' : 'Data Posisi Unit ditambahkan');
  closeModal();
  puCache = null;
  renderPuStaff();
}

/* ---------------------------------------------------------------------
   6. NAVIGASI: tambah view 'posisi_unit'
   --------------------------------------------------------------------- */
const _puPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'posisi_unit'){
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderPosisiUnit();
    return;
  }
  return _puPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   7. SEMBUNYIKAN MENU UNTUK VIEWER
   --------------------------------------------------------------------- */
const _puPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _puPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="posisi_unit"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};
