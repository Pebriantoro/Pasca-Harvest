/* =====================================================================
   PENGECEKAN PRA SPA ADDON
   Di-load PALING TERAKHIR (setelah app.js, rkh.js & addon lain). Sepenuhnya
   ADDITIF: tidak mengubah app.js/rkh.js, hanya menambah menu baru
   "Pengecekan Pra SPA" di bawah "Rencana Kerja Harian".

   Sumber aturan parameter A-E per Kegiatan & rumus Resume Sampling:
   file "Form Assesment SPA Internal" (Pra_SPA.xlsx) yang dikirim user.

   Alur:
   - HANYA akun Staff yang bisa input Pengecekan Pra SPA.
   - Staff memilih Kegiatan (dropdown) -> Keterangan Parameter (huruf A-E
     & artinya) muncul OTOMATIS sesuai kegiatan tsb, dan hanya huruf yang
     relevan yang bisa dicentang di grid Transek 1-6.
   - Kolom Spv: dropdown berisi akun Supervisor di ZONA yang sama dgn
     akun Staff yang input (bukan text bebas).
   - LANGKAH 1: SEMUA akun Supervisor di zona yang sama boleh
     memverifikasi (bukan hanya Spv yang dipilih di form -> itu cuma
     keterangan dokumen).
   - LANGKAH 2: SEMUA akun Superintendent di zona yang sama approve final.
   - Admin & Manager: hanya lihat ringkasan, tanpa aksi.
   - % Kelulusan = (Total Jumlah Plot - Jumlah Tidak Lulus) / Total Jumlah
     Plot x 100%. Total Jumlah Plot = 6 Transek x 10 Plot = 60 (tetap).
     Jumlah Tidak Lulus = TOTAL seluruh centang (huruf apa saja, plot mana
     saja) di semua transek — 1 centang = 1 hitungan tidak lulus. Standar
     Kelulusan = 95%.

   Butuh tabel `pengecekan_pra_spa` — lihat pra_spa_schema.sql (WAJIB
   dijalankan sekali di Supabase SQL Editor sebelum menu ini bisa dipakai).
   ===================================================================== */

const PRASPA_TABLE = 'pengecekan_pra_spa';
const PRASPA_STATUS = {
  PENDING_SUPERVISOR: 'Menunggu Verifikasi Supervisor',
  PENDING_SUPERINTENDENT: 'Menunggu Approval Superintendent',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};
const PRASPA_STANDAR = 95; // % standar kelulusan
const PRASPA_TRANSEK_COUNT = 6;
const PRASPA_PLOT_PER_TRANSEK = 10;
const PRASPA_TOTAL_PLOT = PRASPA_TRANSEK_COUNT * PRASPA_PLOT_PER_TRANSEK; // 60

// Warna chip per huruf (konsisten dipakai di semua kegiatan)
const PRASPA_LETTER_COLOR = {
  A: '#E53935', B: '#1E88E5', C: '#43A047', D: '#FDD835', E: '#8E24AA',
};
function praSpaLetterTextColor(letter){ return letter === 'D' ? '#241c00' : '#fff'; }

// Data "II. Keterangan Parameter" per Kegiatan, persis dari Pra_SPA.xlsx
const PRASPA_KEGIATAN = {
  'Pre-Plant Spraying': {
    letters: ['A', 'B'],
    params: { A: 'Poorkill', B: 'Miss' },
  },
  'Planting': {
    letters: ['A', 'B', 'C', 'D', 'E'],
    params: {
      A: 'Tidak Terdapat Bibit',
      B: 'Bibit Tidak Terpotong',
      C: 'Bibit Tidak Dicover',
      D: 'Tidak Terdapat Pupuk',
      E: 'Bibit Busuk ( Jelek )',
    },
  },
  'Pengendalian Hama Penyakit Tanaman dan Pengendalian Hama Tikus': {
    letters: ['A', 'B', 'C'],
    params: {
      A: 'Furadan Teraplikasi Tidak Merata',
      B: 'Areal tidak teraplikasi Furadan ( Miss )',
      C: 'Gumpalan Furadan terlalu besar & Tercecer',
    },
  },
  'Fertilizing Single Application': {
    letters: ['A', 'B', 'C'],
    params: {
      A: 'Pupuk Teraplikasi Tidak Merata',
      B: 'Areal tidak teraplikasi pupuk ( Miss )',
      C: 'Gumpalan pupuk terlalu besar & Tercecer',
    },
  },
  'Post Spraying 1': {
    letters: ['A', 'B', 'C', 'D', 'E'],
    params: { A: 'Poorkill', B: 'Miss', C: 'Drif', D: 'Damage', E: 'Rayutan' },
  },
  'Post Spraying 2': {
    letters: ['A', 'B', 'C', 'D', 'E'],
    params: { A: 'Poorkill', B: 'Miss', C: 'Drif', D: 'Damage', E: 'Rayutan' },
  },
  'Post Spraying 3': {
    letters: ['A', 'B', 'C', 'D', 'E'],
    params: { A: 'Poorkill', B: 'Miss', C: 'Drif', D: 'Damage', E: 'Rayutan' },
  },
  'Weeding Rayutan': {
    letters: ['A'],
    params: { A: 'Gulma pembelit tidak di cabut' },
  },
};
const PRASPA_KEGIATAN_LIST = Object.keys(PRASPA_KEGIATAN);

let praSpaState = {
  tab: 'aksi',          // 'aksi' | 'tim' | 'saya'
  filterDate: todayISO(),
  useDateFilter: true,
  rows: [],
};

/* ---------------------------------------------------------------------
   1. STYLE (disuntik sekali, tidak menyentuh styles.css)
   --------------------------------------------------------------------- */
(function praSpaInjectStyles(){
  const css = `
    .praspa-transek-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(230px,1fr)); gap:12px; margin-top:10px; }
    .praspa-transek-card{ border:1px solid var(--border-soft); border-radius:10px; overflow:hidden; }
    .praspa-transek-card h4{ margin:0; padding:8px 10px; background:var(--panel-soft, rgba(255,255,255,.04)); font-size:12.5px; }
    .praspa-transek-card table{ width:100%; border-collapse:collapse; font-size:12px; }
    .praspa-transek-card th, .praspa-transek-card td{ padding:5px 6px; text-align:center; border-top:1px solid var(--border-soft); }
    .praspa-transek-card th:first-child, .praspa-transek-card td:first-child{ text-align:left; padding-left:10px; }
    .praspa-letter-chip{ display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; font-weight:700; font-size:11px; }
    .praspa-param-box{ display:flex; flex-wrap:wrap; gap:8px 18px; padding:10px 12px; background:var(--panel-soft, rgba(255,255,255,.04)); border-radius:10px; margin-top:8px; }
    .praspa-param-row{ display:flex; align-items:center; gap:8px; font-size:12.5px; }
    .praspa-resume-table{ width:100%; border-collapse:collapse; font-size:12.5px; margin-top:8px; }
    .praspa-resume-table th, .praspa-resume-table td{ padding:6px 8px; text-align:center; border:1px solid var(--border-soft); }
    .praspa-resume-table th:first-child, .praspa-resume-table td:first-child{ text-align:left; }
    .praspa-verdict{ display:inline-block; padding:4px 12px; border-radius:20px; font-weight:700; font-size:13px; }
    .praspa-verdict.lulus{ background:rgba(67,160,71,.18); color:#6FCB74; }
    .praspa-verdict.tidak-lulus{ background:rgba(229,57,53,.18); color:#F0A392; }
    .praspa-chk{ width:16px; height:16px; cursor:pointer; }
    .praspa-chk:disabled{ opacity:.25; cursor:not-allowed; }
  `;
  const el = document.createElement('style');
  el.setAttribute('data-praspa', '1');
  el.textContent = css;
  document.head.appendChild(el);
})();

/* ---------------------------------------------------------------------
   2. HELPERS DATA
   --------------------------------------------------------------------- */
async function praSpaSupervisorsInZona(zona){
  const profiles = await rkhLoadProfiles(); // reuse cache dari rkh.js
  const z = (zona || '').toString().trim().toUpperCase();
  return Object.values(profiles).filter(p => p.role === 'supervisor' && (p.zona || '').toString().trim().toUpperCase() === z);
}

function praSpaScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(PRASPA_TABLE).select('*').order('created_at', { ascending: false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor' || role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim();
    if(z) q = q.ilike('zona', z);
  }
  // admin & manager: tanpa filter
  return q;
}
async function praSpaFetchRows({ dateFrom, dateTo } = {}){
  let q = praSpaScopedQuery();
  if(dateFrom) q = q.gte('tanggal', dateFrom);
  if(dateTo) q = q.lte('tanggal', dateTo);
  const { data, error } = await q.limit(500);
  if(error){ toast('Gagal memuat Pengecekan Pra SPA: ' + error.message, true); return []; }
  let rows = data || [];
  // Jaga-jaga tambahan di sisi klien utk zona (spasi/huruf besar-kecil)
  if(currentProfile?.role === 'supervisor' || currentProfile?.role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim().toUpperCase();
    if(z) rows = rows.filter(r => (r.zona || '').toString().trim().toUpperCase() === z);
  }
  return rows;
}

/* ---------------------------------------------------------------------
   3. HITUNG RESUME SAMPLING
   --------------------------------------------------------------------- */
// transekData: array 6 transek, tiap transek = array 10 plot {checked:['A','C',...]}
function praSpaComputeResume(kegiatanKey, transekData){
  const def = PRASPA_KEGIATAN[kegiatanKey] || { letters: [] };
  const letters = def.letters;
  const perTransek = [];
  const totalPerLetter = {}; letters.forEach(l => totalPerLetter[l] = 0);
  let totalTidakLulus = 0;
  for(let t = 0; t < PRASPA_TRANSEK_COUNT; t++){
    const plots = (transekData && transekData[t]) || [];
    const counts = {}; letters.forEach(l => counts[l] = 0);
    let rowTotal = 0;
    plots.forEach(plot => {
      (plot?.checked || []).forEach(l => {
        if(counts[l] === undefined) return; // huruf di luar parameter kegiatan ini, abaikan
        counts[l]++; rowTotal++; totalPerLetter[l]++;
      });
    });
    totalTidakLulus += rowTotal;
    perTransek.push({ transek: t + 1, counts, total: rowTotal });
  }
  const totalPlot = PRASPA_TOTAL_PLOT;
  const persen = totalPlot ? ((totalPlot - totalTidakLulus) / totalPlot) * 100 : 0;
  const verdict = persen >= PRASPA_STANDAR ? 'Lulus' : 'Tidak Lulus';
  return { letters, perTransek, totalPerLetter, totalTidakLulus, totalPlot, persen, standar: PRASPA_STANDAR, verdict };
}

function praSpaResumeTableHTML(resume){
  const { letters, perTransek, totalPerLetter, totalTidakLulus, totalPlot, persen, standar, verdict } = resume;
  return `
    <table class="praspa-resume-table">
      <thead><tr><th>Transek</th>${letters.map(l => `<th>${l}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>
        ${perTransek.map(row => `
          <tr>
            <td>${row.transek}</td>
            ${letters.map(l => `<td>${row.counts[l]}</td>`).join('')}
            <td><b>${row.total}</b></td>
          </tr>
        `).join('')}
        <tr style="background:var(--panel-soft, rgba(255,255,255,.05));">
          <td><b>Total</b></td>
          ${letters.map(l => `<td><b>${totalPerLetter[l]}</b></td>`).join('')}
          <td><b>${totalTidakLulus}</b></td>
        </tr>
      </tbody>
    </table>
    <div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-top:10px; font-size:12.5px;">
      <span>Total Jumlah Plot: <b>${totalPlot}</b></span>
      <span>Jumlah Tidak Lulus: <b>${totalTidakLulus}</b></span>
      <span>Standar Kelulusan: <b>${standar}%</b></span>
      <span>% Kelulusan: <b>${persen.toFixed(2)}%</b></span>
      <span class="praspa-verdict ${verdict === 'Lulus' ? 'lulus' : 'tidak-lulus'}">${verdict}</span>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   4. GRID TRANSEK 1-6 (form input / tampilan read-only)
   --------------------------------------------------------------------- */
function praSpaParamBoxHTML(kegiatanKey){
  const def = PRASPA_KEGIATAN[kegiatanKey];
  if(!def) return '';
  return `<div class="praspa-param-box">
    ${def.letters.map(l => `
      <div class="praspa-param-row">
        <span class="praspa-letter-chip" style="background:${PRASPA_LETTER_COLOR[l]}; color:${praSpaLetterTextColor(l)};">${l}</span>
        <span>${esc(def.params[l])}</span>
      </div>
    `).join('')}
  </div>`;
}

function praSpaTransekGridHTML(kegiatanKey, existingTransekData, readOnly){
  const def = PRASPA_KEGIATAN[kegiatanKey];
  if(!def) return '<div class="empty-state">Pilih Kegiatan terlebih dahulu.</div>';
  const allLetters = ['A', 'B', 'C', 'D', 'E'];
  let cards = '';
  for(let t = 0; t < PRASPA_TRANSEK_COUNT; t++){
    const plots = (existingTransekData && existingTransekData[t]) || [];
    let rows = '';
    for(let p = 0; p < PRASPA_PLOT_PER_TRANSEK; p++){
      const checkedLetters = plots[p]?.checked || [];
      rows += `<tr><td>${p + 1}</td>${allLetters.map(l => {
        const enabled = def.letters.includes(l);
        const checked = enabled && checkedLetters.includes(l);
        return `<td>${enabled ? `<input type="checkbox" class="praspa-chk" data-transek="${t}" data-plot="${p}" data-letter="${l}" ${checked ? 'checked' : ''} ${readOnly ? 'disabled' : ''} onchange="praSpaRecomputeResume()">` : ''}</td>`;
      }).join('')}</tr>`;
    }
    cards += `<div class="praspa-transek-card">
      <h4>Transek ${t + 1}</h4>
      <table>
        <thead><tr><th>No Plot</th>${allLetters.map(l => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
  return `<div class="praspa-transek-grid">${cards}</div>`;
}

function praSpaReadTransekFromDom(kegiatanKey){
  const def = PRASPA_KEGIATAN[kegiatanKey];
  const transek = [];
  for(let t = 0; t < PRASPA_TRANSEK_COUNT; t++){
    const plots = [];
    for(let p = 0; p < PRASPA_PLOT_PER_TRANSEK; p++){
      const checked = [];
      (def?.letters || []).forEach(l => {
        const el = document.querySelector(`.praspa-chk[data-transek="${t}"][data-plot="${p}"][data-letter="${l}"]`);
        if(el && el.checked) checked.push(l);
      });
      plots.push({ plot: p + 1, checked });
    }
    transek.push(plots);
  }
  return transek;
}

function praSpaRecomputeResume(){
  const kegiatanKey = $('#praSpaKegiatanSelect')?.value;
  if(!kegiatanKey) return;
  const transek = praSpaReadTransekFromDom(kegiatanKey);
  const resume = praSpaComputeResume(kegiatanKey, transek);
  const box = $('#praSpaResumeBox');
  if(box) box.innerHTML = praSpaResumeTableHTML(resume);
}

function praSpaOnKegiatanChange(){
  const kegiatanKey = $('#praSpaKegiatanSelect')?.value;
  $('#praSpaParamArea').innerHTML = kegiatanKey ? praSpaParamBoxHTML(kegiatanKey) : '';
  $('#praSpaTransekArea').innerHTML = kegiatanKey ? praSpaTransekGridHTML(kegiatanKey, null, false) : '';
  praSpaRecomputeResume();
}

/* ---------------------------------------------------------------------
   5. BADGE & RINGKASAN
   --------------------------------------------------------------------- */
function praSpaBadge(status){
  const map = {
    [PRASPA_STATUS.PENDING_SUPERVISOR]: 'badge-neutral',
    [PRASPA_STATUS.PENDING_SUPERINTENDENT]: 'badge-progress',
    [PRASPA_STATUS.APPROVED]: 'badge-done',
    [PRASPA_STATUS.REJECTED]: 'badge-rejected',
  };
  return `<span class="badge badge-stamp ${map[status] || 'badge-neutral'}">${esc(status || '–')}</span>`;
}
function praSpaVerdictBadge(row){
  const v = row?.resume?.verdict;
  if(!v) return '–';
  return `<span class="praspa-verdict ${v === 'Lulus' ? 'lulus' : 'tidak-lulus'}" style="font-size:11px; padding:2px 9px;">${esc(v)}</span>`;
}
function praSpaSummarize(rows){
  const s = { total: rows.length, pendingSupervisor: 0, pendingSuperintendent: 0, approved: 0, rejected: 0, lulus: 0, tidakLulus: 0 };
  rows.forEach(r => {
    if(r.status === PRASPA_STATUS.PENDING_SUPERVISOR) s.pendingSupervisor++;
    else if(r.status === PRASPA_STATUS.PENDING_SUPERINTENDENT) s.pendingSuperintendent++;
    else if(r.status === PRASPA_STATUS.APPROVED) s.approved++;
    else if(r.status === PRASPA_STATUS.REJECTED) s.rejected++;
    if(r.resume?.verdict === 'Lulus') s.lulus++; else if(r.resume?.verdict === 'Tidak Lulus') s.tidakLulus++;
  });
  return s;
}
function praSpaSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total Pengecekan', s.total, 'baris', 'var(--accent-gold)')}
    ${kpiCard('Menunggu Verifikasi', s.pendingSupervisor, 'tahap Supervisor', 'var(--accent-red)')}
    ${kpiCard('Menunggu Approval', s.pendingSuperintendent, 'tahap Superintendent', 'var(--accent-gold)')}
    ${kpiCard('Disetujui', s.approved, 'sudah final', 'var(--accent-green)')}
    ${kpiCard('Lulus / Tidak Lulus', `${s.lulus}/${s.tidakLulus}`, 'hasil sampling', 'var(--accent-blue)')}
  </div>`;
}

/* ---------------------------------------------------------------------
   6. HALAMAN UTAMA "Pengecekan Pra SPA"
   --------------------------------------------------------------------- */
async function renderPraSpa(){
  $('#pageEyebrow').textContent = 'PERENCANAAN';
  $('#pageTitle').textContent = 'Pengecekan Pra SPA';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  if(role === 'staff') return renderPraSpaStaff();
  if(role === 'supervisor') return renderPraSpaAtasan('supervisor');
  if(role === 'superintendent') return renderPraSpaAtasan('superintendent');
  return renderPraSpaSummaryOnly(); // admin & manager
}

/* --- 6a. STAFF ---------------------------------------------------------- */
async function renderPraSpaStaff(){
  if(!(currentProfile.zona || '').toString().trim()){
    $('#pageContent').innerHTML = `<div class="card"><div class="card-body" style="padding:18px;">
      <p style="color:var(--text-muted);">Akun Anda belum diatur <b>Zona</b> oleh Admin. Silakan hubungi Admin
      untuk melengkapi ini di menu Kelola Pengguna sebelum bisa mengisi Pengecekan Pra SPA.</p>
    </div></div>`;
    return;
  }
  const rows = await praSpaFetchRows({ dateFrom: praSpaState.useDateFilter ? praSpaState.filterDate : null, dateTo: praSpaState.useDateFilter ? praSpaState.filterDate : null });
  praSpaState.rows = rows;
  const s = praSpaSummarize(rows);

  $('#pageContent').innerHTML = `
    ${praSpaSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input Pengecekan Pra SPA</span>
        <button class="btn btn-primary btn-sm" onclick="openPraSpaFormModal()">+ Tambah Pengecekan</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Riwayat Pengecekan Saya (${rows.length})</span>
        <input type="date" class="input" style="max-width:170px;" value="${esc(praSpaState.filterDate)}" onchange="praSpaState.filterDate=this.value; renderPraSpaStaff();">
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Kegiatan</th><th>No Petak</th><th>Kontraktor</th><th>Luas Petak</th><th>% Kelulusan</th><th>Hasil</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td>${esc(r.kegiatan)}</td>
                <td><span class="petak-tag">${esc(r.no_petak||'-')}</span></td>
                <td>${esc(r.kontraktor||'-')}</td>
                <td>${esc(r.luas_petak ?? '-')}</td>
                <td>${r.resume ? r.resume.persen.toFixed(2)+'%' : '-'}</td>
                <td>${praSpaVerdictBadge(r)}</td>
                <td>${praSpaBadge(r.status)}${r.status===PRASPA_STATUS.REJECTED && r.rejection_reason ? `<div style="font-size:11px; color:var(--accent-red-text); margin-top:3px;">${esc(r.rejection_reason)}</div>` : ''}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-outline btn-sm" onclick="openPraSpaDetailModal(${r.id})">Detail</button>
                  ${(r.status===PRASPA_STATUS.PENDING_SUPERVISOR || r.status===PRASPA_STATUS.REJECTED) ? `<button class="btn btn-outline btn-sm" onclick="openPraSpaFormModal(${r.id})">Edit</button><button class="btn btn-danger btn-sm" onclick="praSpaDeleteRow(${r.id})">Hapus</button>` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data untuk tanggal ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* --- 6b. SUPERVISOR / SUPERINTENDENT ------------------------------------ */
function praSpaStageFor(role){
  return role === 'supervisor'
    ? { pendingStatus: PRASPA_STATUS.PENDING_SUPERVISOR, actionLabel: 'Verifikasi' }
    : { pendingStatus: PRASPA_STATUS.PENDING_SUPERINTENDENT, actionLabel: 'Approve Final' };
}
function praSpaExportRows(rows){
  return rows.map(r => ({
    'Tanggal': fmtTanggalRKH(r.tanggal), 'Zona': r.zona || '-', 'Staff': r.staff_name || '-',
    'Kegiatan': r.kegiatan, 'No Petak': r.no_petak, 'Kontraktor': r.kontraktor || '-',
    '% Kelulusan': r.resume ? r.resume.persen.toFixed(2)+'%' : '-', 'Status': r.status,
  }));
}
function praSpaExportJPEG(rows){
  openExportDateRangeModal({ rows, dateField: 'tanggal', mapRow: r => praSpaExportRows([r])[0], title: 'Pengecekan Pra SPA', filePrefix: 'pra_spa' });
}
async function renderPraSpaAtasan(role){
  const stage = praSpaStageFor(role);
  const rows = await praSpaFetchRows({});
  praSpaState.rows = rows;
  const s = praSpaSummarize(rows.filter(r => r.tanggal === todayISO()));
  const perluAksi = rows.filter(r => r.status === stage.pendingStatus);
  const filteredTim = praSpaState.useDateFilter ? rows.filter(r => r.tanggal === praSpaState.filterDate) : rows;
  praSpaState.exportRows = filteredTim;

  $('#pageContent').innerHTML = `
    ${praSpaSummaryCards(s)}
    <div class="rkh-tabs" style="margin-top:16px;">
      <button class="btn btn-sm ${praSpaState.tab==='aksi'?'btn-primary':'btn-outline'}" onclick="praSpaState.tab='aksi'; renderPraSpaAtasan('${role}');">Perlu ${esc(stage.actionLabel)} (${perluAksi.length})</button>
      <button class="btn btn-sm ${praSpaState.tab==='tim'?'btn-primary':'btn-outline'}" onclick="praSpaState.tab='tim'; renderPraSpaAtasan('${role}');">Semua Pengecekan Zona Saya</button>
    </div>
    ${praSpaState.tab==='aksi' ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Menunggu ${esc(stage.actionLabel)} Anda</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Kegiatan</th><th>No Petak</th><th>Kontraktor</th><th>% Kelulusan</th><th>Hasil</th><th>Aksi</th></tr></thead>
            <tbody>
              ${perluAksi.length ? perluAksi.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.kegiatan)}</td>
                  <td><span class="petak-tag">${esc(r.no_petak||'-')}</span></td>
                  <td>${esc(r.kontraktor||'-')}</td>
                  <td>${r.resume ? r.resume.persen.toFixed(2)+'%' : '-'}</td>
                  <td>${praSpaVerdictBadge(r)}</td>
                  <td><button class="btn btn-primary btn-sm" onclick="openPraSpaDetailModal(${r.id})">Lihat & Tindak Lanjut</button></td>
                </tr>
              `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada yang perlu ditindaklanjuti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Semua Pengecekan Zona Saya (${filteredTim.length})</span>
          <div style="display:flex; gap:8px;">
            <input type="date" class="input" style="max-width:170px;" value="${esc(praSpaState.filterDate)}" onchange="praSpaState.filterDate=this.value; renderPraSpaAtasan('${role}');">
            <button class="btn btn-outline btn-sm" onclick="praSpaExportJPEG(praSpaState.exportRows)">Export JPEG</button>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Kegiatan</th><th>No Petak</th><th>% Kelulusan</th><th>Hasil</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              ${filteredTim.length ? filteredTim.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.kegiatan)}</td>
                  <td><span class="petak-tag">${esc(r.no_petak||'-')}</span></td>
                  <td>${r.resume ? r.resume.persen.toFixed(2)+'%' : '-'}</td>
                  <td>${praSpaVerdictBadge(r)}</td>
                  <td>${praSpaBadge(r.status)}</td>
                  <td><button class="btn btn-outline btn-sm" onclick="openPraSpaDetailModal(${r.id})">Detail</button></td>
                </tr>
              `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada data untuk tanggal ini.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

/* --- 6c. ADMIN / MANAGER (hanya ringkasan) ------------------------------ */
async function renderPraSpaSummaryOnly(){
  const rows = await praSpaFetchRows({ dateFrom: praSpaState.filterDate, dateTo: praSpaState.filterDate });
  praSpaState.exportRows = rows;
  const s = praSpaSummarize(rows);
  const perZona = {};
  rows.forEach(r => { const z = r.zona || '–'; perZona[z] = true; });
  Object.keys(perZona).forEach(z => { perZona[z] = praSpaSummarize(rows.filter(r => (r.zona||'–') === z)); });

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header">
        <span class="card-title">Ringkasan Pengecekan Pra SPA</span>
        <div style="display:flex; gap:8px;">
          <input type="date" class="input" style="max-width:170px;" value="${esc(praSpaState.filterDate)}" onchange="praSpaState.filterDate=this.value; renderPraSpaSummaryOnly();">
          <button class="btn btn-outline btn-sm" onclick="praSpaExportJPEG(praSpaState.exportRows)">Export JPEG</button>
        </div>
      </div>
    </div>
    ${praSpaSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th>Total</th><th>Menunggu Verifikasi</th><th>Menunggu Approval</th><th>Disetujui</th><th>Ditolak</th><th>Lulus</th><th>Tidak Lulus</th></tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => `
              <tr>
                <td><b>${esc(z)}</b></td>
                <td>${perZona[z].total}</td>
                <td>${perZona[z].pendingSupervisor}</td>
                <td>${perZona[z].pendingSuperintendent}</td>
                <td>${perZona[z].approved}</td>
                <td>${perZona[z].rejected}</td>
                <td>${perZona[z].lulus}</td>
                <td>${perZona[z].tidakLulus}</td>
              </tr>
            `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data untuk tanggal ini.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   7. FORM TAMBAH / EDIT (Staff)
   --------------------------------------------------------------------- */
async function openPraSpaFormModal(id){
  const existing = id ? praSpaState.rows.find(r => r.id === id) : null;
  const supervisors = await praSpaSupervisorsInZona(currentProfile.zona);
  const praSpaDefaultSvId = defaultSupervisorIdFor(supervisors);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:920px;">
      <div class="modal-header">
        <div class="card-title">${existing ? 'Edit' : 'Tambah'} Pengecekan Pra SPA</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="praSpaForm" class="form-grid">
          <div>
            <label class="field-label">Kegiatan</label>
            <select class="input" name="kegiatan" id="praSpaKegiatanSelect" required onchange="praSpaOnKegiatanChange()">
              <option value="">— Pilih Kegiatan —</option>
              ${PRASPA_KEGIATAN_LIST.map(k => `<option value="${esc(k)}" ${existing && existing.kegiatan===k ? 'selected':''}>${esc(k)}</option>`).join('')}
            </select>
          </div>
          <div><label class="field-label">Tanggal</label><input class="input" type="date" name="tanggal" value="${esc(existing ? existing.tanggal : todayISO())}" required></div>
          <div><label class="field-label">Pengawas</label><input class="input" name="pengawas" value="${esc(existing?.pengawas||'')}" placeholder="Nama pengawas di lapangan" required></div>
          <div>
            <label class="field-label">Spv</label>
            <select class="input" name="supervisor_id" required>
              <option value="">— Pilih Supervisor (Zona ${esc(currentProfile.zona||'-')}) —</option>
              ${supervisors.map(sv => `<option value="${sv.id}" ${(existing ? existing.supervisor_id===sv.id : sv.id===praSpaDefaultSvId) ? 'selected':''}>${esc(sv.full_name)}</option>`).join('')}
            </select>
            ${!supervisors.length ? `<div style="font-size:11.5px; color:var(--accent-red-text); margin-top:4px;">Belum ada akun Supervisor di zona ini. Hubungi Admin.</div>` : ''}
          </div>
          <div><label class="field-label">No Petak</label><input class="input" name="no_petak" value="${esc(existing?.no_petak||'')}" required oninput="checkPetakFormatInput(this,'praSpaPetakWarn')">${petakFormatWarnHTML('praSpaPetakWarn')}</div>
          <div><label class="field-label">Kontraktor</label><input class="input" name="kontraktor" value="${esc(existing?.kontraktor||'')}"></div>
          <div><label class="field-label">Luas Petak (Ha)</label><input class="input" type="number" step="0.01" min="0" name="luas_petak" value="${esc(existing?.luas_petak ?? '')}"></div>
        </form>

        <div style="margin-top:14px;">
          <label class="field-label">II. Keterangan Parameter</label>
          <div id="praSpaParamArea">${existing ? praSpaParamBoxHTML(existing.kegiatan) : ''}</div>
        </div>

        <div style="margin-top:14px;">
          <label class="field-label">I. Purposive Sampling — Transek 1-6</label>
          <div id="praSpaTransekArea">${existing ? praSpaTransekGridHTML(existing.kegiatan, existing.transek, false) : '<div class="empty-state">Pilih Kegiatan terlebih dahulu.</div>'}</div>
        </div>

        <div style="margin-top:14px;">
          <label class="field-label">III. Resume Sampling</label>
          <div id="praSpaResumeBox">${existing ? praSpaResumeTableHTML(praSpaComputeResume(existing.kegiatan, existing.transek)) : ''}</div>
        </div>

        <div id="praSpaFormError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="praSpaSaveBtn" onclick="submitPraSpaForm(${existing ? existing.id : 'null'})">${existing ? 'Simpan Perubahan' : 'Tambahkan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function submitPraSpaForm(id){
  const form = $('#praSpaForm');
  if(!form.reportValidity()) return;
  if(!isValidPetakFormat(form.elements.no_petak.value)){ toast('Format kode petak harus diawali "PNS" atau "KDS" + 6 digit angka, mis. PNS051902', true); return; }
  const kegiatanKey = form.elements.kegiatan.value;
  if(!kegiatanKey || !PRASPA_KEGIATAN[kegiatanKey]){
    toast('Kegiatan tidak valid', true); return;
  }
  const btn = $('#praSpaSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  $('#praSpaFormError').classList.add('hidden');

  const supervisorId = form.elements.supervisor_id.value;
  const supervisors = await praSpaSupervisorsInZona(currentProfile.zona);
  const supervisorProfile = supervisors.find(sv => sv.id === supervisorId);

  const transek = praSpaReadTransekFromDom(kegiatanKey);
  const resume = praSpaComputeResume(kegiatanKey, transek);

  const payload = {
    tanggal: form.elements.tanggal.value,
    zona: currentProfile.zona || null,
    kegiatan: kegiatanKey,
    pengawas: form.elements.pengawas.value.trim(),
    supervisor_id: supervisorId || null,
    supervisor_name: supervisorProfile ? supervisorProfile.full_name : null,
    no_petak: form.elements.no_petak.value.trim(),
    kontraktor: form.elements.kontraktor.value.trim() || null,
    luas_petak: form.elements.luas_petak.value === '' ? null : parseFloat(form.elements.luas_petak.value),
    parameter_snapshot: PRASPA_KEGIATAN[kegiatanKey],
    transek,
    resume,
    staff_id: currentUser.id,
    staff_name: currentProfile.full_name,
    status: PRASPA_STATUS.PENDING_SUPERVISOR,
    rejection_reason: null,
    rejected_by_stage: null,
    verified_by_id: null, verified_by_name: null, verified_at: null,
    approved_by_id: null, approved_by_name: null, approved_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supa.from(PRASPA_TABLE).update(payload).eq('id', id)
    : await supa.from(PRASPA_TABLE).insert(payload);

  btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
  if(error){
    $('#praSpaFormError').textContent = 'Gagal menyimpan: ' + error.message;
    $('#praSpaFormError').classList.remove('hidden');
    return;
  }
  toast(id ? 'Pengecekan Pra SPA diperbarui, menunggu verifikasi ulang' : 'Pengecekan Pra SPA ditambahkan');
  closeModal();
  renderPraSpaStaff();
}

async function praSpaDeleteRow(id){
  if(!confirm('Hapus data Pengecekan Pra SPA ini? Tindakan tidak bisa dibatalkan.')) return;
  const { error } = await supa.from(PRASPA_TABLE).delete().eq('id', id).eq('staff_id', currentUser.id);
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Pengecekan Pra SPA dihapus');
  renderPraSpaStaff();
}

/* ---------------------------------------------------------------------
   8. DETAIL / VERIFIKASI / APPROVE / TOLAK
   --------------------------------------------------------------------- */
function praSpaCanAct(row, role){
  if(role === 'supervisor') return row.status === PRASPA_STATUS.PENDING_SUPERVISOR;
  if(role === 'superintendent') return row.status === PRASPA_STATUS.PENDING_SUPERINTENDENT;
  return false;
}
function openPraSpaDetailModal(id){
  const row = praSpaState.rows.find(r => r.id === id);
  if(!row){ toast('Data tidak ditemukan', true); return; }
  const role = currentProfile?.role;
  const canAct = praSpaCanAct(row, role);
  const resume = row.resume || praSpaComputeResume(row.kegiatan, row.transek);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:920px;">
      <div class="modal-header">
        <div class="card-title">Detail Pengecekan Pra SPA</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px; color:var(--text-muted); display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
          <span>Kegiatan: <b>${esc(row.kegiatan)}</b></span>
          <span>Tanggal: <b>${esc(fmtTanggalRKH(row.tanggal))}</b></span>
          <span>Zona: <b>${esc(row.zona||'-')}</b></span>
          <span>Status: ${praSpaBadge(row.status)}</span>
        </div>
        <div style="font-size:12.5px; color:var(--text-muted); display:flex; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
          <span>Staff: <b>${esc(row.staff_name)}</b></span>
          <span>Pengawas: <b>${esc(row.pengawas||'-')}</b></span>
          <span>Spv: <b>${esc(row.supervisor_name||'-')}</b></span>
          <span>No Petak: <b>${esc(row.no_petak||'-')}</b></span>
          <span>Kontraktor: <b>${esc(row.kontraktor||'-')}</b></span>
          <span>Luas Petak: <b>${esc(row.luas_petak ?? '-')}</b></span>
        </div>

        <label class="field-label">II. Keterangan Parameter</label>
        ${praSpaParamBoxHTML(row.kegiatan)}

        <label class="field-label" style="margin-top:14px; display:block;">I. Purposive Sampling — Transek 1-6</label>
        ${praSpaTransekGridHTML(row.kegiatan, row.transek, true)}

        <label class="field-label" style="margin-top:14px; display:block;">III. Resume Sampling</label>
        ${praSpaResumeTableHTML(resume)}

        ${row.status===PRASPA_STATUS.REJECTED && row.rejection_reason ? `<div style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;">Alasan ditolak (${esc(row.rejected_by_stage||'-')}): ${esc(row.rejection_reason)}</div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${canAct ? `
          <button class="btn btn-danger" onclick="openPraSpaRejectModal(${row.id}, '${role}')">Tolak</button>
          <button class="btn btn-primary" onclick="${role==='supervisor' ? `praSpaVerify(${row.id})` : `praSpaApprove(${row.id})`}">${role==='supervisor' ? 'Verifikasi' : 'Approve Final'}</button>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function praSpaVerify(id){
  const { error } = await supa.from(PRASPA_TABLE).update({
    status: PRASPA_STATUS.PENDING_SUPERINTENDENT,
    verified_by_id: currentUser.id,
    verified_by_name: currentProfile.full_name,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal verifikasi: ' + error.message, true); return; }
  toast('Pengecekan Pra SPA diverifikasi, diteruskan ke Superintendent');
  closeModal();
  renderPraSpaAtasan('supervisor');
}
async function praSpaApprove(id){
  const { error } = await supa.from(PRASPA_TABLE).update({
    status: PRASPA_STATUS.APPROVED,
    approved_by_id: currentUser.id,
    approved_by_name: currentProfile.full_name,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal approve: ' + error.message, true); return; }
  toast('Pengecekan Pra SPA disetujui (final)');
  closeModal();
  renderPraSpaAtasan('superintendent');
}
function openPraSpaRejectModal(id, role){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'praSpaRejectOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><div class="card-title">Tolak Pengecekan Pra SPA</div></div>
      <div class="modal-body">
        <label class="field-label">Alasan Penolakan</label>
        <textarea class="input" id="praSpaRejectReason" rows="3" placeholder="Jelaskan alasan penolakan agar staff bisa merevisi…" required></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('praSpaRejectOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="submitPraSpaReject(${id}, '${role}')">Tolak</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function submitPraSpaReject(id, role){
  const reason = $('#praSpaRejectReason').value.trim();
  if(!reason){ toast('Alasan penolakan wajib diisi', true); return; }
  const { error } = await supa.from(PRASPA_TABLE).update({
    status: PRASPA_STATUS.REJECTED,
    rejection_reason: reason,
    rejected_by_stage: role,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  $('#praSpaRejectOverlay')?.remove();
  if(error){ toast('Gagal menolak: ' + error.message, true); return; }
  toast('Pengecekan Pra SPA ditolak, staff akan merevisi');
  closeModal();
  renderPraSpaAtasan(role);
}

/* ---------------------------------------------------------------------
   9. NAVIGASI: tambah view 'pra_spa'
   --------------------------------------------------------------------- */
const _praSpaPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'pra_spa'){
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
    await renderPraSpa();
    return;
  }
  return _praSpaPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   10. SEMBUNYIKAN MENU UNTUK VIEWER
   --------------------------------------------------------------------- */
const _praSpaPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _praSpaPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="pra_spa"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};
