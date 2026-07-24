/* =====================================================================
   QC BY PROSES ADDON
   Di-load PALING TERAKHIR (setelah app.js, rkh.js & pra-spa.js). Sepenuhnya
   ADDITIF: tidak mengubah file lain, hanya menambah menu baru
   "QC By Proses" di bawah "Pengecekan Pra SPA".

   Sumber parameter per Kegiatan: rekap kolom abu-abu (Furrowing, Planting,
   Blanking, Fertilizing Single Aplication, Post Spraying 1/2/3, Weeding
   Rayutan) yang dikirim user.

   Alur:
   - HANYA akun Staff yang bisa input QC By Proses.
   - Staff pilih Kegiatan -> parameter (kolom abu-abu) muncul otomatis
     sesuai kegiatan itu, tiap parameter dinilai 1-3 (1=Kurang, 2=Cukup,
     3=Baik).
   - Average Nilai = rata-rata seluruh parameter kegiatan itu. Kategori
     Score: rata-rata >= 2.5 => Baik, 1.5 - 2.49 => Cukup, < 1.5 => Kurang.
     Nilai QC (nilai akhir baris) = Average Nilai kegiatan tsb.
   - Kolom Spv: dropdown akun Supervisor di ZONA yang sama dgn staff.
   - LANGKAH 1: SEMUA akun Supervisor di zona yang sama boleh verifikasi.
   - LANGKAH 2: SEMUA akun Superintendent di zona yang sama approve final.
   - Admin & Manager: hanya lihat ringkasan SEMUA zona (summary all),
     tanpa aksi.
   - Filter tersedia: Tanggal, Petak, Kegiatan, Staff, Supervisor,
     Superintendent.

   Butuh tabel `qc_by_proses` — lihat qc_by_proses_schema.sql (WAJIB
   dijalankan sekali di Supabase SQL Editor sebelum menu ini bisa dipakai).
   ===================================================================== */

const QCP_TABLE = 'qc_by_proses';
const QCP_STATUS = {
  PENDING_SUPERVISOR: 'Menunggu Verifikasi Supervisor',
  PENDING_SUPERINTENDENT: 'Menunggu Approval Superintendent',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};
const QCP_SCORE_LABEL = { 1: 'Kurang', 2: 'Cukup', 3: 'Baik' };
const QCP_BAIK_MIN = 2.5;
const QCP_CUKUP_MIN = 1.5;
// Planting & Blanking pakai skala 2 opsi per parameter (nilai 2/1, lihat
// QCP_KEGIATAN di bawah) sesuai "Parameter_Penilaian_QC_By_Proses_Update.pdf".
// Rata-rata maksimal jadi 2 (bukan 3), jadi threshold Baik/Cukup disesuaikan:
// rata-rata = 2 (semua parameter YA) => Baik, >= 1.5 => Cukup, < 1.5 => Kurang.
const QCP_BINARY_THRESHOLDS = { baikMin: 2, cukupMin: 1.5 };

// Parameter (kolom abu-abu) persis dari rekap user, per Kegiatan
const QCP_KEGIATAN = {
  'Furrowing': {
    keys: ['P1', 'P2', 'P3'],
    params: {
      P1: 'Jarak Antar Juring',
      P2: 'Ketinggian Juringan',
      P3: 'Kondisi Ridger',
    },
    options: {
      P1: [{ value: 2, label: '1.5 meter' }, { value: 1, label: 'Kurang/Lebih' }],
      P2: [{ value: 2, label: '30 cm - 50 cm' }, { value: 1, label: 'Kurang/Lebih' }],
      P3: [{ value: 2, label: 'Lurus' }, { value: 1, label: 'Tidak Lurus' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Planting': {
    keys: ['P1', 'P2', 'P3', 'P4'],
    params: {
      P1: 'GAP',
      P2: 'Cacahan Bibit',
      P3: 'Coveran Bibit',
      P4: 'Kondisi Bibit',
    },
    // Sesuai PDF: tiap parameter opsi sendiri, bukan skala umum 1-3.
    options: {
      P1: [{ value: 2, label: 'Terdapat Bibit' }, { value: 1, label: 'Tidak Terdapat Bibit' }],
      P2: [{ value: 2, label: 'Bibit Terpotong' }, { value: 1, label: 'Bibit Tidak Terpotong' }],
      P3: [{ value: 2, label: 'Bibit Tercover' }, { value: 1, label: 'Bibit Tidak Tercover' }],
      P4: [{ value: 2, label: 'Segar/Baik' }, { value: 1, label: 'Busuk/Kering' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Blanking': {
    keys: ['P1', 'P2', 'P3', 'P4'],
    params: {
      P1: 'GAP',
      P2: 'Cacahan Bibit',
      P3: 'Coveran Bibit',
      P4: 'Kondisi Bibit',
    },
    options: {
      P1: [{ value: 2, label: 'Terdapat Bibit' }, { value: 1, label: 'Tidak Terdapat Bibit' }],
      P2: [{ value: 2, label: 'Bibit Terpotong' }, { value: 1, label: 'Bibit Tidak Terpotong' }],
      P3: [{ value: 2, label: 'Bibit Tercover' }, { value: 1, label: 'Bibit Tidak Tercover' }],
      P4: [{ value: 2, label: 'Segar/Baik' }, { value: 1, label: 'Busuk/Kering' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Fertilizing Single Aplication': {
    keys: ['P1', 'P2', 'P3'],
    params: {
      P1: 'Aplikasi Pupuk',
      P2: 'Areal Tidak Teraplikasi',
      P3: 'Gumplan Besar/Tercecer',
    },
    options: {
      P1: [{ value: 2, label: 'Teraplikasi Pupuk' }, { value: 1, label: 'Tidak Teraplikasi' }],
      P2: [{ value: 2, label: 'Tidak Ada' }, { value: 1, label: 'Ada' }],
      P3: [{ value: 2, label: 'Tidak Ada' }, { value: 1, label: 'Ada' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Post Spraying 1': {
    keys: ['P1', 'P2', 'P3'],
    params: {
      P1: 'Mised',
      P2: 'Poorkill',
      P3: 'Aplikator Berjalan Di Juringan',
    },
    options: {
      P1: [{ value: 2, label: 'Semprotan Merata' }, { value: 1, label: 'Semprotan Tidak Merata' }],
      P2: [{ value: 2, label: 'Semprotan Basah' }, { value: 1, label: 'Semprotan Kurang Basah' }],
      P3: [{ value: 2, label: 'YA' }, { value: 1, label: 'TIDAK' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Post Spraying 2': {
    keys: ['P1', 'P2', 'P3'],
    params: {
      P1: 'Mised',
      P2: 'Poorkill',
      P3: 'Aplikator Berjalan Di Juringan',
    },
    options: {
      P1: [{ value: 2, label: 'Semprotan Merata' }, { value: 1, label: 'Semprotan Tidak Merata' }],
      P2: [{ value: 2, label: 'Semprotan Basah' }, { value: 1, label: 'Semprotan Kurang Basah' }],
      P3: [{ value: 2, label: 'YA' }, { value: 1, label: 'TIDAK' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Post Spraying 3': {
    keys: ['P1', 'P2', 'P3'],
    params: {
      P1: 'Mised',
      P2: 'Poorkill',
      P3: 'Aplikator Berjalan Di Juringan',
    },
    options: {
      P1: [{ value: 2, label: 'Semprotan Merata' }, { value: 1, label: 'Semprotan Tidak Merata' }],
      P2: [{ value: 2, label: 'Semprotan Basah' }, { value: 1, label: 'Semprotan Kurang Basah' }],
      P3: [{ value: 2, label: 'YA' }, { value: 1, label: 'TIDAK' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
  'Weeding Rayutan': {
    keys: ['P1', 'P2'],
    params: {
      P1: 'Gulma Pembelit Dicabut',
      P2: 'Gulma Pembelit Digantung/Dibawa Keluar',
    },
    options: {
      P1: [{ value: 2, label: 'YA' }, { value: 1, label: 'TIDAK' }],
      P2: [{ value: 2, label: 'YA' }, { value: 1, label: 'TIDAK' }],
    },
    thresholds: QCP_BINARY_THRESHOLDS,
  },
};
const QCP_KEGIATAN_LIST = Object.keys(QCP_KEGIATAN);

let qcpState = {
  tab: 'aksi', // 'aksi' | 'tim'
  rows: [],
  filters: { tanggal: '', petak: '', kegiatan: '', staffId: '', supervisorId: '', superintendentId: '' },
};

/* ---------------------------------------------------------------------
   1. STYLE
   --------------------------------------------------------------------- */
(function qcpInjectStyles(){
  const css = `
    .qcp-param-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(280px,1fr)); gap:10px; margin-top:10px; }
    .qcp-param-row{ display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 12px; background:var(--panel-soft, rgba(255,255,255,.04)); border-radius:9px; font-size:12.5px; }
    .qcp-param-row select{ max-width:130px; }
    .qcp-kategori{ display:inline-block; padding:3px 11px; border-radius:20px; font-weight:700; font-size:12px; }
    .qcp-kategori.baik{ background:rgba(67,160,71,.18); color:#6FCB74; }
    .qcp-kategori.cukup{ background:rgba(253,216,53,.18); color:#E3C33C; }
    .qcp-kategori.kurang{ background:rgba(229,57,53,.18); color:#F0A392; }
    .qcp-filter-bar{ display:flex; gap:8px; flex-wrap:wrap; align-items:end; padding:12px 14px; margin-bottom:14px; }
    .qcp-filter-bar .qcp-f{ display:flex; flex-direction:column; gap:4px; min-width:140px; }
    .qcp-filter-bar label{ font-size:11px; color:var(--text-muted); }
    .qcp-avg-box{ display:flex; align-items:center; gap:14px; flex-wrap:wrap; margin-top:10px; font-size:12.5px; }
  `;
  const el = document.createElement('style');
  el.setAttribute('data-qcp', '1');
  el.textContent = css;
  document.head.appendChild(el);
})();

/* ---------------------------------------------------------------------
   2. HELPERS SKOR
   --------------------------------------------------------------------- */
function qcpKategoriFromAvg(avg, thresholds){
  const t = thresholds || { baikMin: QCP_BAIK_MIN, cukupMin: QCP_CUKUP_MIN };
  if(avg >= t.baikMin) return 'Baik';
  if(avg >= t.cukupMin) return 'Cukup';
  return 'Kurang';
}
function qcpKategoriClass(kategori){
  return kategori === 'Baik' ? 'baik' : (kategori === 'Cukup' ? 'cukup' : 'kurang');
}
function qcpComputeScore(kegiatanKey, scores){
  const def = QCP_KEGIATAN[kegiatanKey];
  if(!def) return { keys: [], scores: {}, average: 0, kategori: 'Kurang' };
  const vals = def.keys.map(k => Number(scores?.[k]) || 0).filter(v => v > 0);
  const average = vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length) : 0;
  return { keys: def.keys, scores: scores || {}, average: Math.round(average * 100) / 100, kategori: qcpKategoriFromAvg(average, def.thresholds) };
}

/* ---------------------------------------------------------------------
   3. HELPERS DATA
   --------------------------------------------------------------------- */
async function qcpSupervisorsInZona(zona){
  const profiles = await rkhLoadProfiles();
  const z = (zona || '').toString().trim().toUpperCase();
  return Object.values(profiles).filter(p => p.role === 'supervisor' && (p.zona || '').toString().trim().toUpperCase() === z);
}
function qcpScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(QCP_TABLE).select('*').order('created_at', { ascending: false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor' || role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim();
    if(z) q = q.ilike('zona', z);
  }
  return q;
}
async function qcpFetchRows(){
  let q = qcpScopedQuery();
  const { data, error } = await q.limit(500);
  if(error){ toast('Gagal memuat QC By Proses: ' + error.message, true); return []; }
  let rows = data || [];
  if(currentProfile?.role === 'supervisor' || currentProfile?.role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim().toUpperCase();
    if(z) rows = rows.filter(r => (r.zona || '').toString().trim().toUpperCase() === z);
  }
  return rows;
}
function qcpApplyFilters(rows){
  const f = qcpState.filters;
  return rows.filter(r => {
    if(f.tanggal && r.tanggal !== f.tanggal) return false;
    if(f.petak && !(r.petak || '').toLowerCase().includes(f.petak.toLowerCase())) return false;
    if(f.kegiatan && r.kegiatan !== f.kegiatan) return false;
    if(f.staffId && r.staff_id !== f.staffId) return false;
    if(f.supervisorId && r.supervisor_id !== f.supervisorId) return false;
    if(f.superintendentId && r.approved_by_id !== f.superintendentId) return false;
    return true;
  });
}

/* ---------------------------------------------------------------------
   4. BADGE & RINGKASAN
   --------------------------------------------------------------------- */
function qcpBadge(status){
  const map = {
    [QCP_STATUS.PENDING_SUPERVISOR]: 'badge-neutral',
    [QCP_STATUS.PENDING_SUPERINTENDENT]: 'badge-progress',
    [QCP_STATUS.APPROVED]: 'badge-done',
    [QCP_STATUS.REJECTED]: 'badge-rejected',
  };
  return `<span class="badge badge-stamp ${map[status] || 'badge-neutral'}">${esc(status || '–')}</span>`;
}
function qcpKategoriBadge(row){
  const k = row?.kategori;
  if(!k) return '–';
  return `<span class="qcp-kategori ${qcpKategoriClass(k)}">${esc(k)}</span>`;
}
function qcpSummarize(rows){
  const s = { total: rows.length, pendingSupervisor: 0, pendingSuperintendent: 0, approved: 0, rejected: 0, baik: 0, cukup: 0, kurang: 0, avgAll: 0 };
  let sum = 0, cnt = 0;
  rows.forEach(r => {
    if(r.status === QCP_STATUS.PENDING_SUPERVISOR) s.pendingSupervisor++;
    else if(r.status === QCP_STATUS.PENDING_SUPERINTENDENT) s.pendingSuperintendent++;
    else if(r.status === QCP_STATUS.APPROVED) s.approved++;
    else if(r.status === QCP_STATUS.REJECTED) s.rejected++;
    if(r.kategori === 'Baik') s.baik++; else if(r.kategori === 'Cukup') s.cukup++; else if(r.kategori === 'Kurang') s.kurang++;
    if(typeof r.nilai_qc === 'number'){ sum += r.nilai_qc; cnt++; }
  });
  s.avgAll = cnt ? Math.round((sum/cnt) * 100) / 100 : 0;
  return s;
}
function qcpSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total QC By Proses', s.total, 'baris', 'var(--accent-gold)')}
    ${kpiCard('Menunggu Verifikasi', s.pendingSupervisor, 'tahap Supervisor', 'var(--accent-red)')}
    ${kpiCard('Menunggu Approval', s.pendingSuperintendent, 'tahap Superintendent', 'var(--accent-gold)')}
    ${kpiCard('Disetujui', s.approved, 'sudah final', 'var(--accent-green)')}
    ${kpiCard('Rata-rata Nilai QC', s.avgAll || '–', `Baik ${s.baik} · Cukup ${s.cukup} · Kurang ${s.kurang}`, 'var(--accent-blue)')}
  </div>`;
}

/* ---------------------------------------------------------------------
   5. FILTER BAR (Tanggal, Petak, Kegiatan, Staff, Supervisor, Superintendent)
   --------------------------------------------------------------------- */
function qcpFilterBarHTML(rows, rerenderFn){
  const uniq = (field) => Array.from(new Set(rows.map(r => r[field]).filter(Boolean))).sort();
  const staffOpts = Array.from(new Map(rows.filter(r=>r.staff_id).map(r => [r.staff_id, r.staff_name])).entries());
  const svOpts = Array.from(new Map(rows.filter(r=>r.supervisor_id).map(r => [r.supervisor_id, r.supervisor_name])).entries());
  const siOpts = Array.from(new Map(rows.filter(r=>r.approved_by_id).map(r => [r.approved_by_id, r.approved_by_name])).entries());
  const f = qcpState.filters;
  return `
    <div class="card qcp-filter-bar">
      <div class="qcp-f"><label>Tanggal</label><input class="input" type="date" value="${esc(f.tanggal)}" onchange="qcpState.filters.tanggal=this.value; ${rerenderFn}"></div>
      <div class="qcp-f"><label>Petak</label><input class="input" placeholder="Cari petak…" value="${esc(f.petak)}" oninput="qcpState.filters.petak=this.value; ${rerenderFn}"></div>
      <div class="qcp-f"><label>Kegiatan</label><select class="input" onchange="qcpState.filters.kegiatan=this.value; ${rerenderFn}">
        <option value="">Semua Kegiatan</option>
        ${QCP_KEGIATAN_LIST.map(k => `<option value="${esc(k)}" ${f.kegiatan===k?'selected':''}>${esc(k)}</option>`).join('')}
      </select></div>
      <div class="qcp-f"><label>Staff</label><select class="input" onchange="qcpState.filters.staffId=this.value; ${rerenderFn}">
        <option value="">Semua Staff</option>
        ${staffOpts.map(([id,name]) => `<option value="${id}" ${f.staffId===id?'selected':''}>${esc(name)}</option>`).join('')}
      </select></div>
      <div class="qcp-f"><label>Supervisor</label><select class="input" onchange="qcpState.filters.supervisorId=this.value; ${rerenderFn}">
        <option value="">Semua Supervisor</option>
        ${svOpts.map(([id,name]) => `<option value="${id}" ${f.supervisorId===id?'selected':''}>${esc(name)}</option>`).join('')}
      </select></div>
      <div class="qcp-f"><label>Superintendent</label><select class="input" onchange="qcpState.filters.superintendentId=this.value; ${rerenderFn}">
        <option value="">Semua Superintendent</option>
        ${siOpts.map(([id,name]) => `<option value="${id}" ${f.superintendentId===id?'selected':''}>${esc(name)}</option>`).join('')}
      </select></div>
      <div class="qcp-f"><button class="btn btn-outline btn-sm" onclick="qcpState.filters={tanggal:'',petak:'',kegiatan:'',staffId:'',supervisorId:'',superintendentId:''}; ${rerenderFn}">Reset Filter</button></div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   6. PARAMETER INPUT (form) & DETAIL (read-only)
   --------------------------------------------------------------------- */
function qcpParamOptionsFor(def, k){
  // Planting & Blanking: opsi custom per parameter (lihat def.options).
  // Kegiatan lain: tetap skala umum 1=Kurang, 2=Cukup, 3=Baik.
  if(def.options && def.options[k]) return def.options[k];
  return [1, 2, 3].map(v => ({ value: v, label: QCP_SCORE_LABEL[v] }));
}
function qcpScoreLabelFor(def, k, value){
  if(!value) return null;
  const opt = qcpParamOptionsFor(def, k).find(o => Number(o.value) === Number(value));
  return opt ? opt.label : QCP_SCORE_LABEL[value];
}
function qcpParamFormHTML(kegiatanKey, existingScores){
  const def = QCP_KEGIATAN[kegiatanKey];
  if(!def) return '<div class="empty-state">Pilih Kegiatan terlebih dahulu.</div>';
  return `<div class="qcp-param-grid">
    ${def.keys.map(k => `
      <div class="qcp-param-row">
        <span>${esc(def.params[k])}</span>
        <select class="input qcp-score-select" data-key="${k}">
          <option value="">–</option>
          ${qcpParamOptionsFor(def, k).map(o => `<option value="${o.value}" ${existingScores && Number(existingScores[k])===Number(o.value) ? 'selected':''}>${o.value} · ${esc(o.label)}</option>`).join('')}
        </select>
      </div>
    `).join('')}
  </div>
  <div class="qcp-avg-box" id="qcpAvgBox"></div>`;
}
function qcpParamDetailHTML(kegiatanKey, scores){
  const def = QCP_KEGIATAN[kegiatanKey];
  if(!def) return '';
  return `<div class="qcp-param-grid">
    ${def.keys.map(k => `
      <div class="qcp-param-row">
        <span>${esc(def.params[k])}</span>
        <b>${scores?.[k] ? `${scores[k]} · ${esc(qcpScoreLabelFor(def, k, scores[k]))}` : '–'}</b>
      </div>
    `).join('')}
  </div>`;
}
function qcpReadScoresFromDom(kegiatanKey){
  const def = QCP_KEGIATAN[kegiatanKey];
  const scores = {};
  (def?.keys || []).forEach(k => {
    const el = document.querySelector(`.qcp-score-select[data-key="${k}"]`);
    if(el && el.value) scores[k] = Number(el.value);
  });
  return scores;
}
function qcpRecomputeAvgBox(){
  const kegiatanKey = $('#qcpKegiatanSelect')?.value;
  const box = $('#qcpAvgBox');
  if(!kegiatanKey || !box){ if(box) box.innerHTML=''; return; }
  const scores = qcpReadScoresFromDom(kegiatanKey);
  const r = qcpComputeScore(kegiatanKey, scores);
  box.innerHTML = `<span>Average Nilai: <b>${r.average || '–'}</b></span><span>Kategori Score: <span class="qcp-kategori ${qcpKategoriClass(r.kategori)}">${esc(r.kategori)}</span></span>`;
}
function qcpOnKegiatanChange(){
  const kegiatanKey = $('#qcpKegiatanSelect')?.value;
  $('#qcpParamArea').innerHTML = kegiatanKey ? qcpParamFormHTML(kegiatanKey, null) : '';
  qcpRecomputeAvgBox();
}

/* ---------------------------------------------------------------------
   7. HALAMAN UTAMA "QC By Proses"
   --------------------------------------------------------------------- */
async function renderQcByProses(){
  $('#pageEyebrow').textContent = 'PERENCANAAN';
  $('#pageTitle').textContent = 'QC By Proses';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  if(role === 'staff') return renderQcpStaff();
  if(role === 'supervisor') return renderQcpAtasan('supervisor');
  if(role === 'superintendent') return renderQcpAtasan('superintendent');
  return renderQcpSummaryOnly(); // admin & manager
}

/* --- 7a. STAFF ---------------------------------------------------------- */
async function renderQcpStaff(){
  if(!(currentProfile.zona || '').toString().trim()){
    $('#pageContent').innerHTML = `<div class="card"><div class="card-body" style="padding:18px;">
      <p style="color:var(--text-muted);">Akun Anda belum diatur <b>Zona</b> oleh Admin. Silakan hubungi Admin
      untuk melengkapi ini di menu Kelola Pengguna sebelum bisa mengisi QC By Proses.</p>
    </div></div>`;
    return;
  }
  const allRows = await qcpFetchRows();
  qcpState.rows = allRows;
  const rows = qcpApplyFilters(allRows);
  const s = qcpSummarize(rows);

  $('#pageContent').innerHTML = `
    ${qcpSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input QC By Proses</span>
        <button class="btn btn-primary btn-sm" onclick="openQcpFormModal()">+ Tambah QC By Proses</button>
      </div>
    </div>
    ${qcpFilterBarHTML(allRows, 'renderQcpStaff()')}
    <div class="card">
      <div class="card-header"><span class="card-title">Riwayat QC By Proses Saya (${rows.length})</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Kegiatan</th><th>Petak</th><th>Spv</th><th>Average Nilai</th><th>Kategori Score</th><th>Nilai QC</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td>${esc(r.kegiatan)}</td>
                <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                <td>${esc(r.supervisor_name||'-')}</td>
                <td>${r.average_nilai ?? '-'}</td>
                <td>${qcpKategoriBadge(r)}</td>
                <td><b>${r.nilai_qc ?? '-'}</b></td>
                <td>${qcpBadge(r.status)}${r.status===QCP_STATUS.REJECTED && r.rejection_reason ? `<div style="font-size:11px; color:var(--accent-red-text); margin-top:3px;">${esc(r.rejection_reason)}</div>` : ''}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-outline btn-sm" onclick="openQcpDetailModal(${r.id})">Detail</button>
                  ${(r.status===QCP_STATUS.PENDING_SUPERVISOR || r.status===QCP_STATUS.REJECTED) ? `<button class="btn btn-outline btn-sm" onclick="openQcpFormModal(${r.id})">Edit</button><button class="btn btn-danger btn-sm" onclick="qcpDeleteRow(${r.id})">Hapus</button>` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* --- 7b. SUPERVISOR / SUPERINTENDENT ------------------------------------ */
function qcpStageFor(role){
  return role === 'supervisor'
    ? { pendingStatus: QCP_STATUS.PENDING_SUPERVISOR, actionLabel: 'Verifikasi' }
    : { pendingStatus: QCP_STATUS.PENDING_SUPERINTENDENT, actionLabel: 'Approve Final' };
}
function qcpExportRows(rows){
  return rows.map(r => ({
    'Tanggal': fmtTanggalRKH(r.tanggal), 'Zona': r.zona || '-', 'Staff': r.staff_name || '-',
    'Kegiatan': r.kegiatan, 'Petak': r.petak, 'Average Nilai': r.average_nilai ?? '-',
    'Kategori Score': r.kategori || '-', 'Nilai QC': r.nilai_qc ?? '-', 'Status': r.status,
  }));
}
function qcpExportJPEG(rows){
  openExportDateRangeModal({ rows, dateField: 'tanggal', mapRow: r => qcpExportRows([r])[0], title: 'QC By Proses', filePrefix: 'qc_by_proses' });
}
async function renderQcpAtasan(role){
  const stage = qcpStageFor(role);
  const allRows = await qcpFetchRows();
  qcpState.rows = allRows;
  const s = qcpSummarize(allRows);
  const perluAksi = allRows.filter(r => r.status === stage.pendingStatus);
  const filteredTim = qcpApplyFilters(allRows);
  qcpState.exportRows = filteredTim;

  $('#pageContent').innerHTML = `
    ${qcpSummaryCards(s)}
    <div class="rkh-tabs" style="margin-top:16px;">
      <button class="btn btn-sm ${qcpState.tab==='aksi'?'btn-primary':'btn-outline'}" onclick="qcpState.tab='aksi'; renderQcpAtasan('${role}');">Perlu ${esc(stage.actionLabel)} (${perluAksi.length})</button>
      <button class="btn btn-sm ${qcpState.tab==='tim'?'btn-primary':'btn-outline'}" onclick="qcpState.tab='tim'; renderQcpAtasan('${role}');">Semua QC By Proses Zona Saya</button>
    </div>
    ${qcpState.tab==='aksi' ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Menunggu ${esc(stage.actionLabel)} Anda</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Kegiatan</th><th>Petak</th><th>Average Nilai</th><th>Kategori</th><th>Nilai QC</th><th>Aksi</th></tr></thead>
            <tbody>
              ${perluAksi.length ? perluAksi.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.kegiatan)}</td>
                  <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                  <td>${r.average_nilai ?? '-'}</td>
                  <td>${qcpKategoriBadge(r)}</td>
                  <td><b>${r.nilai_qc ?? '-'}</b></td>
                  <td><button class="btn btn-primary btn-sm" onclick="openQcpDetailModal(${r.id})">Lihat & Tindak Lanjut</button></td>
                </tr>
              `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada yang perlu ditindaklanjuti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      ${qcpFilterBarHTML(allRows, `renderQcpAtasan('${role}')`)}
      <div class="card">
        <div class="card-header"><span class="card-title">Semua QC By Proses Zona Saya (${filteredTim.length})</span><button class="btn btn-outline btn-sm" onclick="qcpExportJPEG(qcpState.exportRows)">Export JPEG</button></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Kegiatan</th><th>Petak</th><th>Average Nilai</th><th>Kategori</th><th>Nilai QC</th><th>Status</th><th>Aksi</th></tr></thead>
            <tbody>
              ${filteredTim.length ? filteredTim.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td>${esc(r.kegiatan)}</td>
                  <td><span class="petak-tag">${esc(r.petak||'-')}</span></td>
                  <td>${r.average_nilai ?? '-'}</td>
                  <td>${qcpKategoriBadge(r)}</td>
                  <td><b>${r.nilai_qc ?? '-'}</b></td>
                  <td>${qcpBadge(r.status)}</td>
                  <td><button class="btn btn-outline btn-sm" onclick="openQcpDetailModal(${r.id})">Detail</button></td>
                </tr>
              `).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada data sesuai filter.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `}
  `;
}

/* --- 7c. ADMIN / MANAGER (ringkasan SEMUA zona) ------------------------- */
async function renderQcpSummaryOnly(){
  const allRows = await qcpFetchRows();
  qcpState.rows = allRows;
  const rows = qcpApplyFilters(allRows);
  qcpState.exportRows = rows;
  const s = qcpSummarize(rows);
  const perZona = {};
  rows.forEach(r => { perZona[r.zona || '–'] = true; });
  Object.keys(perZona).forEach(z => { perZona[z] = qcpSummarize(rows.filter(r => (r.zona||'–') === z)); });
  const perKegiatan = {};
  QCP_KEGIATAN_LIST.forEach(k => { perKegiatan[k] = qcpSummarize(rows.filter(r => r.kegiatan === k)); });

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;"><div class="card-header"><span class="card-title">Ringkasan QC By Proses — Semua Zona</span><button class="btn btn-outline btn-sm" onclick="qcpExportJPEG(qcpState.exportRows)">Export JPEG</button></div></div>
    ${qcpFilterBarHTML(allRows, 'renderQcpSummaryOnly()')}
    ${qcpSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th style="text-align:right;">Total</th><th style="text-align:right;">Menunggu Verifikasi</th><th style="text-align:right;">Menunggu Approval</th><th style="text-align:right;">Disetujui</th><th style="text-align:right;">Ditolak</th><th style="text-align:right;">Rata-rata Nilai QC</th><th style="text-align:right;">Baik / Cukup / Kurang</th></tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => `
              <tr>
                <td><b>${esc(z)}</b></td>
                <td style="text-align:right;">${perZona[z].total}</td>
                <td style="text-align:right;">${perZona[z].pendingSupervisor}</td>
                <td style="text-align:right;">${perZona[z].pendingSuperintendent}</td>
                <td style="text-align:right;">${perZona[z].approved}</td>
                <td style="text-align:right;">${perZona[z].rejected}</td>
                <td style="text-align:right;"><b>${perZona[z].avgAll || '-'}</b></td>
                <td style="text-align:right;"><b style="color:#6FCB74;">${perZona[z].baik}</b> / <b style="color:#E3C33C;">${perZona[z].cukup}</b> / <b style="color:#F0A392;">${perZona[z].kurang}</b></td>
              </tr>
            `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Kegiatan (Proses)</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Kegiatan</th><th style="text-align:center;">Total</th><th style="text-align:center;">Rata-rata Nilai QC</th><th>Baik / Cukup / Kurang</th></tr></thead>
          <tbody>
            ${QCP_KEGIATAN_LIST.map(k => `
              <tr>
                <td>${esc(k)}</td>
                <td style="text-align:center;">${perKegiatan[k].total}</td>
                <td style="text-align:center;"><b>${perKegiatan[k].avgAll || '-'}</b></td>
                <td><b style="color:#6FCB74;">${perKegiatan[k].baik}</b> / <b style="color:#E3C33C;">${perKegiatan[k].cukup}</b> / <b style="color:#F0A392;">${perKegiatan[k].kurang}</b></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   8. FORM TAMBAH / EDIT (Staff)
   --------------------------------------------------------------------- */
async function openQcpFormModal(id){
  const existing = id ? qcpState.rows.find(r => r.id === id) : null;
  const supervisors = await qcpSupervisorsInZona(currentProfile.zona);
  const qcpDefaultSvId = defaultSupervisorIdFor(supervisors);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header">
        <div class="card-title">${existing ? 'Edit' : 'Tambah'} QC By Proses</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="qcpForm" class="form-grid">
          <div>
            <label class="field-label">Kegiatan</label>
            <select class="input" name="kegiatan" id="qcpKegiatanSelect" required onchange="qcpOnKegiatanChange()">
              <option value="">— Pilih Kegiatan —</option>
              ${QCP_KEGIATAN_LIST.map(k => `<option value="${esc(k)}" ${existing && existing.kegiatan===k ? 'selected':''}>${esc(k)}</option>`).join('')}
            </select>
          </div>
          <div><label class="field-label">Tanggal</label><input class="input" type="date" name="tanggal" value="${esc(existing ? existing.tanggal : todayISO())}" required></div>
          <div><label class="field-label">Petak</label><input class="input" name="petak" value="${esc(existing?.petak||'')}" required oninput="checkPetakFormatInput(this,'qcpPetakWarn')">${petakFormatWarnHTML('qcpPetakWarn')}</div>
          <div>
            <label class="field-label">Spv</label>
            <select class="input" name="supervisor_id" required>
              <option value="">— Pilih Supervisor (Zona ${esc(currentProfile.zona||'-')}) —</option>
              ${supervisors.map(sv => `<option value="${sv.id}" ${(existing ? existing.supervisor_id===sv.id : sv.id===qcpDefaultSvId) ? 'selected':''}>${esc(sv.full_name)}</option>`).join('')}
            </select>
            ${!supervisors.length ? `<div style="font-size:11.5px; color:var(--accent-red-text); margin-top:4px;">Belum ada akun Supervisor di zona ini. Hubungi Admin.</div>` : ''}
          </div>
        </form>

        <div style="margin-top:14px;">
          <label class="field-label">Parameter</label>
          <div id="qcpParamArea">${existing ? qcpParamFormHTML(existing.kegiatan, existing.scores) : ''}</div>
        </div>

        <div id="qcpFormError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="qcpSaveBtn" onclick="submitQcpForm(${existing ? existing.id : 'null'})">${existing ? 'Simpan Perubahan' : 'Tambahkan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  qcpRecomputeAvgBox();
  document.body.addEventListener('change', qcpRecomputeAvgBox);
}

async function submitQcpForm(id){
  const form = $('#qcpForm');
  if(!form.reportValidity()) return;
  if(!isValidPetakFormat(form.elements.petak.value)){ toast('Format kode petak harus diawali "PNS" atau "KDS" + 6 digit angka, mis. PNS051902', true); return; }
  const kegiatanKey = form.elements.kegiatan.value;
  if(!kegiatanKey || !QCP_KEGIATAN[kegiatanKey]){ toast('Kegiatan tidak valid', true); return; }

  const scores = qcpReadScoresFromDom(kegiatanKey);
  const def = QCP_KEGIATAN[kegiatanKey];
  const filled = def.keys.filter(k => scores[k]);
  if(filled.length !== def.keys.length){ toast('Semua parameter wajib diberi nilai', true); return; }

  const petakVal = form.elements.petak.value.trim();
  let dupQ = supa.from(QCP_TABLE).select('id').eq('kegiatan', kegiatanKey).ilike('petak', petakVal).neq('status', QCP_STATUS.REJECTED);
  if(id) dupQ = dupQ.neq('id', id);
  const { data: dupRows, error: dupErr } = await dupQ.limit(1);
  if(dupErr){ toast('Gagal cek duplikat: ' + dupErr.message, true); return; }
  if(dupRows && dupRows.length){ toast(`Petak "${petakVal}" sudah pernah di-QC untuk kegiatan "${kegiatanKey}". Tidak bisa input duplikat.`, true); return; }

  const btn = $('#qcpSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  $('#qcpFormError').classList.add('hidden');

  const supervisorId = form.elements.supervisor_id.value;
  const supervisors = await qcpSupervisorsInZona(currentProfile.zona);
  const supervisorProfile = supervisors.find(sv => sv.id === supervisorId);
  const scoreResult = qcpComputeScore(kegiatanKey, scores);

  const payload = {
    tanggal: form.elements.tanggal.value,
    zona: currentProfile.zona || null,
    kegiatan: kegiatanKey,
    petak: form.elements.petak.value.trim(),
    supervisor_id: supervisorId || null,
    supervisor_name: supervisorProfile ? supervisorProfile.full_name : null,
    scores,
    average_nilai: scoreResult.average,
    kategori: scoreResult.kategori,
    nilai_qc: scoreResult.average,
    staff_id: currentUser.id,
    staff_name: currentProfile.full_name,
    status: QCP_STATUS.PENDING_SUPERVISOR,
    rejection_reason: null,
    rejected_by_stage: null,
    verified_by_id: null, verified_by_name: null, verified_at: null,
    approved_by_id: null, approved_by_name: null, approved_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supa.from(QCP_TABLE).update(payload).eq('id', id)
    : await supa.from(QCP_TABLE).insert(payload);

  btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
  if(error){
    $('#qcpFormError').textContent = 'Gagal menyimpan: ' + error.message;
    $('#qcpFormError').classList.remove('hidden');
    return;
  }
  toast(id ? 'QC By Proses diperbarui, menunggu verifikasi ulang' : 'QC By Proses ditambahkan');
  closeModal();
  renderQcpStaff();
}

async function qcpDeleteRow(id){
  if(!confirm('Hapus data QC By Proses ini? Tindakan tidak bisa dibatalkan.')) return;
  const { error } = await supa.from(QCP_TABLE).delete().eq('id', id).eq('staff_id', currentUser.id);
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('QC By Proses dihapus');
  renderQcpStaff();
}

/* ---------------------------------------------------------------------
   9. DETAIL / VERIFIKASI / APPROVE / TOLAK
   --------------------------------------------------------------------- */
function qcpCanAct(row, role){
  if(role === 'supervisor') return row.status === QCP_STATUS.PENDING_SUPERVISOR;
  if(role === 'superintendent') return row.status === QCP_STATUS.PENDING_SUPERINTENDENT;
  return false;
}
function openQcpDetailModal(id){
  const row = qcpState.rows.find(r => r.id === id);
  if(!row){ toast('Data tidak ditemukan', true); return; }
  const role = currentProfile?.role;
  const canAct = qcpCanAct(row, role);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header">
        <div class="card-title">Detail QC By Proses</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px; color:var(--text-muted); display:flex; gap:16px; flex-wrap:wrap; margin-bottom:10px;">
          <span>Kegiatan: <b>${esc(row.kegiatan)}</b></span>
          <span>Tanggal: <b>${esc(fmtTanggalRKH(row.tanggal))}</b></span>
          <span>Zona: <b>${esc(row.zona||'-')}</b></span>
          <span>Status: ${qcpBadge(row.status)}</span>
        </div>
        <div style="font-size:12.5px; color:var(--text-muted); display:flex; gap:16px; flex-wrap:wrap; margin-bottom:14px;">
          <span>Staff: <b>${esc(row.staff_name)}</b></span>
          <span>Spv: <b>${esc(row.supervisor_name||'-')}</b></span>
          <span>Petak: <b>${esc(row.petak||'-')}</b></span>
          <span>Superintendent: <b>${esc(row.approved_by_name||'-')}</b></span>
        </div>

        <label class="field-label">Parameter</label>
        ${qcpParamDetailHTML(row.kegiatan, row.scores)}

        <div class="qcp-avg-box">
          <span>Average Nilai: <b>${row.average_nilai ?? '-'}</b></span>
          <span>Kategori Score: ${qcpKategoriBadge(row)}</span>
          <span>Nilai QC: <b>${row.nilai_qc ?? '-'}</b></span>
        </div>

        ${row.status===QCP_STATUS.REJECTED && row.rejection_reason ? `<div style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;">Alasan ditolak (${esc(row.rejected_by_stage||'-')}): ${esc(row.rejection_reason)}</div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${canAct ? `
          <button class="btn btn-danger" onclick="openQcpRejectModal(${row.id}, '${role}')">Tolak</button>
          <button class="btn btn-primary" onclick="${role==='supervisor' ? `qcpVerify(${row.id})` : `qcpApprove(${row.id})`}">${role==='supervisor' ? 'Verifikasi' : 'Approve Final'}</button>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function qcpVerify(id){
  const { error } = await supa.from(QCP_TABLE).update({
    status: QCP_STATUS.PENDING_SUPERINTENDENT,
    verified_by_id: currentUser.id,
    verified_by_name: currentProfile.full_name,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal verifikasi: ' + error.message, true); return; }
  toast('QC By Proses diverifikasi, diteruskan ke Superintendent');
  closeModal();
  renderQcpAtasan('supervisor');
}
async function qcpApprove(id){
  const { error } = await supa.from(QCP_TABLE).update({
    status: QCP_STATUS.APPROVED,
    approved_by_id: currentUser.id,
    approved_by_name: currentProfile.full_name,
    approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal approve: ' + error.message, true); return; }
  toast('QC By Proses disetujui (final)');
  closeModal();
  renderQcpAtasan('superintendent');
}
function openQcpRejectModal(id, role){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'qcpRejectOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><div class="card-title">Tolak QC By Proses</div></div>
      <div class="modal-body">
        <label class="field-label">Alasan Penolakan</label>
        <textarea class="input" id="qcpRejectReason" rows="3" placeholder="Jelaskan alasan penolakan agar staff bisa merevisi…" required></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('qcpRejectOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="submitQcpReject(${id}, '${role}')">Tolak</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function submitQcpReject(id, role){
  const reason = $('#qcpRejectReason').value.trim();
  if(!reason){ toast('Alasan penolakan wajib diisi', true); return; }
  const { error } = await supa.from(QCP_TABLE).update({
    status: QCP_STATUS.REJECTED,
    rejection_reason: reason,
    rejected_by_stage: role,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  $('#qcpRejectOverlay')?.remove();
  if(error){ toast('Gagal menolak: ' + error.message, true); return; }
  toast('QC By Proses ditolak, staff akan merevisi');
  closeModal();
  renderQcpAtasan(role);
}

/* ---------------------------------------------------------------------
   10. NAVIGASI: tambah view 'qc_by_proses'
   --------------------------------------------------------------------- */
const _qcpPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'qc_by_proses'){
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
    await renderQcByProses();
    return;
  }
  return _qcpPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   11. SEMBUNYIKAN MENU UNTUK VIEWER
   --------------------------------------------------------------------- */
const _qcpPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _qcpPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="qc_by_proses"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};
