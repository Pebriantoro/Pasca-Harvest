/* =========================================================================
   MODUL ADDON: TEBANG BIBIT
   =========================================================================
   Menu baru di grup "Menu Data", persis di bawah "PC & RPC Eks Non RKT".
   Sumber data: sheet "DBASE BIBIT" (database_template_-_Petak_Bibit.xlsx).
   Fitur: CRUD + Import XLSX (Tambah/Update by Petak), KPI, grafik & analisa,
   dibatasi zona untuk Superintendent/Supervisor/Staff (Admin & Manager
   selalu melihat SEMUA petak). Additif — tidak mengubah app.js/peta-gis.js
   secara logic, hanya menambah entri baru lewat Object.assign/override
   fungsi (pola yang sama dipakai produktivitas-he.js & peta-gis.js).

   PENTING — jalankan SQL berikut di Supabase SQL Editor sebelum modul ini
   dipakai (lihat juga file supabase_tebang_bibit.sql):

   create table if not exists tebang_bibit (
     id bigint generated always as identity primary key,
     petak text not null,
     zona text,
     tb_superintendent text,
     tb_supervisor text,
     tb_staff text,
     tb_size_rkt numeric,
     tb_varietas text,
     tb_action_plan text,
     tb_phasing text,
     tb_populasi_2025 numeric,
     tb_wo_tebang_bibit date,
     tb_bapp_tebang_bibit date,
     tb_size_bapp_tebang_bibit numeric,
     tb_status_tebang_bibit text,
     tb_status_fsa text,
     tb_status_post1 text,
     tb_status_post2 text,
     tb_status_post3 text,
     tb_status_weeding_rayutan text,
     tb_status_pengendalian_hpt text,
     tb_status_hama_tikus text,
     tb_schedule_gs1 date,
     tb_populasi_2026 numeric,
     tb_status_petak_update text,
     created_by uuid,
     updated_by uuid,
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );
   alter table tebang_bibit enable row level security;
   -- Samakan kebijakan RLS dengan tabel pc_rpc_eks_non_rkt (lihat
   -- supabase_rls_zona.sql), sesuaikan nama tabel jadi 'tebang_bibit'.
   ========================================================================= */

const TB_TABLE = 'tebang_bibit';
const TB_STATUS_OPTIONS = STATUS3; // ['Not Yet','Progress','Done']
const TB_STATUS_PETAK_OPTIONS = ['RATOON 1','RATOON 2','RATOON 3','RATOON 4','RATOON 5','RATOON 6','RATOON 7','RATOON 8','RATOON 9','PC','RPC'];

Object.assign(FIELD_META, {
  tb_superintendent: { label:'Superintendent', type:'text' },
  tb_supervisor: { label:'Supervisor', type:'text' },
  tb_staff: { label:'Staff', type:'text' },
  tb_size_rkt: { label:'Size RKT', type:'number' },
  tb_varietas: { label:'Varietas', type:'text' },
  tb_action_plan: { label:'Action Plan Current Crop 2026', type:'text' },
  tb_phasing: { label:'Phasing 2026', type:'select', options:MONTHS },
  tb_populasi_2025: { label:'Populasi 2025', type:'number' },
  tb_wo_tebang_bibit: { label:'WO Tebang Bibit', type:'date' },
  tb_bapp_tebang_bibit: { label:'BAPP Tebang Bibit', type:'date' },
  tb_size_bapp_tebang_bibit: { label:'Size BAPP Tebang Bibit', type:'number' },
  tb_status_tebang_bibit: { label:'Status Tebang Bibit', type:'select', options:TB_STATUS_OPTIONS, required:true },
  tb_status_fsa: { label:'Status FSA', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_post1: { label:'Status POST 1', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_post2: { label:'Status POST 2', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_post3: { label:'Status POST 3', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_weeding_rayutan: { label:'Status WEEDING RAYUTAN', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_pengendalian_hpt: { label:'Status Pengendalian HPT', type:'select', options:TB_STATUS_OPTIONS },
  tb_status_hama_tikus: { label:'Status P. Hama Tikus', type:'select', options:TB_STATUS_OPTIONS },
  tb_schedule_gs1: { label:'Schedule GS 1', type:'date' },
  tb_populasi_2026: { label:'Populasi 2026', type:'number' },
  tb_status_petak_update: { label:'Status Petak Update', type:'text', list:TB_STATUS_PETAK_OPTIONS },
});

// Urutan kolom persis seperti sheet "DBASE BIBIT" (dipakai untuk form modal,
// export, dan pemetaan header saat import).
const TB_COLUMNS = [
  'petak','zona','tb_superintendent','tb_supervisor','tb_staff','tb_size_rkt','tb_varietas',
  'tb_action_plan','tb_phasing','tb_populasi_2025','tb_wo_tebang_bibit','tb_bapp_tebang_bibit',
  'tb_size_bapp_tebang_bibit','tb_status_tebang_bibit','tb_status_fsa','tb_status_post1','tb_status_post2',
  'tb_status_post3','tb_status_weeding_rayutan','tb_status_pengendalian_hpt','tb_status_hama_tikus',
  'tb_schedule_gs1','tb_populasi_2026','tb_status_petak_update',
];
// Kolom ringkas yang tampil di tabel daftar.
const TB_LIST_COLUMNS = ['petak','zona','tb_varietas','tb_size_rkt','tb_status_tebang_bibit','tb_phasing','tb_status_petak_update'];
// 8 kolom status tahapan — dipakai untuk rekap progress & grafik kelompok.
const TB_ACTIVITY_FIELDS = [
  ['tb_status_tebang_bibit','Status Tebang Bibit'],
  ['tb_status_fsa','Status FSA'],
  ['tb_status_post1','Status POST 1'],
  ['tb_status_post2','Status POST 2'],
  ['tb_status_post3','Status POST 3'],
  ['tb_status_weeding_rayutan','Status WEEDING RAYUTAN'],
  ['tb_status_pengendalian_hpt','Status Pengendalian HPT'],
  ['tb_status_hama_tikus','Status P. Hama Tikus'],
];
// Pengelompokan tahapan menjadi 3 grafik (nilai dalam Ha)
const TB_ACTIVITY_GROUPS = [
  { key:'penebangan', title:'Penebangan Bibit', fields:['tb_status_tebang_bibit'] },
  { key:'pemeliharaan_awal', title:'Pemeliharaan Awal (FSA & POST)', fields:['tb_status_fsa','tb_status_post1','tb_status_post2','tb_status_post3'] },
  { key:'pengendalian_opt', title:'Pengendalian OPT & Gulma', fields:['tb_status_weeding_rayutan','tb_status_pengendalian_hpt','tb_status_hama_tikus'] },
];
// Header di file Excel sudah sama persis dengan label FIELD_META, kecuali kolom zona.
const TB_HEADER_ALIASES = { zona: 'Zona Plantation' };

// Rekap luas (Ha) per tahapan berdasarkan status Not Yet / Progress / Done
function tbActivityHaByGroup(rows, fields){
  const labelOf = key => (TB_ACTIVITY_FIELDS.find(f => f[0]===key) || [key,key])[1];
  const categories = fields.map(labelOf);
  const notYet = [], progress = [], done = [];
  fields.forEach(key => {
    let nY=0, pR=0, dN=0;
    rows.forEach(r => {
      const v = (r[key]||'').toString().trim().toLowerCase();
      const ha = parseFloat(r.tb_size_rkt) || 0;
      if(v==='' || v==='not yet') nY += ha;
      else if(v==='progress') pR += ha;
      else if(v==='done') dN += ha;
    });
    notYet.push(+nY.toFixed(2)); progress.push(+pR.toFixed(2)); done.push(+dN.toFixed(2));
  });
  return { categories, seriesMap: { 'Not Yet': notYet, 'Progress': progress, 'Done': done } };
}
function tbRowActivityPct(r){
  const total = TB_ACTIVITY_FIELDS.length;
  if(!total) return 0;
  const done = TB_ACTIVITY_FIELDS.filter(([k]) => (r[k]||'').toString().trim().toLowerCase()==='done').length;
  return Math.round((done/total)*100);
}

state[TB_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:14,
  filterZona:'', filterVarietas:'', filterStatus:'', filterPhasing:'', filterPanelOpen:false,
};

async function ensureTebangBibitData(){
  const st = state[TB_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(TB_TABLE).select('*').order('petak', { ascending:true });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat data Tebang Bibit: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data || []);
  st.loaded = true;
  return st.data;
}

async function renderTebangBibit(){
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'Tebang Bibit';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureTebangBibitData();
  paintTebangBibit(rows);
}

function resetTebangBibitFilters(){
  const st = state[TB_TABLE];
  st.filterZona=''; st.filterVarietas=''; st.filterStatus=''; st.filterPhasing='';
  st.page = 1;
  paintTebangBibit(st.data);
}
function toggleTebangBibitFilterPanel(){
  state[TB_TABLE].filterPanelOpen = !state[TB_TABLE].filterPanelOpen;
  paintTebangBibit(state[TB_TABLE].data);
}
function sortTebangBibit(key){
  const st = state[TB_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintTebangBibit(st.data);
}
function changeTebangBibitPage(delta){
  state[TB_TABLE].page += delta;
  paintTebangBibit(state[TB_TABLE].data);
}
function badgeForTbStatus(val){
  const v = (val||'').toString().trim().toLowerCase();
  if(v==='done') return `<span class="badge" style="background:rgba(95,174,125,.16); color:var(--accent-green);">${esc(val)}</span>`;
  if(v==='progress') return `<span class="badge" style="background:rgba(217,169,74,.16); color:var(--accent-gold);">${esc(val)}</span>`;
  if(v==='not yet') return `<span class="badge" style="background:rgba(193,84,60,.16); color:var(--accent-red);">${esc(val)}</span>`;
  return `<span class="badge badge-neutral">–</span>`;
}
function renderTebangBibitCell(col, val, row){
  if(col === 'petak') return `<span class="petak-tag">${esc(val)}</span>`;
  if(col === 'tb_size_rkt') return val===null||val===undefined||val==='' ? '–' : fmtNum(val);
  if(col === 'tb_status_tebang_bibit') return badgeForTbStatus(val);
  return esc(val) || '<span style="color:var(--text-faint)">–</span>';
}

function paintTebangBibit(allRows){
  const st = state[TB_TABLE];

  const zonaOptions = uniqueValues(allRows, 'zona');
  const varietasOptions = uniqueValues(allRows, 'tb_varietas');
  const statusOptions = uniqueValues(allRows, 'tb_status_tebang_bibit');
  const phasingOptions = uniqueValues(allRows, 'tb_phasing');
  const filterActive = !!(st.filterZona || st.filterVarietas || st.filterStatus || st.filterPhasing);
  const filterCount = [st.filterZona, st.filterVarietas, st.filterStatus, st.filterPhasing].filter(Boolean).length;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona ?? '').toString().trim() === st.filterZona);
  if(st.filterVarietas) rows = rows.filter(r => (r.tb_varietas ?? '').toString().trim() === st.filterVarietas);
  if(st.filterStatus) rows = rows.filter(r => (r.tb_status_tebang_bibit ?? '').toString().trim() === st.filterStatus);
  if(st.filterPhasing) rows = rows.filter(r => (r.tb_phasing ?? '').toString().trim() === st.filterPhasing);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => TB_LIST_COLUMNS.some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows; // dasar untuk KPI & grafik (ikut filter & pencarian aktif)

  const totalPetak = filteredRows.length;
  const totalLuas = filteredRows.reduce((s,r)=> s + (parseFloat(r.tb_size_rkt)||0), 0);
  const totalPopulasi2025 = filteredRows.reduce((s,r)=> s + (parseFloat(r.tb_populasi_2025)||0), 0);
  const totalPopulasi2026 = filteredRows.reduce((s,r)=> s + (parseFloat(r.tb_populasi_2026)||0), 0);
  const doneTebangCount = filteredRows.filter(r => (r.tb_status_tebang_bibit||'').toString().trim().toLowerCase()==='done').length;
  const avgActivityPct = totalPetak ? Math.round(filteredRows.reduce((s,r)=>s+tbRowActivityPct(r),0)/totalPetak) : 0;

  const statusAgg = aggregateCount(filteredRows, 'tb_status_tebang_bibit');
  const varietasAgg = aggregateSum(filteredRows, 'tb_varietas', 'tb_size_rkt');
  const phasingAgg = aggregateSumByMonthToken(filteredRows, 'tb_phasing', 'tb_size_rkt');
  const zonaOrder = zonaOptions.length ? zonaOptions : ['-'];
  const populasiSeries = {
    'Populasi 2025': zonaOrder.map(z => +filteredRows.filter(r=>(r.zona??'').toString().trim()===z).reduce((s,r)=>s+(parseFloat(r.tb_populasi_2025)||0),0).toFixed(0)),
    'Populasi 2026': zonaOrder.map(z => +filteredRows.filter(r=>(r.zona??'').toString().trim()===z).reduce((s,r)=>s+(parseFloat(r.tb_populasi_2026)||0),0).toFixed(0)),
  };

  const activityGroupData = TB_ACTIVITY_GROUPS.map(g => ({
    ...g,
    ...tbActivityHaByGroup(filteredRows, g.fields),
  }));

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey]??''), bv = (b[st.sortKey]??'');
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);

  $('#pageContent').innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Total Petak', totalPetak, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)')}
      ${kpiCard('Total Luas', fmtNum(totalLuas)+' Ha', filterActive ? 'Size RKT · sesuai filter' : 'Size RKT', 'var(--accent-blue)')}
      ${kpiCard('Sudah Tebang', doneTebangCount+'/'+totalPetak, 'status Tebang Bibit = Done', 'var(--accent-green)')}
      ${kpiCard('Rata-rata Progress Tahapan', avgActivityPct+'%', 'rata-rata 8 tahapan per petak', 'var(--accent-red)')}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; align-items:center; gap:16px; padding:12px 18px; flex-wrap:wrap;">
        <span style="font-size:12px; color:var(--text-muted);">Populasi 2025: <b style="color:var(--accent-blue);">${fmtNum(totalPopulasi2025,0)}</b> &nbsp;→&nbsp; Populasi 2026: <b style="color:var(--accent-gold);">${fmtNum(totalPopulasi2026,0)}</b></span>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Status Tebang Bibit (Jumlah Petak)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_tb_status"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Komposisi Luas per Varietas (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_tb_varietas"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Phasing 2026 per Bulan (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_tb_phasing"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Populasi 2025 vs 2026 per Zona</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_tb_populasi"></canvas></div></div></div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik ${esc(activityGroupData[0].title)} (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[0].categories, activityGroupData[0].seriesMap, activityGroupData[0].fields, 'tbActivity_penebangan', filteredRows, 'tb_size_rkt')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik ${esc(activityGroupData[1].title)} (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[1].categories, activityGroupData[1].seriesMap, activityGroupData[1].fields, 'tbActivity_pemeliharaan', filteredRows, 'tb_size_rkt')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik ${esc(activityGroupData[2].title)} (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[2].categories, activityGroupData[2].seriesMap, activityGroupData[2].fields, 'tbActivity_opt', filteredRows, 'tb_size_rkt')}</div>
    </div>

    <div class="card">
      <div class="table-toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" placeholder="Cari petak, zona, varietas…" id="searchInput_tebangbibit" value="${esc(st.search)}">
        </div>
        <button class="btn ${filterActive ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="toggleTebangBibitFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetTebangBibitFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportTebangBibit()" title="Baris dengan Petak yang sudah ada akan diperbarui, yang belum ada akan ditambahkan.">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX (Tambah/Update)
          </button>
          <input type="file" id="importFileTebangBibit" accept=".xlsx,.xls" class="hidden" onchange="handleImportTebangBibit(this)">
          ${renderExportMenu('tebangbibit')}` : ''}
          ${canEditModule('tebang_bibit') ? `<button class="btn btn-primary btn-sm" onclick="openTebangBibitModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_tb">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(s=>`<option value="${esc(s)}" ${st.filterZona===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterVarietas_tb">
          <option value="">Varietas: Semua</option>
          ${varietasOptions.map(s=>`<option value="${esc(s)}" ${st.filterVarietas===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatus_tb">
          <option value="">Status Tebang Bibit: Semua</option>
          ${statusOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterPhasing_tb">
          <option value="">Phasing 2026: Semua</option>
          ${phasingOptions.map(s=>`<option value="${esc(s)}" ${st.filterPhasing===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            ${TB_LIST_COLUMNS.map(c => `<th onclick="sortTebangBibit('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${TB_LIST_COLUMNS.length+1}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map(r => `<tr>
                ${TB_LIST_COLUMNS.map(c => `<td>${renderTebangBibitCell(c, r[c], r)}</td>`).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openTebangBibitModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('tebang_bibit') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteTebangBibit(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeTebangBibitPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeTebangBibitPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  $('#searchInput_tebangbibit').addEventListener('input', debounce(function(){
    st.search = this.value; st.page = 1; paintTebangBibit(state[TB_TABLE].data);
    setTimeout(()=>{ const inp = $('#searchInput_tebangbibit'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));
  $('#filterZona_tb')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintTebangBibit(st.data); });
  $('#filterVarietas_tb')?.addEventListener('change', function(){ st.filterVarietas = this.value; st.page = 1; paintTebangBibit(st.data); });
  $('#filterStatus_tb')?.addEventListener('change', function(){ st.filterStatus = this.value; st.page = 1; paintTebangBibit(st.data); });
  $('#filterPhasing_tb')?.addEventListener('change', function(){ st.filterPhasing = this.value; st.page = 1; paintTebangBibit(st.data); });

  drawDonut('chart_tb_status', statusAgg, true);
  drawDonut('chart_tb_varietas', varietasAgg, false);
  drawBar('chart_tb_phasing', Object.fromEntries(PHASING_CHART_MONTHS.map(m=>[m, +(phasingAgg[m]||0).toFixed(2)])));
  drawGroupedBar('chart_tb_populasi', zonaOrder, populasiSeries, ['#5B8FA8','#D9A94A']);
}

function openTebangBibitModal(id){
  const record = id ? state[TB_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('tebang_bibit');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — Tebang Bibit</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormTebangBibit" class="form-grid">
          ${TB_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveTebangBibit(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveTebangBibit(id){
  const form = $('#recordFormTebangBibit');
  const payload = {};
  TB_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.petak){ toast('Kolom Petak wajib diisi', true); return; }
  const zonaRestrict = getUserZonaRestriction();
  if(zonaRestrict) payload.zona = zonaRestrict;
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(TB_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(TB_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: TB_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.petak], zona: payload.zona });
  closeModal();
  state[TB_TABLE].loaded = false;
  await ensureTebangBibitData();
  paintTebangBibit(state[TB_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteTebangBibit(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteTebangBibit(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteTebangBibit(id){
  const rec = state[TB_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(TB_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: TB_TABLE, action:'hapus', petakList: [rec?.petak], zona: rec?.zona });
  state[TB_TABLE].loaded = false;
  await ensureTebangBibitData();
  paintTebangBibit(state[TB_TABLE].data);
  refreshAllCounts();
}

function triggerImportTebangBibit(){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFileTebangBibit').click();
}
async function handleImportTebangBibit(input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const normalizeHeaderKey = s => (s ?? '').toString().trim().toLowerCase().replace(/[\s_/-]+/g, '');
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });
      const petakNormKey = normalizeHeaderKey('Petak');
      // Cari baris header beneran (baris berisi "Petak") — file lu punya baris
      // judul/kosong sebelum header, jadi gak bisa asal ambil baris pertama.
      // Pass 1: cocok persis "Petak". Pass 2 (fallback): header yang MENGANDUNG
      // kata "petak" (mis. "Kode Petak", "No. Petak").
      function findHeaderRowIdxTB(sheet){
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false, defval:null });
        for(let i=0; i<Math.min(rows.length, 50); i++){
          const row = rows[i] || [];
          if(row.some(h => normalizeHeaderKey(h) === petakNormKey)) return i;
        }
        for(let i=0; i<Math.min(rows.length, 50); i++){
          const row = rows[i] || [];
          if(row.some(h => normalizeHeaderKey(h).includes(petakNormKey))) return i;
        }
        return -1;
      }
      let sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'dbase bibit');
      let headerRowIdx = sheetName ? findHeaderRowIdxTB(wb.Sheets[sheetName]) : -1;
      if(!sheetName || headerRowIdx === -1){
        for(const name of wb.SheetNames){
          const idx = findHeaderRowIdxTB(wb.Sheets[name]);
          if(idx !== -1){ sheetName = name; headerRowIdx = idx; break; }
        }
      }
      if(!sheetName) sheetName = wb.SheetNames[0];
      if(headerRowIdx === -1) headerRowIdx = 0; // gak ketemu header "Petak" -> anggap baris pertama sheet ini header

      // SELALU pakai jalur manual (header:1) — jangan pernah pakai
      // XLSX.utils.sheet_to_json(sheet,{defval:null}) polos, karena itu asal
      // ambil baris pertama SEBENARNYA di sheet sebagai header (kalau ada
      // baris judul/kosong di atas header beneran, hasilnya kacau/kosong).
      const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, blankrows:false, defval:null });
      const headerRow = (rawRows[headerRowIdx] || []).map(h => (h||'').toString().trim());
      const json = rawRows.slice(headerRowIdx+1).map(r=>{
        const o = {};
        headerRow.forEach((h,i)=>{ if(h) o[h] = r[i] !== undefined ? r[i] : null; });
        return o;
      }).filter(r => Object.values(r).some(v => v!==null && v!==''));
      if(!json.length){ toast('Sheet kosong atau format tidak dikenali', true); return; }

      const normToRawKey = {};
      Object.keys(json[0]).forEach(k => { normToRawKey[normalizeHeaderKey(k)] = k; });
      const zonaRestrict = getUserZonaRestriction();
      const dateFields = ['tb_wo_tebang_bibit','tb_bapp_tebang_bibit','tb_schedule_gs1'];

      const payloadRows = json.map(row=>{
        const o = {};
        TB_COLUMNS.forEach(c=>{
          const label = FIELD_META[c].label;
          const alias = TB_HEADER_ALIASES[c];
          let v;
          if(row[c] !== undefined) v = row[c];
          else if(row[label] !== undefined) v = row[label];
          else if(alias !== undefined && row[alias] !== undefined) v = row[alias];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)] ?? (alias ? normToRawKey[normalizeHeaderKey(alias)] : undefined);
            v = rawKey !== undefined ? row[rawKey] : null;
          }
          if(dateFields.includes(c)){
            if(v === null || v === '' ) v = null;
            else if(typeof v === 'number'){
              // Sel kosong yang diformat sebagai jam (mis. 00:00:00) terbaca sebagai
              // serial < 1 (pecahan hari saja, tanpa tanggal) — anggap belum diisi.
              v = v < 1 ? null : excelSerialToISODate(v);
            }
            else if(v instanceof Date) v = excelSerialToISODate(v);
            else if(typeof v === 'string' && v.trim().toLowerCase().startsWith('1899-12-30')) v = null; // placeholder time(0,0)
            else v = v.toString().trim() || null;
          } else if(FIELD_META[c].type === 'number' && v !== null && v !== '') v = parseFloat(v);
          if(v === '') v = null;
          o[c] = v === undefined || v === null ? null : (typeof v === 'string' ? v.trim() : v);
        });
        if(zonaRestrict) o.zona = zonaRestrict;
        return o;
      }).filter(r => r.petak);

      if(!payloadRows.length){
        const foundHeaders = headerRow.filter(Boolean).join(', ') || '(tidak ada header terbaca)';
        toast('Tidak ditemukan kolom "Petak" pada file. Header yang kebaca di sheet "' + sheetName + '": ' + foundHeaders, true);
        return;
      }

      const normPetak = v => (v ?? '').toString().trim().toUpperCase();
      const existingRows = await ensureTebangBibitData();
      const existingMap = new Map();
      existingRows.forEach(r => { const key = normPetak(r.petak); if(key) existingMap.set(key, r.id); });

      const matched = [];
      const toInsert = [];
      payloadRows.forEach(o=>{
        const id = existingMap.get(normPetak(o.petak));
        if(id) matched.push({ id, payload: { ...o, updated_by: currentUser.id } });
        else toInsert.push(o);
      });

      const updateResults = matched.length ? await Promise.all(matched.map(m => supa.from(TB_TABLE).update(m.payload).eq('id', m.id))) : [];
      const failedUpdate = updateResults.filter(r => r.error);
      const successUpdate = matched.length - failedUpdate.length;

      let successInsert = 0, failedInsert = 0, insertErrorMsg = '';
      if(toInsert.length){
        const insertPayloads = toInsert.map(o => ({ ...o, created_by: currentUser.id, updated_by: currentUser.id }));
        const insertResults = await Promise.all(insertPayloads.map(p => supa.from(TB_TABLE).insert(p)));
        insertResults.forEach(r=>{
          if(r.error){ failedInsert++; if(!insertErrorMsg) insertErrorMsg = r.error.message; }
          else successInsert++;
        });
      }

      if(successUpdate) await logNotificationGrouped(TB_TABLE, 'import', matched.filter((_,i)=>!updateResults[i].error).map(m=>m.payload));
      if(successInsert) await logNotificationGrouped(TB_TABLE, 'import', toInsert);

      let msg = '';
      if(successUpdate) msg += `${successUpdate} baris diperbarui`;
      if(successInsert) msg += (msg ? ', ' : '') + `${successInsert} baris baru ditambahkan`;
      if(failedUpdate.length) msg += (msg ? ', ' : '') + `${failedUpdate.length} gagal diperbarui`;
      if(failedInsert) msg += (msg ? ', ' : '') + `${failedInsert} gagal ditambahkan${insertErrorMsg ? ' — ' + insertErrorMsg : ''}`;
      if(!msg) msg = 'Tidak ada data yang diproses';
      hideImportProgress(true);
      toast(msg, (successUpdate + successInsert) === 0);

      state[TB_TABLE].loaded = false;
      await ensureTebangBibitData();
      paintTebangBibit(state[TB_TABLE].data);
      refreshAllCounts();
    } catch(err){
      hideImportProgress(false);
      toast('Gagal membaca file: ' + err.message, true);
    } finally {
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

/* ---------------------------------------------------------------------
   HOOK KE INFRASTRUKTUR YANG SUDAH ADA (permission, navigate, badge count,
   refresh) — dengan cara override/extend, bukan mengubah app.js langsung.
   --------------------------------------------------------------------- */
Object.assign(MODULE_PERMISSIONS, {
  tebang_bibit: { edit:['admin'], del:['admin'] },
});

const _tbPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'tebang_bibit'){
    if(currentProfile?.role === 'staff' && typeof STAFF_BLOCKED_VIEWS !== 'undefined' && STAFF_BLOCKED_VIEWS.includes('tebang_bibit')){
      toast('Menu ini tidak tersedia untuk role Staff', true);
      view = 'dashboard';
    } else {
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
      await renderTebangBibit();
      return;
    }
  }
  return _tbPrevNavigate(view);
};

const _tbPrevRefreshCurrentView = refreshCurrentView;
refreshCurrentView = function(){
  if(currentView === 'tebang_bibit') state[TB_TABLE].loaded = false;
  _tbPrevRefreshCurrentView();
};

const _tbPrevRefreshAllCounts = refreshAllCounts;
refreshAllCounts = async function(){
  await _tbPrevRefreshAllCounts();
  try{
    const zonaRestrict = getUserZonaRestriction();
    let query = supa.from(TB_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_tebang_bibit');
    if(el) el.textContent = count ?? '0';
  } catch(err){ console.error('Gagal muat badge Tebang Bibit:', err); }
};
