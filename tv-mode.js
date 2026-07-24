/* =====================================================================
   TV MODE — Dashboard putar-otomatis untuk layar TV kantor / ruang rapat.
   File ini di-load SETELAH app.js & estate2-addons.js (lihat index.html),
   jadi memakai ulang supa, TABLES, ensureData, esc, $, $all, currentProfile,
   getUserZonaRestriction, dst. Bersifat ADDITIF — tidak mengubah file lain,
   hanya menambah 1 tombol menu + 1 overlay full-layar.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. STYLE
   --------------------------------------------------------------------- */
(function injectTvStyles(){
  const css = `
    #tvModeOverlay{
      position:fixed; inset:0; z-index:9999; background:
        radial-gradient(circle at 85% -10%, rgba(95,174,125,0.16), transparent 55%),
        radial-gradient(circle at -10% 110%, rgba(217,169,74,0.10), transparent 50%),
        var(--bg, #12201A);
      display:none; flex-direction:column; padding:3.2vh 4vw 2.4vh; box-sizing:border-box;
      font-family: var(--font-body, 'Inter', sans-serif); color: var(--text-primary, #EDEBE2);
    }
    #tvModeOverlay.show{ display:flex; }
    .tv-topbar{ display:flex; align-items:center; justify-content:space-between; margin-bottom:2.2vh; flex-shrink:0; }
    .tv-brand{ display:flex; align-items:center; gap:14px; }
    .tv-brand-dot{ width:12px; height:12px; border-radius:50%; background:var(--accent-green,#5FAE7D); box-shadow:0 0 0 5px rgba(95,174,125,.18); animation: tvPulse 1.8s infinite ease-in-out; }
    @keyframes tvPulse{ 0%,100%{ opacity:1 } 50%{ opacity:.45 } }
    .tv-brand-text{ font-family:var(--font-display,'Space Grotesk',sans-serif); font-size:15px; letter-spacing:2px; color:var(--text-muted,#93A79A); font-weight:600; text-transform:uppercase; }
    .tv-clock{ font-family:var(--font-mono,'IBM Plex Mono',monospace); font-size:15px; color:var(--text-muted,#93A79A); }
    .tv-exit{ position:absolute; top:2.4vh; right:3.2vw; background:var(--bg-card,#1B2A23); border:1px solid var(--border,#253830);
      color:var(--text-muted,#93A79A); width:38px; height:38px; border-radius:50%; cursor:pointer; font-size:16px;
      display:flex; align-items:center; justify-content:center; opacity:.55; transition:opacity .2s; }
    .tv-exit:hover{ opacity:1; color:var(--text-primary,#EDEBE2); }
    .tv-eyebrow{ font-family:var(--font-display,'Space Grotesk',sans-serif); font-size:14px; letter-spacing:3px; color:var(--accent-gold,#D9A94A); font-weight:700; text-transform:uppercase; margin:0 0 .6vh; }
    .tv-title{ font-family:var(--font-display,'Space Grotesk',sans-serif); font-size:clamp(26px,3.6vw,46px); font-weight:700; margin:0 0 2vh; color:var(--text-primary,#EDEBE2); }
    .tv-stage{ flex:1; min-height:0; display:flex; flex-direction:column; }
    .tv-slide{ flex:1; min-height:0; display:none; flex-direction:column; animation: tvFade .5s ease; }
    .tv-slide.active{ display:flex; }
    @keyframes tvFade{ from{ opacity:0; transform:translateY(6px);} to{ opacity:1; transform:translateY(0);} }
    .tv-kpi-row{ display:grid; grid-template-columns:repeat(4,1fr); gap:1.4vw; margin-bottom:2vh; }
    .tv-kpi-row.tv-kpi-3{ grid-template-columns:repeat(3,1fr); }
    .tv-kpi-card{ background:var(--bg-card,#1B2A23); border:1px solid var(--border,#253830); border-radius:16px; padding:2.2vh 1.6vw; position:relative; box-shadow:0 0 0 1px rgba(217,169,74,.14), 0 0 26px -12px rgba(217,169,74,.22); transition:box-shadow .25s ease; }
    .tv-kpi-card:has(.tv-kpi-value.gold){ box-shadow:0 0 0 1px rgba(217,169,74,.4), 0 0 34px -8px rgba(217,169,74,.4); }
    .tv-kpi-card:has(.tv-kpi-value.red){ box-shadow:0 0 0 1px rgba(240,163,146,.4), 0 0 34px -8px rgba(240,163,146,.35); }
    .tv-kpi-card:has(.tv-kpi-value.green){ box-shadow:0 0 0 1px rgba(95,174,125,.4), 0 0 34px -8px rgba(95,174,125,.35); }
    .tv-kpi-label{ font-size:13px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-muted,#93A79A); font-weight:600; margin-bottom:1vh; }
    .tv-kpi-value{ font-family:var(--font-display,'Space Grotesk',sans-serif); font-size:clamp(32px,4.2vw,58px); font-weight:700; color:var(--text-primary,#EDEBE2); line-height:1; }
    .tv-kpi-sub{ font-size:13.5px; color:var(--text-faint,#5E7268); margin-top:.9vh; }
    .tv-kpi-value.gold{ color:var(--accent-gold,#D9A94A); }
    .tv-kpi-value.red{ color:var(--accent-red-text,#F0A392); }
    .tv-kpi-value.green{ color:var(--accent-green,#5FAE7D); }
    .tv-body-grid{ flex:1; min-height:0; display:grid; grid-template-columns:1.3fr 1fr; gap:1.6vw; }
    .tv-body-grid.tv-single{ grid-template-columns:1fr; }
    .tv-panel{ background:var(--bg-card,#1B2A23); border:1px solid var(--border,#253830); border-radius:16px; padding:2vh 1.6vw; min-height:0; display:flex; flex-direction:column; }
    .tv-panel-label{ font-size:13px; letter-spacing:1.5px; text-transform:uppercase; color:var(--text-muted,#93A79A); font-weight:600; margin-bottom:1.4vh; flex-shrink:0; }
    .tv-panel-chart{ flex:1; min-height:0; position:relative; }
    .tv-notes{ flex:1; min-height:0; overflow:hidden; display:flex; flex-direction:column; gap:1.4vh; }
    .tv-note{ display:flex; gap:12px; align-items:flex-start; }
    .tv-note-bar{ width:5px; border-radius:3px; flex-shrink:0; align-self:stretch; background:var(--accent-gold,#D9A94A); }
    .tv-note.alert .tv-note-bar{ background:var(--accent-red,#C1543C); }
    .tv-note.ok .tv-note-bar{ background:var(--accent-green,#5FAE7D); }
    .tv-note-title{ font-weight:700; font-size:16px; color:var(--text-primary,#EDEBE2); margin-bottom:2px; }
    .tv-note-desc{ font-size:14px; color:var(--text-muted,#93A79A); line-height:1.4; }
    .tv-dots{ display:flex; justify-content:center; gap:10px; margin-top:2.2vh; flex-shrink:0; }
    .tv-dot{ width:9px; height:9px; border-radius:50%; background:var(--border,#253830); cursor:pointer; transition:background .2s, transform .2s; }
    .tv-dot.active{ background:var(--accent-gold,#D9A94A); transform:scale(1.25); }
    .tv-progress{ position:fixed; top:0; left:0; height:3px; background:var(--accent-gold,#D9A94A); z-index:10000; transition:width linear; }
    .tv-loading{ position:fixed; inset:0; z-index:9998; background:var(--bg,#12201A); display:flex; align-items:center; justify-content:center; color:var(--text-muted,#93A79A); font-family:var(--font-display); font-size:16px; letter-spacing:2px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

/* ---------------------------------------------------------------------
   1. ROW "MODE TV" DI PANEL PENGATURAN
   --------------------------------------------------------------------- */
function injectTvModeButton(){
  const panel = document.getElementById('settingsPanel');
  if(!panel || document.getElementById('settingsTvModeBtn')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'settingsTvModeBtn';
  btn.className = 'settings-row';
  btn.title = 'Buka/tutup dashboard mode TV layar penuh';
  btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg><span>Mode TV</span><span class="ui-switch" id="tvModeSwitch" role="switch" aria-checked="false" aria-label="Mode TV"></span>`;
  btn.onclick = () => {
    if(TV_STATE.open){
      closeTvMode();
    } else {
      const wrap = document.getElementById('settingsWrap'); wrap?.classList.remove('open');
      document.getElementById('settingsPanel')?.classList.add('hidden');
      openTvMode();
    }
    syncTvModeSwitch();
  };
  panel.appendChild(btn);
}
function syncTvModeSwitch(){
  const sw = document.getElementById('tvModeSwitch');
  if(!sw) return;
  sw.classList.toggle('on', !!TV_STATE.open);
  sw.setAttribute('aria-checked', String(!!TV_STATE.open));
}
document.addEventListener('DOMContentLoaded', injectTvModeButton);
injectTvModeButton();
const _tvSettingsWatcher = setInterval(() => { if(document.getElementById('settingsPanel')){ injectTvModeButton(); clearInterval(_tvSettingsWatcher); } }, 300);

/* ---------------------------------------------------------------------
   2. STATE & HELPERS
   --------------------------------------------------------------------- */
const TV_STATE = { open:false, slideIndex:0, timer:null, progressTimer:null, refreshTimer:null, charts:[], data:null };
const TV_SLIDE_SECONDS = 14;
const TV_REFRESH_MINUTES = 5;

function tvNum(v){
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g,''));
  return isNaN(n) ? null : n;
}
function tvFmt(n, d=0){
  if(n === null || n === undefined || isNaN(n)) return '–';
  return n.toLocaleString('id-ID', { minimumFractionDigits:d, maximumFractionDigits:d });
}
function tvColor(varName, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(varName);
  return v ? v.trim() : fallback;
}

/* ---------------------------------------------------------------------
   3. AMBIL & OLAH DATA
   --------------------------------------------------------------------- */
async function tvLoadData(){
  const [ph, ratoon, blanking, maint, actualTk, aset, motor] = await Promise.all([
    ensureData('pasca_harvest'),
    ensureData('ratoon'),
    ensureData('blanking'),
    ensureData(MAINTENANCE_TABLE),
    ensureData(ACTUAL_TK_TABLE),
    ensureData(MONITORING_ASET_TABLE),
    ensureData(MONITORING_MOTOR_TABLE),
  ]);

  let notif = [];
  try{
    const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
    const { data } = await supa.from('notifications').select('action,created_at').gte('created_at', since);
    notif = data || [];
  }catch(e){ notif = []; }

  const withTch = ph.map(r => ({ ...r, _tch: tvNum(r.tch_nett_bapp_2026), _size: tvNum(r.size_rkt) || 0 }));
  const totalPetak = ph.length;
  const totalHa = withTch.reduce((a,r) => a + r._size, 0);
  const tchVals = withTch.map(r => r._tch).filter(v => v !== null);
  const avgTch = tchVals.length ? tchVals.reduce((a,b)=>a+b,0)/tchVals.length : null;
  const below70 = withTch.filter(r => r._tch !== null && r._tch < 70).length;
  const checked = ph.filter(r => (r.status_pengecekan_pasca_hvt||'').toUpperCase() === 'SUDAH').length;

  const zonas = [...new Set(ph.map(r => (r.zona||'-').toUpperCase()))].sort();
  const perZona = zonas.map(z => {
    const rows = withTch.filter(r => (r.zona||'-').toUpperCase() === z);
    const vals = rows.map(r=>r._tch).filter(v=>v!==null);
    return {
      zona: z, petak: rows.length,
      ha: rows.reduce((a,r)=>a+r._size,0),
      avgTch: vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null,
      below70: rows.filter(r=>r._tch!==null && r._tch<70).length,
    };
  });

  const statusCount = { 'Done':0, 'Progress':0, 'Not Yet':0 };
  ph.forEach(r => { const s = r.status_progress || 'Not Yet'; statusCount[s] = (statusCount[s]||0)+1; });

  const kategoriCount = {};
  ph.forEach(r => { if(r.status_pengecekan_pasca_hvt === 'SUDAH'){ const k = r.kategori_pasca_harvest || 'Lainnya'; kategoriCount[k] = (kategoriCount[k]||0)+1; } });

  const ratoonOrder = ['RPC','RC1','RC2','RC3','RC4','RC5','RC6','RC7','RC8','RC9','RC10','RC11'];
  const ratoonCount = {}; ratoonOrder.forEach(k=>ratoonCount[k]=0);
  ratoon.forEach(r => { const s = r.status_petak; if(s && ratoonCount[s]!==undefined) ratoonCount[s]++; });
  const blankingTotal = blanking.length;

  const mtFields = [
    ['mt_stuble_shaving','Stuble Shaving'], ['mt_furrowing','Furrowing'],
    ['mt_mechanical_stuble_shaving','Mech. Stuble Shaving'], ['mt_terra_tyne','Terra Tyne'],
    ['mt_mounding','Mounding'], ['mt_cross_drain','Cross Drain'], ['mt_field_drain','Field Drain'],
    ['mt_mid_drain','Mid Drain'], ['mt_fertilizing_single_aplication','Fertilizing'],
    ['mt_pengendalian_hama_tikus','Hama Tikus'], ['mt_pengendalian_hama_penyakit_tanaman','Hama Penyakit'],
    ['mt_post_spraying_1','Post Spraying 1'], ['mt_post_spraying_2','Post Spraying 2'],
    ['mt_post_spraying_3','Post Spraying 3'], ['mt_weeding_rayutan','Weeding Rayutan'],
  ];
  const mtDone = mtFields.map(([f,label]) => ({
    label, done: maint.filter(r => String(r[f]||'').toLowerCase() === 'done').length,
  })).sort((a,b)=>b.done-a.done);

  const tkRows = actualTk.map(r => ({
    kontraktor: r.kontraktor || '-', zona: r.zona || '-',
    kebutuhan: tvNum(r.kebutuhan_tk) || 0, aktual: tvNum(r.jumlah_aktual_tk) || 0,
  }));
  const tkTotalKebutuhan = tkRows.reduce((a,r)=>a+r.kebutuhan,0);
  const tkTotalAktual = tkRows.reduce((a,r)=>a+r.aktual,0);

  const asetBaik = aset.filter(a => (a.kondisi||'').toLowerCase()==='baik').length;
  const motorBaik = motor.filter(m => (m.kondisi||'').toLowerCase()==='baik').length;

  const notifCount = { tambah:0, import:0, hapus:0, edit:0 };
  notif.forEach(n => { if(notifCount[n.action]!==undefined) notifCount[n.action]++; });

  return {
    totalPetak, totalHa, avgTch, below70, checked, perZona, statusCount, kategoriCount,
    ratoonCount, ratoonOrder, ratoonTotal: ratoon.length, blankingTotal,
    mtDone, mtTotal: maint.length, tkRows, tkTotalKebutuhan, tkTotalAktual,
    asetTotal: aset.length, asetBaik, motorTotal: motor.length, motorBaik,
    notifCount, notifTotal: notif.length,
  };
}

/* ---------------------------------------------------------------------
   4. RENDER SLIDES
   --------------------------------------------------------------------- */
function tvDestroyCharts(){ TV_STATE.charts.forEach(c => { try{ c.destroy(); }catch(e){} }); TV_STATE.charts = []; }

function tvChartDefaults(){
  return {
    ink: tvColor('--text-primary','#EDEBE2'), muted: tvColor('--text-muted','#93A79A'),
    grid: 'rgba(147,167,154,0.12)', green: tvColor('--accent-green','#5FAE7D'),
    gold: tvColor('--accent-gold','#D9A94A'), red: tvColor('--accent-red','#C1543C'),
    redText: tvColor('--accent-red-text','#F0A392'), blue: tvColor('--accent-blue','#5B8FA8'), sage:'#8FAE93',
  };
}

function tvSlideHtml_ringkasan(d){
  const pct = d.totalPetak ? Math.round(d.checked/d.totalPetak*100) : 0;
  return `
    <div class="tv-eyebrow">Ringkasan Eksekutif</div>
    <div class="tv-title">Posisi Kebun Saat Ini</div>
    <div class="tv-kpi-row">
      <div class="tv-kpi-card"><div class="tv-kpi-label">Total Petak</div><div class="tv-kpi-value">${tvFmt(d.totalPetak)}</div><div class="tv-kpi-sub">${tvFmt(d.totalHa,0)} Ha tertanam</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Rata-rata TCH Nett</div><div class="tv-kpi-value green">${d.avgTch!==null?tvFmt(d.avgTch,1):'–'}</div><div class="tv-kpi-sub">Ton cane / hektar</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Pengecekan Selesai</div><div class="tv-kpi-value gold">${pct}%</div><div class="tv-kpi-sub">${tvFmt(d.checked)} dari ${tvFmt(d.totalPetak)} petak</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Di Bawah Target</div><div class="tv-kpi-value red">${tvFmt(d.below70)}</div><div class="tv-kpi-sub">TCH &lt; 70 ton/ha</div></div>
    </div>
    <div class="tv-body-grid">
      <div class="tv-panel"><div class="tv-panel-label">Status Progress Pasca Harvest</div><div class="tv-panel-chart"><canvas id="tvChartStatus"></canvas></div></div>
      <div class="tv-panel"><div class="tv-panel-label">Highlight</div><div class="tv-notes" id="tvNotesRingkasan"></div></div>
    </div>`;
}
function tvRender_ringkasan(d){
  const c = tvChartDefaults();
  const ctx = document.getElementById('tvChartStatus');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'doughnut',
    data:{ labels:['Done','Progress','Not Yet'], datasets:[{ data:[d.statusCount['Done']||0, d.statusCount['Progress']||0, d.statusCount['Not Yet']||0], backgroundColor:[c.green,c.gold,c.sage], borderWidth:0 }] },
    options:{ maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:c.muted, font:{ size:14 }, padding:16 } }, datalabels:{ color:'#12201A', font:{ weight:'700', size:15 }, formatter:v=>v } }, cutout:'62%' },
    plugins:[ChartDataLabels],
  }));
  const kats = Object.entries(d.kategoriCount);
  const box = document.getElementById('tvNotesRingkasan');
  if(box){
    const items = [
      { cls:'ok', t:'Approval berjalan lancar', s:`Seluruh ${tvFmt(d.totalPetak)} petak berstatus disetujui.` },
      { cls:'', t:'Kategori kondisi (dari petak yang sudah dicek)', s: kats.length ? kats.map(([k,v])=>`${k} ${v}`).join(' · ') : 'Belum ada data' },
      { cls: d.below70 > d.totalPetak*0.15 ? 'alert':'', t:`${tvFmt(d.below70)} petak di bawah target TCH`, s:'Sudah tercatat justifikasi keterangannya di sistem.' },
    ];
    box.innerHTML = items.map(i => `<div class="tv-note ${i.cls}"><div class="tv-note-bar"></div><div><div class="tv-note-title">${i.t}</div><div class="tv-note-desc">${i.s}</div></div></div>`).join('');
  }
}

function tvSlideHtml_zona(d){
  return `
    <div class="tv-eyebrow">Progress Lapangan</div>
    <div class="tv-title">Perbandingan Antar Zona</div>
    <div class="tv-body-grid">
      <div class="tv-panel"><div class="tv-panel-label">Rata-rata TCH per Zona (ton/ha)</div><div class="tv-panel-chart"><canvas id="tvChartZonaTch"></canvas></div></div>
      <div class="tv-panel"><div class="tv-panel-label">Ringkasan Zona</div><div class="tv-notes" id="tvNotesZona"></div></div>
    </div>`;
}
function tvRender_zona(d){
  const c = tvChartDefaults();
  const ctx = document.getElementById('tvChartZonaTch');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'bar',
    data:{ labels:d.perZona.map(z=>'Zona '+z.zona), datasets:[{ data:d.perZona.map(z=>z.avgTch?+z.avgTch.toFixed(1):0), backgroundColor:c.green, borderRadius:8, maxBarThickness:90 }] },
    options:{ maintainAspectRatio:false, plugins:{ legend:{ display:false }, datalabels:{ anchor:'end', align:'top', color:c.ink, font:{ weight:'700', size:16 } } },
      scales:{ x:{ ticks:{ color:c.ink, font:{ size:14 } }, grid:{ display:false } }, y:{ ticks:{ color:c.muted }, grid:{ color:c.grid } } } },
    plugins:[ChartDataLabels],
  }));
  const box = document.getElementById('tvNotesZona');
  if(box){
    box.innerHTML = d.perZona.map(z => `
      <div class="tv-note"><div class="tv-note-bar" style="background:${c.gold}"></div>
        <div><div class="tv-note-title">Zona ${z.zona}</div>
        <div class="tv-note-desc">${tvFmt(z.petak)} petak · ${tvFmt(z.ha,0)} Ha · TCH ${z.avgTch?tvFmt(z.avgTch,1):'–'} · ${tvFmt(z.below70)} petak di bawah target</div></div>
      </div>`).join('');
  }
}

function tvSlideHtml_maintenance(d){
  return `
    <div class="tv-eyebrow">Maintenance</div>
    <div class="tv-title">Checklist Kegiatan Pasca Harvest</div>
    <div class="tv-body-grid tv-single">
      <div class="tv-panel"><div class="tv-panel-label">Petak selesai per kegiatan (dari ${tvFmt(d.mtTotal)} petak)</div><div class="tv-panel-chart"><canvas id="tvChartMaint"></canvas></div></div>
    </div>`;
}
function tvRender_maintenance(d){
  const c = tvChartDefaults();
  const top = d.mtDone.slice(0,10);
  const ctx = document.getElementById('tvChartMaint');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'bar',
    data:{ labels:top.map(m=>m.label), datasets:[{ data:top.map(m=>m.done), backgroundColor:c.green, borderRadius:6 }] },
    options:{ indexAxis:'y', maintainAspectRatio:false, plugins:{ legend:{ display:false }, datalabels:{ anchor:'end', align:'end', color:c.ink, font:{ weight:'700', size:13 } } },
      scales:{ x:{ ticks:{ color:c.muted }, grid:{ color:c.grid } }, y:{ ticks:{ color:c.ink, font:{ size:14 } }, grid:{ display:false } } } },
    plugins:[ChartDataLabels],
  }));
}

function tvSlideHtml_ratoon(d){
  return `
    <div class="tv-eyebrow">Umur Tanaman</div>
    <div class="tv-title">Profil Siklus Ratoon</div>
    <div class="tv-kpi-row tv-kpi-3">
      <div class="tv-kpi-card"><div class="tv-kpi-label">Petak Tercatat Ratoon</div><div class="tv-kpi-value">${tvFmt(d.ratoonTotal)}</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Perlu Blanking</div><div class="tv-kpi-value gold">${tvFmt(d.blankingTotal)}</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">RPC (Tanam Baru)</div><div class="tv-kpi-value green">${tvFmt(d.ratoonCount['RPC']||0)}</div></div>
    </div>
    <div class="tv-body-grid tv-single">
      <div class="tv-panel"><div class="tv-panel-label">Distribusi RPC / RC1–RC11</div><div class="tv-panel-chart"><canvas id="tvChartRatoon"></canvas></div></div>
    </div>`;
}
function tvRender_ratoon(d){
  const c = tvChartDefaults();
  const ctx = document.getElementById('tvChartRatoon');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'bar',
    data:{ labels:d.ratoonOrder, datasets:[{ data:d.ratoonOrder.map(k=>d.ratoonCount[k]||0), backgroundColor:c.green, borderRadius:6, maxBarThickness:60 }] },
    options:{ maintainAspectRatio:false, plugins:{ legend:{ display:false }, datalabels:{ anchor:'end', align:'top', color:c.ink, font:{ weight:'700', size:12 } } },
      scales:{ x:{ ticks:{ color:c.ink, font:{ size:12 } }, grid:{ display:false } }, y:{ ticks:{ color:c.muted }, grid:{ color:c.grid } } } },
    plugins:[ChartDataLabels],
  }));
}

function tvSlideHtml_tenagakerja(d){
  const pct = d.tkTotalKebutuhan ? Math.round(d.tkTotalAktual/d.tkTotalKebutuhan*100) : 0;
  return `
    <div class="tv-eyebrow">Tenaga Kerja</div>
    <div class="tv-title">Rencana vs Aktual Kontraktor</div>
    <div class="tv-kpi-row tv-kpi-3">
      <div class="tv-kpi-card"><div class="tv-kpi-label">Kebutuhan Tenaga</div><div class="tv-kpi-value">${tvFmt(d.tkTotalKebutuhan)}</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Aktual di Lapangan</div><div class="tv-kpi-value gold">${tvFmt(d.tkTotalAktual)}</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Pemenuhan</div><div class="tv-kpi-value ${pct<90?'red':'green'}">${pct}%</div></div>
    </div>
    <div class="tv-body-grid tv-single">
      <div class="tv-panel"><div class="tv-panel-label">Per Kontraktor</div><div class="tv-panel-chart"><canvas id="tvChartTk"></canvas></div></div>
    </div>`;
}
function tvRender_tenagakerja(d){
  const c = tvChartDefaults();
  const ctx = document.getElementById('tvChartTk');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'bar',
    data:{ labels:d.tkRows.map(r=>`${r.kontraktor} (${r.zona})`), datasets:[
      { label:'Kebutuhan', data:d.tkRows.map(r=>r.kebutuhan), backgroundColor:c.sage, borderRadius:6 },
      { label:'Aktual', data:d.tkRows.map(r=>r.aktual), backgroundColor:c.gold, borderRadius:6 },
    ]},
    options:{ indexAxis:'y', maintainAspectRatio:false, plugins:{ legend:{ position:'top', labels:{ color:c.muted, font:{ size:13 } } }, datalabels:{ anchor:'end', align:'end', color:c.ink, font:{ weight:'700', size:12 } } },
      scales:{ x:{ ticks:{ color:c.muted }, grid:{ color:c.grid } }, y:{ ticks:{ color:c.ink, font:{ size:13 } }, grid:{ display:false } } } },
    plugins:[ChartDataLabels],
  }));
}

function tvSlideHtml_aset(d){
  return `
    <div class="tv-eyebrow">Aset & Alat Berat</div>
    <div class="tv-title">Kondisi Unit Operasional</div>
    <div class="tv-kpi-row tv-kpi-3">
      <div class="tv-kpi-card"><div class="tv-kpi-label">Aset Terpantau</div><div class="tv-kpi-value">${tvFmt(d.asetTotal)}</div><div class="tv-kpi-sub">${d.asetTotal?Math.round(d.asetBaik/d.asetTotal*100):0}% kondisi Baik</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Unit Motor</div><div class="tv-kpi-value">${tvFmt(d.motorTotal)}</div><div class="tv-kpi-sub">${d.motorTotal?Math.round(d.motorBaik/d.motorTotal*100):0}% kondisi Baik</div></div>
      <div class="tv-kpi-card"><div class="tv-kpi-label">Aktivitas Sistem (7 Hari)</div><div class="tv-kpi-value gold">${tvFmt(d.notifTotal)}</div><div class="tv-kpi-sub">total aksi tercatat</div></div>
    </div>
    <div class="tv-body-grid tv-single">
      <div class="tv-panel"><div class="tv-panel-label">Jenis Aksi Sistem — 7 Hari Terakhir</div><div class="tv-panel-chart"><canvas id="tvChartAktivitas"></canvas></div></div>
    </div>`;
}
function tvRender_aset(d){
  const c = tvChartDefaults();
  const ctx = document.getElementById('tvChartAktivitas');
  if(ctx) TV_STATE.charts.push(new Chart(ctx, {
    type:'bar',
    data:{ labels:['Tambah','Import','Hapus','Edit'], datasets:[{ data:[d.notifCount.tambah,d.notifCount.import,d.notifCount.hapus,d.notifCount.edit], backgroundColor:[c.green,c.blue,c.red,c.gold], borderRadius:8, maxBarThickness:100 }] },
    options:{ maintainAspectRatio:false, plugins:{ legend:{ display:false }, datalabels:{ anchor:'end', align:'top', color:c.ink, font:{ weight:'700', size:16 } } },
      scales:{ x:{ ticks:{ color:c.ink, font:{ size:14 } }, grid:{ display:false } }, y:{ ticks:{ color:c.muted }, grid:{ color:c.grid } } } },
    plugins:[ChartDataLabels],
  }));
}

const TV_SLIDES = [
  { html: tvSlideHtml_ringkasan, render: tvRender_ringkasan },
  { html: tvSlideHtml_zona, render: tvRender_zona },
  { html: tvSlideHtml_maintenance, render: tvRender_maintenance },
  { html: tvSlideHtml_ratoon, render: tvRender_ratoon },
  { html: tvSlideHtml_tenagakerja, render: tvRender_tenagakerja },
  { html: tvSlideHtml_aset, render: tvRender_aset },
];

/* ---------------------------------------------------------------------
   5. OVERLAY, SIKLUS, KONTROL
   --------------------------------------------------------------------- */
function tvBuildOverlay(){
  if(document.getElementById('tvModeOverlay')) return;
  const ov = document.createElement('div');
  ov.id = 'tvModeOverlay';
  ov.innerHTML = `
    <div class="tv-progress" id="tvProgressBar" style="width:0%"></div>
    <button class="tv-exit" id="tvExitBtn" title="Keluar (Esc)">✕</button>
    <div class="tv-topbar">
      <div class="tv-brand"><span class="tv-brand-dot"></span><span class="tv-brand-text">Estate 2 · Pasca Harvest — Live</span></div>
      <div class="tv-clock" id="tvClock"></div>
    </div>
    <div class="tv-stage" id="tvStage"></div>
    <div class="tv-dots" id="tvDots"></div>
  `;
  document.body.appendChild(ov);
  document.getElementById('tvExitBtn').onclick = closeTvMode;
  document.addEventListener('keydown', (e) => { if(TV_STATE.open && e.key === 'Escape') closeTvMode(); });
}

function tvTickClock(){
  const el = document.getElementById('tvClock');
  if(el) el.textContent = new Date().toLocaleString('id-ID', { weekday:'long', day:'numeric', month:'long', hour:'2-digit', minute:'2-digit' });
}

function tvRenderSlide(i){
  tvDestroyCharts();
  const stage = document.getElementById('tvStage');
  const dots = document.getElementById('tvDots');
  if(!stage || !TV_STATE.data) return;
  stage.innerHTML = `<div class="tv-slide active">${TV_SLIDES[i].html(TV_STATE.data)}</div>`;
  requestAnimationFrame(() => TV_SLIDES[i].render(TV_STATE.data));
  dots.innerHTML = TV_SLIDES.map((_,idx) => `<div class="tv-dot ${idx===i?'active':''}" data-i="${idx}"></div>`).join('');
  dots.querySelectorAll('.tv-dot').forEach(dot => dot.onclick = () => { TV_STATE.slideIndex = +dot.dataset.i; tvRenderSlide(TV_STATE.slideIndex); tvResetProgress(); });
}

function tvResetProgress(){
  const bar = document.getElementById('tvProgressBar');
  if(!bar) return;
  bar.style.transition = 'none'; bar.style.width = '0%';
  requestAnimationFrame(() => { bar.style.transition = `width ${TV_SLIDE_SECONDS}s linear`; bar.style.width = '100%'; });
}

function tvNextSlide(){
  TV_STATE.slideIndex = (TV_STATE.slideIndex + 1) % TV_SLIDES.length;
  tvRenderSlide(TV_STATE.slideIndex);
  tvResetProgress();
}

async function openTvMode(){
  tvBuildOverlay();
  const ov = document.getElementById('tvModeOverlay');
  ov.classList.add('show');
  TV_STATE.open = true;
  sidebarOpenState = false; document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('tvStage').innerHTML = `<div class="tv-loading">MEMUAT DATA…</div>`;
  try{ await (document.documentElement.requestFullscreen?.() || Promise.resolve()); }catch(e){}
  tvTickClock();
  TV_STATE.data = await tvLoadData();
  TV_STATE.slideIndex = 0;
  tvRenderSlide(0);
  tvResetProgress();
  TV_STATE.timer = setInterval(tvNextSlide, TV_SLIDE_SECONDS * 1000);
  TV_STATE.progressTimer = setInterval(tvTickClock, 30000);
  TV_STATE.refreshTimer = setInterval(async () => {
    ['pasca_harvest','ratoon','blanking',MAINTENANCE_TABLE,ACTUAL_TK_TABLE,MONITORING_ASET_TABLE,MONITORING_MOTOR_TABLE]
      .forEach(t => { if(state[t]) state[t].loaded = false; });
    TV_STATE.data = await tvLoadData();
  }, TV_REFRESH_MINUTES * 60 * 1000);
}

function closeTvMode(){
  const ov = document.getElementById('tvModeOverlay');
  if(ov) ov.classList.remove('show');
  TV_STATE.open = false;
  tvDestroyCharts();
  clearInterval(TV_STATE.timer); clearInterval(TV_STATE.progressTimer); clearInterval(TV_STATE.refreshTimer);
  if(document.fullscreenElement) document.exitFullscreen?.().catch(()=>{});
  syncTvModeSwitch();
}

/* ---------------------------------------------------------------------
   6. Routing 'tv_mode' lewat menu biasa (opsional, kalau dipanggil via navigate)
   --------------------------------------------------------------------- */
if(typeof navigate !== 'undefined'){
  const _origNavigate2 = navigate;
  navigate = async function(view){
    if(view === 'tv_mode'){ openTvMode(); return; }
    return _origNavigate2(view);
  };
}
