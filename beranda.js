/* =====================================================================
   BERANDA ADDON — feed gaya Facebook yang menggabungkan aktivitas input
   Staff dari 3 menu: Rencana Kerja Harian, Pengecekan Pra SPA, dan
   QC By Proses, diurutkan dari yang terbaru. Additif, load PALING
   TERAKHIR (setelah rkh.js, pra-spa.js, qc-by-proses.js) supaya bisa
   pakai ulang query & badge status yang sudah ada di ketiga modul itu.

   Data yang ditampilkan ikut aturan akses masing-masing modul (staff
   cuma lihat punya sendiri, supervisor/superintendent lingkup zona/
   hierarkinya, admin & manager lihat semua) — beranda ini murni lapisan
   tampilan, bukan menambah bocoran data baru.
   ===================================================================== */

let berandaFeedCache = [];
let berandaState = { filter: 'semua', visibleCount: 10 };
const BERANDA_PAGE_SIZE = 10;

function berandaInitial(name){
  return (name || '?').toString().trim().charAt(0).toUpperCase() || '?';
}

async function berandaFetchFeed(){
  const [rkhRows, praSpaRows, qcpRows] = await Promise.all([
    supa && typeof rkhScopedQuery === 'function'
      ? rkhScopedQuery().limit(20).then(r => r.data || [])
      : Promise.resolve([]),
    typeof praSpaScopedQuery === 'function'
      ? praSpaScopedQuery().limit(20).then(r => r.data || [])
      : Promise.resolve([]),
    typeof qcpScopedQuery === 'function'
      ? qcpScopedQuery().limit(20).then(r => r.data || [])
      : Promise.resolve([]),
  ]);

  const items = [];
  rkhRows.forEach(r => items.push({
    source: 'rkh', id: r.id, created_at: r.created_at || r.tanggal, tanggal: r.tanggal,
    staff_name: r.staff_name, zona: r.zona,
    icon: 'rkh', sourceLabel: 'Rencana Kerja Harian',
    body: `Rencana kerja <b>${esc(r.aktivitas || '-')}</b> di petak <b>${esc(r.petak || '-')}</b>${r.jumlah_tk ? ` · ${esc(String(r.jumlah_tk))} TK` : ''}${r.kontraktor ? ` · ${esc(r.kontraktor)}` : ''}`,
    statusHtml: berandaRelabelBadge(typeof rkhBadge === 'function' ? rkhBadge(r.status) : esc(r.status || '')),
    onClick: `navigate('rkh')`,
  }));
  praSpaRows.forEach(r => items.push({
    source: 'pra_spa', id: r.id, created_at: r.created_at || r.tanggal, tanggal: r.tanggal,
    staff_name: r.staff_name, zona: r.zona,
    icon: 'pra_spa', sourceLabel: 'Pengecekan Pra SPA',
    body: `Pengecekan <b>${esc(r.kegiatan || '-')}</b> di petak <b>${esc(r.no_petak || '-')}</b>${r.resume ? ` — Kelulusan ${r.resume.persen.toFixed(1)}%` : ''}`,
    statusHtml: berandaRelabelBadge(typeof praSpaBadge === 'function' ? praSpaBadge(r.status) : esc(r.status || '')),
    onClick: `navigate('pra_spa')`,
  }));
  qcpRows.forEach(r => items.push({
    source: 'qc_by_proses', id: r.id, created_at: r.created_at || r.tanggal, tanggal: r.tanggal,
    staff_name: r.staff_name, zona: r.zona,
    icon: 'qc_by_proses', sourceLabel: 'QC By Proses',
    body: `QC <b>${esc(r.kegiatan || '-')}</b> di petak <b>${esc(r.petak || '-')}</b> — Nilai ${r.average_nilai ?? '-'} (${esc(r.kategori || '-')})`,
    statusHtml: berandaRelabelBadge(typeof qcpBadge === 'function' ? qcpBadge(r.status) : esc(r.status || '')),
    onClick: `navigate('qc_by_proses')`,
  }));

  items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return items;
}

const BERANDA_FILTERS = [
  { key: 'semua', label: 'Semua' },
  { key: 'rkh', label: 'RKH' },
  { key: 'pra_spa', label: 'Pra SPA' },
  { key: 'qc_by_proses', label: 'QC By Proses' },
];

function berandaFilterBarHTML(items){
  const counts = { semua: items.length };
  BERANDA_FILTERS.slice(1).forEach(f => { counts[f.key] = items.filter(i => i.source === f.key).length; });
  return `<div style="margin-bottom:16px;">
    <div class="beranda-filter-select-wrap">
      <select class="beranda-filter-select" onchange="berandaState.filter=this.value; berandaState.visibleCount=${BERANDA_PAGE_SIZE}; renderBerandaFeed();">
        ${BERANDA_FILTERS.map(f => `
          <option value="${f.key}" ${berandaState.filter===f.key ? 'selected' : ''}>${esc(f.label)} (${counts[f.key] || 0})</option>
        `).join('')}
      </select>
      <svg class="beranda-filter-select-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </div>
  </div>`;
}

function berandaRelabelBadge(html){
  if(!html) return html;
  return html
    .replace(/Menunggu Verifikasi Supervisor/gi, 'Waiting Approval 1st')
    .replace(/Menunggu Approval Superintendent/gi, 'Waiting Approval 2nd')
    .replace(/Disetujui/gi, 'Approved')
    .replace(/Ditolak/gi, 'Reject');
}

const BERANDA_SOURCE_COLOR = {
  rkh: 'var(--accent-green)',
  pra_spa: 'var(--accent-gold)',
  qc_by_proses: 'var(--accent-blue)',
};
const BERANDA_SOURCE_SVG = {
  rkh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
  pra_spa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  qc_by_proses: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
};

function berandaCardHTML(item){
  const color = BERANDA_SOURCE_COLOR[item.source] || 'var(--accent-gold)';
  const svg = BERANDA_SOURCE_SVG[item.source] || '';
  return `
    <div class="beranda-timeline-item">
      <div class="beranda-timeline-dot" style="background:${color};">${svg}</div>
      <div class="card card-hoverable beranda-timeline-content" style="position:relative; cursor:pointer; padding:16px;" onclick="${item.onClick}">
        <div style="position:absolute; top:14px; right:16px;">${item.statusHtml}</div>
        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div class="chat-avatar" style="width:36px; height:36px; font-size:14px; flex-shrink:0;">${esc(berandaInitial(item.staff_name))}</div>
          <div style="flex:1; min-width:0; padding-right:120px;">
            <div style="font-weight:700; font-size:13.5px;">${esc(item.staff_name || 'Staff')}</div>
            <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">
              ${esc(item.sourceLabel)} ${item.zona ? '· Zona '+esc(item.zona) : ''} · ${esc(typeof timeAgo === 'function' ? timeAgo(item.created_at) : fmtTanggalRKH(item.tanggal))}
            </div>
            <div style="font-size:13px; color:var(--text-muted); margin-top:10px; line-height:1.5;">${item.body}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderBerandaFeed(){
  const items = berandaState.filter === 'semua' ? berandaFeedCache : berandaFeedCache.filter(i => i.source === berandaState.filter);
  const visible = items.slice(0, berandaState.visibleCount);
  const listEl = $('#berandaFeedList');
  const filterEl = $('#berandaFilterBar');
  if(filterEl) filterEl.innerHTML = berandaFilterBarHTML(berandaFeedCache);
  if(!listEl) return;
  listEl.innerHTML = visible.length
    ? `<div class="beranda-timeline">${visible.map(berandaCardHTML).join('')}</div>` + (items.length > visible.length
        ? `<div style="text-align:center; margin-top:8px;"><button class="btn btn-outline btn-sm" onclick="berandaState.visibleCount+=${BERANDA_PAGE_SIZE}; renderBerandaFeed();">Muat Lebih Banyak</button></div>`
        : '')
    : `<div class="empty-state">Belum ada aktivitas untuk ditampilkan.</div>`;
}

async function renderBeranda(){
  $('#pageEyebrow').textContent = 'RINGKASAN';
  $('#pageTitle').textContent = 'Beranda';
  berandaState.filter = 'semua'; berandaState.visibleCount = BERANDA_PAGE_SIZE;
  if(currentProfile?.role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `
    ${typeof wfHeroHTML === 'function' ? wfHeroHTML() : ''}
    <div class="card" style="margin-bottom:16px; padding:16px;">
      <div style="font-weight:700; font-size:14px;">👋 Aktivitas Terbaru Tim</div>
      <div style="font-size:12px; color:var(--text-faint); margin-top:4px;">Ringkasan input Rencana Kerja Harian, Pengecekan Pra SPA & QC By Proses, terbaru di atas.</div>
    </div>
    <div id="berandaFilterBar"></div>
    <div id="berandaFeedList">${skeletonListHTML(4)}</div>
  `;
  if(typeof wfInitHero === 'function') wfInitHero();
  berandaFeedCache = await berandaFetchFeed();
  renderBerandaFeed();
}

/* ---------------------------------------------------------------------
   NAVIGASI: tambah view 'beranda'
   --------------------------------------------------------------------- */
const _berandaPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'beranda'){
    currentView = view;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
    sidebarOpenState = false; $('#sidebar').classList.remove('open'); $('#sidebarBackdrop')?.classList.remove('show');
    await renderBeranda();
    return;
  }
  return _berandaPrevNavigate(view);
};
