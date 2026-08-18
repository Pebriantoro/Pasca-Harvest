/* =====================================================================
   MODUL ADDON: MONITORING PEKERJAAN PLANTATION
   =========================================================================
   Menu baru "Monitoring Pekerjaan Plantation" — akses kamera perangkat
   langsung buat Staff (dan role di atasnya untuk mantau), isi konten kartu
   niru contoh: foto lapangan + rincian (Kegiatan, Petak, Kontraktor, TK
   Kerja, Status, Nama Pengawas, Atasan Langsung, Kadep), ditampilkan
   sebagai timeline foto+rincian gaya menu Beranda (lihat beranda.js).

   Hierarki nama otomatis ikut punya RKH (rkh.js, WAJIB load lebih dulu):
   - Nama Pengawas   = Staff yang input (dianggap pengawas lapangan)
   - Atasan Langsung = hier.supervisor_name
   - Kadep           = hier.superintendent_name

   Akses:
   - Staff: isi form + foto (kamera) + lihat riwayat sendiri.
   - Supervisor/Superintendent/Manager: pantau timeline tim (scoped sama
     kayak RKH: supervisor_id / superintendent_id, manager lihat semua).
   - Admin: ringkasan (KPI + rekap per zona + aktivitas terbaru).
   - Viewer: menu disembunyikan.

   Foto SELALU dikompres di sisi browser sebelum diunggah (resize maks
   1600px sisi terpanjang, re-encode JPEG kualitas ~0.72) tidak peduli
   ukuran asli file — pakai createImageBitmap({imageOrientation:'from-image'})
   biar orientasi EXIF kamera HP tetap benar tanpa loader tambahan.

   Additif — tidak mengubah app.js/rkh.js. Load PALING TERAKHIR (setelah
   rkh.js, biar bisa pakai ulang rkhGetHierarchyFor/isValidPetakFormat/dst).

   PENTING — jalankan sekali di Supabase sebelum menu ini dipakai:

   create table if not exists monitoring_pekerjaan_plantation (
     id bigint generated always as identity primary key,
     tanggal date not null,
     zona text,
     staff_id uuid,
     staff_name text,
     supervisor_id uuid,
     supervisor_name text,
     superintendent_id uuid,
     superintendent_name text,
     kegiatan text,
     petak text,
     kontraktor text,
     tk_kerja integer,
     status text,
     keterangan text,
     foto_urls text[],
     created_at timestamptz default now(),
     updated_at timestamptz default now()
   );
   alter table monitoring_pekerjaan_plantation enable row level security;
   -- Samakan RLS dengan pola rencana_kerja_harian (staff lihat/insert punya
   -- sendiri; supervisor_id/superintendent_id = auth.uid() buat atasan;
   -- admin & manager lihat semua).

   -- Storage: buat bucket PUBLIC "monitoring-photos" di Supabase Storage
   -- (Storage -> New bucket -> nama: monitoring-photos, Public: ON), lalu
   -- policy insert khusus authenticated user (sama pola bucket "avatars").

   UPDATE: judul menu jadi "Kegiatan Plantation". Tiap kartu timeline kini
   punya menu titik-3 (pojok kanan atas) isinya Lihat Detail / Ubah / Hapus
   (Ubah & Hapus cuma muncul buat pemilik data / admin / manager — lihat
   mpCanManage). Kartu foto dirender dengan panel gradasi niru referensi
   kartu "TAHAP" bergambar — CSS-nya di companion file baru
   monitoring-plantation.css (dimuat lewat index.html).
   ========================================================================= */

const MP_TABLE = 'monitoring_pekerjaan_plantation';
const MP_BUCKET = 'monitoring-photos';
const MP_STATUS_OPTIONS = ['Progres', 'Done'];
const MP_KEGIATAN_SUGGEST = [
  'POST 1','POST 2','POST 3','FSA','Weeding Rayutan','Pengendalian HPT','P. Hama Tikus',
  'Tebang Bibit','Penanaman','Pemupukan','Penyemprotan Gulma','Pembajakan','Furrowing','Panen',
];
const MP_MAX_PHOTOS = 4;
const MP_MAX_DIM = 1600;
const MP_JPEG_QUALITY = 0.72;

let mpState = { rows: [], tab: 'aksi', filterDate: todayISO(), useDateFilter: false };
let mpPendingPhotos = []; // { blob, previewUrl } — hasil kompresi, menunggu disubmit
let mpExistingPhotos = []; // url foto lama (mode ubah) — bisa dihapus/dipertahankan

/* ---------------------------------------------------------------------
   1. KOMPRESI FOTO (selalu jalan, berapa pun ukuran aslinya)
   --------------------------------------------------------------------- */
async function mpCompressImage(file, maxDim = MP_MAX_DIM, quality = MP_JPEG_QUALITY){
  let bitmap;
  try{
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  }catch(_e){
    bitmap = await createImageBitmap(file); // fallback browser lama
  }
  let w = bitmap.width, h = bitmap.height;
  if(Math.max(w, h) > maxDim){
    const scale = maxDim / Math.max(w, h);
    w = Math.round(w * scale); h = Math.round(h * scale);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
}
function mpFormatKB(bytes){ return Math.max(1, Math.round(bytes / 1024)) + ' KB'; }

/* ---------------------------------------------------------------------
   2. INPUT KAMERA — trigger langsung ke kamera perangkat (capture=environment)
   --------------------------------------------------------------------- */
function mpEnsureCameraInput(){
  let inp = document.getElementById('mpCameraInput');
  if(!inp){
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.id = 'mpCameraInput'; inp.className = 'hidden'; inp.multiple = false;
    inp.addEventListener('change', mpHandleCameraChange);
    document.body.appendChild(inp);
  }
  return inp;
}
function mpTriggerCamera(){
  if(mpExistingPhotos.length + mpPendingPhotos.length >= MP_MAX_PHOTOS){ toast(`Maksimal ${MP_MAX_PHOTOS} foto per laporan`, true); return; }
  mpEnsureCameraInput().click();
}
async function mpHandleCameraChange(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('File harus berupa gambar', true); return; }
  const originalKB = mpFormatKB(file.size);
  toast('Mengompres foto…');
  const blob = await mpCompressImage(file);
  if(!blob){ toast('Gagal memproses foto, coba lagi', true); return; }
  mpPendingPhotos.push({ blob, previewUrl: URL.createObjectURL(blob) });
  toast(`Foto siap (${originalKB} → ${mpFormatKB(blob.size)})`);
  mpRenderPhotoPreview();
}
function mpRemovePendingPhoto(idx){
  const p = mpPendingPhotos[idx];
  if(p) URL.revokeObjectURL(p.previewUrl);
  mpPendingPhotos.splice(idx, 1);
  mpRenderPhotoPreview();
}
function mpRemoveExistingPhoto(idx){
  mpExistingPhotos.splice(idx, 1);
  mpRenderPhotoPreview();
}
function mpRenderPhotoPreview(){
  const el = document.getElementById('mpPhotoPreviewGrid');
  if(!el) return;
  const existingHTML = mpExistingPhotos.map((url, i) => `
    <div style="position:relative; width:78px; height:78px; border-radius:10px; overflow:hidden; flex-shrink:0;">
      <img src="${esc(url)}" style="width:100%; height:100%; object-fit:cover; display:block;">
      <button type="button" onclick="mpRemoveExistingPhoto(${i})" style="position:absolute; top:2px; right:2px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,.65); color:#fff; font-size:12px; line-height:1; cursor:pointer;">✕</button>
    </div>
  `).join('');
  const pendingHTML = mpPendingPhotos.map((p, i) => `
    <div style="position:relative; width:78px; height:78px; border-radius:10px; overflow:hidden; flex-shrink:0;">
      <img src="${p.previewUrl}" style="width:100%; height:100%; object-fit:cover; display:block;">
      <button type="button" onclick="mpRemovePendingPhoto(${i})" style="position:absolute; top:2px; right:2px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,.65); color:#fff; font-size:12px; line-height:1; cursor:pointer;">✕</button>
    </div>
  `).join('');
  const addBtn = (mpExistingPhotos.length + mpPendingPhotos.length) < MP_MAX_PHOTOS ? `
    <button type="button" onclick="mpTriggerCamera()" style="width:78px; height:78px; border-radius:10px; border:1.5px dashed var(--border-soft); background:var(--bg-elevated); color:var(--text-muted); font-size:22px; cursor:pointer; flex-shrink:0;">📷</button>
  ` : '';
  el.innerHTML = existingHTML + pendingHTML + addBtn;
}

/* ---------------------------------------------------------------------
   3. QUERY (scope sama pola RKH)
   --------------------------------------------------------------------- */
function mpScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(MP_TABLE).select('*').order('created_at', { ascending: false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor') q = q.eq('supervisor_id', currentUser.id);
  else if(role === 'superintendent') q = q.eq('superintendent_id', currentUser.id);
  return q; // admin & manager: tanpa filter
}
async function mpFetchRows(){
  const { data, error } = await mpScopedQuery().limit(300);
  if(error){ toast('Gagal memuat Monitoring Pekerjaan Plantation: ' + error.message, true); return []; }
  return data || [];
}

/* ---------------------------------------------------------------------
   4. BADGE & KARTU TIMELINE (foto + rincian, gaya sama seperti Beranda)
   --------------------------------------------------------------------- */
function mpBadge(status){
  const cls = status === 'Done' ? 'badge-done' : status === 'Progres' ? 'badge-progress' : 'badge-neutral';
  return `<span class="badge badge-stamp ${cls}">${esc(status || '–')}</span>`;
}
function mpOpenLightbox(url){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'mpLightboxOverlay';
  overlay.onclick = () => overlay.remove();
  overlay.innerHTML = `<img src="${url}" style="max-width:92vw; max-height:88vh; border-radius:12px; box-shadow:0 20px 60px rgba(0,0,0,.5);" onclick="event.stopPropagation()">`;
  overlay.style.cssText = 'display:flex; align-items:center; justify-content:center; cursor:zoom-out;';
  document.body.appendChild(overlay);
}

/* --- Menu titik-3 (Read/Update/Delete) tiap kartu -------------------- */
function mpCanManage(item){
  const role = currentProfile?.role;
  if(role === 'admin') return true;
  if(role === 'staff') return item.staff_id === currentUser.id;
  return false; // supervisor/superintendent/manager: pantau saja (baca)
}
function mpCloseAllMenus(){
  $all('.mp-card-menu-list').forEach(el => el.classList.add('hidden'));
}
function mpToggleMenu(id, evt){
  evt?.stopPropagation();
  const el = document.getElementById('mpMenuList_' + id);
  if(!el) return;
  const willOpen = el.classList.contains('hidden');
  mpCloseAllMenus();
  if(willOpen) el.classList.remove('hidden');
}
document.addEventListener('click', (e) => {
  if(!e.target.closest?.('.mp-card-menu')) mpCloseAllMenus();
});
function mpMenuHTML(item){
  const canManage = mpCanManage(item);
  return `
    <div class="mp-card-menu">
      <button type="button" class="mp-card-menu-btn" onclick="mpToggleMenu(${item.id}, event)" aria-label="Menu">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
      <div class="mp-card-menu-list hidden" id="mpMenuList_${item.id}">
        <button type="button" onclick="event.stopPropagation(); mpCloseAllMenus(); mpOpenDetailModal(${item.id})">🔍 Lihat Detail</button>
        ${canManage ? `<button type="button" onclick="event.stopPropagation(); mpCloseAllMenus(); openMPFormModal(${item.id})">✏️ Ubah</button>` : ''}
        ${canManage ? `<button type="button" class="mp-danger" onclick="event.stopPropagation(); mpCloseAllMenus(); mpDeleteRow(${item.id})">🗑️ Hapus</button>` : ''}
      </div>
    </div>`;
}

/* --- Detail (Read) ----------------------------------------------------- */
function mpOpenDetailModal(id){
  const item = (mpState.rows || []).find(r => r.id === id);
  if(!item){ toast('Data tidak ditemukan', true); return; }
  const photos = Array.isArray(item.foto_urls) ? item.foto_urls : [];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">Detail Kegiatan Plantation</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${photos.length ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
          ${photos.map(u => `<img src="${esc(u)}" loading="lazy" style="width:96px; height:96px; object-fit:cover; border-radius:10px; cursor:zoom-in;" onclick="mpOpenLightbox('${esc(u)}')">`).join('')}
        </div>` : ''}
        <div style="font-size:13px; color:var(--text-muted); line-height:2;">
          <div><b>Tanggal</b> : ${esc(fmtTanggalRKH(item.tanggal))}</div>
          <div><b>Zona</b> : ${esc(item.zona || '-')}</div>
          <div><b>Kegiatan</b> : ${esc(item.kegiatan || '-')}</div>
          <div><b>Petak</b> : <span class="petak-tag">${esc(item.petak || '-')}</span></div>
          <div><b>Kontraktor</b> : ${esc(item.kontraktor || '-')}</div>
          <div><b>TK Kerja</b> : ${esc(item.tk_kerja ?? '-')} orang</div>
          <div><b>Status</b> : ${mpBadge(item.status)}</div>
          <div><b>Nama Pengawas</b> : ${esc(item.staff_name || '-')}</div>
          <div><b>Atasan Langsung</b> : ${esc(item.supervisor_name || '-')}</div>
          <div><b>Kadep</b> : ${esc(item.superintendent_name || '-')}</div>
          ${item.keterangan ? `<div><b>Keterangan</b> : ${esc(item.keterangan)}</div>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

/* --- Delete -------------------------------------------------------------- */
async function mpDeleteRow(id){
  const item = (mpState.rows || []).find(r => r.id === id);
  if(!item){ toast('Data tidak ditemukan', true); return; }
  if(!mpCanManage(item)){ toast('Anda tidak punya akses menghapus data ini', true); return; }
  if(!confirm('Hapus laporan Kegiatan Plantation ini? Tindakan tidak bisa dibatalkan.')) return;
  const { error } = await supa.from(MP_TABLE).delete().eq('id', id);
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  logAudit(MP_TABLE, id, item.petak, item, {}, 'hapus');
  toast('Laporan dihapus');
  renderMonitoringPlantation();
}

/* --- Kartu timeline (gaya foto + panel gradasi, gaya referensi tahapan) - */
function mpCardHTML(item){
  const photos = Array.isArray(item.foto_urls) ? item.foto_urls : [];
  const cover = photos[0];
  return `
    <div class="beranda-timeline-item">
      <div class="beranda-timeline-time">${esc(typeof timeAgo === 'function' ? timeAgo(item.created_at) : fmtTanggalRKH(item.tanggal))}</div>
      <div class="beranda-timeline-dot" style="background:var(--accent-green);">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
      </div>
      <div class="card card-hoverable beranda-timeline-content mp-card">
        ${mpMenuHTML(item)}
        <div class="mp-card-photo">
          ${cover ? `<img src="${esc(cover)}" loading="lazy" onclick="mpOpenLightbox('${esc(cover)}')">` : `<div class="mp-card-photo-empty">📷</div>`}
          <div class="mp-card-photo-stamp">${mpBadge(item.status)}</div>
        </div>
        <div class="mp-card-body">
          <div class="mp-card-eyebrow">${esc(fmtTanggalRKH(item.tanggal))} · ${esc(item.zona || '-')}</div>
          <div class="mp-card-title-row">
            <div class="mp-card-title">${esc(item.kegiatan || '-')}</div>
          </div>
          <div class="mp-card-desc">
            <div><b>Petak</b> : <span class="petak-tag">${esc(item.petak || '-')}</span></div>
            <div><b>Kontraktor</b> : ${esc(item.kontraktor || '-')}</div>
            <div><b>TK Kerja</b> : ${esc(item.tk_kerja ?? '-')} orang</div>
            <div><b>Pengawas</b> : ${esc(item.staff_name || '-')}</div>
            ${item.keterangan ? `<div><b>Ket</b> : ${esc(item.keterangan)}</div>` : ''}
          </div>
          ${photos.length > 1 ? `<div class="mp-card-extra-photos">
            ${photos.slice(1).map(u => `<img src="${esc(u)}" loading="lazy" onclick="event.stopPropagation(); mpOpenLightbox('${esc(u)}')">`).join('')}
          </div>` : ''}
        </div>
      </div>
    </div>`;
}
function mpTimelineHTML(rows, limit){
  const list = limit ? rows.slice(0, limit) : rows;
  if(!list.length) return `<div class="empty-state">Belum ada Monitoring Pekerjaan Plantation.</div>`;
  return `<div class="beranda-timeline">${list.map(mpCardHTML).join('')}</div>`;
}

/* ---------------------------------------------------------------------
   5. RINGKASAN KPI
   --------------------------------------------------------------------- */
function mpSummarize(rows){
  const s = { total: rows.length, progres: 0, done: 0, totalTK: 0 };
  rows.forEach(r => {
    if(r.status === 'Done') s.done++; else if(r.status === 'Progres') s.progres++;
    s.totalTK += parseInt(r.tk_kerja, 10) || 0;
  });
  return s;
}
function mpSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total Laporan', s.total, 'monitoring masuk', 'var(--accent-gold)')}
    ${kpiCard('Progres', s.progres, 'sedang berjalan', 'var(--accent-gold)')}
    ${kpiCard('Done', s.done, 'selesai', 'var(--accent-green)')}
    ${kpiCard('Total Tenaga Kerja', s.totalTK, 'orang tercatat', 'var(--accent-blue)')}
  </div>`;
}

/* ---------------------------------------------------------------------
   6. HALAMAN UTAMA
   --------------------------------------------------------------------- */
async function renderMonitoringPlantation(){
  $('#pageEyebrow').textContent = 'LAPANGAN';
  $('#pageTitle').textContent = 'Kegiatan Plantation';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = skeletonPageHTML();
  if(role === 'staff') return renderMPStaff();
  if(role === 'admin') return renderMPSummaryOnly();
  return renderMPAtasan(role); // supervisor, superintendent, manager
}

/* --- 6a. STAFF: form kamera + riwayat sendiri --------------------------- */
async function renderMPStaff(){
  const hier = await rkhGetHierarchyFor(currentProfile);
  const rows = await mpFetchRows();
  mpState.rows = rows;
  const s = mpSummarize(rows);

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted); display:flex; gap:18px; flex-wrap:wrap;">
        <span>Atasan Langsung: <b style="color:var(--text-strong,#fff);">${esc(hier.supervisor_name || '-')}</b></span>
        <span>Kadep: <b style="color:var(--text-strong,#fff);">${esc(hier.superintendent_name || '-')}</b></span>
      </div>
    </div>
    ${mpSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input Monitoring Pekerjaan Plantation</span>
        <button class="btn btn-primary btn-sm" onclick="openMPFormModal()">📷 Laporan Baru</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Riwayat Saya (${rows.length})</span></div>
      <div class="card-body">${mpTimelineHTML(rows)}</div>
    </div>
  `;
}

/* --- 6b. SUPERVISOR / SUPERINTENDENT / MANAGER: pantau tim -------------- */
async function renderMPAtasan(role){
  const rows = await mpFetchRows();
  mpState.rows = rows;
  const s = mpSummarize(rows);
  const filtered = mpState.useDateFilter ? rows.filter(r => r.tanggal === mpState.filterDate) : rows;

  $('#pageContent').innerHTML = `
    ${mpSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Aktivitas Tim (${filtered.length})</span>
        <label style="display:flex; align-items:center; gap:8px; font-size:12px; color:var(--text-muted);">
          <input type="checkbox" ${mpState.useDateFilter ? 'checked' : ''} onchange="mpState.useDateFilter=this.checked; renderMPAtasan('${role}');"> Filter tanggal
          ${mpState.useDateFilter ? `<input type="date" class="input" style="max-width:150px;" value="${esc(mpState.filterDate)}" onchange="mpState.filterDate=this.value; renderMPAtasan('${role}');">` : ''}
        </label>
      </div>
      <div class="card-body">${mpTimelineHTML(filtered)}</div>
    </div>
  `;
}

/* --- 6c. ADMIN: ringkasan saja ------------------------------------------ */
async function renderMPSummaryOnly(){
  const rows = await mpFetchRows();
  mpState.rows = rows;
  const s = mpSummarize(rows);
  const perZona = {};
  rows.forEach(r => { const z = r.zona || '–'; (perZona[z] = perZona[z] || []).push(r); });

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Ringkasan Monitoring Pekerjaan Plantation</span></div>
    </div>
    ${mpSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th style="text-align:center;">Total</th><th style="text-align:center;">Progres</th><th style="text-align:center;">Done</th><th style="text-align:center;">Total TK</th></tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => {
              const zs = mpSummarize(perZona[z]);
              return `<tr><td><b>${esc(z)}</b></td><td style="text-align:center;">${zs.total}</td><td style="text-align:center;">${zs.progres}</td><td style="text-align:center;">${zs.done}</td><td style="text-align:center;">${zs.totalTK}</td></tr>`;
            }).join('') : `<tr><td colspan="5" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Aktivitas Terbaru</span></div>
      <div class="card-body">${mpTimelineHTML(rows, 12)}</div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   7. FORM LAPORAN BARU (Staff, dengan kamera + kompresi)
   --------------------------------------------------------------------- */
async function openMPFormModal(id = null){
  const editing = !!id;
  const item = editing ? (mpState.rows || []).find(r => r.id === id) : null;
  if(editing && !item){ toast('Data tidak ditemukan', true); return; }
  if(editing && !mpCanManage(item)){ toast('Anda tidak punya akses mengubah data ini', true); return; }

  mpPendingPhotos = [];
  mpExistingPhotos = editing ? [...(item.foto_urls || [])] : [];
  const petakOptions = await rkhGetPetakOptions();
  const hier = await rkhGetHierarchyFor(currentProfile);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${editing ? 'Ubah Laporan Kegiatan Plantation' : 'Laporan Kegiatan Plantation'}</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px; display:flex; gap:14px; flex-wrap:wrap;">
          <span>Atasan Langsung: <b>${esc((editing ? item.supervisor_name : hier.supervisor_name) || '-')}</b></span>
          <span>Kadep: <b>${esc((editing ? item.superintendent_name : hier.superintendent_name) || '-')}</b></span>
        </div>
        <label class="field-label">Foto Lapangan (wajib, langsung dari kamera)</label>
        <div id="mpPhotoPreviewGrid" style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 4px;"></div>
        <div style="font-size:11px; color:var(--text-faint); margin-bottom:14px;">Foto otomatis dikompres sebelum diunggah, maksimal ${MP_MAX_PHOTOS} foto.</div>
        <form id="mpForm" class="form-grid">
          <div><label class="field-label">Tanggal</label><input class="input" type="date" name="tanggal" value="${esc(item?.tanggal || todayISO())}" required></div>
          <div><label class="field-label">Kegiatan</label>
            <input class="input" name="kegiatan" list="mpKegiatanList" autocomplete="off" value="${esc(item?.kegiatan || '')}" required>
            <datalist id="mpKegiatanList">${MP_KEGIATAN_SUGGEST.map(k => `<option value="${esc(k)}">`).join('')}</datalist>
          </div>
          <div><label class="field-label">Petak</label>
            <input class="input" name="petak" list="mpPetakList" autocomplete="off" placeholder="mis. PNS052502" value="${esc(item?.petak || '')}" required oninput="checkPetakFormatInput(this,'mpPetakWarn')">
            <datalist id="mpPetakList">${petakOptions.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
            ${petakFormatWarnHTML('mpPetakWarn')}
          </div>
          <div><label class="field-label">Kontraktor</label><input class="input" name="kontraktor" placeholder="mis. CV.SMM" value="${esc(item?.kontraktor || '')}"></div>
          <div><label class="field-label">TK Kerja</label><input class="input" type="number" min="0" name="tk_kerja" value="${esc(item?.tk_kerja ?? '')}"></div>
          <div><label class="field-label">Status</label>
            <select class="input" name="status" required>${MP_STATUS_OPTIONS.map(o => `<option value="${o}" ${item?.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
          </div>
          <div style="grid-column:1/-1;"><label class="field-label">Keterangan (opsional)</label><input class="input" name="keterangan" value="${esc(item?.keterangan || '')}"></div>
        </form>
        <div id="mpFormError" class="hidden" style="background:var(--accent-red-soft); color:var(--accent-red-text); padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="mpSaveBtn" onclick="submitMPForm(${editing ? id : 'null'})">${editing ? 'Simpan Perubahan' : 'Kirim Laporan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  mpRenderPhotoPreview();
}

async function mpUploadPhotos(){
  const zona = currentProfile.zona || 'umum';
  const urls = [];
  for(let i = 0; i < mpPendingPhotos.length; i++){
    const path = `${zona}/${currentUser.id}/${Date.now()}_${i}.jpg`;
    const { error } = await supa.storage.from(MP_BUCKET).upload(path, mpPendingPhotos[i].blob, { upsert: true, cacheControl: '3600', contentType: 'image/jpeg' });
    if(error) throw new Error(error.message);
    const { data: pub } = supa.storage.from(MP_BUCKET).getPublicUrl(path);
    urls.push(pub.publicUrl);
  }
  return urls;
}

async function submitMPForm(id = null){
  const editing = !!id;
  const form = $('#mpForm');
  if(!form.reportValidity()) return;
  if(!isValidPetakFormat(form.elements.petak.value)){ toast('Format kode petak harus diawali "PNS" atau "KDS" + 6 digit angka', true); return; }
  if(!(mpExistingPhotos.length + mpPendingPhotos.length)){ toast('Minimal 1 foto lapangan wajib dilampirkan', true); return; }

  const btn = $('#mpSaveBtn'); btn.disabled = true; btn.textContent = editing ? 'Menyimpan…' : 'Mengunggah…';
  $('#mpFormError').classList.add('hidden');

  try{
    const newUrls = await mpUploadPhotos();
    const foto_urls = [...mpExistingPhotos, ...newUrls];
    const payload = {
      tanggal: form.elements.tanggal.value,
      kegiatan: form.elements.kegiatan.value.trim(),
      petak: form.elements.petak.value.trim(),
      kontraktor: form.elements.kontraktor.value.trim() || null,
      tk_kerja: form.elements.tk_kerja.value === '' ? null : parseInt(form.elements.tk_kerja.value, 10),
      status: form.elements.status.value,
      keterangan: form.elements.keterangan.value.trim() || null,
      foto_urls,
      updated_at: new Date().toISOString(),
    };

    let error, before = null;
    if(editing){
      before = (mpState.rows || []).find(r => r.id === id) || null;
      ({ error } = await supa.from(MP_TABLE).update(payload).eq('id', id));
    }else{
      const hier = await rkhGetHierarchyFor(currentProfile);
      Object.assign(payload, {
        zona: currentProfile.zona || null,
        staff_id: currentUser.id,
        staff_name: currentProfile.full_name,
        supervisor_id: hier.supervisor_id,
        supervisor_name: hier.supervisor_name,
        superintendent_id: hier.superintendent_id,
        superintendent_name: hier.superintendent_name,
      });
      ({ error } = await supa.from(MP_TABLE).insert(payload));
    }
    if(error) throw new Error(error.message);
    logAudit(MP_TABLE, id, payload.petak, before, payload, 'form');
    toast(editing ? 'Laporan Kegiatan Plantation diperbarui' : 'Laporan Kegiatan Plantation terkirim');
    mpPendingPhotos.forEach(p => URL.revokeObjectURL(p.previewUrl));
    mpPendingPhotos = []; mpExistingPhotos = [];
    closeModal();
    renderMonitoringPlantation();
  }catch(err){
    $('#mpFormError').textContent = 'Gagal menyimpan: ' + err.message;
    $('#mpFormError').classList.remove('hidden');
  }finally{
    btn.disabled = false; btn.textContent = editing ? 'Simpan Perubahan' : 'Kirim Laporan';
  }
}

/* ---------------------------------------------------------------------
   8. NAVIGASI: tambah view 'monitoring_plantation'
   --------------------------------------------------------------------- */
const _mpPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'monitoring_plantation'){
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
    await renderMonitoringPlantation();
    return;
  }
  return _mpPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   9. SEMBUNYIKAN MENU UNTUK VIEWER
   --------------------------------------------------------------------- */
const _mpPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _mpPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="monitoring_plantation"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};
