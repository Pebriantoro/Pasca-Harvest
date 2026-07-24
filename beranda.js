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
    icon: '📋', sourceLabel: 'Rencana Kerja Harian',
    body: `Rencana kerja <b>${esc(r.aktivitas || '-')}</b> di petak <b>${esc(r.petak || '-')}</b>${r.jumlah_tk ? ` · ${esc(String(r.jumlah_tk))} TK` : ''}${r.kontraktor ? ` · ${esc(r.kontraktor)}` : ''}`,
    statusHtml: typeof rkhBadge === 'function' ? rkhBadge(r.status) : esc(r.status || ''),
    onClick: `navigate('rkh')`,
  }));
  praSpaRows.forEach(r => items.push({
    source: 'pra_spa', id: r.id, created_at: r.created_at || r.tanggal, tanggal: r.tanggal,
    staff_name: r.staff_name, zona: r.zona,
    icon: '🔍', sourceLabel: 'Pengecekan Pra SPA',
    body: `Pengecekan <b>${esc(r.kegiatan || '-')}</b> di petak <b>${esc(r.no_petak || '-')}</b>${r.resume ? ` — Kelulusan ${r.resume.persen.toFixed(1)}%` : ''}`,
    statusHtml: typeof praSpaBadge === 'function' ? praSpaBadge(r.status) : esc(r.status || ''),
    onClick: `navigate('pra_spa')`,
  }));
  qcpRows.forEach(r => items.push({
    source: 'qc_by_proses', id: r.id, created_at: r.created_at || r.tanggal, tanggal: r.tanggal,
    staff_name: r.staff_name, zona: r.zona,
    icon: '✅', sourceLabel: 'QC By Proses',
    body: `QC <b>${esc(r.kegiatan || '-')}</b> di petak <b>${esc(r.petak || '-')}</b> — Nilai ${r.average_nilai ?? '-'} (${esc(r.kategori || '-')})`,
    statusHtml: typeof qcpBadge === 'function' ? qcpBadge(r.status) : esc(r.status || ''),
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
  return `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
    ${BERANDA_FILTERS.map(f => `
      <button class="btn btn-sm ${berandaState.filter===f.key ? 'btn-primary' : 'btn-outline'}" onclick="berandaState.filter='${f.key}'; berandaState.visibleCount=${BERANDA_PAGE_SIZE}; renderBerandaFeed();">
        ${esc(f.label)} (${counts[f.key] || 0})
      </button>
    `).join('')}
  </div>`;
}

function berandaCardHTML(item){
  return `
    <div class="card card-hoverable" style="margin-bottom:12px; cursor:pointer; padding:16px;" onclick="${item.onClick}">
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div class="chat-avatar" style="width:42px; height:42px; font-size:16px; flex-shrink:0;">${esc(berandaInitial(item.staff_name))}</div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:700; font-size:13.5px;">${esc(item.staff_name || 'Staff')}</div>
              <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">
                ${item.icon} ${esc(item.sourceLabel)} ${item.zona ? '· Zona '+esc(item.zona) : ''} · ${esc(typeof timeAgo === 'function' ? timeAgo(item.created_at) : fmtTanggalRKH(item.tanggal))}
              </div>
            </div>
            <div>${item.statusHtml}</div>
          </div>
          <div style="font-size:13px; color:var(--text-muted); margin-top:10px; line-height:1.5;">${item.body}</div>
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
    ? visible.map(berandaCardHTML).join('') + (items.length > visible.length
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
    <div class="card" style="margin-bottom:16px; padding:16px;">
      <div style="font-weight:700; font-size:14px;">👋 Aktivitas Terbaru Tim</div>
      <div style="font-size:12px; color:var(--text-faint); margin-top:4px;">Ringkasan input Rencana Kerja Harian, Pengecekan Pra SPA & QC By Proses, terbaru di atas.</div>
    </div>
    <div id="berandaFilterBar"></div>
    <div id="berandaFeedList"><div style="display:flex; justify-content:center; padding:40px;"><div class="spinner"></div></div></div>
  `;
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
