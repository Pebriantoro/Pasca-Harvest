/* =========================================================================
   MODUL ADDON: PRODUKTIVITAS HE (ALAT BERAT)
   =========================================================================
   Sumber data: sheet "Report" pada file
   01__Daily_Report_Alat_Berat_Estate_2_2026.xlsb (log harian per unit alat
   berat: 1 baris = 1 unit, 1 hari, 1 kegiatan). Dipetakan ke satu tabel
   Supabase 'produktivitas_he', lalu ditampilkan lewat 2 SUB-MENU terpisah
   di grup "Produktivitas":
     - Produktivitas HE — Rental   (Kontraktor = PT. HKL / PT. PRN)
     - Produktivitas HE — Internal (Kontraktor = INTERNAL)
   Kedua menu berbagi data & fitur CRUD/Import yang SAMA (satu file Report
   berisi baris Rental & Internal sekaligus), hanya beda filter tampilan &
   analisa: Rental cuma analisa HM/Ha, Internal analisa HM/Ha + Ltr/HM
   (BBM), sesuai permintaan.

   Analisa KPI/kartu meniru sheet "Mont. HM" (Monitoring HM Alat Berat):
   Target HM/Hari, Realisasi, %, HM/Ha, HK, HM Actual to date, Target HM to
   date, Balance, %, Breakdown/Standby, % Avaibility, % Utility — dihitung
   otomatis per Kode Unit dari log harian di atas (bukan diinput manual).

   PENTING — jalankan SQL berikut di Supabase SQL Editor sebelum modul ini
   dipakai (kolom & RLS mengikuti pola tabel lain di aplikasi ini):

   create table if not exists produktivitas_he (
     id bigint generated always as identity primary key,
     tanggal date,
     lokasi_he2 text,
     petak text,
     luas_wo numeric,
     no_wo text,
     status_petak_he2 text,
     kegiatan_wo_he2 text,
     pekerjaan_he2 text,
     satuan text,
     hasil numeric,
     hk_produktif_he2 numeric,
     kontraktor_he2 text,
     kode_unit_he text,
     operator_he2 text,
     jam_awal_he2 text,
     jam_akhir_he2 text,
     total_jam_keseluruhan_he2 numeric,
     total_jam_bayar_he2 numeric,
     hm_awal_he2 numeric,
     hm_akhir_he2 numeric,
     potongan_hm_he2 numeric,
     hm_hari_ini_he2 numeric,
     jenis_unit_he2 text,
     hm_ha_he2 numeric,
     jumlah_liter_he2 numeric,
     ltr_hm_he2 numeric,
     keterangan text,
     pengawas text,
     created_by uuid references profiles(id),
     updated_by uuid references profiles(id),
     created_at timestamptz default now()
   );
   alter table produktivitas_he enable row level security;
   create policy "produktivitas_he_select" on produktivitas_he for select using (true);
   create policy "produktivitas_he_insert" on produktivitas_he for insert with check (
     auth.uid() in (select id from profiles where role = 'admin')
   );
   create policy "produktivitas_he_update" on produktivitas_he for update using (
     auth.uid() in (select id from profiles where role = 'admin')
   );
   create policy "produktivitas_he_delete" on produktivitas_he for delete using (
     auth.uid() in (select id from profiles where role = 'admin')
   );
   ------------------------------------------------------------------- */
const PHE_TABLE = 'produktivitas_he';
const PHE_TARGET_HM_PER_DAY = 10; // sama seperti kolom "Target" di sheet Mont. HM (tetap 10 HM/hari)

const PHE_COLUMNS = [
  'tanggal','lokasi_he2','petak','luas_wo','no_wo','status_petak_he2',
  'kegiatan_wo_he2','pekerjaan_he2','satuan','hasil','hk_produktif_he2',
  'kontraktor_he2','kode_unit_he','jenis_unit_he2','operator_he2',
  'jam_awal_he2','jam_akhir_he2','total_jam_keseluruhan_he2','total_jam_bayar_he2',
  'hm_awal_he2','hm_akhir_he2','potongan_hm_he2','hm_hari_ini_he2',
  'hm_ha_he2','jumlah_liter_he2','ltr_hm_he2','keterangan','pengawas',
];
const PHE_LIST_COLUMNS_RENTAL = ['tanggal','kode_unit_he','jenis_unit_he2','kontraktor_he2','petak','pekerjaan_he2','hasil','hm_hari_ini_he2','hm_ha_he2'];
const PHE_LIST_COLUMNS_INTERNAL = ['tanggal','kode_unit_he','jenis_unit_he2','petak','pekerjaan_he2','hasil','hm_hari_ini_he2','hm_ha_he2','jumlah_liter_he2','ltr_hm_he2'];

Object.assign(FIELD_META, {
  lokasi_he2: { label:'Lokasi', type:'text' },
  status_petak_he2: { label:'Status Petak', type:'text', list:['REPLANTING','PLANT CANE','RATOON 1','RATOON 2','RATOON 3','RATOON 4','RATOON 5','RATOON 6','RATOON 7','DRAINAGE','-'] },
  kegiatan_wo_he2: { label:'Kegiatan WO', type:'text', list:['BREAKDOWN','MECHANICAL STUBLE SHAVING','MECHANICAL SLASH WASTE','MECHANICAL PLANTING','MID DRAIN MAINTENANCE','FIELD DRAIN MAINTENANCE','MOUNDING','FURROWING','CROSS DRAIN MAINTENANCE','CUTTING SEEDLING','Kerja'] },
  pekerjaan_he2: { label:'Pekerjaan', type:'text', list:['ROLLING UNIT','MECHANICAL STUBLE SHAVING','BREAKDOWN','MECHANICAL SLASH WASTE','MID DRAIN MAINTENANCE','MOUNDING','FIELD DRAIN MAINTENANCE','Perataan blotong','MECHANICAL PLANTING','FURROWING','CROSS DRAIN MAINTENANCE','Isi bibit ke planter','Boom Spraying','Perapihan Rumpukan','Pemakaian Internal'] },
  hk_produktif_he2: { label:'HK Produktif', type:'number' },
  kontraktor_he2: { label:'Kontraktor', type:'select', options:['PT. HKL','PT. PRN','INTERNAL'], required:true },
  jenis_unit_he2: { label:'Jenis Unit', type:'select', options:['Exca-75','Exca-130','Exca-70','Dozer','WT','CT','BD'], required:true },
  operator_he2: { label:'Operator', type:'text' },
  jam_awal_he2: { label:'Jam Awal', type:'text' },
  jam_akhir_he2: { label:'Jam Akhir', type:'text' },
  total_jam_keseluruhan_he2: { label:'Total Jam (Keseluruhan)', type:'number' },
  total_jam_bayar_he2: { label:'Total Jam (Bayar)', type:'number' },
  hm_awal_he2: { label:'HM Awal', type:'number' },
  hm_akhir_he2: { label:'HM Akhir', type:'number' },
  potongan_hm_he2: { label:'Potongan HM', type:'number' },
  hm_hari_ini_he2: { label:'HM Hari Ini', type:'number', required:true },
  hm_ha_he2: { label:'HM/Ha', type:'number' },
  jumlah_liter_he2: { label:'Jumlah Liter (BBM)', type:'number' },
  ltr_hm_he2: { label:'Ltr/HM', type:'number' },
});

state[PHE_TABLE] = { data:[], loaded:false };
state.produktivitas_he_rental = {
  search:'', sortKey:'tanggal', sortDir:'desc', page:1, pageSize:14,
  filterUnit:'', filterKontraktor:'', filterJenisUnit:'', filterDari:'', filterSampai:'', filterPanelOpen:false,
};
state.produktivitas_he_internal = {
  search:'', sortKey:'tanggal', sortDir:'desc', page:1, pageSize:14,
  filterUnit:'', filterJenisUnit:'', filterDari:'', filterSampai:'', filterPanelOpen:false,
};

async function ensurePHEData(){
  const st = state[PHE_TABLE];
  if(st.loaded) return st.data;
  const { data, error } = await supa.from(PHE_TABLE).select('*').order('tanggal', { ascending:false });
  if(error){ toast('Gagal memuat Produktivitas HE: ' + error.message, true); return []; }
  st.data = data || [];
  st.loaded = true;
  return st.data;
}
function pheRowsForMode(allRows, mode){
  return allRows.filter(r=>{
    const k = (r.kontraktor_he2||'').toString().trim().toUpperCase();
    return mode === 'rental' ? (k === 'PT. HKL' || k === 'PT. PRN') : k === 'INTERNAL';
  });
}

async function renderProduktivitasHERental(){
  $('#pageEyebrow').textContent = 'PRODUKTIVITAS · HE';
  $('#pageTitle').textContent = 'Produktivitas HE — Rental (PT. HKL & PT. PRN)';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensurePHEData();
  paintProduktivitasHE(rows, 'rental');
}
async function renderProduktivitasHEInternal(){
  $('#pageEyebrow').textContent = 'PRODUKTIVITAS · HE';
  $('#pageTitle').textContent = 'Produktivitas HE — Internal';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensurePHEData();
  paintProduktivitasHE(rows, 'internal');
}

function pheModuleKey(){ return 'produktivitas_he'; }
function pheStateKey(mode){ return mode === 'rental' ? 'produktivitas_he_rental' : 'produktivitas_he_internal'; }

function resetPHEFilters(mode){
  const st = state[pheStateKey(mode)];
  st.filterUnit=''; st.filterKontraktor=''; st.filterJenisUnit=''; st.filterDari=''; st.filterSampai='';
  st.page = 1;
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
}
function togglePHEFilterPanel(mode){
  state[pheStateKey(mode)].filterPanelOpen = !state[pheStateKey(mode)].filterPanelOpen;
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
}
function sortPHE(mode, key){
  const st = state[pheStateKey(mode)];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
}
function changePHEPage(mode, delta){
  state[pheStateKey(mode)].page += delta;
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
}

// Agregasi per Kode Unit -> meniru sheet "Mont. HM" (Target/Realisasi/HM per
// Ha/HK/To Date/Balance/Breakdown/% Avaibility/% Utility), dihitung dari log
// harian, bukan diinput manual.
function pheAggregateByUnit(rows, mode){
  const byUnit = {};
  rows.forEach(r=>{
    const u = (r.kode_unit_he || '(tanpa kode)').toString().trim() || '(tanpa kode)';
    if(!byUnit[u]) byUnit[u] = {
      unit:u, jenis: r.jenis_unit_he2 || '-', kontraktor: r.kontraktor_he2 || '-',
      hk:0, hmActual:0, luasWo:0, breakdown:0, liter:0,
      _hariSet:new Set(), _hariBreakdownSet:new Set(), _hmHaSum:0, _hmHaCount:0,
    };
    const b = byUnit[u];
    const hariKey = (r.tanggal===null||r.tanggal===undefined||r.tanggal==='') ? null : r.tanggal.toString().trim();
    if(hariKey) b._hariSet.add(hariKey); else b.hk++; // fallback: tanpa tanggal tetap kehitung per-row spy tidak hilang
    b.hmActual += (parseFloat(r.hm_hari_ini_he2) || 0);
    b.luasWo += (parseFloat(r.luas_wo) || 0);
    b.liter += (parseFloat(r.jumlah_liter_he2) || 0);
    // HM/Ha: rata-rata dari nilai yang benar-benar terisi di log (sama seperti kolom HM/Ha di tabel bawah)
    const hmHaVal = parseFloat(r.hm_ha_he2);
    if(r.hm_ha_he2 !== null && r.hm_ha_he2 !== undefined && r.hm_ha_he2 !== '' && !isNaN(hmHaVal)){
      b._hmHaSum += hmHaVal; b._hmHaCount++;
    }
    const isBreakdown = /breakdown/i.test(r.kegiatan_wo_he2||'') || /breakdown/i.test(r.pekerjaan_he2||'') || !(parseFloat(r.hm_hari_ini_he2) > 0);
    if(isBreakdown){ if(hariKey) b._hariBreakdownSet.add(hariKey); else b.breakdown++; }
  });
  return Object.values(byUnit).map(b=>{
    b.hk += b._hariSet.size;
    b.breakdown += b._hariBreakdownSet.size;
    const hmHaSum = b._hmHaSum, hmHaCount = b._hmHaCount;
    delete b._hariSet; delete b._hariBreakdownSet; delete b._hmHaSum; delete b._hmHaCount;
    const targetHm = b.hk * PHE_TARGET_HM_PER_DAY;
    const balance = b.hmActual - targetHm;
    const pct = targetHm ? Math.round(b.hmActual/targetHm*100) : 0;
    const pctAvaibility = b.hk ? Math.round((b.hk - b.breakdown) / b.hk * 100) : 0;
    const hmHa = hmHaCount ? Math.round((hmHaSum/hmHaCount)*100)/100 : 0;
    const ltrHm = b.hmActual ? Math.round((b.liter/b.hmActual)*100)/100 : 0;
    return { ...b, targetHm, balance, pct, pctAvaibility, pctUtility: pct, hmHa, ltrHm };
  }).sort((a,b)=> b.hmActual - a.hmActual);
}

function paintProduktivitasHE(allRowsRaw, mode){
  const st = state[pheStateKey(mode)];
  const allRows = pheRowsForMode(allRowsRaw, mode);

  const unitOptions = uniqueValues(allRows, 'kode_unit_he');
  const jenisOptions = uniqueValues(allRows, 'jenis_unit_he2');
  const kontraktorOptions = mode === 'rental' ? ['PT. HKL','PT. PRN'] : ['INTERNAL'];
  const filterActive = !!(st.filterUnit || st.filterKontraktor || st.filterJenisUnit || st.filterDari || st.filterSampai);
  const filterCount = [st.filterUnit, st.filterKontraktor, st.filterJenisUnit, st.filterDari, st.filterSampai].filter(Boolean).length;

  let rows = allRows;
  if(st.filterUnit) rows = rows.filter(r => (r.kode_unit_he||'').toString().trim() === st.filterUnit);
  if(mode === 'rental' && st.filterKontraktor) rows = rows.filter(r => (r.kontraktor_he2||'').toString().trim() === st.filterKontraktor);
  if(st.filterJenisUnit) rows = rows.filter(r => (r.jenis_unit_he2||'').toString().trim() === st.filterJenisUnit);
  if(st.filterDari) rows = rows.filter(r => (r.tanggal||'') >= st.filterDari);
  if(st.filterSampai) rows = rows.filter(r => (r.tanggal||'') <= st.filterSampai);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['kode_unit_he','petak','pekerjaan_he2','kegiatan_wo_he2','operator_he2'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  const unitAgg = pheAggregateByUnit(filteredRows, mode);

  // --- KPI ---
  const totalUnit = new Set(filteredRows.map(r=>r.kode_unit_he).filter(Boolean)).size;
  const totalHmActual = filteredRows.reduce((s,r)=>s+(parseFloat(r.hm_hari_ini_he2)||0),0);
  const totalLuasWo = filteredRows.reduce((s,r)=>s+(parseFloat(r.luas_wo)||0),0);
  // Rata-rata HM/Ha: ambil dari kolom HM/Ha yang sudah dihitung per unit di tabel bawah (u.hmHa),
  // bukan dari total HM Actual / total Luas WO seluruh baris.
  const unitsWithHmHa = unitAgg.filter(u=>u.hmHa);
  const avgHmHa = unitsWithHmHa.length ? Math.round((unitsWithHmHa.reduce((s,u)=>s+u.hmHa,0)/unitsWithHmHa.length)*100)/100 : 0;
  const avgAvaibility = unitAgg.length ? Math.round(unitAgg.reduce((s,u)=>s+u.pctAvaibility,0)/unitAgg.length) : 0;
  const avgUtility = unitAgg.length ? Math.round(unitAgg.reduce((s,u)=>s+u.pctUtility,0)/unitAgg.length) : 0;
  const totalBreakdown = unitAgg.reduce((s,u)=>s+u.breakdown,0);
  const totalLiter = filteredRows.reduce((s,r)=>s+(parseFloat(r.jumlah_liter_he2)||0),0);
  const avgLtrHm = totalHmActual ? Math.round((totalLiter/totalHmActual)*100)/100 : 0;

  const hmHaByUnit = {}; unitAgg.forEach(u=>hmHaByUnit[u.unit]=u.hmHa);
  const targetVsRealCategories = unitAgg.map(u=>u.unit);
  const targetVsRealSeries = { 'Target HM': unitAgg.map(u=>u.targetHm), 'HM Actual': unitAgg.map(u=>Math.round(u.hmActual*100)/100) };
  const avaibilityByUnit = {}; unitAgg.forEach(u=>avaibilityByUnit[u.unit]=u.pctAvaibility);
  const ltrHmByUnit = {}; unitAgg.forEach(u=>ltrHmByUnit[u.unit]=u.ltrHm);

  rows = [...rows].sort((a,b)=>{
    let av = a[st.sortKey] ?? '', bv = b[st.sortKey] ?? '';
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const pageStartNo = (st.page-1)*st.pageSize;

  const listCols = mode === 'rental' ? PHE_LIST_COLUMNS_RENTAL : PHE_LIST_COLUMNS_INTERNAL;
  const idPrefix = mode === 'rental' ? 'pher' : 'phei';

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Data mengikuti struktur sheet <b>Report</b> (Daily Report Alat Berat), 1 baris = 1 unit / 1 hari / 1 kegiatan.
        Modul ini menampilkan baris dengan Kontraktor <b>${mode==='rental' ? 'PT. HKL & PT. PRN (Rental)' : 'INTERNAL'}</b> saja.
        Analisa per unit (Target HM/Hari, HK, HM Actual, Balance, % Avaibility, % Utility, HM/Ha${mode==='internal' ? ', Ltr/HM' : ''}) dihitung otomatis dari log harian, meniru sheet "Mont. HM".
      </div>
    </div>

    <div class="kpi-grid">
      ${kpiCard('Jumlah Unit', totalUnit, filterActive ? 'unit (sesuai filter)' : 'unit tercatat', 'var(--accent-gold)')}
      ${kpiCard('Total HM Actual', fmtNum(totalHmActual,2), 'akumulasi HM hari ini', 'var(--accent-blue)')}
      ${kpiCard('Rata-rata HM/Ha', fmtNum(avgHmHa,2), 'realisasi HM per Ha', 'var(--accent-green)')}
      ${mode === 'internal'
        ? kpiCard('Rata-rata Ltr/HM', fmtNum(avgLtrHm,2), `total BBM ${fmtNum(totalLiter,0)} Ltr`, 'var(--accent-red)')
        : kpiCard('% Avaibility', avgAvaibility+'%', `${totalBreakdown} hari breakdown/standby`, 'var(--accent-red)')}
      ${kpiCard('% Utility', avgUtility+'%', 'HM Actual vs Target HM', 'var(--accent-blue)')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">HM/Ha per Unit</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_${idPrefix}_hmha"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Target HM vs HM Actual (To Date) per Unit</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_${idPrefix}_target"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">% Avaibility per Unit</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_${idPrefix}_avail"></canvas></div></div></div>
      ${mode === 'internal' ? `
      <div class="card"><div class="card-header"><span class="card-title">Ltr/HM per Unit (BBM)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_${idPrefix}_ltrhm"></canvas></div></div></div>
      ` : `
      <div class="card"><div class="card-header"><span class="card-title">Kontraktor (jumlah baris log)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_${idPrefix}_kontraktor"></canvas></div></div></div>
      `}
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><span class="card-title">Analisa per Unit (meniru Mont. HM)</span></div>
      <div class="card-body" style="padding:0;">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Kode Unit</th><th>Jenis</th><th>Kontraktor</th><th>HK</th>
              <th>HM Actual</th><th>Target HM</th><th>Balance</th>
              <th>Breakdown/Standby</th><th>% Avaibility</th><th>% Utility</th><th>HM/Ha</th>
              ${mode==='internal' ? '<th>Ltr/HM</th>' : ''}
            </tr></thead>
            <tbody>
              ${unitAgg.length===0 ? `<tr><td colspan="${mode==='internal'?12:11}"><div class="empty-state">Belum ada data.</div></td></tr>` :
                unitAgg.map(u=>`<tr>
                  <td>${esc(u.unit)}</td>
                  <td>${esc(u.jenis)}</td>
                  <td>${esc(u.kontraktor)}</td>
                  <td>${u.hk}</td>
                  <td>${fmtNum(u.hmActual,2)}</td>
                  <td>${fmtNum(u.targetHm,0)}</td>
                  <td style="color:${u.balance<0?'var(--accent-red)':'var(--accent-green)'}">${fmtNum(u.balance,2)}</td>
                  <td>${u.breakdown}</td>
                  <td>${badgeForStatus(u.pctAvaibility>=90?'Baik':(u.pctAvaibility>=70?'Cukup':'Kurang'))} <span style="font-family:var(--font-mono); font-size:11.5px;">${u.pctAvaibility}%</span></td>
                  <td>${badgeForStatus(u.pctUtility>=90?'Baik':(u.pctUtility>=70?'Cukup':'Kurang'))} <span style="font-family:var(--font-mono); font-size:11.5px;">${u.pctUtility}%</span></td>
                  <td>${fmtNum(u.hmHa,2)}</td>
                  ${mode==='internal' ? `<td>${fmtNum(u.ltrHm,2)}</td>` : ''}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Log Harian ${mode==='rental'?'Rental':'Internal'} (${rows.length} baris)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari Unit/Petak/Pekerjaan…" id="searchInput_${idPrefix}" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="togglePHEFilterPanel('${mode}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetPHEFilters('${mode}')" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportPHE('${mode}')" title="Import dari file Excel (sheet Report): kolom sesuai Daily Report Alat Berat.">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX (Report)
          </button>
          <input type="file" id="importFilePHE_${idPrefix}" accept=".xlsx,.xls,.xlsb" class="hidden" onchange="handleImportProduktivitasHE(this)">` : ''}
          ${canEditModule(pheModuleKey()) ? `<button class="btn btn-primary btn-sm" onclick="openPHEModal('${mode}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterUnit_${idPrefix}">
          <option value="">Kode Unit: Semua</option>
          ${unitOptions.map(k=>`<option value="${esc(k)}" ${st.filterUnit===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        ${mode==='rental' ? `
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKontraktor_${idPrefix}">
          <option value="">Kontraktor: Semua</option>
          ${kontraktorOptions.map(k=>`<option value="${esc(k)}" ${st.filterKontraktor===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>` : ''}
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterJenisUnit_${idPrefix}">
          <option value="">Jenis Unit: Semua</option>
          ${jenisOptions.map(k=>`<option value="${esc(k)}" ${st.filterJenisUnit===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <input type="date" class="input" style="padding:6px 9px; font-size:12px; max-width:150px;" id="filterDari_${idPrefix}" value="${esc(st.filterDari)}" title="Dari tanggal">
        <input type="date" class="input" style="padding:6px 9px; font-size:12px; max-width:150px;" id="filterSampai_${idPrefix}" value="${esc(st.filterSampai)}" title="Sampai tanggal">
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${listCols.map(c => `<th onclick="sortPHE('${mode}','${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${listCols.length+2}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r,i) => `<tr>
                <td>${pageStartNo + i + 1}</td>
                ${listCols.map(c => {
                  if(c==='hm_ha_he2' || c==='ltr_hm_he2' || c==='hasil' || c==='hm_hari_ini_he2' || c==='jumlah_liter_he2') return `<td>${r[c]==null?'–':fmtNum(r[c], 2)}</td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openPHEModal('${mode}',${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule(pheModuleKey()) ? `<button class="btn btn-danger btn-sm" onclick="confirmDeletePHE('${mode}',${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changePHEPage('${mode}',-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changePHEPage('${mode}',1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  $('#searchInput_'+idPrefix)?.addEventListener('input', debounce(function(){
    st.search = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode);
    setTimeout(()=>{ const inp = $('#searchInput_'+idPrefix); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));
  $('#filterUnit_'+idPrefix)?.addEventListener('change', function(){ st.filterUnit = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode); });
  $('#filterKontraktor_'+idPrefix)?.addEventListener('change', function(){ st.filterKontraktor = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode); });
  $('#filterJenisUnit_'+idPrefix)?.addEventListener('change', function(){ st.filterJenisUnit = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode); });
  $('#filterDari_'+idPrefix)?.addEventListener('change', function(){ st.filterDari = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode); });
  $('#filterSampai_'+idPrefix)?.addEventListener('change', function(){ st.filterSampai = this.value; st.page = 1; paintProduktivitasHE(state[PHE_TABLE].data, mode); });

  drawHBar('chart_'+idPrefix+'_hmha', hmHaByUnit);
  drawGroupedBar('chart_'+idPrefix+'_target', targetVsRealCategories, targetVsRealSeries, ['#5B8FA8','#D9A94A']);
  drawHBar('chart_'+idPrefix+'_avail', avaibilityByUnit);
  if(mode === 'internal') drawHBar('chart_'+idPrefix+'_ltrhm', ltrHmByUnit);
  else drawDonut('chart_'+idPrefix+'_kontraktor', aggregateCount(filteredRows, 'kontraktor_he2'));
}

function openPHEModal(mode, id){
  const record = id ? state[PHE_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule(pheModuleKey());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — Produktivitas HE (${mode==='rental'?'Rental':'Internal'})</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormPHE" class="form-grid">
          ${PHE_COLUMNS.map(col => fieldHTML(col, record ? record[col] : (col==='kontraktor_he2' ? (mode==='internal'?'INTERNAL':'') : ''), readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="savePHE('${mode}',${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function savePHE(mode, id){
  const form = $('#recordFormPHE');
  const payload = {};
  PHE_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.kode_unit_he){ toast('Kolom Kode Unit wajib diisi', true); return; }
  if(!payload.tanggal){ toast('Kolom Tanggal wajib diisi', true); return; }
  if(!payload.kontraktor_he2){ toast('Kolom Kontraktor wajib diisi', true); return; }
  if(payload.hm_hari_ini_he2 === null || payload.hm_hari_ini_he2 === undefined || isNaN(payload.hm_hari_ini_he2)){ toast('Kolom HM Hari Ini wajib diisi', true); return; }
  // HM/Ha & Ltr/HM dihitung otomatis kalau kosong (mengikuti rumus sheet Report)
  if((payload.hm_ha_he2===null || payload.hm_ha_he2===undefined) && payload.luas_wo) payload.hm_ha_he2 = Math.round((payload.hm_hari_ini_he2/payload.luas_wo)*100)/100;
  if((payload.ltr_hm_he2===null || payload.ltr_hm_he2===undefined) && payload.jumlah_liter_he2 && payload.hm_hari_ini_he2) payload.ltr_hm_he2 = Math.round((payload.jumlah_liter_he2/payload.hm_hari_ini_he2)*100)/100;
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(PHE_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(PHE_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: PHE_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kode_unit_he] });
  closeModal();
  state[PHE_TABLE].loaded = false;
  await ensurePHEData();
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
  refreshAllCounts();
}

function confirmDeletePHE(mode, id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris log Produktivitas HE akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeletePHE('${mode}',${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeletePHE(mode, id){
  const rec = state[PHE_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(PHE_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: PHE_TABLE, action:'hapus', petakList: [rec?.kode_unit_he] });
  state[PHE_TABLE].loaded = false;
  await ensurePHEData();
  paintProduktivitasHE(state[PHE_TABLE].data, mode);
  refreshAllCounts();
}

function triggerImportPHE(mode){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  const idPrefix = mode === 'rental' ? 'pher' : 'phei';
  _pheImportMode = mode;
  $('#importFilePHE_'+idPrefix).click();
}
let _pheImportMode = 'rental';

// Peta header sheet "Report" (dinormalisasi huruf kecil, spasi dirapikan) -> kolom database
function pheNormalizeHeader(s){
  return (s ?? '').toString().trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const PHE_HEADER_MAP = {
  [pheNormalizeHeader('Tanggal')]: 'tanggal',
  [pheNormalizeHeader('Lokasi')]: 'lokasi_he2',
  [pheNormalizeHeader('Petak')]: 'petak',
  [pheNormalizeHeader('Luas WO')]: 'luas_wo',
  [pheNormalizeHeader('NO WO')]: 'no_wo',
  [pheNormalizeHeader('Status Petak')]: 'status_petak_he2',
  [pheNormalizeHeader('Kegiatan WO')]: 'kegiatan_wo_he2',
  [pheNormalizeHeader('Pekerjaan')]: 'pekerjaan_he2',
  [pheNormalizeHeader('Satuan')]: 'satuan',
  [pheNormalizeHeader('Hasil')]: 'hasil',
  [pheNormalizeHeader('HK Produktif')]: 'hk_produktif_he2',
  [pheNormalizeHeader('Kontraktor')]: 'kontraktor_he2',
  [pheNormalizeHeader('Unit')]: 'kode_unit_he',
  [pheNormalizeHeader('Operator')]: 'operator_he2',
  [pheNormalizeHeader('Jam Awal')]: 'jam_awal_he2',
  [pheNormalizeHeader('Jam Akhir')]: 'jam_akhir_he2',
  [pheNormalizeHeader('Total Jam (Keseluruhan)')]: 'total_jam_keseluruhan_he2',
  [pheNormalizeHeader('Total Jam (Bayar)')]: 'total_jam_bayar_he2',
  [pheNormalizeHeader('HM Awal')]: 'hm_awal_he2',
  [pheNormalizeHeader('HM Akhir')]: 'hm_akhir_he2',
  [pheNormalizeHeader('Potongan HM')]: 'potongan_hm_he2',
  [pheNormalizeHeader('HM Hari Ini')]: 'hm_hari_ini_he2',
  [pheNormalizeHeader('Jenis Unit')]: 'jenis_unit_he2',
  [pheNormalizeHeader('HM/Ha')]: 'hm_ha_he2',
  [pheNormalizeHeader('Jumlah Liter')]: 'jumlah_liter_he2',
  [pheNormalizeHeader('Ltr/HM')]: 'ltr_hm_he2',
  [pheNormalizeHeader('Keterangan')]: 'keterangan',
  [pheNormalizeHeader('Pengawas')]: 'pengawas',
};
const PHE_NUMBER_COLUMNS = new Set(['luas_wo','hasil','hk_produktif_he2','total_jam_keseluruhan_he2','total_jam_bayar_he2','hm_awal_he2','hm_akhir_he2','potongan_hm_he2','hm_hari_ini_he2','hm_ha_he2','jumlah_liter_he2','ltr_hm_he2']);

async function handleImportProduktivitasHE(input){
  const mode = _pheImportMode;
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });

      // Cari sheet "Report" (atau sheet manapun yang header-nya cocok: Unit + HM Hari Ini)
      let sheetName = wb.SheetNames.find(n => pheNormalizeHeader(n) === 'report');
      let headerRowIdx = -1, ws = null;
      const candidateNames = sheetName ? [sheetName, ...wb.SheetNames] : wb.SheetNames;
      for(const name of candidateNames){
        const testWs = wb.Sheets[name];
        // PENTING: jangan pakai blankrows:false di sini. Index hasil pencarian ini dipakai
        // sebagai opsi `range` pada sheet_to_json di bawah, yang membaca sheet ASLI
        // (baris kosong tetap dihitung). Kalau blankrows:false dipakai di sini, baris kosong
        // dibuang duluan sehingga index header jadi geser (off-by-N) dan baris yang salah
        // (mis. baris "2026") ikut kebaca sebagai header -> semua kolom jadi __EMPTY_x dan
        // seluruh data ter-skip ("tidak ada yang valid untuk diimpor").
        const raw = XLSX.utils.sheet_to_json(testWs, { header:1, defval:null });
        const idx = raw.findIndex(row => {
          const norm = (row||[]).map(pheNormalizeHeader);
          return norm.includes(pheNormalizeHeader('Unit')) && norm.includes(pheNormalizeHeader('HM Hari Ini'));
        });
        if(idx !== -1){ sheetName = name; headerRowIdx = idx; ws = testWs; break; }
      }
      if(!ws || headerRowIdx === -1){
        hideImportProgress(false);
        toast('Sheet "Report" (kolom Unit, HM Hari Ini, dst) tidak ditemukan pada file ini. Pastikan file masih punya sheet bernama "Report" dengan header persis seperti Daily Report Alat Berat.', true);
        return;
      }

      const json = XLSX.utils.sheet_to_json(ws, { range: headerRowIdx, defval:null });
      if(!json.length){ hideImportProgress(false); toast('Sheet "' + sheetName + '" kosong (tidak ada baris data di bawah header)', true); return; }

      let skippedUnit = 0, skippedHm = 0;
      const payloadRows = [];
      json.forEach(row=>{
        const o = {};
        Object.keys(row).forEach(rawKey=>{
          const col = PHE_HEADER_MAP[pheNormalizeHeader(rawKey)];
          if(!col) return;
          let v = row[rawKey];
          if(col === 'tanggal'){ o[col] = excelSerialToISODate(v); return; }
          if(PHE_NUMBER_COLUMNS.has(col)){
            v = (v === null || v === undefined || v.toString().trim() === '' || v.toString().trim() === '-') ? null : parseFloat(v);
          } else {
            v = (v === null || v === undefined || v.toString().trim() === '') ? null : v.toString().trim();
          }
          o[col] = v;
        });
        if(o.kontraktor_he2) o.kontraktor_he2 = o.kontraktor_he2.toString().trim().toUpperCase();
        if(!o.kode_unit_he){ skippedUnit++; return; }
        if(o.hm_hari_ini_he2 === null || o.hm_hari_ini_he2 === undefined || isNaN(o.hm_hari_ini_he2)){ skippedHm++; return; }
        payloadRows.push(o);
      });

      if(!payloadRows.length){
        hideImportProgress(false);
        toast(`Sheet "${sheetName}" terbaca ${json.length} baris, tapi tidak ada yang valid untuk diimpor (dilewati: ${skippedUnit} tanpa kolom Unit terisi, ${skippedHm} kolom HM Hari Ini kosong/bukan angka). Cek lagi header/isi file.`, true);
        return;
      }

      // Cegah data dobel saat file yang sama/overlap diimpor ulang: baris dengan
      // kombinasi tanggal+unit+kegiatan wo+petak yang sudah ada di-UPDATE, bukan INSERT lagi.
      const rowKey = r => [r.tanggal, r.kode_unit_he, r.kegiatan_wo_he2, r.petak].join('||').toLowerCase();
      await ensurePHEData();
      const existingById = {};
      state[PHE_TABLE].data.forEach(r => { existingById[rowKey(r)] = r.id; });
      const seenInFile = {};
      const toUpdate = [], toInsert = [];
      payloadRows.forEach(p=>{
        p.updated_by = currentUser.id;
        const key = rowKey(p);
        const existingId = seenInFile[key] || existingById[key];
        if(existingId){ toUpdate.push({ id:existingId, payload:p }); seenInFile[key] = existingId; }
        else { toInsert.push({ ...p, created_by: currentUser.id }); }
      });

      const results = await Promise.all([
        ...toInsert.map(p => supa.from(PHE_TABLE).insert(p)),
        ...toUpdate.map(u => supa.from(PHE_TABLE).update(u.payload).eq('id', u.id)),
      ]);
      const failed = results.filter(r=>r.error);
      const success = payloadRows.length - failed.length;
      if(success) await logNotificationGrouped(PHE_TABLE, 'import', payloadRows.slice(0, success));

      let msg = `${toInsert.length} baris ditambahkan, ${toUpdate.length} baris diperbarui`;
      const skippedTotal = skippedUnit + skippedHm;
      if(skippedTotal) msg += `, ${skippedTotal} baris dilewati (Unit/HM Hari Ini kosong)`;
      if(failed.length) msg += `, ${failed.length} gagal${failed[0].error ? ' — ' + failed[0].error.message : ''}`;
      hideImportProgress(true);
      toast(msg, failed.length === payloadRows.length);

      state[PHE_TABLE].loaded = false;
      await ensurePHEData();
      paintProduktivitasHE(state[PHE_TABLE].data, mode);
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
   INTEGRASI: navigate(), refreshCurrentView(), refreshAllCounts(),
   MODULE_PERMISSIONS, STAFF_BLOCKED_VIEWS — dibungkus (wrap), bukan edit
   langsung app.js, supaya modul ini murni addon terpisah.
   --------------------------------------------------------------------- */
MODULE_PERMISSIONS[pheModuleKey()] = { edit:['admin'], del:['admin'] };
if(typeof STAFF_BLOCKED_VIEWS !== 'undefined') STAFF_BLOCKED_VIEWS.push('produktivitas_he_rental','produktivitas_he_internal');

const _pheOrigNavigate = navigate;
navigate = async function(view){
  if(view === 'produktivitas_he_rental'){
    if(currentProfile?.role === 'staff'){ toast('Menu ini tidak tersedia untuk role Staff', true); return _pheOrigNavigate('dashboard'); }
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderProduktivitasHERental();
    return;
  }
  if(view === 'produktivitas_he_internal'){
    if(currentProfile?.role === 'staff'){ toast('Menu ini tidak tersedia untuk role Staff', true); return _pheOrigNavigate('dashboard'); }
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderProduktivitasHEInternal();
    return;
  }
  return _pheOrigNavigate(view);
};

const _pheOrigRefreshCurrentView = refreshCurrentView;
refreshCurrentView = function(){
  if(currentView === 'produktivitas_he_rental' || currentView === 'produktivitas_he_internal') state[PHE_TABLE].loaded = false;
  return _pheOrigRefreshCurrentView();
};

const _pheOrigRefreshAllCounts = refreshAllCounts;
refreshAllCounts = async function(){
  await _pheOrigRefreshAllCounts();
  {
    const { count } = await supa.from(PHE_TABLE).select('id', { count:'exact', head:true }).in('kontraktor_he2', ['PT. HKL','PT. PRN']);
    const el = $('#countBadge_produktivitas_he_rental');
    if(el) el.textContent = count ?? '0';
  }
  {
    const { count } = await supa.from(PHE_TABLE).select('id', { count:'exact', head:true }).eq('kontraktor_he2', 'INTERNAL');
    const el = $('#countBadge_produktivitas_he_internal');
    if(el) el.textContent = count ?? '0';
  }
};
