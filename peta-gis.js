/* =====================================================================
   PETA — GIS INTERAKTIF GABUNGAN (Pasca Harvest, RPC After Giling, Extra
   Planting, Blanking, Ratoon, Maintenance, Justifikasi TCH Under 70,
   Kondisi Petak/Bulanan)
   Additif, load PALING TERAKHIR. Tidak ubah app.js/estate2-addons.js/dll.

   - Boundary petak diambil dari petak-boundaries.geojson (hasil convert
     folder "Design_Petak_Google_14_Juni_2026" di file KML GIS Central,
     1482 petak). File statis, di-load sekali lalu di-cache di memori.
   - Warna polygon per petak mengikuti status modul yang lagi dipilih
     (pakai colorForLabel() yang sudah ada di app.js, jadi konsisten sama
     badge di tabel: hijau=Baik/Done, kuning=Cukup/Progress, merah=
     Kurang/NotYet, abu2=belum ada data).
   - Klik polygon -> popup info ringkas + tombol "Buka Detail" yang
     lompat ke menu asli & auto-cari petak itu.
   - Petak yang tidak masuk zona/scope akun (superintendent/supervisor/
     staff) TIDAK ditampilkan sama sekali (dicocokkan lewat data master
     Pasca Harvest yang sudah dibatasi zona oleh ensureData()).
   ===================================================================== */

const PETA_GEOJSON_URL = './petak-boundaries.geojson';
(function injectPetaLabelCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .peta-petak-label {
      background: transparent; border: none; box-shadow: none; padding: 0;
      font-size: 9px; font-weight: 700; color: #1c1f24; text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff;
      white-space: nowrap;
    }
    .peta-petak-label::before { display: none; }
    #petaMapContainer, #petaMapContainer *{
      transition: none !important; animation: none !important;
    }
  `;
  document.head.appendChild(style);
})();
let petaGeoJsonCache = null;
let petaMapInstance = null;
let petaLayerGroup = null;
const petaState = { module: 'pasca_harvest', loading: false, activeStatuses: new Set(), activeStatusesFor: null, bulanFilter: '', extraFilterValues: {}, bappFrom: '', bappTo: '' };
let petaLastRender = null; // cache {module, geojson, dataMap, visibleSet} biar toggle filter gak fetch ulang

async function loadPetaGeoJson() {
  if (petaGeoJsonCache) return petaGeoJsonCache;
  const res = await fetch(PETA_GEOJSON_URL);
  if (!res.ok) throw new Error('Gagal memuat boundary peta (' + res.status + ')');
  petaGeoJsonCache = await res.json();
  return petaGeoJsonCache;
}

// Definisi 8 modul yang digabung ke satu Peta. `stateKey` dipakai supaya
// tombol "Buka Detail" bisa set kotak pencarian modul asal sebelum pindah halaman.
const PETA_MODULES = [
  // Hanya petak yang SUDAH TEBANG (status_progress = Done) yang tampil di peta ini,
  // baik yang sudah disurvey (Baik/Cukup/Kurang) maupun yang belum (Not Yet).
  { key: 'pasca_harvest', label: 'Pasca Harvest', view: 'pasca_harvest', stateKey: 'pasca_harvest',
    statusField: 'kategori_pasca_harvest', statusLabel: 'Kategori Pasca Harvest',
    fetch: () => ensureData('pasca_harvest'),
    areaField: 'size_rkt',
    bappFilter: true,
    petaRowFilter: row => !!row && petaNormStatus(row.status_progress) === 'done',
    legend: [
      ['baik', '#5FAE7D', 'Baik'],
      ['cukup', '#D9A94A', 'Cukup'],
      ['kurang', '#C1543C', 'Kurang'],
      ['kosong', '#9aa1ab', 'Belum Disurvey'],
    ] },
  // Done Planting / Progress Planting / Not Yet Planting saja (petak tanpa data disembunyikan).
  { key: 'rpc_after_giling', label: 'RPC After Giling', view: 'rpc_after_giling', stateKey: 'rpc_after_giling',
    statusField: 'status_planting', statusLabel: 'Status Planting',
    fetch: () => ensureData('rpc_after_giling'),
    areaField: 'luas_rpc',
    petaRowFilter: row => !!row && !!petaNormStatus(row.status_planting),
    legend: [
      ['baik', '#5FAE7D', 'Done Planting'],
      ['cukup', '#D9A94A', 'Progress Planting'],
      ['kurang', '#C1543C', 'Not Yet Planting'],
    ] },
  { key: 'extra_planting_after_giling', label: 'Extra Planting', view: 'extra_planting_after_giling', stateKey: 'extra_planting_after_giling',
    statusField: 'status_planting', statusLabel: 'Status Planting',
    fetch: () => ensureData('extra_planting_after_giling'),
    areaField: 'luas_rpc',
    petaRowFilter: row => !!row && !!petaNormStatus(row.status_planting),
    legend: [
      ['baik', '#5FAE7D', 'Done Planting'],
      ['cukup', '#D9A94A', 'Progress Planting'],
      ['kurang', '#C1543C', 'Not Yet Planting'],
    ] },
  // Done Planting, Progress Planting, dan Not Yet Planting (tanpa data tetap disembunyikan).
  { key: 'blanking', label: 'Blanking', view: 'blanking', stateKey: 'blanking',
    statusField: 'status_planting', statusLabel: 'Status Planting',
    fetch: () => ensureData('blanking'),
    areaField: 'luas_blanking',
    petaRowFilter: row => !!row && !!petaNormStatus(row.status_planting),
    legend: [
      ['baik', '#5FAE7D', 'Done Planting'],
      ['cukup', '#D9A94A', 'Progress Planting'],
      ['kurang', '#C1543C', 'Not Yet Planting'],
    ] },
  // Done Harvest / Progress Harvest / Not Yet Harvest saja.
  { key: 'ratoon', label: 'Ratoon', view: 'ratoon', stateKey: 'ratoon',
    statusField: 'status_progress', statusLabel: 'Status Progress',
    fetch: () => ensureData('ratoon'),
    areaField: 'size_rkt',
    petaRowFilter: row => !!row && !!petaNormStatus(row.status_progress),
    legend: [
      ['baik', '#5FAE7D', 'Done Harvest'],
      ['cukup', '#D9A94A', 'Progress Harvest'],
      ['kurang', '#C1543C', 'Not Yet Harvest'],
    ] },
  // Peta Maintenance: warna/legend pakai Status Harvest. 6 filter tambahan
  // (dropdown) buat nyaring petak sesuai Next Action & status per grup aktivitas.
  { key: 'maintenance', label: 'Maintenance', view: 'maintenance', stateKey: 'maintenance_pasca_harvest',
    statusField: 'mt_status_harvest', statusLabel: 'Status Harvest',
    fetch: () => (typeof ensureMaintenanceData === 'function' ? ensureMaintenanceData() : []),
    areaField: 'size_rkt',
    petaRowFilter: row => !!row,
    legend: [
      ['baik', '#5FAE7D', 'Done Harvest'],
      ['cukup', '#D9A94A', 'Progress Harvest'],
      ['kurang', '#C1543C', 'Not Yet Harvest'],
    ],
    bappFilter: true,
    // key dipakai id dropdown, label buat UI, values null = ambil otomatis dari data
    // (Next Action), values array = fix ambil dari status grup (Not yet/Progress/Done).
    extraFilters: [
      { key: 'mt_next_action', label: 'Next Action', values: (typeof MT_NEXT_ACTION_OPTIONS !== 'undefined' ? MT_NEXT_ACTION_OPTIONS : ['Ratoon', 'Replanting Cane']) },
      // Mekanisasi
      { key: 'mt_stuble_shaving', label: 'Stuble Shaving', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_furrowing', label: 'Furrowing', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_mechanical_stuble_shaving', label: 'Mechanical Stuble Shaving', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_terra_tyne', label: 'Terra Tyne', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_mounding', label: 'Mounding', values: ['Not yet', 'Progress', 'Done'] },
      // Drain
      { key: 'mt_cross_drain', label: 'Cross Drain', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_field_drain', label: 'Field Drain', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_mid_drain', label: 'Mid Drain', values: ['Not yet', 'Progress', 'Done'] },
      // Hama
      { key: 'mt_pengendalian_hama_tikus', label: 'Pengendalian Hama Tikus', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_pengendalian_hama_penyakit_tanaman', label: 'Pengendalian Hama Penyakit Tanaman', values: ['Not yet', 'Progress', 'Done'] },
      // Perawatan Mandatory
      { key: 'mt_fertilizing_single_aplication', label: 'Fertilizing Single Aplication', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_post_spraying_1', label: 'Post Spraying 1', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_post_spraying_2', label: 'Post Spraying 2', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_post_spraying_3', label: 'Post Spraying 3', values: ['Not yet', 'Progress', 'Done'] },
      { key: 'mt_weeding_rayutan', label: 'Weeding Rayutan', values: ['Not yet', 'Progress', 'Done'] },
    ] },
  // Ganti Maintenance -> PC & RPC Eks Non RKT (tampilkan semua petak yang ada datanya).
  { key: 'pc_rpc_eks_non_rkt', label: 'PC & RPC Eks Non RKT', view: 'pc_rpc_eks_non_rkt', stateKey: 'pc_rpc_eks_non_rkt',
    statusField: 'pr_status_planting', statusLabel: 'Status Planting',
    fetch: () => (typeof ensurePcRpcData === 'function' ? ensurePcRpcData() : []),
    areaField: 'pr_size_rkt_2024',
    petaRowFilter: row => !!row,
    legend: [
      ['baik', '#5FAE7D', 'Done Planting'],
      ['cukup', '#D9A94A', 'Progress Planting'],
      ['kurang', '#C1543C', 'Not Yet Planting'],
    ] },
  // Peta Tebang Bibit: warna/legend pakai Status Tebang Bibit. Semua petak yang
  // sudah ada datanya ditampilkan (zona dibatasi via ensureTebangBibitData()).
  { key: 'tebang_bibit', label: 'Tebang Bibit', view: 'tebang_bibit', stateKey: 'tebang_bibit',
    statusField: 'tb_status_tebang_bibit', statusLabel: 'Status Tebang Bibit',
    fetch: () => (typeof ensureTebangBibitData === 'function' ? ensureTebangBibitData() : []),
    areaField: 'tb_size_rkt',
    petaRowFilter: row => !!row,
    legend: [
      ['baik', '#5FAE7D', 'Done'],
      ['cukup', '#D9A94A', 'Progress'],
      ['kurang', '#C1543C', 'Not Yet'],
    ] },
  // Data justifikasi sudah otomatis cuma berisi petak TCH Under 70, jadi tinggal sembunyikan
  // petak yang tidak ada di daftar itu (tanpa data = bukan TCH Under 70).
  { key: 'justifikasi_tch_under70', label: 'Justifikasi TCH Under 70', view: 'justifikasi_tch_under70', stateKey: 'justifikasi_tch_under70',
    statusField: null, statusLabel: 'Status Justifikasi', isJustifikasi: true,
    areaField: 'size_rkt',
    fetch: async () => {
      const [pascaRows, ketRows] = await Promise.all([ensureData('pasca_harvest'), ensureJustifikasiKeteranganData()]);
      return buildJustifikasiTCHRows(pascaRows, ketRows);
    },
    petaRowFilter: row => !!row,
    legend: [
      ['cukup', '#D9A94A', 'Sudah Dijustifikasi'],
      ['kurang', '#C1543C', 'Perlu Justifikasi'],
    ] },
  // Cuma petak yang sudah Harvest & sudah dinilai bulan ini (status_bulan Baik/Cukup/Kurang).
  { key: 'kondisi_bulanan', label: 'Kondisi Petak (Bulanan)', view: 'kondisi_bulanan', stateKey: 'kondisi_bulanan',
    statusField: 'status_bulan', statusLabel: 'Status Bulan',
    areaField: null,
    fetch: () => ensureData('kondisi_bulanan'),
    petaRowFilter: row => !!row && !!petaNormStatus(row.status_bulan),
    legend: [
      ['baik', '#5FAE7D', 'Baik'],
      ['cukup', '#D9A94A', 'Cukup'],
      ['kurang', '#C1543C', 'Kurang'],
    ] },
  // Data Posisi Unit: bukan status baik/cukup/kurang, tapi 4 jenis unit alat
  // berat. Warna & key legend custom lewat statusKeyFn/colorFn (lihat
  // petaColorFor/petaDrawMap), bukan lewat colorForLabel() umum.
  { key: 'posisi_unit', label: 'Data Posisi Unit', view: 'posisi_unit', stateKey: 'posisi_unit',
    statusField: 'jenis_unit', statusLabel: 'Jenis Unit',
    areaField: null,
    fetch: () => (typeof ensurePosisiUnitData === 'function' ? ensurePosisiUnitData() : []),
    petaRowFilter: row => !!row,
    colorFn: row => ({ 'SK-75':'#5FAE7D', 'WT':'#4C9AE0', 'Dozer':'#D9A94A', 'SK-130':'#C1543C' }[row?.jenis_unit] || '#9aa1ab'),
    statusKeyFn: row => ({ 'SK-75':'sk75', 'WT':'wt', 'Dozer':'dozer', 'SK-130':'sk130' }[row?.jenis_unit] || 'lainnya'),
    legend: [
      ['sk75', '#5FAE7D', 'SK-75'],
      ['wt', '#4C9AE0', 'WT'],
      ['dozer', '#D9A94A', 'Dozer'],
      ['sk130', '#C1543C', 'SK-130'],
    ] },
];

// Status gabungan 1 grup aktivitas Maintenance (Mekanisasi/Drain/Hama/Mandatory):
// semua Done -> Done, semua kosong/Not yet -> Not yet, sisanya -> Progress.
function petaGroupStatus(row, fields) {
  if (!row) return '';
  const vals = fields.map(f => petaNormStatus(row[f]));
  const doneCount = vals.filter(v => v === 'done').length;
  const emptyCount = vals.filter(v => v === '' || v === 'not yet').length;
  if (doneCount === fields.length) return 'Done';
  if (emptyCount === fields.length) return 'Not yet';
  return 'Progress';
}

function petaNormStatus(v) { return (v || '').toString().trim().toLowerCase(); }

/* ---------------------------------------------------------------------
   TREND TCH PER ZONA PER BULAN — additif, disuntik ke Dashboard Gabungan
   (tidak ubah app.js). Sumber: pasca_harvest (tch_nett_bapp_2026,
   bulan_tebang, zona). TCH kosong/0/TBD dikecualikan (belum ada hasil).
   Nilai per sel = rata-rata TCH petak yang tebang di bulan itu per zona.
   --------------------------------------------------------------------- */
function petaBuildTchTrendByZona(pascaRows) {
  const sums = {}; // zona -> { JAN: {total,count}, ... }
  const monthsUsed = new Set();
  (pascaRows || []).forEach(r => {
    const monthCode = normalizeMonthToken(r.bulan_tebang);
    const zona = (r.zona || '').toString().trim();
    const tch = parseTchNumber(r.tch_nett_bapp_2026);
    if (!monthCode || !zona || isNaN(tch) || tch <= 0) return;
    monthsUsed.add(monthCode);
    if (!sums[zona]) sums[zona] = {};
    if (!sums[zona][monthCode]) sums[zona][monthCode] = { total: 0, count: 0 };
    sums[zona][monthCode].total += tch;
    sums[zona][monthCode].count++;
  });
  const categories = MONTHS.filter(m => monthsUsed.has(m));
  const seriesMap = {};
  Object.keys(sums).sort().forEach(zona => {
    seriesMap[zona] = categories.map(m => {
      const cell = sums[zona][m];
      return cell ? +(cell.total / cell.count).toFixed(2) : null; // null = spanGaps, garis nyambung lewatin bulan kosong
    });
  });
  return { categories, seriesMap };
}

const _prevRenderDashboardPeta = renderDashboard;
renderDashboard = async function () {
  await _prevRenderDashboardPeta();
  try {
    const pascaRows = await ensureData('pasca_harvest');
    const { categories, seriesMap } = petaBuildTchTrendByZona(pascaRows);
    const holder = document.getElementById('pageContent');
    if (!holder || !categories.length) return;
    holder.insertAdjacentHTML('beforeend', `
      <div class="chart-grid">
        <div class="card" style="grid-column:1 / -1;">
          <div class="card-header">
            <span class="card-title">Trend TCH per Zona per Bulan</span>
            <span style="font-size:11px; color:var(--text-faint);">rata-rata TCH Nett BAPP, dari bulan tebang</span>
          </div>
          <div class="card-body"><div class="chart-box"><canvas id="chart_dash_tch_trend"></canvas></div></div>
        </div>
      </div>`);
    drawLineMulti('chart_dash_tch_trend', categories, seriesMap, CHART_PALETTE, true);
  } catch (err) {
    console.error('Gagal muat trend TCH:', err);
  }
};

function petaModuleByKey(key) { return PETA_MODULES.find(m => m.key === key) || PETA_MODULES[0]; }

function petaNormPetak(v) { return (v || '').toString().trim().toUpperCase(); }

// Cache petak -> { bapp, staff } dari modul Pasca Harvest, dipakai khusus di
// Peta Maintenance supaya "Bulan Tebang"/"Selesai Harvest" ikut tanggal BAPP
// (kolom `date`, lihat FIELD_META.bapp di app.js) dan "Staff" ikut data master
// Pasca Harvest — alih-alih kolom staff/mt_actual_month_harvest milik tabel
// Maintenance sendiri yang sering kosong/gak sinkron. Di-cache di memori
// (ensureData sendiri sudah punya cache-nya masing-masing).
let petaPascaRefMap = null;
async function ensurePetaPascaRefMap() {
  const rows = await ensureData('pasca_harvest');
  const map = new Map();
  rows.forEach(r => {
    if (!r) return;
    map.set(petaNormPetak(r.petak), { bapp: r.bapp || null, staff: r.staff || null });
  });
  petaPascaRefMap = map;
  return map;
}
function petaBulanTebangFromBapp(iso) {
  const m = String(iso ?? '').match(/^\d{4}-(\d{2})-/);
  if (!m) return null;
  const name = MONTHS[parseInt(m[1], 10) - 1];
  return name ? name.charAt(0) + name.slice(1).toLowerCase() : null;
}

// Ambil 1 baris representatif per petak. Modul yang punya banyak baris per
// petak (Kondisi Bulanan = 1 baris/bulan) diquery lewat ensureData() yang
// urutannya id DESC, jadi baris PERTAMA yang ketemu = baris terbaru.
function petaBuildDataMap(rows) {
  const map = new Map();
  (rows || []).forEach(r => {
    const k = petaNormPetak(r.petak);
    if (k && !map.has(k)) map.set(k, r);
  });
  return map;
}

function petaColorFor(module, row) {
  if (!row) return '#9aa1ab';
  if (module.colorFn) return module.colorFn(row);
  if (module.isJustifikasi) {
    return (row.keterangan && row.keterangan.toString().trim()) ? colorForLabel('cukup') : colorForLabel('kurang');
  }
  const val = row[module.statusField];
  if (!val) return '#9aa1ab';
  // Modul Pasca Harvest pakai kategori_pasca_harvest, di mana 'Not Yet' artinya
  // "belum disurvey" (3 kategori kondisi lapangan belum lengkap terisi) — beda
  // makna dari 'Not Yet'/'Belum' di modul lain (progress belum selesai).
  // colorForLabel() umum menyamakan 'not yet' dengan 'kurang'/'belum' (sama-sama
  // merah), jadi petak yang BELUM disurvey ikut kehitung/kewarnain sebagai Kurang.
  // Override khusus modul ini supaya 'Not Yet' tetap abu-abu (Belum Disurvey).
  if (module.key === 'pasca_harvest' && val.toString().trim().toLowerCase() === 'not yet') return '#9aa1ab';
  return colorForLabel(val);
}

// Petakan warna hasil petaColorFor() ke key filter (dipakai buat cocokin sama legend)
function petaStatusKeyFor(color) {
  if (color === '#5FAE7D') return 'baik';
  if (color === '#D9A94A') return 'cukup';
  if (color === '#C1543C') return 'kurang';
  if (color === '#9aa1ab') return 'kosong';
  return 'kosong';
}

function petaStatusValueFor(module, row) {
  if (!row) return 'Belum ada data';
  if (module.isJustifikasi) return (row.keterangan && row.keterangan.trim()) ? 'Sudah dijustifikasi' : 'Perlu justifikasi';
  return row[module.statusField] || '–';
}

// Set petak yang boleh dilihat akun ini (null = semua boleh, dipakai admin/
// manager/viewer yang tidak dibatasi zona). Dibangun dari data master Pasca
// Harvest yang SUDAH dibatasi zona oleh ensureData() sendiri.
async function petaVisiblePetakSet() {
  const zonaRestrict = getUserZonaRestriction();
  if (!zonaRestrict) return null;
  const masterRows = await ensureData('pasca_harvest');
  return new Set(masterRows.map(r => petaNormPetak(r.petak)));
}

function petaLegendHTML(module) {
  const items = module.legend;
  return `<div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center; font-size:12px; color:var(--text-muted);">
    ${items.map(([key, c, l]) => {
      const active = petaState.activeStatuses.has(key);
      return `<button type="button" onclick="petaToggleStatusFilter('${key}')" title="Klik buat tampil/sembunyi"
        style="display:inline-flex; align-items:center; gap:6px; border:1px solid ${active ? 'transparent' : '#d5d8dd'};
        background:${active ? 'rgba(0,0,0,.04)' : 'transparent'}; border-radius:20px; padding:4px 10px 4px 6px;
        cursor:pointer; opacity:${active ? '1' : '.45'}; font-size:12px; color:inherit;">
        <span style="width:12px; height:12px; border-radius:3px; background:${c}; display:inline-block;"></span>${esc(l)}
      </button>`;
    }).join('')}
  </div>`;
}

function petaToggleStatusFilter(key) {
  if (petaState.activeStatuses.has(key)) {
    if (petaState.activeStatuses.size === 1) return; // jangan sampai semua kematiin, peta jadi kosong total
    petaState.activeStatuses.delete(key);
  } else {
    petaState.activeStatuses.add(key);
  }
  // Update tampilan legend (biar tombol keliatan aktif/nonaktif) tanpa fetch ulang data
  const module = petaModuleByKey(petaState.module);
  const legendHolder = document.getElementById('petaLegendHolder');
  if (legendHolder) legendHolder.innerHTML = `<label class="field-label" style="visibility:hidden;">Status</label>${petaLegendHTML(module)}`;
  if (petaLastRender) {
    petaDrawMap(petaLastRender.module, petaLastRender.geojson, petaLastRender.dataMap, petaLastRender.visibleSet, petaLastRender.pascaRefMap);
  }
}

async function renderPeta() {
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'Peta';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  await paintPeta();
}

async function paintPeta() {
  const module = petaModuleByKey(petaState.module);
  if (petaState.activeStatusesFor !== module.key) {
    petaState.activeStatuses = new Set(module.legend.map(i => i[0])); // default: semua status modul ini aktif
    petaState.activeStatusesFor = module.key;
  }

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; gap:14px; flex-wrap:wrap; align-items:center; padding:16px 18px;">
        <div>
          <label class="field-label">Modul</label>
          <select class="input" id="petaModuleSelect" style="min-width:240px;">
            ${PETA_MODULES.map(m => `<option value="${m.key}" ${m.key === module.key ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
          </select>
        </div>
        ${module.key === 'kondisi_bulanan' ? `
        <div>
          <label class="field-label">Bulan</label>
          <select class="input" id="petaBulanSelect" style="min-width:140px;">
            <option value="">Terbaru (semua)</option>
            ${BULAN_OPTIONS.map(b => `<option value="${b}" ${petaState.bulanFilter === b ? 'selected' : ''}>Bulan ${b}</option>`).join('')}
          </select>
        </div>` : ''}
        <div style="flex:1; min-width:220px;" id="petaLegendHolder">
          <label class="field-label" style="visibility:hidden;">Status</label>
          ${petaLegendHTML(module)}
        </div>
        <button class="btn btn-outline btn-sm" onclick="paintPeta()">Muat Ulang</button>
      </div>
      ${(module.extraFilters || module.bappFilter) ? `<div class="card-body" style="display:flex; gap:14px; flex-wrap:wrap; padding:0 18px 16px;">
        ${(module.extraFilters || []).map(ef => {
          const opts = ef.values;
          const selected = petaState.extraFilterValues[ef.key] || '';
          return `<div>
            <label class="field-label">${esc(ef.label)}</label>
            <select class="input peta-extra-filter" data-filter-key="${ef.key}" style="min-width:170px;">
              <option value="">Semua</option>
              ${opts.map(v => `<option value="${esc(v)}" ${selected === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </div>`;
        }).join('')}
        ${module.bappFilter ? `
        <div>
          <label class="field-label">Tgl BAPP Dari</label>
          <input class="input" type="date" style="min-width:150px;" id="petaBappDari" value="${esc(petaState.bappFrom)}">
        </div>
        <div>
          <label class="field-label">Tgl BAPP Sampai</label>
          <input class="input" type="date" style="min-width:150px;" id="petaBappSampai" value="${esc(petaState.bappTo)}">
        </div>
        ${(petaState.bappFrom || petaState.bappTo) ? `<div style="align-self:flex-end;">
          <button class="btn btn-outline btn-sm" id="petaBappReset" type="button">Reset Tgl BAPP</button>
        </div>` : ''}` : ''}
      </div>` : ''}
    </div>
    <div class="card" id="petaSummaryHolder" style="margin-bottom:16px;"></div>
    <div class="card">
      <div class="card-body" style="padding:0;">
        <div id="petaMapContainer" style="height:640px; border-radius:var(--radius,10px); overflow:hidden;">
          <div style="display:flex; justify-content:center; align-items:center; height:100%;"><div class="spinner"></div></div>
        </div>
        <div id="petaMissingWarn"></div>
      </div>
    </div>
  `;
  $('#petaModuleSelect').addEventListener('change', function () {
    petaState.module = this.value;
    petaState.bulanFilter = ''; // reset filter bulan tiap ganti modul
    petaState.extraFilterValues = {}; // reset extra filter tiap ganti modul
    petaState.bappFrom = ''; petaState.bappTo = ''; // reset filter tgl bapp tiap ganti modul
    paintPeta();
  });
  $('#petaBulanSelect')?.addEventListener('change', function () {
    petaState.bulanFilter = this.value;
    paintPeta();
  });
  $all('.peta-extra-filter').forEach(sel => {
    sel.addEventListener('change', function () {
      petaState.extraFilterValues[this.dataset.filterKey] = this.value;
      paintPeta();
    });
  });
  $('#petaBappDari')?.addEventListener('change', function () {
    petaState.bappFrom = this.value;
    paintPeta();
  });
  $('#petaBappSampai')?.addEventListener('change', function () {
    petaState.bappTo = this.value;
    paintPeta();
  });
  $('#petaBappReset')?.addEventListener('click', function () {
    petaState.bappFrom = ''; petaState.bappTo = '';
    paintPeta();
  });

  try {
    const [geojson, rows, visibleSet, pascaRefMap] = await Promise.all([
      loadPetaGeoJson(),
      module.fetch(),
      petaVisiblePetakSet(),
      module.key === 'maintenance' ? ensurePetaPascaRefMap() : Promise.resolve(null),
    ]);
    // Filter khusus modul Kondisi Bulanan: kalau user pilih bulan tertentu, cuma
    // pakai baris bulan itu (bukan baris terbaru per petak yang jadi default).
    let filteredRows = (module.key === 'kondisi_bulanan' && petaState.bulanFilter)
      ? rows.filter(r => (r.bulan || '').toString().trim() === petaState.bulanFilter)
      : rows;
    // Filter khusus modul Maintenance: Next Action + status per grup aktivitas
    // (Mekanisasi/Drain/Hama/Mandatory), semua opsi harus cocok kalau diisi.
    if (module.extraFilters) {
      module.extraFilters.forEach(ef => {
        const selected = petaState.extraFilterValues[ef.key];
        if (!selected) return;
        filteredRows = filteredRows.filter(r => {
          const actual = ef.groupFields ? petaGroupStatus(r, ef.groupFields) : (r[ef.key] || '').toString().trim();
          return actual === selected;
        });
      });
    }
    // Filter Tgl BAPP: modul Pasca Harvest pakai kolom `bapp` miliknya sendiri;
    // modul Maintenance pakai tgl BAPP dari data master Pasca Harvest lewat
    // pascaRefMap (kolom `bapp` bukan milik tabel Maintenance sendiri).
    if (module.bappFilter && (petaState.bappFrom || petaState.bappTo)) {
      filteredRows = filteredRows.filter(r => {
        let bapp = '';
        if (module.key === 'maintenance') {
          const ref = pascaRefMap?.get(petaNormPetak(r.petak));
          bapp = ref?.bapp ? String(ref.bapp).slice(0, 10) : '';
        } else {
          bapp = r.bapp ? String(r.bapp).slice(0, 10) : '';
        }
        if (!bapp) return false; // petak tanpa tgl BAPP disembunyikan kalau filter aktif
        if (petaState.bappFrom && bapp < petaState.bappFrom) return false;
        if (petaState.bappTo && bapp > petaState.bappTo) return false;
        return true;
      });
    }
    const dataMap = petaBuildDataMap(filteredRows);
    petaLastRender = { module, geojson, dataMap, visibleSet, pascaRefMap };
    petaDrawMap(module, geojson, dataMap, visibleSet, pascaRefMap);
  } catch (err) {
    $('#petaMapContainer').innerHTML = `<div class="empty-state">Gagal memuat peta: ${esc(err.message)}</div>`;
  }
}

function petaFmtHa(n) {
  return n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function petaRenderSummary(module, summary) {
  const holder = document.getElementById('petaSummaryHolder');
  if (!holder) return;
  const totalCount = Object.values(summary).reduce((s, v) => s + v.count, 0);
  const totalHa = Object.values(summary).reduce((s, v) => s + v.ha, 0);
  const cards = module.legend.map(([key, color, label]) => {
    const s = summary[key] || { count: 0, ha: 0 };
    return `
      <div style="flex:1; min-width:140px; border:1px solid #e7e9ec; border-radius:10px; padding:10px 14px; display:flex; align-items:center; gap:10px;">
        <span style="width:10px; height:10px; border-radius:3px; background:${color}; flex-shrink:0;"></span>
        <div>
          <div style="font-size:11px; color:var(--text-muted);">${esc(label)}</div>
          <div style="font-size:16px; font-weight:700;">${s.count} petak${module.areaField ? ` <span style="font-size:12px; font-weight:500; color:var(--text-muted);">(${petaFmtHa(s.ha)} Ha)</span>` : ''}</div>
        </div>
      </div>`;
  }).join('');
  holder.innerHTML = `
    <div class="card-body" style="display:flex; gap:10px; flex-wrap:wrap; padding:14px 18px;">
      <div style="flex:1; min-width:140px; border:1px solid #e7e9ec; border-radius:10px; padding:10px 14px; background:rgba(0,0,0,.02);">
        <div style="font-size:11px; color:var(--text-muted);">Total Petak</div>
        <div style="font-size:16px; font-weight:700;">${totalCount} petak${module.areaField ? ` <span style="font-size:12px; font-weight:500; color:var(--text-muted);">(${petaFmtHa(totalHa)} Ha)</span>` : ''}</div>
      </div>
      ${cards}
    </div>`;
}

function petaDrawMap(module, geojson, dataMap, visibleSet, pascaRefMap) {
  const container = $('#petaMapContainer');
  if (!container) return;
  container.innerHTML = '';

  if (petaMapInstance) { petaMapInstance.remove(); petaMapInstance = null; }
  petaMapInstance = L.map(container, { scrollWheelZoom: true, fadeAnimation: false, zoomAnimation: false, markerZoomAnimation: false, inertia: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(petaMapInstance);

  petaLayerGroup = L.featureGroup().addTo(petaMapInstance);
  let visibleCount = 0;
  const summary = {}; // key -> { count, ha }
  module.legend.forEach(([k]) => { summary[k] = { count: 0, ha: 0 }; });
  const geojsonKeySet = new Set(geojson.features.map(f => petaNormPetak(f.properties && f.properties.petak)));

  geojson.features.forEach(f => {
    const petak = (f.properties && f.properties.petak || '').toString();
    const key = petaNormPetak(petak);
    if (visibleSet && !visibleSet.has(key)) return; // di luar zona akun ini, jangan ditampilkan
    const row = dataMap.get(key) || null;
    if (module.petaRowFilter && !module.petaRowFilter(row)) return; // gak lolos kriteria modul ini (mis. belum tebang)
    const color = petaColorFor(module, row);
    const statusKey = module.statusKeyFn ? module.statusKeyFn(row) : petaStatusKeyFor(color);

    // Tally summary DULUAN (independen dari toggle legend), biar kartu ringkasan tetap
    // nunjukin total sebenarnya walau sebagian status lagi disembunyikan di peta.
    if (!summary[statusKey]) summary[statusKey] = { count: 0, ha: 0 };
    summary[statusKey].count++;
    if (module.areaField && row) summary[statusKey].ha += parseFloat(row[module.areaField]) || 0;

    if (!petaState.activeStatuses.has(statusKey)) return; // status ini lagi disembunyikan lewat filter legend
    visibleCount++;

    const layer = L.geoJSON(f, {
      style: { color: '#2b2f36', weight: 1, fillColor: color, fillOpacity: 0.55 },
    });

    const statusVal = petaStatusValueFor(module, row);
    const zona = row?.zona ? esc(row.zona) : '–';
    // Di Peta Maintenance, Staff & Selesai Harvest dirujuk dari modul Pasca Harvest
    // (bukan kolom staff/mt_actual_month_harvest milik tabel Maintenance sendiri,
    // yang sering kosong) — lihat ensurePetaPascaRefMap().
    const pascaRef = (module.key === 'maintenance' && pascaRefMap) ? pascaRefMap.get(key) : null;
    const staff = (pascaRef?.staff || row?.staff || row?.staff_name) ? esc(pascaRef?.staff || row.staff || row.staff_name) : '–';
    // Bulan Tebang: nama bulan saja. Selesai Harvest: tanggal lengkap DD-MM-YYYY.
    // Keduanya diturunkan dari kolom BAPP (tanggal) di Pasca Harvest.
    const bulanTebang = pascaRef ? petaBulanTebangFromBapp(pascaRef.bapp) : null;
    const bulanTebangRow = bulanTebang ? `<div>Bulan Tebang: <b>${esc(bulanTebang)}</b></div>` : '';
    const selesaiHarvestTgl = pascaRef ? fmtDateID(pascaRef.bapp) : null;
    const actualHarvest = selesaiHarvestTgl ? `<div>Selesai Harvest: <b>${esc(selesaiHarvestTgl)}</b></div>` : '';
    const posisiUnitExtra = (module.key === 'posisi_unit' && row) ? `
        <div>Tanggal: <b>${esc(fmtDateID(row.tanggal))}</b></div>
        <div>Kode Unit: <b>${esc(row.kode_unit || '-')}</b></div>
        <div>Keterangan: <b>${esc(row.keterangan || '-')}</b></div>
        <div>Status: <b>${esc(row.status || '-')}</b></div>` : '';
    const popupHtml = `
      <div style="min-width:200px; font-size:12.5px;">
        <div style="font-weight:700; margin-bottom:4px;">${esc(petak)}</div>
        <div>Zona: <b>${zona}</b></div>
        <div>Staff: <b>${staff}</b></div>
        <div>${esc(module.statusLabel)}: <b>${esc(statusVal)}</b></div>
        ${bulanTebangRow}
        ${actualHarvest}
        ${posisiUnitExtra}
        <button class="btn btn-primary btn-sm" style="margin-top:8px; width:100%;" onclick="petaOpenDetail('${module.view}','${module.stateKey}','${petak.replace(/'/g, "\\'")}')">Buka Detail</button>
      </div>`;
    layer.bindPopup(popupHtml);
    layer.bindTooltip(petak, {
      permanent: true, direction: 'center', className: 'peta-petak-label', opacity: 0.9,
    });
    layer.addTo(petaLayerGroup);
  });

  petaRenderSummary(module, summary);

  // Diagnostik: petak yang lolos kriteria modul tapi TIDAK ada shape-nya di
  // petak-boundaries.geojson (mis. petak "New Land" / eks non-RKT yang belum
  // ada di file boundary 1482 petak) -> gak kegambar di peta sama sekali.
  const missingPetak = [];
  dataMap.forEach((row, key) => {
    if (visibleSet && !visibleSet.has(key)) return;
    if (module.petaRowFilter && !module.petaRowFilter(row)) return;
    if (!geojsonKeySet.has(key)) missingPetak.push(key);
  });
  if (missingPetak.length) {
    console.warn(`[Peta] ${missingPetak.length} petak modul "${module.label}" tidak ada shape di petak-boundaries.geojson:`, missingPetak);
  }
  const warnHolder = document.getElementById('petaMissingWarn');
  if (warnHolder) {
    warnHolder.innerHTML = missingPetak.length
      ? `<div style="padding:8px 18px; font-size:12px; color:#8a5a1a; background:#fff6e6; border-top:1px solid #f0dfb8;">
          ⚠ ${missingPetak.length} petak (${esc(missingPetak.slice(0, 8).join(', '))}${missingPetak.length > 8 ? ', …' : ''}) ada datanya tapi belum ada shape/boundary di peta — cek console (F12) buat daftar lengkapnya.
        </div>`
      : '';
  }

  if (petaLayerGroup.getLayers().length) {
    petaMapInstance.fitBounds(petaLayerGroup.getBounds(), { padding: [16, 16] });
  } else {
    petaMapInstance.setView([-3.9, 105.8], 11); // fallback view area kebun kalau kosong
  }

  // Badge jumlah petak yang tampil (info kecil di pojok)
  const info = L.control({ position: 'bottomleft' });
  info.onAdd = function () {
    const div = L.DomUtil.create('div');
    div.style.cssText = 'background:rgba(255,255,255,.9); padding:4px 10px; border-radius:6px; font-size:11.5px; color:#333;';
    div.textContent = visibleCount + ' petak ditampilkan';
    return div;
  };
  info.addTo(petaMapInstance);
}

function petaOpenDetail(view, stateKey, petak) {
  if (state[stateKey]) {
    state[stateKey].search = petak;
    state[stateKey].page = 1;
  }
  navigate(view);
}

/* ---------------------------------------------------------------------
   OVERRIDE navigate() — routing view 'peta'
   --------------------------------------------------------------------- */
const _prevNavigatePeta = navigate;
navigate = async function (view) {
  if (view === 'peta') {
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    const activeItem = $all('.nav-item').find(el => el.dataset.view === view);
    const parentSection = activeItem?.closest('.nav-section');
    if (parentSection && parentSection.classList.contains('collapsed')) {
      parentSection.classList.remove('collapsed');
      const key = parentSection.id.replace('navSection_', '');
      const btn = parentSection.querySelector('.nav-section-label');
      if (btn) btn.setAttribute('aria-expanded', 'true');
      saveNavSectionState(key, false);
    }
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderPeta();
    return;
  }
  return _prevNavigatePeta(view);
};

/* ---------------------------------------------------------------------
   INJECT nav-item "Peta" ke sidebar (satu section sendiri, dibawah Menu
   Data). Dijalankan sekali saat file ini di-load.
   --------------------------------------------------------------------- */
(function injectPetaNavItem() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;
  const section = document.createElement('div');
  section.className = 'nav-section';
  section.id = 'navSection_peta';
  section.innerHTML = `
    <button type="button" class="nav-section-label" onclick="toggleNavSection('peta')" aria-expanded="true">
      <span>Peta</span>
      <svg class="nav-section-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    <div class="nav-section-body" id="navSectionBody_peta">
      <a class="nav-item" data-view="peta" onclick="navigate('peta')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13 6-3m-6 3V7m6 10 4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4m0 0L9 7"/></svg>
        <span>Peta</span>
      </a>
    </div>
  `;
  const menuDataSection = document.getElementById('navSection_menu_data');
  if (menuDataSection && menuDataSection.nextSibling) {
    nav.insertBefore(section, menuDataSection.nextSibling);
  } else {
    nav.appendChild(section);
  }
})();
