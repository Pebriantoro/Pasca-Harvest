/* =====================================================================
   MAINTENANCE ON TIME — Due/Overdue tracker aktivitas pasca-tebang.
   Additif, tidak mengubah app.js. Load PALING TERAKHIR (sesudah
   maintenance & data modul lain sudah didefinisikan).

   SUMBER DATA (tidak ada tabel baru — murni dihitung dari data yang
   sudah ada di 4 tabel):
     1) pasca_harvest        -> daftar petak "Done" tebang + tanggal
                                 selesai tebang (kolom `bapp`) + zona/dst.
     2) maintenance_pasca_harvest (MAINTENANCE_TABLE) -> mt_next_action
        ('Ratoon' / 'Replanting Cane') menentukan petak masuk skedul
        Ratoon atau Replanting, plus status tiap aktivitas perawatan
        (mt_stuble_shaving, mt_mechanical_stuble_shaving,
        mt_fertilizing_single_aplication, mt_post_spraying_1/2/3, dst) —
        tabel yang sama ini juga dipakai buat join aktivitas perawatan
        petak Tebang Bibit (lihat poin 4).
     3) rpc_after_giling / extra_planting_after_giling -> status
        MSW/Furrowing/PPS1/PPS2/Planting (aktivitas Land Preparation s.d.
        Planting khusus jalur Replanting). Dipilih berdasarkan
        mt_ket_next_status: 'Extra Planting' -> extra_planting_after_giling,
        selain itu -> rpc_after_giling (dengan fallback ke tabel lain
        kalau petaknya ternyata ada di sana).
     4) tebang_bibit (TB_TABLE) -> daftar petak Tebang Bibit yang
        tb_status_tebang_bibit = 'Done' + tanggal selesai tebang (kolom
        `tb_bapp_tebang_bibit`) jadi baseline jadwal, ditampilkan di tabel
        terpisah "Tebang Bibit" (di antara section Replanting & Ratoon).
        Aktivitas (Post 1, FSA, Post 2, Post 3) diambil LANGSUNG dari
        kolom tb_status_post1/tb_status_fsa/tb_status_post2/tb_status_post3
        di tabel tebang_bibit sendiri (bukan join ke MAINTENANCE_TABLE).

   JADWAL STANDAR (hari dihitung sejak Tanggal Selesai Tebang / `bapp`):
     Replanting: Land Prep=25, Furrow=55, PPS1=85, PPS2=92, Planting=92,
                 Fertilizing=120, Post1=150, Post2=180, Post3(Rayutan)=210
     Ratoon:     Stuble Shaving=7, Post1=42, Post2=72, Fertilizing=77,
                 Post3(Rayutan)=102

   ATURAN STATUS (sesuai arahan): kalau aktivitas masih "Not Yet"/kosong
   DAN tanggal hari ini sudah melewati tanggal jatuh tempo -> OVERDUE.
   Kalau belum lewat -> DUE (H-n). Kalau field aktivitas sudah "Done"
   -> dianggap selesai (tidak dihitung due/overdue).
   Catatan: "Post 3" dianggap selesai kalau kolom mt_post_spraying_3 sudah
   Done. Kolom Weeding Rayutan TIDAK lagi ikut dihitung di sini (sudah
   dilepas dari syarat Post 3, baik di Ratoon maupun Replanting).

   FIX ANOMALI (Stuble Shaving vs Mechanical Stuble Shaving):
   Stuble Shaving (manual) dan Mechanical Stuble Shaving adalah SATU jenis
   kegiatan yang sama, cuma dikerjakan lewat 2 metode berbeda -> di satu
   petak yang sama, cuma salah satu dari dua kolom ini yang boleh "aktif"
   (Progress/Done) pada satu waktu:
     - Kalau mt_stuble_shaving = Done   -> Stuble Shaving = Selesai,
       Mechanical Stuble Shaving dipaksa jadi "Not Mechanical Stuble".
     - Kalau mt_mechanical_stuble_shaving = Done (dan manual belum Done)
       -> Mechanical Stuble Shaving = Selesai, Stuble Shaving dipaksa jadi
       "Not Stuble Shaving".
     - Kalau DUA-DUANYA "Progress" sekaligus (anomali input data) -> kolom
       manual (Stuble Shaving) yang dianggap sumber kebenaran & dipakai,
       kolom Mechanical Stuble Shaving otomatis diturunkan jadi
       "Not Mechanical Stuble". Kalau cuma Mechanical yang Progress
       (manual masih kosong) -> Mechanical yang dipakai, Stuble Shaving
       jadi "Not Stuble Shaving".
   Kolom Mechanical Stuble Shaving juga dikasih label "Hari ke-7" yang
   sama persis dengan Stuble Shaving (bukan lagi tanpa keterangan hari),
   karena keduanya mengacu ke jadwal/kegiatan yang sama.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. DEFINISI JADWAL
   --------------------------------------------------------------------- */
const MOT_SCHEDULE_REPLANTING = [
  { key:'land_prep', label:'Land Preparation',            hari:25,  statusField:'status_msw' },
  { key:'furrow',     label:'Furrow',                      hari:55,  statusField:'status_furrowing' },
  { key:'pps1',       label:'Pre Plant Spraying 1',        hari:85,  statusField:'status_pps1' },
  { key:'pps2',       label:'Pre Plant Spraying 2',        hari:92,  statusField:'status_pps2' },
  { key:'planting',   label:'Planting',                    hari:92,  statusField:'status_planting' },
  { key:'fertilizing',label:'Fertilizing Single Aplication',hari:120, statusField:'mt_fertilizing_single_aplication' },
  { key:'post1',      label:'Post 1',                      hari:150, statusField:'mt_post_spraying_1' },
  { key:'post2',      label:'Post 2',                      hari:180, statusField:'mt_post_spraying_2' },
  { key:'post3',      label:'Post 3',                      hari:210, statusField:'mt_post_spraying_3' },
];
const MOT_SCHEDULE_RATOON = [
  { key:'stuble_shaving', label:'Stuble Shaving',                hari:7,   statusField:'mt_stuble_shaving' },
  { key:'mechanical_stuble_shaving', label:'Mechanical Stuble Shaving', hari:7, statusField:'mt_mechanical_stuble_shaving', infoOnly:true },
  { key:'post1',          label:'Post 1',                         hari:42,  statusField:'mt_post_spraying_1' },
  { key:'post2',          label:'Post 2',                         hari:72,  statusField:'mt_post_spraying_2' },
  { key:'fertilizing',    label:'Fertilizing Single Aplication',  hari:77,  statusField:'mt_fertilizing_single_aplication' },
  { key:'post3',          label:'Post 3',                         hari:102, statusField:'mt_post_spraying_3' },
];
// Petak TEBANG BIBIT: kolom aktivitas ditarik LANGSUNG dari tabel
// tebang_bibit sendiri (bukan join ke MAINTENANCE_TABLE) — datanya udah
// ada di sana: tb_status_post1, tb_status_fsa, tb_status_post2,
// tb_status_post3. Urutan tampil: Post 1, FSA, Post 2, Post 3.
const MOT_SCHEDULE_TEBANG_BIBIT = [
  { key:'tb_post1', label:'Post 1', hari:42,  statusField:'tb_status_post1' },
  { key:'tb_fsa',    label:'FSA',    hari:77,  statusField:'tb_status_fsa' },
  { key:'tb_post2', label:'Post 2', hari:72,  statusField:'tb_status_post2' },
  { key:'tb_post3', label:'Post 3', hari:102, statusField:'tb_status_post3' },
];


/* ---------------------------------------------------------------------
   1. UTIL TANGGAL (lokal ke file ini, hindari isu timezone)
   --------------------------------------------------------------------- */
function motTodayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function motAddDays(iso, n){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+n);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}
function motDiffDays(fromISO, toISO){ // toISO - fromISO, dalam hari
  const [y1,m1,d1]=fromISO.split('-').map(Number);
  const [y2,m2,d2]=toISO.split('-').map(Number);
  return Math.round((Date.UTC(y2,m2-1,d2) - Date.UTC(y1,m1-1,d1)) / 86400000);
}
function motNormPetak(v){ return (v||'').toString().trim().toUpperCase(); }

/* ---------------------------------------------------------------------
   2. STATUS PER AKTIVITAS
   --------------------------------------------------------------------- */
// Stuble Shaving & Mechanical Stuble Shaving = SATU kegiatan yang sama.
// Fungsi ini menentukan mana yang "aktif" (manual atau mechanical) supaya
// dua-duanya gak pernah tampil Progress/Done bersamaan di satu petak.
// Urutan prioritas: manual Done > mechanical Done > manual Progress >
// mechanical Progress. Kalau dua-duanya kebetulan "Progress" sekaligus
// (anomali input), manual (Stuble Shaving) yang dipakai sebagai sumber
// kebenaran, mechanical otomatis diturunkan jadi "Not Mechanical Stuble".
function motStubleCombined(fieldsObj){
  const manual = (fieldsObj.mt_stuble_shaving || '').toString().trim().toLowerCase();
  const mech = (fieldsObj.mt_mechanical_stuble_shaving || '').toString().trim().toLowerCase();
  if(manual === 'done') return { active:'manual', state:'done' };
  if(mech === 'done') return { active:'mechanical', state:'done' };
  if(manual === 'progress') return { active:'manual', state:'progress' };
  if(mech === 'progress') return { active:'mechanical', state:'progress' };
  return { active:null, state:'notyet' };
}
function motActivityStatus(fieldsObj, def, todayISO){
  // Kolom Stuble Shaving & Mechanical Stuble Shaving ditangani lewat resolver
  // gabungan supaya cuma salah satu yang pernah tampil Progress/Done.
  if(def.key === 'stuble_shaving'){
    const c = motStubleCombined(fieldsObj);
    if(c.active === 'mechanical') return { state:'notstuble' }; // "Not Stuble Shaving"
    if(c.active === 'manual') return { state:c.state }; // done / progress
    // belum ada satupun yang jalan -> lanjut ke hitungan Due/Overdue normal (hari:7) di bawah
  } else if(def.key === 'mechanical_stuble_shaving'){
    const c = motStubleCombined(fieldsObj);
    if(c.active === 'manual') return { state:'notmechanical' }; // "Not Mechanical Stuble"
    if(c.active === 'mechanical') return { state:c.state }; // done / progress
    return { state:'notyet' }; // belum ada satupun yang jalan, kolom info aja
  }

  const fields = Array.isArray(def.statusField) ? def.statusField : [def.statusField];
  const vals = fields.map(f => (fieldsObj[f] || '').toString().trim().toLowerCase());
  if(vals.every(v => v === 'done')) return { state:'done' };

  // Kalau salah satu field aktivitas lagi "Progress" -> keterangan ikut Progress,
  // gak dihitung Due/Overdue.
  if(vals.some(v => v === 'progress')) return { state:'progress' };

  // Kolom informasional lain (di luar stuble/mechanical) -> cuma status, tidak ada H-due/Overdue.
  if(def.infoOnly) return { state:'notyet' };

  if(!fieldsObj.bappISO) return { state:'nodata' };
  const due = motAddDays(fieldsObj.bappISO, def.hari);
  const diff = motDiffDays(todayISO, due); // due - today
  if(diff < 0) return { state:'overdue', due, daysDiff:-diff };
  return { state:'due', due, daysDiff:diff };
}
function motBadgeCell(status){
  if(status.state === 'nodata') return `<span class="badge badge-neutral">– BAPP kosong</span>`;
  if(status.state === 'notstuble') return `<span class="badge badge-neutral" title="Sudah dikerjakan lewat Mechanical Stuble Shaving">Not Stuble Shaving</span>`;
  if(status.state === 'notmechanical') return `<span class="badge badge-neutral" title="Sudah/sedang dikerjakan lewat Stuble Shaving manual">Not Mechanical Stuble</span>`;
  if(status.state === 'notyet') return `<span class="badge badge-neutral">Belum Dikerjakan</span>`;
  if(status.state === 'progress') return `<span class="badge badge-progress">Progress</span>`;
  if(status.state === 'done') return `<span class="badge badge-done">Selesai</span>`;
  const dueTxt = `<div style="font-size:10px; color:var(--text-faint); margin-top:2px;">${esc(fmtDateID(status.due))}</div>`;
  if(status.state === 'overdue') return `<div><span class="badge badge-notyet">Overdue ${status.daysDiff}h</span>${dueTxt}</div>`;
  return `<div><span class="badge badge-progress">Due H-${status.daysDiff}</span>${dueTxt}</div>`;
}

/* ---------------------------------------------------------------------
   3. AMBIL & GABUNGKAN DATA
   --------------------------------------------------------------------- */
state.mot = { search:'', onlyOverdue:false, onlyDueSoon:false, loaded:false, replanting:[], tebangBibit:[], ratoon:[], unknown:[] };

async function ensureMotData(){
  const pascaRows = await ensureData('pasca_harvest');
  const doneRows = pascaRows.filter(r => (r.status_progress || '').toString().trim().toLowerCase() === 'done');
  const mtRows = await ensureMaintenanceData();
  const rpcRows = await ensureData('rpc_after_giling');
  const extraRows = await ensureData('extra_planting_after_giling');
  const tbRows = await ensureTebangBibitData();
  const tbDoneRows = tbRows.filter(r => (r.tb_status_tebang_bibit || '').toString().trim().toLowerCase() === 'done');

  const byPetak = (rows) => { const m = {}; rows.forEach(r => { m[motNormPetak(r.petak)] = r; }); return m; };
  const mtByPetak = byPetak(mtRows);
  const rpcByPetak = byPetak(rpcRows);
  const extraByPetak = byPetak(extraRows);

  const replanting = [], ratoon = [], unknown = [];
  doneRows.forEach(pr => {
    const petak = motNormPetak(pr.petak);
    const mt = mtByPetak[petak] || null;
    const bappISO = parseAnyDateToISO(pr.bapp);
    const base = { petak: pr.petak, zona: pr.zona, staff: pr.staff, bapp: pr.bapp, bappISO };
    const nextAction = (mt?.mt_next_action || '').toString().trim().toLowerCase();

    if(nextAction === 'ratoon'){
      ratoon.push({ ...base, fields:{ bappISO, ...(mt||{}) } });
    } else if(nextAction === 'replanting cane'){
      const ketNext = (mt?.mt_ket_next_status || '').toString().trim().toLowerCase();
      let landPrepRow = ketNext === 'extra planting' ? extraByPetak[petak] : rpcByPetak[petak];
      if(!landPrepRow) landPrepRow = rpcByPetak[petak] || extraByPetak[petak] || null;
      replanting.push({ ...base, fields:{ bappISO, ...(landPrepRow||{}), ...(mt||{}) } });
    } else {
      unknown.push(base); // belum diisi Next Action di menu Maintenance
    }
  });

  // Petak TEBANG BIBIT yang sudah "Done" tebang (tb_status_tebang_bibit) —
  // baseline tanggal jadwal dari tb_bapp_tebang_bibit, status aktivitas
  // (Post1/FSA/Post2/Post3) langsung dari row tebang_bibit itu sendiri.
  const tebangBibit = tbDoneRows.map(tr => {
    const bappISO = parseAnyDateToISO(tr.tb_bapp_tebang_bibit);
    return { petak: tr.petak, zona: tr.zona, bapp: tr.tb_bapp_tebang_bibit, bappISO, fields:{ bappISO, ...tr } };
  });

  state.mot.replanting = replanting;
  state.mot.tebangBibit = tebangBibit;
  state.mot.ratoon = ratoon;
  state.mot.unknown = unknown;
  state.mot.loaded = true;
  return state.mot;
}

/* ---------------------------------------------------------------------
   4. RENDER
   --------------------------------------------------------------------- */
function motRowOverdueCount(row, scheduleDefs, todayISO){
  return scheduleDefs.reduce((n, def) => n + (motActivityStatus(row.fields, def, todayISO).state === 'overdue' ? 1 : 0), 0);
}
// Hitung berapa aktivitas di petak ini yang masih "Due" tapi tinggal
// <=10 hari lagi jatuh tempo (H-10 ke bawah, belum overdue).
function motRowDueSoonCount(row, scheduleDefs, todayISO){
  return scheduleDefs.reduce((n, def) => {
    const st = motActivityStatus(row.fields, def, todayISO);
    return n + (st.state === 'due' && st.daysDiff <= 10 ? 1 : 0);
  }, 0);
}
function motSectionHTML(title, rows, scheduleDefs, todayISO, idSuffix){
  const st = state.mot;
  let filtered = rows;
  if(st.search){
    const q = st.search.toLowerCase();
    filtered = filtered.filter(r => (r.petak||'').toLowerCase().includes(q) || (r.zona||'').toLowerCase().includes(q));
  }
  if(st.onlyOverdue){
    filtered = filtered.filter(r => motRowOverdueCount(r, scheduleDefs, todayISO) > 0);
  }
  if(st.onlyDueSoon){
    filtered = filtered.filter(r => motRowDueSoonCount(r, scheduleDefs, todayISO) > 0);
  }
  return `
    <div class="card" style="margin-bottom:18px;">
      <div class="card-header"><span class="card-title">${esc(title)} (${filtered.length} petak)</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Petak</th><th>Zona</th><th>Tgl Selesai Tebang</th>
            ${scheduleDefs.map(d => `<th>${esc(d.label)}${d.hari!=null ? `<div style="font-weight:400; color:var(--text-faint); font-size:10px;">Hari ke-${d.hari}</div>` : ''}</th>`).join('')}
            <th>Overdue</th>
          </tr></thead>
          <tbody>
            ${filtered.length===0 ? `<tr><td colspan="${scheduleDefs.length+4}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              filtered.map(r => {
                const overdueCount = motRowOverdueCount(r, scheduleDefs, todayISO);
                return `<tr>
                  <td><span class="petak-tag">${esc(r.petak)}</span></td>
                  <td>${esc(r.zona)||'–'}</td>
                  <td>${r.bappISO ? esc(fmtDateID(r.bappISO)) : '<span style="color:var(--text-faint)">–</span>'}</td>
                  ${scheduleDefs.map(d => `<td>${motBadgeCell(motActivityStatus(r.fields, d, todayISO))}</td>`).join('')}
                  <td>${overdueCount>0 ? `<span class="badge badge-notyet">${overdueCount}</span>` : `<span class="badge badge-done">0</span>`}</td>
                </tr>`;
              }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}
function motUnknownSectionHTML(rows){
  if(!rows.length) return '';
  return `
    <div class="card" style="margin-bottom:18px;">
      <div class="card-header"><span class="card-title">Belum Ditentukan Next Action (${rows.length} petak)</span></div>
      <div class="card-body" style="font-size:12.5px; color:var(--text-muted); padding-bottom:0;">
        Petak sudah Done tebang tapi kolom <b>Next Action</b> di menu Maintenance belum diisi (Ratoon / Replanting Cane),
        jadi belum bisa ditentukan masuk skedul yang mana.
        ${canEditModule('maintenance') ? `<button class="btn btn-outline btn-sm" style="margin-left:8px;" onclick="navigate('maintenance')">Isi di Menu Maintenance</button>` : ''}
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Petak</th><th>Zona</th><th>Tgl Selesai Tebang</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><span class="petak-tag">${esc(r.petak)}</span></td>
              <td>${esc(r.zona)||'–'}</td>
              <td>${r.bappISO ? esc(fmtDateID(r.bappISO)) : '<span style="color:var(--text-faint)">–</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function paintMaintenanceOnTime(){
  const st = state.mot;
  const todayISO = motTodayISO();
  const totalPetak = st.replanting.length + st.tebangBibit.length + st.ratoon.length + st.unknown.length;
  const overdueReplanting = st.replanting.reduce((s,r)=>s+motRowOverdueCount(r, MOT_SCHEDULE_REPLANTING, todayISO), 0);
  const overdueTebangBibit = st.tebangBibit.reduce((s,r)=>s+motRowOverdueCount(r, MOT_SCHEDULE_TEBANG_BIBIT, todayISO), 0);
  const overdueRatoon = st.ratoon.reduce((s,r)=>s+motRowOverdueCount(r, MOT_SCHEDULE_RATOON, todayISO), 0);

  $('#pageContent').innerHTML = `
    <div class="kpi-grid">
      ${kpiCard('Total Petak Done Tebang', totalPetak, 'sumber: Pasca Harvest & Tebang Bibit', 'var(--accent-gold)')}
      ${kpiCard('Petak Ratoon', st.ratoon.length, 'skedul Ratoon', 'var(--accent-green)')}
      ${kpiCard('Petak Replanting', st.replanting.length, 'skedul Replanting', 'var(--accent-blue)')}
      ${kpiCard('Petak Tebang Bibit', st.tebangBibit.length, 'skedul Tebang Bibit', 'var(--accent-purple, #8b5cf6)')}
      ${kpiCard('Total Aktivitas Overdue', overdueReplanting+overdueTebangBibit+overdueRatoon, `${overdueRatoon} Ratoon · ${overdueReplanting} Replanting · ${overdueTebangBibit} Tebang Bibit`, 'var(--accent-red)')}
    </div>
    <div class="card" style="margin-top:18px; margin-bottom:16px;">
      <div class="card-body" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 18px;">
        <div class="search-box" style="max-width:280px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" placeholder="Cari petak / zona…" id="searchInput_mot" value="${esc(st.search)}">
        </div>
        <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-muted); cursor:pointer;">
          <input type="checkbox" id="onlyOverdue_mot" ${st.onlyOverdue?'checked':''}> Hanya tampilkan yang ada Overdue
        </label>
        <label style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-muted); cursor:pointer;">
          <input type="checkbox" id="onlyDueSoon_mot" ${st.onlyDueSoon?'checked':''}> Akan Overdue 10 Hari Lagi
        </label>
      </div>
    </div>
    ${motSectionHTML('Replanting', st.replanting, MOT_SCHEDULE_REPLANTING, todayISO)}
    ${motSectionHTML('Tebang Bibit', st.tebangBibit, MOT_SCHEDULE_TEBANG_BIBIT, todayISO)}
    ${motSectionHTML('Ratoon', st.ratoon, MOT_SCHEDULE_RATOON, todayISO)}
    ${motUnknownSectionHTML(st.unknown)}
  `;

  $('#searchInput_mot').addEventListener('input', debounce(function(){
    st.search = this.value;
    paintMaintenanceOnTime();
    setTimeout(()=>{ const inp = $('#searchInput_mot'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));
  $('#onlyOverdue_mot').addEventListener('change', function(){ st.onlyOverdue = this.checked; paintMaintenanceOnTime(); });
  $('#onlyDueSoon_mot').addEventListener('change', function(){ st.onlyDueSoon = this.checked; paintMaintenanceOnTime(); });

  const badge = $('#countBadge_maintenance_on_time');
  if(badge){
    const totalOverdue = overdueReplanting + overdueRatoon;
    badge.textContent = totalOverdue > 99 ? '99+' : String(totalOverdue);
    badge.classList.toggle('hidden', totalOverdue === 0);
  }
}

async function renderMaintenanceOnTime(){
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'Maintenance On Time';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  await ensureMotData();
  paintMaintenanceOnTime();
}

/* ---------------------------------------------------------------------
   5. OVERRIDE navigate() — routing view 'maintenance_on_time'
   --------------------------------------------------------------------- */
const _prevNavigateMot = navigate;
navigate = async function(view){
  if(view === 'maintenance_on_time'){
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
    await renderMaintenanceOnTime();
    return;
  }
  return _prevNavigateMot(view);
};

/* Refresh (tombol reload topbar) — pastikan sumber data ikut dimuat ulang */
const _prevRefreshMot = refreshCurrentView;
refreshCurrentView = function(){
  if(currentView === 'maintenance_on_time'){
    state['pasca_harvest'].loaded = false;
    state['rpc_after_giling'].loaded = false;
    state['extra_planting_after_giling'].loaded = false;
    state[MAINTENANCE_TABLE].loaded = false;
    state[TB_TABLE].loaded = false;
    state.mot.loaded = false;
  }
  _prevRefreshMot();
};

/* ---------------------------------------------------------------------
   6. INJECT nav-item ke sidebar (di dalam section "Menu Data", tepat
      sesudah item "Maintenance")
   --------------------------------------------------------------------- */
(function injectMotNavItem(){
  const maintenanceItem = document.querySelector('.nav-item[data-view="maintenance"]');
  if(!maintenanceItem) return;
  const a = document.createElement('a');
  a.className = 'nav-item';
  a.dataset.view = 'maintenance_on_time';
  a.setAttribute('onclick', "navigate('maintenance_on_time')");
  a.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>
    <span>Maintenance On Time</span><span class="count-badge hidden" id="countBadge_maintenance_on_time">–</span>
  `;
  maintenanceItem.insertAdjacentElement('afterend', a);
})();
