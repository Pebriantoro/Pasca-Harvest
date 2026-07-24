/* =====================================================================
   EXPORT MENU — dropdown Export dengan pilihan XLSX / PDF / JPEG untuk
   semua modul (Data Petak, Produktivitas Harian, Justifikasi TCH,
   Produktivitas Kontraktor, Maintenance Pasca Harvest, PC/RPC Eks Non
   RKT), plus restyle tombol jadi lebih "keren" (gradient, glow, micro
   animasi). Load SETELAH app.js dan modul lain. Additif, tidak ubah
   file lain — hanya menimpa isi tombol Export XLSX lama lewat
   renderExportMenu() yang dipanggil dari app.js.
   ===================================================================== */

/* ------------------------------------------------------------------ *
 * 1. STYLE — tombol & dropdown export lebih keren
 * ------------------------------------------------------------------ */
(function injectExportMenuStyles(){
  const css = `
    /* --- Upgrade tombol global: lebih hidup, ada glow & lift halus --- */
    .btn{
      position:relative; overflow:hidden;
      letter-spacing:.1px;
      transition: transform .16s var(--ease-out), box-shadow .2s var(--ease-out),
                  background .2s var(--ease-out), border-color .2s var(--ease-out),
                  color .2s var(--ease-out), filter .2s var(--ease-out);
    }
    .btn::after{
      content:''; position:absolute; inset:0; border-radius:inherit; opacity:0;
      background: radial-gradient(circle at 50% 0%, rgba(255,255,255,.22), transparent 70%);
      transition: opacity .25s var(--ease-out); pointer-events:none;
    }
    .btn:hover::after{ opacity:1; }
    .btn svg{ transition: transform .2s var(--ease-out); flex-shrink:0; }
    .btn:hover svg{ transform: scale(1.08); }

    .btn-primary{
      background: linear-gradient(135deg, #EEC569 0%, var(--accent-gold) 55%, #C1943E 100%);
      box-shadow: 0 1px 0 rgba(0,0,0,0.1), 0 6px 16px rgba(217,169,74,0.22);
    }
    .btn-primary:hover{
      background: linear-gradient(135deg, #F4D488 0%, #E8B85C 55%, #D2A24C 100%);
      box-shadow: var(--shadow-glow-gold), 0 10px 24px rgba(217,169,74,0.28);
      transform: translateY(-2px);
    }
    .btn-primary:active{ transform: translateY(0) scale(.97); }

    .btn-outline{
      background: var(--bg-elevated);
      box-shadow: 0 1px 2px rgba(0,0,0,0.12);
    }
    .btn-outline:hover{
      border-color: var(--accent-gold);
      color: var(--accent-gold);
      background: var(--accent-gold-soft);
      transform: translateY(-2px);
      box-shadow: 0 8px 18px rgba(217,169,74,0.16);
    }
    .btn-outline:active{ transform: translateY(0) scale(.97); }

    .btn-danger:hover{ box-shadow: 0 8px 18px rgba(193,84,60,0.28); transform: translateY(-2px); }

    /* --- Dropdown Export ---
       Dropdown di-portal ke <body> dengan position:fixed saat dibuka, supaya
       tidak terpotong oleh ancestor ".card{overflow:hidden}". Lihat toggleExportMenu(). */
    .export-menu{ position:relative; display:inline-flex; }
    .export-menu .btn-export-toggle .chev{ transition: transform .2s var(--ease-out); margin-left:1px; }
    .export-menu.open .btn-export-toggle .chev{ transform: rotate(180deg); }
    .export-menu.open .btn-export-toggle{
      border-color: var(--accent-gold); color: var(--accent-gold); background: var(--accent-gold-soft);
    }

    .export-menu-dropdown{
      position:fixed; top:0; left:-9999px; z-index:2000;
      min-width:190px; padding:6px; border-radius:12px;
      background: var(--bg-card); border:1px solid var(--border);
      box-shadow: var(--shadow-md);
      opacity:0; visibility:hidden; transform: translateY(-6px) scale(.97);
      transform-origin: top right;
      transition: opacity .16s var(--ease-out), transform .16s var(--ease-out), visibility .16s;
    }
    .export-menu-dropdown.open{
      opacity:1; visibility:visible; transform: translateY(0) scale(1);
    }
    .export-menu-item{
      display:flex; align-items:center; gap:10px; width:100%;
      padding:9px 10px; border-radius:8px; border:none; background:transparent;
      color: var(--text-primary); font-size:12.8px; font-weight:600; text-align:left;
      cursor:pointer; transition: background .14s, color .14s, transform .12s;
    }
    .export-menu-item:hover{ background: var(--accent-gold-soft); color: var(--accent-gold); transform: translateX(2px); }
    .export-menu-item:active{ transform: translateX(2px) scale(.98); }
    .export-menu-item .emi-ico{
      width:26px; height:26px; border-radius:7px; flex-shrink:0;
      display:flex; align-items:center; justify-content:center; font-size:13px;
    }
    .export-menu-item.emi-xlsx .emi-ico{ background: var(--accent-green-soft); color: var(--accent-green); }
    .export-menu-item.emi-pdf .emi-ico{ background: var(--accent-red-soft); color: var(--accent-red-text); }
    .export-menu-item.emi-jpeg .emi-ico{ background: var(--accent-blue-soft); color: var(--accent-blue-text); }
    .export-menu-divider{ height:1px; background: var(--border-soft); margin:5px 4px; }
    .export-menu-loading{ opacity:.55; pointer-events:none; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

/* ------------------------------------------------------------------ *
 * 2. Loader lazy untuk library PDF (jsPDF + autotable) & JPEG (html2canvas)
 * ------------------------------------------------------------------ */
const EXPORT_LIB_URLS = {
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js',
  jspdfAutotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js',
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
};
const _exportLibPromises = {};
function loadExportLib(key, url, checkFn){
  if(checkFn && checkFn()) return Promise.resolve();
  if(_exportLibPromises[key]) return _exportLibPromises[key];
  _exportLibPromises[key] = new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Gagal memuat modul ' + key));
    document.head.appendChild(s);
  });
  return _exportLibPromises[key];
}
async function ensurePDFLib(){
  await loadExportLib('jspdf', EXPORT_LIB_URLS.jspdf, () => !!window.jspdf);
  await loadExportLib('jspdfAutotable', EXPORT_LIB_URLS.jspdfAutotable, () => !!(window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API && window.jspdf.jsPDF.API.autoTable));
}
async function ensureJPEGLib(){
  await loadExportLib('html2canvas', EXPORT_LIB_URLS.html2canvas, () => !!window.html2canvas);
}

/* ------------------------------------------------------------------ *
 * 3. Generic exporter — data adalah array of plain object {Label: value}
 * ------------------------------------------------------------------ */
function _exportFileBase(prefix){
  return `${prefix}_${new Date().toISOString().slice(0,10)}`;
}

function _exportZonaLabel(){
  return currentProfile?.zona ? `Zona ${currentProfile.zona}` : '';
}
function _exportActorLine(){
  return currentProfile?.full_name || currentUser?.email || '-';
}
function _exportTitleWithZona(title){
  const zona = _exportZonaLabel();
  return zona ? `${title} ${zona}` : title;
}

function exportDataToXLSX(data, sheetName, filePrefix){
  if(!data || !data.length){ toast('Tidak ada data untuk diekspor', true); return; }
  const ws = XLSX.utils.aoa_to_sheet([
    [_exportTitleWithZona(sheetName)],
    [_exportActorLine()],
    [`Tanggal ekspor: ${new Date().toLocaleDateString('id-ID')}`],
    [],
  ]);
  XLSX.utils.sheet_add_json(ws, data, { origin: -1 });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName).substring(0,31));
  XLSX.writeFile(wb, `${_exportFileBase(filePrefix)}.xlsx`);
  toast('File XLSX berhasil diunduh');
}

async function exportDataToPDF(data, title, filePrefix){
  if(!data || !data.length){ toast('Tidak ada data untuk diekspor', true); return; }
  try{
    await ensurePDFLib();
  }catch(e){ toast('Gagal memuat modul PDF, cek koneksi internet', true); return; }
  const { jsPDF } = window.jspdf;
  const cols = Object.keys(data[0]);
  const doc = new jsPDF({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit:'pt', format:'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(27,20,5);
  doc.text(_exportTitleWithZona(title), 40, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110,110,110);
  doc.text(`${_exportActorLine()} • ${new Date().toLocaleDateString('id-ID')}`, 40, 50);
  doc.autoTable({
    startY: 62,
    head: [cols],
    body: data.map(row => cols.map(c => row[c] === null || row[c] === undefined ? '' : String(row[c]))),
    styles:{ fontSize:8, cellPadding:5, lineColor:[229,223,206], lineWidth:0.5 },
    headStyles:{ fillColor:[217,169,74], textColor:[27,20,5], fontStyle:'bold' },
    alternateRowStyles:{ fillColor:[247,244,235] },
    margin:{ left:40, right:40 },
  });
  doc.save(`${_exportFileBase(filePrefix)}.pdf`);
  toast('File PDF berhasil diunduh');
}

async function exportDataToJPEG(data, title, filePrefix){
  if(!data || !data.length){ toast('Tidak ada data untuk diekspor', true); return; }
  try{
    await ensureJPEGLib();
  }catch(e){ toast('Gagal memuat modul JPEG, cek koneksi internet', true); return; }
  const cols = Object.keys(data[0]);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed; left:-99999px; top:0; background:#ffffff; padding:26px; width:max-content; font-family:Inter,Arial,sans-serif; color:#1B1405;';
  wrap.innerHTML = `
    <div style="font-family:'Space Grotesk',Arial,sans-serif; font-size:19px; font-weight:700; margin-bottom:2px;">${esc(_exportTitleWithZona(title))}</div>
    <div style="font-size:11px; color:#8A8272; margin-bottom:14px;">${esc(_exportActorLine())} • ${esc(new Date().toLocaleDateString('id-ID'))}</div>
    <table style="border-collapse:collapse; font-size:12px;">
      <thead><tr>${cols.map(c=>`<th style="background:#D9A94A; color:#1B1405; text-align:left; padding:8px 12px; border:1px solid #C9985E; white-space:nowrap;">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${data.map((row,i)=>`<tr style="background:${i%2 ? '#F7F4EB' : '#FFFFFF'};">${cols.map(c=>`<td style="padding:7px 12px; border:1px solid #E5DFCE; white-space:nowrap;">${esc(row[c])}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  document.body.appendChild(wrap);
  try{
    const canvas = await html2canvas(wrap, { scale:2, backgroundColor:'#ffffff' });
    const link = document.createElement('a');
    link.download = `${_exportFileBase(filePrefix)}.jpg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    toast('File JPEG berhasil diunduh');
  }catch(e){
    toast('Gagal membuat JPEG: ' + e.message, true);
  }finally{
    wrap.remove();
  }
}

/* ------------------------------------------------------------------ *
 * 3b. MODAL PILIH TANGGAL SEBELUM EXPORT JPEG (dipakai RKH, Pengecekan
 * Pra SPA, QC By Proses — lihat rkh.js/pra-spa.js/qc-by-proses.js).
 * opts: { rows, dateField, mapRow(row)->object, title, filePrefix }
 * ------------------------------------------------------------------ */
function openExportDateRangeModal(opts){
  document.getElementById('exportDateRangeOverlay')?.remove();
  const dates = (opts.rows||[]).map(r => r[opts.dateField]).filter(Boolean).sort();
  const minD = dates[0] || '';
  const maxD = dates[dates.length-1] || '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'exportDateRangeOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="card-title">Export JPEG — Pilih Tanggal</div>
        <button class="btn btn-outline btn-icon" onclick="document.getElementById('exportDateRangeOverlay').remove()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div><label class="field-label">Dari Tanggal</label><input class="input" type="date" id="exportDrFrom" value="${esc(minD)}"></div>
          <div><label class="field-label">Sampai Tanggal</label><input class="input" type="date" id="exportDrTo" value="${esc(maxD)}"></div>
        </div>
        <p style="font-size:11.5px; color:var(--text-faint); margin-top:10px;">Kosongkan salah satu/keduanya untuk export semua tanggal (${(opts.rows||[]).length} baris).</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('exportDateRangeOverlay').remove()">Batal</button>
        <button class="btn btn-primary" id="exportDrBtn">Export JPEG</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('exportDrBtn').onclick = async () => {
    const from = document.getElementById('exportDrFrom').value;
    const to = document.getElementById('exportDrTo').value;
    let rows = opts.rows || [];
    if(from) rows = rows.filter(r => r[opts.dateField] >= from);
    if(to) rows = rows.filter(r => r[opts.dateField] <= to);
    if(!rows.length){ toast('Tidak ada data pada rentang tanggal itu', true); return; }
    document.getElementById('exportDateRangeOverlay').remove();
    await exportDataToJPEG(rows.map(opts.mapRow), opts.title, opts.filePrefix);
  };
}

/* ------------------------------------------------------------------ *
 * 4. Registry per modul — cara ambil data & label export tiap modul
 * ------------------------------------------------------------------ */
const EXPORT_MODULES = {
  table: {
    adminOnly: true,
    title: (arg) => arg,
    sheet: (arg) => arg,
    prefix: (arg) => `${arg}_export`,
    rows: (arg) => state[arg].data,
    getData: (arg) => {
      const cfg = TABLES[arg];
      return state[arg].data.map(r=>{
        const o = {};
        cfg.columns.forEach(c => o[c] = (FIELD_META[c] && FIELD_META[c].type === 'date') ? (fmtDateID(r[c]) || '') : r[c]);
        return o;
      });
    },
    afterExport: (arg) => logNotificationGrouped(arg, 'export', state[arg].data),
  },
  produktivitas: {
    adminOnly: true,
    title: () => 'Produktivitas Harian',
    sheet: () => 'Report',
    prefix: () => 'produktivitas_harian_export',
    rows: () => state[PRODUKTIVITAS_TABLE].data,
    getData: () => state[PRODUKTIVITAS_TABLE].data.map(r=>{
      const o = {};
      PRODUKTIVITAS_COLUMNS.forEach(c => o[c] = r[c]);
      o['produktivitas_pct'] = produktivitasPct(r);
      return o;
    }),
    afterExport: () => logNotificationGrouped(PRODUKTIVITAS_TABLE, 'export', state[PRODUKTIVITAS_TABLE].data),
  },
  justifikasi: {
    adminOnly: false,
    title: () => 'Justifikasi TCH Under 70',
    sheet: () => 'Justifikasi TCH Under 70',
    prefix: () => 'justifikasi_tch_under70',
    rows: () => justifikasiBaseRows,
    getData: () => justifikasiBaseRows.map(r => ({
      'Petak': r.petak,
      'Size RKT (Ha)': r.size_rkt,
      'Varietas': r.varietas,
      'Zona': r.zona,
      'Staff': r.staff,
      'Bulan Tebang': r.bulan_tebang,
      'TCH Nett BAPP 2026': r.tch_nett_bapp_2026,
      'Keterangan': r.keterangan,
    })),
    afterExport: () => {},
  },
  pk: {
    adminOnly: true,
    title: () => 'Produktivitas Kontraktor',
    sheet: () => 'Rekap WO',
    prefix: () => 'produktivitas_kontraktor_export',
    rows: () => state[PK_TABLE].data,
    getData: () => state[PK_TABLE].data.map((r,i)=>({
      'No': i+1,
      'Kontraktor': r.kontraktor,
      'Kegiatan': r.kegiatan_pk,
      'Luas BAPP': r.luas_bapp,
      'Ket Hasil': r.ket_hasil,
    })),
    afterExport: () => logNotificationGrouped(PK_TABLE, 'export', state[PK_TABLE].data),
  },
  maintenance: {
    adminOnly: true,
    title: () => 'Maintenance Pasca Harvest',
    sheet: () => 'Monitoring',
    prefix: () => 'maintenance_pasca_harvest_export',
    rows: () => state[MAINTENANCE_TABLE].data,
    getData: () => state[MAINTENANCE_TABLE].data.map(r=>{
      const o = {};
      MAINTENANCE_COLUMNS.forEach(c => o[FIELD_META[c].label] = r[c]);
      return o;
    }),
    afterExport: () => logNotificationGrouped(MAINTENANCE_TABLE, 'export', state[MAINTENANCE_TABLE].data),
  },
  pcrpc: {
    adminOnly: true,
    title: () => 'PC/RPC Eks Non RKT',
    sheet: () => 'DBASE',
    prefix: () => 'pc_rpc_eks_non_rkt_export',
    rows: () => state[PC_RPC_TABLE].data,
    getData: () => state[PC_RPC_TABLE].data.map(r=>{
      const o = {};
      PR_COLUMNS.forEach(c => o[PR_HEADER_ALIASES[c] || FIELD_META[c].label] = r[c]);
      return o;
    }),
    afterExport: () => logNotificationGrouped(PC_RPC_TABLE, 'export', state[PC_RPC_TABLE].data),
  },
  tebangbibit: {
    adminOnly: true,
    title: () => 'Tebang Bibit',
    sheet: () => 'DBASE BIBIT',
    prefix: () => 'tebang_bibit_export',
    rows: () => state[TB_TABLE].data,
    getData: () => state[TB_TABLE].data.map(r=>{
      const o = {};
      TB_COLUMNS.forEach(c => o[TB_HEADER_ALIASES[c] || FIELD_META[c].label] = r[c]);
      return o;
    }),
    afterExport: () => logNotificationGrouped(TB_TABLE, 'export', state[TB_TABLE].data),
  },
};

/* ------------------------------------------------------------------ *
 * 5. Render dropdown & dispatcher
 * ------------------------------------------------------------------ */
let _exportMenuSeq = 0;
function renderExportMenu(moduleKey, arg){
  const mod = EXPORT_MODULES[moduleKey];
  if(!mod) return '';
  if(mod.adminOnly && !isAdminRole()) return '';
  const id = 'exportMenu_' + (++_exportMenuSeq);
  const a = arg !== undefined ? `,'${String(arg).replace(/'/g,"\\'")}'` : ',null';
  return `
    <div class="export-menu" id="${id}">
      <button class="btn btn-outline btn-sm btn-export-toggle" onclick="toggleExportMenu(event,'${id}')" title="Export data">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V9m0 12-4-4m4 4 4-4M4 3h16"/></svg>
        Export
        <svg class="chev" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="export-menu-dropdown">
        <button class="export-menu-item emi-xlsx" onclick="runModuleExport('xlsx','${moduleKey}'${a},'${id}')">
          <span class="emi-ico">📊</span> Excel (.xlsx)
        </button>
        <button class="export-menu-item emi-pdf" onclick="runModuleExport('pdf','${moduleKey}'${a},'${id}')">
          <span class="emi-ico">📄</span> PDF (.pdf)
        </button>
        <div class="export-menu-divider"></div>
        <button class="export-menu-item emi-jpeg" onclick="runModuleExport('jpeg','${moduleKey}'${a},'${id}')">
          <span class="emi-ico">🖼️</span> Gambar (.jpg)
        </button>
      </div>
    </div>`;
}

function closeAllExportMenus(except){
  document.querySelectorAll('.export-menu-dropdown.open').forEach(dd=>{
    const ownerId = dd.dataset.ownerId;
    if(ownerId === except) return;
    dd.classList.remove('open');
    const wrap = ownerId && document.getElementById(ownerId);
    if(wrap){ wrap.classList.remove('open'); wrap.appendChild(dd); } // pulangkan ke posisi asli
  });
}
function positionExportDropdown(dd, btn){
  const rect = btn.getBoundingClientRect();
  const menuWidth = dd.offsetWidth || 190;
  let left = rect.right - menuWidth;
  if(left < 8) left = 8;
  if(left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  let top = rect.bottom + 8;
  if(top + 160 > window.innerHeight){ top = Math.max(8, rect.top - 8 - 150); } // buka ke atas kalau mepet bawah layar
  dd.style.top = top + 'px';
  dd.style.left = left + 'px';
}
function toggleExportMenu(evt, id){
  evt.stopPropagation();
  const wrap = document.getElementById(id);
  if(!wrap) return;
  const dd = wrap.querySelector('.export-menu-dropdown');
  const btn = wrap.querySelector('.btn-export-toggle');
  const wasOpen = dd.classList.contains('open');
  closeAllExportMenus();
  if(wasOpen) return;
  document.body.appendChild(dd);
  dd.dataset.ownerId = id;
  positionExportDropdown(dd, btn);
  wrap.classList.add('open');
  dd.classList.add('open');
}
document.addEventListener('click', () => closeAllExportMenus());
document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeAllExportMenus(); });
document.addEventListener('scroll', () => closeAllExportMenus(), true);
window.addEventListener('resize', () => closeAllExportMenus());

async function runModuleExport(kind, moduleKey, arg, menuId){
  const mod = EXPORT_MODULES[moduleKey];
  if(!mod) return;
  closeAllExportMenus();
  if(mod.adminOnly && !isAdminRole()){ toast('Hanya Admin yang dapat mengekspor data', true); return; }
  const menuEl = menuId ? document.getElementById(menuId) : null;
  if(menuEl) menuEl.classList.add('export-menu-loading');
  try{
    const data = mod.getData(arg);
    const title = mod.title(arg);
    if(kind === 'xlsx'){
      exportDataToXLSX(data, mod.sheet(arg), mod.prefix(arg));
    } else if(kind === 'pdf'){
      await exportDataToPDF(data, title, mod.prefix(arg));
    } else if(kind === 'jpeg'){
      await exportDataToJPEG(data, title, mod.prefix(arg));
    }
    mod.afterExport(arg);
  } finally {
    if(menuEl) menuEl.classList.remove('export-menu-loading');
  }
}
