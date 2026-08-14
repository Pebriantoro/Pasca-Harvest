/* =====================================================================
   TASK CALENDAR — menu baru di bawah Beranda. Tampilkan kalender 1 bulan,
   tiap tanggal dikasih dot warna sesuai jenis kegiatan yang ada di
   tanggal itu: RKH (hijau), Pengecekan Pra SPA (kuning/gold), QC By
   Proses (biru). Additif — load PALING TERAKHIR (setelah rkh.js,
   pra-spa.js, qc-by-proses.js, beranda.js) supaya bisa pakai ulang query
   scoped yang sudah ada (jadi ikut aturan akses per role/zona yang sama).
   ===================================================================== */

const TASK_CAL_LEGEND = [
  { key: 'rkh', label: 'Rencana Kerja Harian', color: 'var(--accent-green)' },
  { key: 'pra_spa', label: 'Pengecekan Pra SPA', color: 'var(--accent-gold)' },
  { key: 'qc_by_proses', label: 'QC By Proses', color: 'var(--accent-blue)' },
];
const TASK_CAL_BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const TASK_CAL_HARI = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

let taskCalState = { year: new Date().getFullYear(), month: new Date().getMonth() }; // month: 0-11
let taskCalEventsCache = {}; // { 'YYYY-MM-DD': { rkh: n, pra_spa: n, qc_by_proses: n } }
let taskCalDetailDate = null;

function taskCalPad(n){ return String(n).padStart(2, '0'); }
function taskCalISO(y, m, d){ return `${y}-${taskCalPad(m+1)}-${taskCalPad(d)}`; }

async function taskCalFetchMonth(year, month){
  const dateFrom = taskCalISO(year, month, 1);
  const lastDay = new Date(year, month+1, 0).getDate();
  const dateTo = taskCalISO(year, month, lastDay);

  const [rkhRows, praSpaRows, qcpRowsRaw] = await Promise.all([
    typeof rkhFetchRows === 'function' ? rkhFetchRows({ dateFrom, dateTo }) : Promise.resolve([]),
    typeof praSpaFetchRows === 'function' ? praSpaFetchRows({ dateFrom, dateTo }) : Promise.resolve([]),
    typeof qcpScopedQuery === 'function'
      ? qcpScopedQuery().gte('tanggal', dateFrom).lte('tanggal', dateTo).limit(500).then(r => r.data || [])
      : Promise.resolve([]),
  ]);

  const map = {};
  function bump(list, key){
    list.forEach(r => {
      const tgl = (r.tanggal || '').toString().slice(0, 10);
      if(!tgl) return;
      if(!map[tgl]) map[tgl] = { rkh: 0, pra_spa: 0, qc_by_proses: 0, items: [] };
      map[tgl][key]++;
      map[tgl].items.push({ source: key, row: r });
    });
  }
  bump(rkhRows, 'rkh');
  bump(praSpaRows, 'pra_spa');
  bump(qcpRowsRaw, 'qc_by_proses');
  return map;
}

function taskCalLegendHTML(){
  return `<div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px;">
    ${TASK_CAL_LEGEND.map(l => `
      <div style="display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--text-muted);">
        <span style="width:10px; height:10px; border-radius:50%; background:${l.color}; flex-shrink:0; display:inline-block;"></span>
        ${esc(l.label)}
      </div>
    `).join('')}
  </div>`;
}

function taskCalDayCellHTML(y, m, d, isCurrentMonth){
  const iso = taskCalISO(y, m, d);
  const day = taskCalEventsCache[iso];
  const isToday = iso === taskCalISO(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  const bars = day ? TASK_CAL_LEGEND.filter(l => day[l.key] > 0) : [];
  return `
    <div class="taskcal-day ${isCurrentMonth ? '' : 'taskcal-day-muted'} ${isToday ? 'taskcal-day-today' : ''}" ${day ? `onclick="taskCalOpenDay('${iso}')"` : ''}>
      <div class="taskcal-day-num">${d}</div>
      ${bars.length ? `<div class="taskcal-day-bars">
        ${bars.map(l => {
          const count = day[l.key];
          const widthPct = Math.min(100, 30 + count * 14);
          return `<div class="taskcal-bar-row" title="${esc(l.label)} (${count})">
            <span class="taskcal-bar" style="background:${l.color}; width:${widthPct}%;"></span>
            <span class="taskcal-bar-count">${count}</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
}

function taskCalGridHTML(){
  const { year, month } = taskCalState;
  const firstDow = new Date(year, month, 1).getDay(); // 0=Min
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for(let i = firstDow - 1; i >= 0; i--){
    const d = daysInPrevMonth - i;
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    cells.push(taskCalDayCellHTML(py, pm, d, false));
  }
  for(let d = 1; d <= daysInMonth; d++) cells.push(taskCalDayCellHTML(year, month, d, true));
  while(cells.length % 7 !== 0){
    const nextIdx = cells.length - (firstDow) - daysInMonth + 1;
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    cells.push(taskCalDayCellHTML(ny, nm, nextIdx, false));
  }

  return `
    <div class="taskcal-grid-head">
      ${TASK_CAL_HARI.map(h => `<div>${h}</div>`).join('')}
    </div>
    <div class="taskcal-grid">${cells.join('')}</div>
  `;
}

async function taskCalRenderGrid(){
  const gridWrap = $('#taskCalGridWrap');
  if(!gridWrap) return;
  gridWrap.innerHTML = `<div class="empty-state">Memuat kalender…</div>`;
  taskCalEventsCache = await taskCalFetchMonth(taskCalState.year, taskCalState.month);
  $('#taskCalMonthLabel').textContent = `${TASK_CAL_BULAN[taskCalState.month]} ${taskCalState.year}`;
  gridWrap.innerHTML = taskCalGridHTML();
}

function taskCalPrevMonth(){
  taskCalState.month--;
  if(taskCalState.month < 0){ taskCalState.month = 11; taskCalState.year--; }
  taskCalRenderGrid();
}
function taskCalNextMonth(){
  taskCalState.month++;
  if(taskCalState.month > 11){ taskCalState.month = 0; taskCalState.year++; }
  taskCalRenderGrid();
}
function taskCalToday(){
  const now = new Date();
  taskCalState.year = now.getFullYear(); taskCalState.month = now.getMonth();
  taskCalRenderGrid();
}

function taskCalEventLineHTML(ev){
  const legend = TASK_CAL_LEGEND.find(l => l.key === ev.source);
  const r = ev.row;
  let label = '-';
  if(ev.source === 'rkh') label = `${esc(r.staff_name||'-')} — ${esc(r.aktivitas||'-')} (${esc(r.petak||'-')})`;
  else if(ev.source === 'pra_spa') label = `${esc(r.staff_name||'-')} — ${esc(r.kegiatan||'-')} (${esc(r.no_petak||'-')})`;
  else if(ev.source === 'qc_by_proses') label = `${esc(r.staff_name||'-')} — ${esc(r.kegiatan||'-')} (${esc(r.petak||'-')})`;
  return `
    <div style="display:flex; align-items:center; gap:9px; padding:9px 0; border-bottom:1px solid var(--border-soft);">
      <span style="width:9px; height:9px; border-radius:50%; background:${legend.color}; flex-shrink:0;"></span>
      <span style="font-size:11.5px; color:var(--text-faint); min-width:100px;">${esc(legend.label)}</span>
      <span style="font-size:12.5px; flex:1; min-width:0;">${label}</span>
    </div>`;
}

function taskCalOpenDay(iso){
  taskCalDetailDate = iso;
  const day = taskCalEventsCache[iso] || { items: [] };
  document.getElementById('taskCalDayOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'taskCalDayOverlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:480px;">
      <div class="modal-header">
        <span class="card-title">${esc(fmtTanggalRKH ? fmtTanggalRKH(iso) : iso)}</span>
        <button class="btn-icon" onclick="document.getElementById('taskCalDayOverlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        ${day.items.length ? day.items.map(taskCalEventLineHTML).join('') : `<div class="empty-state">Tidak ada kegiatan di tanggal ini.</div>`}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.remove(); });
}

async function renderTaskCalendar(){
  $('#pageEyebrow').textContent = 'RINGKASAN';
  $('#pageTitle').textContent = 'Task Calendar';
  if(currentProfile?.role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  const now = new Date();
  taskCalState.year = now.getFullYear(); taskCalState.month = now.getMonth();
  $('#pageContent').innerHTML = `
    <div class="card" style="padding:16px;">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div style="display:flex; align-items:center; gap:10px;">
          <button class="btn btn-outline btn-icon" onclick="taskCalPrevMonth()">‹</button>
          <div id="taskCalMonthLabel" style="font-weight:700; font-size:15px; min-width:150px; text-align:center;"></div>
          <button class="btn btn-outline btn-icon" onclick="taskCalNextMonth()">›</button>
        </div>
        <button class="btn btn-outline btn-sm" onclick="taskCalToday()">Hari Ini</button>
      </div>
      ${taskCalLegendHTML()}
      <div id="taskCalGridWrap"><div class="empty-state">Memuat kalender…</div></div>
    </div>
  `;
  await taskCalRenderGrid();
}

/* ---------------------------------------------------------------------
   NAVIGASI: tambah view 'task_calendar'
   --------------------------------------------------------------------- */
const _taskCalPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'task_calendar'){
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderTaskCalendar();
    return;
  }
  return _taskCalPrevNavigate(view);
};
