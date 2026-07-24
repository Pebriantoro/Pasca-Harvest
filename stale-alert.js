/* =====================================================================
   ALERT DATA TELAT PER ZONA — banner peringatan kalau suatu zona sudah
   sekian hari tidak ada aktivitas input (tambah/edit/import) tercatat
   di tabel `notifications`. Load SETELAH app.js. Additif, tidak ubah
   file lain. Hanya admin/manager/superintendent yang bisa lihat
   (mengikuti RLS tabel notifications yang sudah ada).
   ===================================================================== */

const STALE_THRESHOLD_DAYS = 3; // ganti angka ini kalau mau lebih ketat/longgar

(function injectStaleStyles(){
  const css = `
    #staleAlertBanner{ display:none; margin:0 0 16px; padding:12px 16px; border-radius:12px;
      background:var(--accent-red-soft,rgba(193,84,60,.14)); border:1px solid var(--accent-red,#C1543C);
      color:var(--accent-red-text,#F0A392); font-size:13.5px; align-items:flex-start; gap:10px; }
    #staleAlertBanner.show{ display:flex; }
    #staleAlertBanner .stale-icon{ flex-shrink:0; margin-top:1px; }
    #staleAlertBanner .stale-body{ flex:1; min-width:0; }
    #staleAlertBanner .stale-title{ font-weight:700; color:var(--text-primary,#EDEBE2); margin-bottom:4px; }
    #staleAlertBanner .stale-list{ display:flex; flex-wrap:wrap; gap:8px; }
    #staleAlertBanner .stale-chip{ background:rgba(0,0,0,.18); border-radius:8px; padding:4px 10px; font-weight:600; white-space:nowrap; }
    #staleAlertBanner .stale-close{ background:none; border:none; color:inherit; opacity:.6; cursor:pointer; font-size:15px; line-height:1; flex-shrink:0; }
    #staleAlertBanner .stale-close:hover{ opacity:1; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

function injectStaleBanner(){
  if(document.getElementById('staleAlertBanner')) return;
  const content = document.getElementById('pageContent');
  if(!content || !content.parentElement) return;
  const el = document.createElement('div');
  el.id = 'staleAlertBanner';
  el.innerHTML = `
    <span class="stale-icon">⚠️</span>
    <div class="stale-body">
      <div class="stale-title" id="staleAlertTitle"></div>
      <div class="stale-list" id="staleAlertList"></div>
    </div>
    <button class="stale-close" id="staleAlertClose" title="Tutup">✕</button>
  `;
  content.parentElement.insertBefore(el, content);
  document.getElementById('staleAlertClose').onclick = () => {
    el.classList.remove('show');
    try{ sessionStorage.setItem('staleAlertDismissed', STALE_LAST_SIGNATURE); }catch(e){}
  };
}

let STALE_LAST_SIGNATURE = '';

async function checkStaleZones(){
  try{
    if(!currentProfile) return;
    if(!['admin','manager','superintendent'].includes(currentProfile.role)) return;

    const ph = await ensureData('pasca_harvest');
    const zonas = [...new Set(ph.map(r => (r.zona||'').toUpperCase()).filter(Boolean))].sort();
    if(!zonas.length) return;

    const { data, error } = await supa
      .from('notifications')
      .select('zona,created_at')
      .not('zona', 'is', null)
      .order('created_at', { ascending:false })
      .limit(500);
    if(error) return;

    const lastByZona = {};
    (data||[]).forEach(row => {
      const z = (row.zona||'').toUpperCase();
      if(z && !lastByZona[z]) lastByZona[z] = row.created_at;
    });

    const now = Date.now();
    const stale = zonas.map(z => {
      const last = lastByZona[z] || null;
      const days = last ? (now - new Date(last).getTime()) / 86400000 : Infinity;
      return { zona:z, days, last };
    }).filter(r => r.days > STALE_THRESHOLD_DAYS);

    injectStaleBanner();
    const banner = document.getElementById('staleAlertBanner');
    const titleEl = document.getElementById('staleAlertTitle');
    const listEl = document.getElementById('staleAlertList');
    if(!banner) return;

    if(!stale.length){
      banner.classList.remove('show');
      STALE_LAST_SIGNATURE = '';
      return;
    }

    STALE_LAST_SIGNATURE = stale.map(s => s.zona + ':' + Math.floor(s.days)).join(',');
    let dismissed = null;
    try{ dismissed = sessionStorage.getItem('staleAlertDismissed'); }catch(e){}
    if(dismissed === STALE_LAST_SIGNATURE) return; // sudah ditutup user & belum berubah

    titleEl.textContent = `${stale.length} zona belum ada input data ${STALE_THRESHOLD_DAYS}+ hari terakhir`;
    listEl.innerHTML = stale.map(s => {
      const label = s.days === Infinity ? 'belum pernah tercatat' : `${Math.floor(s.days)} hari lalu`;
      return `<span class="stale-chip">Zona ${s.zona} — terakhir ${label}</span>`;
    }).join('');
    banner.classList.add('show');
  }catch(e){ /* diam-diam gagal, jangan ganggu app utama */ }
}

// jalan pertama kali begitu profil siap, lalu cek ulang tiap 10 menit
const _staleWatcher = setInterval(() => {
  if(currentProfile){ checkStaleZones(); clearInterval(_staleWatcher); }
}, 500);
setInterval(checkStaleZones, 10 * 60 * 1000);

// cek ulang juga tiap pindah ke dashboard (paling sering dilihat)
if(typeof navigate !== 'undefined'){
  const _origNavigate3 = navigate;
  navigate = async function(view){
    const r = await _origNavigate3(view);
    if(view === 'dashboard') checkStaleZones();
    return r;
  };
}
