/* =====================================================================
   TIMESHEET ALAT BERAT ADDON
   Di-load PALING TERAKHIR (setelah app.js, rkh.js, approval-workflow.js
   & qc-by-proses.js — dipakai untuk helper bersama: todayISO, fmtTanggalRKH,
   rkhLoadProfiles, defaultSupervisorIdFor). Sepenuhnya ADDITIF: tidak
   mengubah file lain, hanya menambah menu baru "Timesheet Alat Berat".

   Sumber bentuk form: FM-BS-ADM-05 "Laporan Pemakaian Alat (Time Sheet)"
   rev.01 — 1 lembar kertas = 1 record digital. Baris kegiatan (Jam
   Operator, Jam Alat/HM, BBM, Lokasi, Kegiatan, Produksi) bisa lebih dari
   satu per lembar → disimpan sebagai array JSON di kolom `rows`, PERSIS
   pola tabel di kertas aslinya.

   Alur:
   - HANYA akun Staff yang bisa input (dibatasi zona, sama seperti QC By
     Proses / Pengecekan Pra SPA).
   - Staff isi header (Tanggal, Pengawas, Kontraktor, Operator, Kode Unit,
     Jenis Alat, BBM dikirim, Oli) + minimal 1 baris kegiatan. Nama
     Operator & Nama Pengawas cukup diketik/dropdown teks (BUKAN akun
     login/approval digital).
   - Tiap baris kegiatan: Mulai/Selesai (Total Jam otomatis), HM Awal/HM
     Akhir (Total HM otomatis) — masing-masing BISA dilampiri FOTO bukti
     (foto HM meter alat) yang diunggah ke Supabase Storage bucket
     'timesheet-foto'. BBM Terpakai, Lokasi, Kegiatan, Produksi (Meter/M³/Ha).
   - Simpan → otomatis "Menunggu Verifikasi Supervisor" (tanpa tombol
     submit terpisah).
   - LANGKAH 1: akun Supervisor di zona sama → Verifikasi → "Menunggu
     Approval Superintendent".
   - LANGKAH 2: akun Superintendent di zona sama → Approve Final →
     "Disetujui". Bisa juga "Tolak" di kedua langkah (kembali ke staff
     dengan alasan).
   - Edit ulang baris yang sudah lewat verifikasi/approval → otomatis
     balik ke "Menunggu Verifikasi Supervisor" dari awal.
   - Admin & Manager: hanya lihat ringkasan semua zona, tanpa aksi approve.
   - Tombol "Hapus" khusus Staff, hanya untuk baris yang belum diverifikasi
     atau yang ditolak.

   PENTING — jalankan file `timesheet_alat_berat_schema.sql` (tabel + RLS +
   storage bucket & policy) di Supabase SQL Editor sebelum menu ini dipakai.
   ===================================================================== */

const TSB_TABLE = 'timesheet_alat_berat';
const TSB_BUCKET = 'timesheet-foto';
const TSB_STATUS = {
  PENDING_SUPERVISOR: 'Menunggu Verifikasi Supervisor',
  PENDING_SUPERINTENDENT: 'Menunggu Approval Superintendent',
  APPROVED: 'Disetujui',
  REJECTED: 'Ditolak',
};

let tsbState = {
  tab: 'aksi', // 'aksi' | 'tim' (supervisor/superintendent)
  rows: [],
  filters: { tanggal: '', kode_unit_alat: '', kontraktor: '', operator: '', zona: '' },
  exportRows: [],
  formRows: [],     // baris kegiatan sedang diedit di form modal
  fotoUploadCtx: null, // { idx, field } saat menunggu pilih file
};

/* ---------------------------------------------------------------------
   1. STYLE
   --------------------------------------------------------------------- */
(function tsbInjectStyles(){
  const css = `
    .tsb-filter-bar{
      display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr));
      gap:10px 12px; align-items:end; padding:14px; margin-bottom:14px;
    }
    .tsb-filter-bar .tsb-f{ display:flex; flex-direction:column; gap:4px; min-width:0; }
    .tsb-filter-bar label{ font-size:11px; color:var(--text-muted); }
    .tsb-filter-bar .input{ height:34px; box-sizing:border-box; }
    .tsb-f-reset button{ width:100%; height:34px; box-sizing:border-box; }
    @media (max-width:640px){
      .tsb-filter-bar{ grid-template-columns:1fr 1fr; }
      .tsb-f-reset{ grid-column:1 / -1; }
    }
    .tsb-header-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(200px,1fr)); gap:12px; }
    .tsb-row-card{
      background:var(--panel-soft, rgba(255,255,255,.04)); border:1px solid var(--border-soft, rgba(255,255,255,.08));
      border-radius:12px; padding:14px; margin-top:12px; position:relative;
    }
    .tsb-row-card-title{ font-weight:700; font-size:12.5px; margin-bottom:10px; display:flex; align-items:center; justify-content:space-between; }
    .tsb-row-grid{ display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:10px; }
    .tsb-row-grid label{ font-size:11px; color:var(--text-muted); display:block; margin-bottom:3px; }
    .tsb-row-total{ font-size:11.5px; color:var(--accent-gold); font-weight:700; margin-top:4px; }
    .tsb-foto-slot{ display:flex; align-items:center; gap:8px; margin-top:3px; }
    .tsb-foto-thumb{ width:44px; height:44px; border-radius:8px; object-fit:cover; border:1px solid var(--border-soft, rgba(255,255,255,.12)); cursor:pointer; }
    .tsb-foto-placeholder{ width:44px; height:44px; border-radius:8px; border:1px dashed var(--border-soft, rgba(255,255,255,.25)); display:flex; align-items:center; justify-content:center; color:var(--text-faint); font-size:16px; }
    .tsb-grand-total{ display:flex; gap:18px; flex-wrap:wrap; margin-top:14px; padding:12px 14px; background:var(--accent-gold-soft); border-radius:10px; font-size:12.5px; }
    .tsb-detail-table{ width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
    .tsb-detail-table th, .tsb-detail-table td{ border:1px solid var(--border-soft, rgba(255,255,255,.12)); padding:6px 8px; text-align:center; }
    .tsb-remove-row{ position:absolute; top:10px; right:12px; }

    /* --- Tampilan mirip kertas FM-BS-ADM-05 --- */
    .tsb-paper{ background:#fff; color:#1a1a1a; border:1px solid #999; border-radius:4px; overflow:hidden; font-family:Arial, Helvetica, sans-serif; }
    .tsb-paper-head{ display:grid; grid-template-columns:1.4fr 1fr; border-bottom:2px solid #1a1a1a; }
    .tsb-paper-head-left{ display:flex; align-items:center; gap:10px; padding:10px 14px; border-right:2px solid #1a1a1a; }
    .tsb-paper-head-left img{ width:38px; height:38px; object-fit:contain; }
    .tsb-paper-head-left .tsb-ph-title{ font-weight:800; font-size:14px; line-height:1.3; }
    .tsb-paper-head-left .tsb-ph-sub{ font-size:10.5px; color:#555; }
    .tsb-paper-head-right table{ width:100%; border-collapse:collapse; font-size:10.5px; }
    .tsb-paper-head-right td{ border-bottom:1px solid #ccc; padding:3px 8px; }
    .tsb-paper-head-right td:first-child{ width:42%; color:#555; }
    .tsb-paper-meta{ display:grid; grid-template-columns:1fr 1fr; gap:0; border-bottom:2px solid #1a1a1a; font-size:11.5px; }
    .tsb-paper-meta > div{ padding:8px 14px; }
    .tsb-paper-meta > div:first-child{ border-right:1px solid #ccc; }
    .tsb-paper-meta b{ display:inline-block; min-width:105px; color:#555; font-weight:600; }
    .tsb-paper-table{ width:100%; border-collapse:collapse; font-size:10.5px; color:#1a1a1a; }
    .tsb-paper-table th, .tsb-paper-table td{ border:1px solid #1a1a1a; padding:5px 6px; text-align:center; }
    .tsb-paper-table thead th{ background:#eee; font-weight:700; }
    .tsb-paper-table .tsb-pt-total td{ background:#f7f7f7; font-weight:700; }
    .tsb-paper-foot{ display:grid; grid-template-columns:1fr 1fr; border-top:2px solid #1a1a1a; font-size:11.5px; }
    .tsb-paper-foot > div{ padding:8px 14px; }
    .tsb-paper-foot > div:first-child{ border-right:1px solid #ccc; }
    .tsb-paper-ttd{ display:grid; grid-template-columns:repeat(4,1fr); border-top:2px solid #1a1a1a; text-align:center; font-size:11px; }
    .tsb-paper-ttd > div{ padding:12px 8px; border-right:1px solid #ccc; }
    .tsb-paper-ttd > div:last-child{ border-right:none; }
    .tsb-ttd-role{ font-weight:700; margin-bottom:26px; }
    .tsb-ttd-name{ border-top:1px solid #1a1a1a; padding-top:5px; font-weight:700; }
    .tsb-ttd-empty{ color:#aaa; font-style:italic; }
    .tsb-ttd-stamp{ display:inline-block; margin-top:4px; padding:2px 8px; border-radius:3px; font-size:9.5px; font-weight:700; }
    @media (max-width:760px){
      .tsb-paper-head{ grid-template-columns:1fr; }
      .tsb-paper-head-left{ border-right:none; border-bottom:1px solid #ccc; }
      .tsb-paper-meta{ grid-template-columns:1fr; }
      .tsb-paper-meta > div:first-child{ border-right:none; border-bottom:1px solid #ccc; }
      .tsb-paper-foot{ grid-template-columns:1fr; }
      .tsb-paper-foot > div:first-child{ border-right:none; border-bottom:1px solid #ccc; }
      .tsb-paper-ttd{ grid-template-columns:1fr 1fr; }
    }
  `;
  const el = document.createElement('style');
  el.setAttribute('data-tsb', '1');
  el.textContent = css;
  document.head.appendChild(el);
})();

/* ---------------------------------------------------------------------
   2. HELPERS BARIS KEGIATAN (jam, HM, total)
   --------------------------------------------------------------------- */
function tsbUid(){ return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function tsbNewRow(){
  return { localId: tsbUid(), mulai:'', selesai:'', total_jam:null, hm_awal:'', hm_akhir:'', total_hm:null,
    hm_awal_foto:'', hm_akhir_foto:'', bbm_terpakai:'', lokasi:'', kegiatan:'', meter:'', m3:'', ha:'' };
}
function tsbJamToMinutes(hhmm){
  if(!hhmm) return null;
  const [h,m] = hhmm.split(':').map(Number);
  if(isNaN(h) || isNaN(m)) return null;
  return h*60+m;
}
function tsbComputeTotalJam(mulai, selesai){
  const a = tsbJamToMinutes(mulai), b = tsbJamToMinutes(selesai);
  if(a===null || b===null) return null;
  let diff = b - a;
  if(diff <= 0) diff += 24*60; // lewat tengah malam
  return Math.round((diff/60) * 100) / 100;
}
function tsbComputeTotalHm(awal, akhir){
  const a = parseFloat(awal), b = parseFloat(akhir);
  if(isNaN(a) || isNaN(b)) return null;
  const diff = Math.round((b-a) * 100) / 100;
  return diff < 0 ? null : diff;
}
function tsbGrandTotals(rows){
  return rows.reduce((acc,r) => {
    acc.jam += (parseFloat(r.total_jam) || 0);
    acc.hm += (parseFloat(r.total_hm) || 0);
    return acc;
  }, { jam:0, hm:0 });
}

/* ---------------------------------------------------------------------
   3. UPLOAD FOTO HM AWAL / HM AKHIR (Supabase Storage)
   --------------------------------------------------------------------- */
function tsbEnsureFileInput(){
  let inp = document.getElementById('tsbFotoFileInput');
  if(!inp){
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'tsbFotoFileInput'; inp.style.display = 'none';
    inp.addEventListener('change', tsbHandleFotoChange);
    document.body.appendChild(inp);
  }
  return inp;
}
function tsbTriggerFotoUpload(idx, field){
  tsbState.fotoUploadCtx = { idx, field };
  tsbEnsureFileInput().click();
}
async function tsbHandleFotoChange(e){
  const file = e.target.files[0];
  e.target.value = '';
  const ctx = tsbState.fotoUploadCtx;
  if(!file || !ctx) return;
  if(!file.type.startsWith('image/')){ toast('File harus berupa gambar', true); return; }
  if(file.size > 8*1024*1024){ toast('Ukuran gambar maksimal 8MB', true); return; }

  const slot = document.getElementById(`tsbFotoSlot_${ctx.idx}_${ctx.field}`);
  if(slot) slot.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">Mengunggah…</span>`;

  const objUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const MAX_W = 1280;
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => {
      URL.revokeObjectURL(objUrl);
      if(!blob){ toast('Gagal memproses gambar', true); return; }
      const path = `${currentUser.id}/${Date.now()}_${ctx.field}_${Math.random().toString(36).slice(2,7)}.jpg`;
      const { error: upErr } = await supa.storage.from(TSB_BUCKET).upload(path, blob, { upsert: true, cacheControl: '3600', contentType: 'image/jpeg' });
      if(upErr){
        toast('Gagal mengunggah foto: ' + upErr.message, true);
        if(slot) slot.innerHTML = tsbFotoSlotInnerHTML(idxFieldRow(ctx.idx), ctx.field);
        return;
      }
      const { data: pub } = supa.storage.from(TSB_BUCKET).getPublicUrl(path);
      const url = pub.publicUrl + '?t=' + Date.now();
      const row = tsbState.formRows[ctx.idx];
      if(row){ row[ctx.field] = url; }
      if(slot) slot.innerHTML = tsbFotoSlotInnerHTML(row, ctx.field, ctx.idx);
      toast('Foto berhasil diunggah');
    }, 'image/jpeg', 0.85);
  };
  img.onerror = () => toast('Gagal membaca gambar', true);
  img.src = objUrl;
}
function idxFieldRow(idx){ return tsbState.formRows[idx]; }
function tsbFotoSlotInnerHTML(row, field, idx){
  const url = row ? row[field] : '';
  if(url){
    return `
      <img class="tsb-foto-thumb" src="${esc(url)}" onclick="window.open('${esc(url)}','_blank')" alt="Foto ${field}">
      <button type="button" class="btn btn-outline btn-sm" onclick="tsbTriggerFotoUpload(${idx},'${field}')">Ganti</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="tsbRemoveFoto(${idx},'${field}')">Hapus</button>
    `;
  }
  return `
    <div class="tsb-foto-placeholder">📷</div>
    <button type="button" class="btn btn-outline btn-sm" onclick="tsbTriggerFotoUpload(${idx},'${field}')">Unggah Foto</button>
  `;
}
function tsbRemoveFoto(idx, field){
  const row = tsbState.formRows[idx];
  if(!row) return;
  row[field] = '';
  const slot = document.getElementById(`tsbFotoSlot_${idx}_${field}`);
  if(slot) slot.innerHTML = tsbFotoSlotInnerHTML(row, field, idx);
}

/* ---------------------------------------------------------------------
   4. BARIS KEGIATAN — render & update (form modal)
   --------------------------------------------------------------------- */
function tsbRowCardHTML(row, idx){
  return `
    <div class="tsb-row-card" data-row-idx="${idx}">
      ${tsbState.formRows.length > 1 ? `<button type="button" class="btn btn-danger btn-sm tsb-remove-row" onclick="tsbRemoveRow(${idx})">✕</button>` : ''}
      <div class="tsb-row-card-title">Baris Kegiatan #${idx+1}</div>
      <div class="tsb-row-grid">
        <div><label>Jam Mulai</label><input class="input" type="time" value="${esc(row.mulai)}" onchange="tsbUpdateField(${idx},'mulai',this.value)"></div>
        <div><label>Jam Selesai</label><input class="input" type="time" value="${esc(row.selesai)}" onchange="tsbUpdateField(${idx},'selesai',this.value)"></div>
        <div><label>Total Jam</label><div class="tsb-row-total" id="tsbTotalJam_${idx}">${row.total_jam ?? '–'}</div></div>

        <div>
          <label>HM Awal</label>
          <input class="input" type="number" step="0.01" value="${esc(row.hm_awal)}" onchange="tsbUpdateField(${idx},'hm_awal',this.value)">
          <div class="tsb-foto-slot" id="tsbFotoSlot_${idx}_hm_awal_foto">${tsbFotoSlotInnerHTML(row,'hm_awal_foto',idx)}</div>
        </div>
        <div>
          <label>HM Akhir</label>
          <input class="input" type="number" step="0.01" value="${esc(row.hm_akhir)}" onchange="tsbUpdateField(${idx},'hm_akhir',this.value)">
          <div class="tsb-foto-slot" id="tsbFotoSlot_${idx}_hm_akhir_foto">${tsbFotoSlotInnerHTML(row,'hm_akhir_foto',idx)}</div>
        </div>
        <div><label>Total HM</label><div class="tsb-row-total" id="tsbTotalHm_${idx}">${row.total_hm ?? '–'}</div></div>

        <div><label>BBM Terpakai (Ltr)</label><input class="input" type="number" step="0.01" value="${esc(row.bbm_terpakai)}" onchange="tsbUpdateField(${idx},'bbm_terpakai',this.value)"></div>
        <div><label>Lokasi</label><input class="input" value="${esc(row.lokasi)}" onchange="tsbUpdateField(${idx},'lokasi',this.value)"></div>
        <div><label>Kegiatan / Activity</label><input class="input" value="${esc(row.kegiatan)}" onchange="tsbUpdateField(${idx},'kegiatan',this.value)"></div>

        <div><label>Produksi — Meter</label><input class="input" type="number" step="0.01" value="${esc(row.meter)}" onchange="tsbUpdateField(${idx},'meter',this.value)"></div>
        <div><label>Produksi — M³</label><input class="input" type="number" step="0.01" value="${esc(row.m3)}" onchange="tsbUpdateField(${idx},'m3',this.value)"></div>
        <div><label>Produksi — Ha</label><input class="input" type="number" step="0.01" value="${esc(row.ha)}" onchange="tsbUpdateField(${idx},'ha',this.value)"></div>
      </div>
    </div>
  `;
}
function tsbUpdateField(idx, field, value){
  const row = tsbState.formRows[idx];
  if(!row) return;
  row[field] = value;
  if(field==='mulai' || field==='selesai'){
    row.total_jam = tsbComputeTotalJam(row.mulai, row.selesai);
    const el = document.getElementById(`tsbTotalJam_${idx}`); if(el) el.textContent = row.total_jam ?? '–';
  }
  if(field==='hm_awal' || field==='hm_akhir'){
    row.total_hm = tsbComputeTotalHm(row.hm_awal, row.hm_akhir);
    const el = document.getElementById(`tsbTotalHm_${idx}`); if(el) el.textContent = row.total_hm ?? '–';
  }
  tsbRecomputeGrandTotalBox();
}
function tsbRecomputeGrandTotalBox(){
  const box = document.getElementById('tsbGrandTotalBox');
  if(!box) return;
  const t = tsbGrandTotals(tsbState.formRows);
  box.innerHTML = `<span>Total Jam Keseluruhan: <b>${t.jam || '–'}</b></span><span>Total HM Keseluruhan: <b>${t.hm || '–'}</b></span>`;
}
function tsbAddRow(){
  tsbState.formRows.push(tsbNewRow());
  tsbRerenderRowArea();
}
function tsbRemoveRow(idx){
  if(tsbState.formRows.length <= 1) return;
  tsbState.formRows.splice(idx, 1);
  tsbRerenderRowArea();
}
function tsbRerenderRowArea(){
  const area = document.getElementById('tsbRowArea');
  if(area) area.innerHTML = tsbState.formRows.map((r,i) => tsbRowCardHTML(r,i)).join('');
  tsbRecomputeGrandTotalBox();
}

/* ---------------------------------------------------------------------
   5. DATA FETCH (dibatasi peran) & FILTER
   --------------------------------------------------------------------- */
function tsbScopedQuery(){
  const role = currentProfile?.role;
  let q = supa.from(TSB_TABLE).select('*').order('created_at', { ascending: false });
  if(role === 'staff') q = q.eq('staff_id', currentUser.id);
  else if(role === 'supervisor' || role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim();
    if(z) q = q.ilike('zona', z);
  }
  return q;
}
async function tsbFetchRows(){
  const { data, error } = await tsbScopedQuery().limit(500);
  if(error){ toast('Gagal memuat Timesheet Alat Berat: ' + error.message, true); return []; }
  let rows = data || [];
  if(currentProfile?.role === 'supervisor' || currentProfile?.role === 'superintendent'){
    const z = (currentProfile.zona || '').toString().trim().toUpperCase();
    if(z) rows = rows.filter(r => (r.zona || '').toString().trim().toUpperCase() === z);
  }
  return rows;
}
function tsbApplyFilters(rows){
  const f = tsbState.filters;
  return rows.filter(r => {
    if(f.tanggal && r.tanggal !== f.tanggal) return false;
    if(f.kode_unit_alat && !(r.kode_unit_alat||'').toLowerCase().includes(f.kode_unit_alat.toLowerCase())) return false;
    if(f.kontraktor && !(r.kontraktor||'').toLowerCase().includes(f.kontraktor.toLowerCase())) return false;
    if(f.operator && !(r.nama_operator||'').toLowerCase().includes(f.operator.toLowerCase())) return false;
    if(f.zona && (r.zona||'').toLowerCase() !== f.zona.toLowerCase()) return false;
    return true;
  });
}
function tsbFilterBarHTML(rerenderFn, showZona){
  const f = tsbState.filters;
  return `
    <div class="card tsb-filter-bar">
      <div class="tsb-f"><label>Tanggal</label><input class="input" type="date" value="${esc(f.tanggal)}" onchange="tsbState.filters.tanggal=this.value; ${rerenderFn}"></div>
      ${showZona ? `<div class="tsb-f"><label>Zona</label><input class="input" placeholder="Cari zona…" value="${esc(f.zona)}" oninput="tsbState.filters.zona=this.value; ${rerenderFn}"></div>` : ''}
      <div class="tsb-f"><label>Kode Unit Alat</label><input class="input" placeholder="Cari kode unit…" value="${esc(f.kode_unit_alat)}" oninput="tsbState.filters.kode_unit_alat=this.value; ${rerenderFn}"></div>
      <div class="tsb-f"><label>Kontraktor</label><input class="input" placeholder="Cari kontraktor…" value="${esc(f.kontraktor)}" oninput="tsbState.filters.kontraktor=this.value; ${rerenderFn}"></div>
      <div class="tsb-f"><label>Operator</label><input class="input" placeholder="Cari operator…" value="${esc(f.operator)}" oninput="tsbState.filters.operator=this.value; ${rerenderFn}"></div>
      <div class="tsb-f tsb-f-reset"><button class="btn btn-outline btn-sm" onclick="tsbState.filters={tanggal:'',kode_unit_alat:'',kontraktor:'',operator:'',zona:''}; ${rerenderFn}">Reset Filter</button></div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   6. BADGE & RINGKASAN
   --------------------------------------------------------------------- */
function tsbBadge(status){
  const map = {
    [TSB_STATUS.PENDING_SUPERVISOR]: 'badge-neutral',
    [TSB_STATUS.PENDING_SUPERINTENDENT]: 'badge-progress',
    [TSB_STATUS.APPROVED]: 'badge-done',
    [TSB_STATUS.REJECTED]: 'badge-rejected',
  };
  return `<span class="badge badge-stamp ${map[status] || 'badge-neutral'}">${esc(status || '–')}</span>`;
}
function tsbSummarize(rows){
  const s = { total: rows.length, pendingSupervisor:0, pendingSuperintendent:0, approved:0, rejected:0, totalJam:0, totalHm:0 };
  rows.forEach(r => {
    if(r.status_approval === TSB_STATUS.PENDING_SUPERVISOR) s.pendingSupervisor++;
    else if(r.status_approval === TSB_STATUS.PENDING_SUPERINTENDENT) s.pendingSuperintendent++;
    else if(r.status_approval === TSB_STATUS.APPROVED) s.approved++;
    else if(r.status_approval === TSB_STATUS.REJECTED) s.rejected++;
    s.totalJam += (parseFloat(r.total_jam) || 0);
    s.totalHm += (parseFloat(r.total_hm) || 0);
  });
  return s;
}
function tsbRecapByUnit(rows){
  const map = {};
  rows.forEach(r => {
    const key = r.kode_unit_alat || '–';
    if(!map[key]) map[key] = { kode_unit_alat:key, jenis_alat:r.jenis_alat||'-', jumlah:0, totalJam:0, totalHm:0, pendingSupervisor:0, pendingSuperintendent:0, approved:0, rejected:0 };
    const b = map[key];
    b.jumlah++;
    b.totalJam += (parseFloat(r.total_jam)||0);
    b.totalHm += (parseFloat(r.total_hm)||0);
    if(r.status_approval===TSB_STATUS.PENDING_SUPERVISOR) b.pendingSupervisor++;
    else if(r.status_approval===TSB_STATUS.PENDING_SUPERINTENDENT) b.pendingSuperintendent++;
    else if(r.status_approval===TSB_STATUS.APPROVED) b.approved++;
    else if(r.status_approval===TSB_STATUS.REJECTED) b.rejected++;
  });
  return Object.values(map).sort((a,b) => a.kode_unit_alat.localeCompare(b.kode_unit_alat));
}
function tsbRecapTableHTML(rows, title){
  const recap = tsbRecapByUnit(rows);
  return `
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">${esc(title)}</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Kode Unit</th><th>Jenis Alat</th><th style="text-align:right;">Jumlah Lembar</th><th style="text-align:right;">Total Jam</th><th style="text-align:right;">Total HM</th><th style="text-align:right;">Menunggu Verifikasi</th><th style="text-align:right;">Menunggu Approval</th><th style="text-align:right;">Disetujui</th><th style="text-align:right;">Ditolak</th></tr></thead>
          <tbody>
            ${recap.length ? recap.map(b => `
              <tr>
                <td><span class="petak-tag">${esc(b.kode_unit_alat)}</span></td>
                <td>${esc(b.jenis_alat)}</td>
                <td style="text-align:right;">${b.jumlah}</td>
                <td style="text-align:right;"><b>${fmtNum(b.totalJam,1)}</b></td>
                <td style="text-align:right;"><b>${fmtNum(b.totalHm,1)}</b></td>
                <td style="text-align:right;">${b.pendingSupervisor}</td>
                <td style="text-align:right;">${b.pendingSuperintendent}</td>
                <td style="text-align:right;">${b.approved}</td>
                <td style="text-align:right;">${b.rejected}</td>
              </tr>
            `).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function tsbSummaryCards(s){
  return `<div class="kpi-grid">
    ${kpiCard('Total Timesheet', s.total, 'lembar', 'var(--accent-gold)')}
    ${kpiCard('Menunggu Verifikasi', s.pendingSupervisor, 'tahap Supervisor', 'var(--accent-red)')}
    ${kpiCard('Menunggu Approval', s.pendingSuperintendent, 'tahap Superintendent', 'var(--accent-gold)')}
    ${kpiCard('Disetujui', s.approved, 'sudah final', 'var(--accent-green)')}
    ${kpiCard('Total Jam / HM', `${fmtNum(s.totalJam,1)} / ${fmtNum(s.totalHm,1)}`, 'akumulasi sesuai filter', 'var(--accent-blue)')}
  </div>`;
}

/* ---------------------------------------------------------------------
   7. HALAMAN UTAMA "Timesheet Alat Berat"
   --------------------------------------------------------------------- */
async function renderTimesheetAlatBerat(){
  $('#pageEyebrow').textContent = 'PRODUKTIVITAS';
  $('#pageTitle').textContent = 'Timesheet Alat Berat';
  const role = currentProfile?.role;
  if(role === 'viewer'){
    $('#pageContent').innerHTML = `<div class="empty-state">Menu ini tidak tersedia untuk role Viewer.</div>`;
    return;
  }
  $('#pageContent').innerHTML = skeletonPageHTML();

  if(role === 'staff') return renderTsbStaff();
  if(role === 'supervisor') return renderTsbAtasan('supervisor');
  if(role === 'superintendent') return renderTsbAtasan('superintendent');
  return renderTsbAdminManager(); // admin & manager — lihat SEMUA timesheet semua zona
}

/* --- 7a. STAFF ---------------------------------------------------------- */
async function renderTsbStaff(){
  if(!(currentProfile.zona || '').toString().trim()){
    $('#pageContent').innerHTML = `<div class="card"><div class="card-body" style="padding:18px;">
      <p style="color:var(--text-muted);">Akun Anda belum diatur <b>Zona</b> oleh Admin. Silakan hubungi Admin
      untuk melengkapi ini di menu Kelola Pengguna sebelum bisa mengisi Timesheet Alat Berat.</p>
    </div></div>`;
    return;
  }
  const allRows = await tsbFetchRows();
  tsbState.rows = allRows;
  const rows = tsbApplyFilters(allRows);
  const s = tsbSummarize(rows);

  $('#pageContent').innerHTML = `
    ${tsbSummaryCards(s)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header">
        <span class="card-title">Input Timesheet Alat Berat</span>
        <button class="btn btn-primary btn-sm" onclick="openTsbFormModal()">+ Tambah Timesheet</button>
      </div>
    </div>
    ${tsbFilterBarHTML('renderTsbStaff()')}
    <div class="card">
      <div class="card-header"><span class="card-title">Riwayat Timesheet Saya (${rows.length})</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Kode Unit</th><th>Jenis Alat</th><th>Operator</th><th>Kontraktor</th><th>Total Jam</th><th>Total HM</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td><span class="petak-tag">${esc(r.kode_unit_alat||'-')}</span></td>
                <td>${esc(r.jenis_alat||'-')}</td>
                <td>${esc(r.nama_operator||'-')}</td>
                <td>${esc(r.kontraktor||'-')}</td>
                <td>${r.total_jam ?? '-'}</td>
                <td>${r.total_hm ?? '-'}</td>
                <td>${tsbBadge(r.status_approval)}${r.status_approval===TSB_STATUS.REJECTED && r.rejected_reason ? `<div style="font-size:11px; color:var(--accent-red-text); margin-top:3px;">${esc(r.rejected_reason)}</div>` : ''}</td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-outline btn-sm" onclick="openTsbDetailModal(${r.id})">Detail</button>
                  ${(r.status_approval===TSB_STATUS.PENDING_SUPERVISOR || r.status_approval===TSB_STATUS.REJECTED) ? `<button class="btn btn-outline btn-sm" onclick="openTsbFormModal(${r.id})">Edit</button><button class="btn btn-danger btn-sm" onclick="tsbDeleteRow(${r.id})">Hapus</button>` : ''}
                </td>
              </tr>
            `).join('') : `<tr><td colspan="9" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* --- 7b. SUPERVISOR / SUPERINTENDENT ------------------------------------ */
function tsbStageFor(role){
  return role === 'supervisor'
    ? { pendingStatus: TSB_STATUS.PENDING_SUPERVISOR, actionLabel: 'Verifikasi' }
    : { pendingStatus: TSB_STATUS.PENDING_SUPERINTENDENT, actionLabel: 'Approve Final' };
}
function tsbExportRows(rows){
  return rows.map(r => ({
    'Tanggal': fmtTanggalRKH(r.tanggal), 'Zona': r.zona || '-', 'Kode Unit': r.kode_unit_alat, 'Jenis Alat': r.jenis_alat,
    'Operator': r.nama_operator, 'Pengawas': r.nama_pengawas, 'Kontraktor': r.kontraktor,
    'Total Jam': r.total_jam ?? '-', 'Total HM': r.total_hm ?? '-', 'Status': r.status_approval,
  }));
}
function tsbExportJPEG(rows){
  openExportDateRangeModal({ rows, dateField: 'tanggal', mapRow: r => tsbExportRows([r])[0], title: 'Timesheet Alat Berat', filePrefix: 'timesheet_alat_berat' });
}
async function renderTsbAtasan(role){
  const stage = tsbStageFor(role);
  const allRows = await tsbFetchRows();
  tsbState.rows = allRows;
  const s = tsbSummarize(allRows);
  const perluAksi = allRows.filter(r => r.status_approval === stage.pendingStatus);
  const filteredTim = tsbApplyFilters(allRows);
  tsbState.exportRows = filteredTim;

  $('#pageContent').innerHTML = `
    ${tsbSummaryCards(s)}
    <div class="rkh-tabs" style="margin-top:16px;">
      <button class="btn btn-sm ${tsbState.tab==='aksi'?'btn-primary':'btn-outline'}" onclick="tsbState.tab='aksi'; renderTsbAtasan('${role}');">Perlu ${esc(stage.actionLabel)} (${perluAksi.length})</button>
      <button class="btn btn-sm ${tsbState.tab==='tim'?'btn-primary':'btn-outline'}" onclick="tsbState.tab='tim'; renderTsbAtasan('${role}');">Semua Timesheet Zona Saya</button>
    </div>
    ${tsbState.tab==='aksi' ? `
      <div class="card">
        <div class="card-header"><span class="card-title">Menunggu ${esc(stage.actionLabel)} Anda</span></div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Tanggal</th><th>Staff</th><th>Kode Unit</th><th>Operator</th><th>Total Jam</th><th>Total HM</th><th>Aksi</th></tr></thead>
            <tbody>
              ${perluAksi.length ? perluAksi.map(r => `
                <tr>
                  <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                  <td>${esc(r.staff_name)}</td>
                  <td><span class="petak-tag">${esc(r.kode_unit_alat||'-')}</span></td>
                  <td>${esc(r.nama_operator||'-')}</td>
                  <td>${r.total_jam ?? '-'}</td>
                  <td>${r.total_hm ?? '-'}</td>
                  <td><button class="btn btn-primary btn-sm" onclick="openTsbDetailModal(${r.id})">Lihat & Tindak Lanjut</button></td>
                </tr>
              `).join('') : `<tr><td colspan="7" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada yang perlu ditindaklanjuti.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    ` : `
      ${tsbFilterBarHTML(`renderTsbAtasan('${role}')`)}
      <div class="card">
        <div class="card-header"><span class="card-title">Rekap Timesheet Zona ${esc(currentProfile.zona||'-')} (${filteredTim.length} lembar)</span><button class="btn btn-outline btn-sm" style="height:34px; box-sizing:border-box;" onclick="tsbExportJPEG(tsbState.exportRows)">Export JPEG</button></div>
      </div>
      ${tsbRecapTableHTML(filteredTim, 'Rekap per Kode Unit Alat — Zona Saya')}
    `}
  `;
}

/* --- 7c. ADMIN / MANAGER (SEMUA timesheet, SEMUA zona) ------------------ */
async function renderTsbAdminManager(){
  const allRows = await tsbFetchRows(); // admin/manager: tsbScopedQuery tidak membatasi zona -> otomatis SEMUA
  tsbState.rows = allRows;
  const rows = tsbApplyFilters(allRows);
  tsbState.exportRows = rows;
  const s = tsbSummarize(rows);
  const perZona = {};
  rows.forEach(r => { perZona[r.zona || '–'] = true; });
  Object.keys(perZona).forEach(z => { perZona[z] = tsbSummarize(rows.filter(r => (r.zona||'–') === z)); });

  $('#pageContent').innerHTML = `
    ${tsbSummaryCards(s)}
    <div class="card" style="margin-bottom:16px;"><div class="card-header"><span class="card-title">Timesheet Alat Berat — Semua Zona</span><button class="btn btn-outline btn-sm" onclick="tsbExportJPEG(tsbState.exportRows)">Export JPEG</button></div></div>
    ${tsbFilterBarHTML('renderTsbAdminManager()', true)}
    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Ringkasan per Zona</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Zona</th><th style="text-align:right;">Total</th><th style="text-align:right;">Menunggu Verifikasi</th><th style="text-align:right;">Menunggu Approval</th><th style="text-align:right;">Disetujui</th><th style="text-align:right;">Ditolak</th><th style="text-align:right;">Total Jam</th><th style="text-align:right;">Total HM</th></tr></thead>
          <tbody>
            ${Object.keys(perZona).length ? Object.keys(perZona).sort().map(z => `
              <tr>
                <td><b>${esc(z)}</b></td>
                <td style="text-align:right;">${perZona[z].total}</td>
                <td style="text-align:right;">${perZona[z].pendingSupervisor}</td>
                <td style="text-align:right;">${perZona[z].pendingSuperintendent}</td>
                <td style="text-align:right;">${perZona[z].approved}</td>
                <td style="text-align:right;">${perZona[z].rejected}</td>
                <td style="text-align:right;"><b>${fmtNum(perZona[z].totalJam,1)}</b></td>
                <td style="text-align:right;"><b>${fmtNum(perZona[z].totalHm,1)}</b></td>
              </tr>
            `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-header"><span class="card-title">Semua Timesheet — Daftar Lengkap (${rows.length})</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Tanggal</th><th>Zona</th><th>Staff</th><th>Kode Unit</th><th>Jenis Alat</th><th>Operator</th><th>Kontraktor</th><th>Total Jam</th><th>Total HM</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `
              <tr>
                <td>${esc(fmtTanggalRKH(r.tanggal))}</td>
                <td><b>${esc(r.zona||'-')}</b></td>
                <td>${esc(r.staff_name||'-')}</td>
                <td><span class="petak-tag">${esc(r.kode_unit_alat||'-')}</span></td>
                <td>${esc(r.jenis_alat||'-')}</td>
                <td>${esc(r.nama_operator||'-')}</td>
                <td>${esc(r.kontraktor||'-')}</td>
                <td>${r.total_jam ?? '-'}</td>
                <td>${r.total_hm ?? '-'}</td>
                <td>${tsbBadge(r.status_approval)}</td>
                <td><button class="btn btn-outline btn-sm" onclick="openTsbDetailModal(${r.id})">Detail</button></td>
              </tr>
            `).join('') : `<tr><td colspan="11" style="text-align:center; color:var(--text-faint); padding:24px;">Tidak ada data sesuai filter.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/* ---------------------------------------------------------------------
   8. FORM TAMBAH / EDIT (Staff)
   --------------------------------------------------------------------- */
async function openTsbFormModal(id){
  const existing = id ? tsbState.rows.find(r => r.id === id) : null;
  const supervisors = await qcpSupervisorsInZona(currentProfile.zona);
  const tsbDefaultSvId = defaultSupervisorIdFor(supervisors);
  tsbState.formRows = existing && Array.isArray(existing.rows) && existing.rows.length
    ? JSON.parse(JSON.stringify(existing.rows)).map(r => ({ ...tsbNewRow(), ...r, localId: tsbUid() }))
    : [tsbNewRow()];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:920px;">
      <div class="modal-header">
        <div class="card-title">${existing ? 'Edit' : 'Tambah'} Timesheet Alat Berat</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="tsbForm" class="tsb-header-grid">
          <div><label class="field-label">Tanggal</label><input class="input" type="date" name="tanggal" value="${esc(existing ? existing.tanggal : todayISO())}" required></div>
          <div><label class="field-label">Nama Pengawas</label><input class="input" name="nama_pengawas" value="${esc(existing?.nama_pengawas||'')}" required></div>
          <div><label class="field-label">Kontraktor</label><input class="input" name="kontraktor" value="${esc(existing?.kontraktor||'')}"></div>
          <div><label class="field-label">Nama Operator</label><input class="input" name="nama_operator" value="${esc(existing?.nama_operator||'')}" required></div>
          <div><label class="field-label">Kode Unit Alat</label><input class="input" name="kode_unit_alat" value="${esc(existing?.kode_unit_alat||'')}" required></div>
          <div><label class="field-label">Jenis Alat</label><input class="input" name="jenis_alat" value="${esc(existing?.jenis_alat||'')}" required></div>
          <div><label class="field-label">BBM Dikirim Hari Ini (Ltr)</label><input class="input" type="number" step="0.01" name="bbm_dikirim" value="${esc(existing?.bbm_dikirim??'')}"></div>
          <div><label class="field-label">Oli (Ltr)</label><input class="input" type="number" step="0.01" name="oli" value="${esc(existing?.oli??'')}"></div>
          <div>
            <label class="field-label">Spv</label>
            <select class="input" name="supervisor_id" required>
              <option value="">— Pilih Supervisor (Zona ${esc(currentProfile.zona||'-')}) —</option>
              ${supervisors.map(sv => `<option value="${sv.id}" ${(existing ? existing.supervisor_id===sv.id : sv.id===tsbDefaultSvId) ? 'selected':''}>${esc(sv.full_name)}</option>`).join('')}
            </select>
            ${!supervisors.length ? `<div style="font-size:11.5px; color:var(--accent-red-text); margin-top:4px;">Belum ada akun Supervisor di zona ini. Hubungi Admin.</div>` : ''}
          </div>
        </form>

        <div style="margin-top:16px; display:flex; align-items:center; justify-content:space-between;">
          <label class="field-label" style="margin:0;">Baris Kegiatan (Jam Operator / Jam Alat / BBM / Lokasi / Kegiatan / Produksi)</label>
          <button type="button" class="btn btn-outline btn-sm" onclick="tsbAddRow()">+ Tambah Baris</button>
        </div>
        <div id="tsbRowArea">${tsbState.formRows.map((r,i) => tsbRowCardHTML(r,i)).join('')}</div>
        <div class="tsb-grand-total" id="tsbGrandTotalBox"></div>

        <div style="margin-top:14px;"><label class="field-label">Keterangan (opsional)</label><textarea class="input" id="tsbKeterangan" rows="2">${esc(existing?.keterangan||'')}</textarea></div>

        <div id="tsbFormError" class="hidden" style="background:var(--accent-red-soft); color:var(--accent-red-text); padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="tsbSaveBtn" onclick="submitTsbForm(${existing ? existing.id : 'null'})">${existing ? 'Simpan Perubahan' : 'Tambahkan'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  tsbRecomputeGrandTotalBox();
}

async function submitTsbForm(id){
  const form = $('#tsbForm');
  if(!form.reportValidity()) return;

  const filledRows = tsbState.formRows.filter(r => r.kegiatan && r.kegiatan.trim());
  if(!filledRows.length){ toast('Minimal 1 baris kegiatan wajib diisi (kolom Kegiatan)', true); return; }

  const btn = $('#tsbSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  $('#tsbFormError').classList.add('hidden');

  const supervisorId = form.elements.supervisor_id.value;
  const supervisors = await qcpSupervisorsInZona(currentProfile.zona);
  const supervisorProfile = supervisors.find(sv => sv.id === supervisorId);
  const totals = tsbGrandTotals(tsbState.formRows);

  const cleanRows = tsbState.formRows.map(r => ({
    mulai: r.mulai || null, selesai: r.selesai || null, total_jam: r.total_jam,
    hm_awal: r.hm_awal === '' ? null : parseFloat(r.hm_awal), hm_akhir: r.hm_akhir === '' ? null : parseFloat(r.hm_akhir),
    total_hm: r.total_hm, hm_awal_foto: r.hm_awal_foto || null, hm_akhir_foto: r.hm_akhir_foto || null,
    bbm_terpakai: r.bbm_terpakai === '' ? null : parseFloat(r.bbm_terpakai),
    lokasi: r.lokasi || null, kegiatan: r.kegiatan || null,
    meter: r.meter === '' ? null : parseFloat(r.meter), m3: r.m3 === '' ? null : parseFloat(r.m3), ha: r.ha === '' ? null : parseFloat(r.ha),
  }));

  const payload = {
    tanggal: form.elements.tanggal.value,
    zona: currentProfile.zona || null,
    nama_pengawas: form.elements.nama_pengawas.value.trim(),
    kontraktor: form.elements.kontraktor.value.trim() || null,
    nama_operator: form.elements.nama_operator.value.trim(),
    kode_unit_alat: form.elements.kode_unit_alat.value.trim(),
    jenis_alat: form.elements.jenis_alat.value.trim(),
    rows: cleanRows,
    total_jam: Math.round(totals.jam*100)/100,
    total_hm: Math.round(totals.hm*100)/100,
    bbm_dikirim: form.elements.bbm_dikirim.value === '' ? null : parseFloat(form.elements.bbm_dikirim.value),
    oli: form.elements.oli.value === '' ? null : parseFloat(form.elements.oli.value),
    keterangan: $('#tsbKeterangan').value.trim() || null,
    supervisor_id: supervisorId || null,
    supervisor_name: supervisorProfile ? supervisorProfile.full_name : null,
    staff_id: currentUser.id,
    staff_name: currentProfile.full_name,
    status_approval: TSB_STATUS.PENDING_SUPERVISOR,
    rejected_reason: null, rejected_by_stage: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    approved_by: null, approved_by_name: null, approved_at: null,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supa.from(TSB_TABLE).update(payload).eq('id', id)
    : await supa.from(TSB_TABLE).insert(payload);

  btn.disabled = false; btn.textContent = id ? 'Simpan Perubahan' : 'Tambahkan';
  if(error){
    $('#tsbFormError').textContent = 'Gagal menyimpan: ' + error.message;
    $('#tsbFormError').classList.remove('hidden');
    return;
  }
  const before = id ? (tsbState.rows || []).find(r => r.id === id) || null : null;
  logAudit(TSB_TABLE, id, payload.kode_unit_alat, before, payload, 'form');
  toast(id ? 'Timesheet diperbarui, menunggu verifikasi ulang' : 'Timesheet ditambahkan');
  closeModal();
  renderTsbStaff();
}

async function tsbDeleteRow(id){
  if(!confirm('Hapus Timesheet Alat Berat ini? Tindakan tidak bisa dibatalkan.')) return;
  const before = (tsbState.rows || []).find(r => r.id === id) || null;
  const { error } = await supa.from(TSB_TABLE).delete().eq('id', id).eq('staff_id', currentUser.id);
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  logAudit(TSB_TABLE, id, before?.kode_unit_alat, before, {}, 'hapus');
  toast('Timesheet dihapus');
  renderTsbStaff();
}

/* ---------------------------------------------------------------------
   9. DETAIL / VERIFIKASI / APPROVE / TOLAK
   --------------------------------------------------------------------- */
function tsbCanAct(row, role){
  if(role === 'supervisor') return row.status_approval === TSB_STATUS.PENDING_SUPERVISOR;
  if(role === 'superintendent') return row.status_approval === TSB_STATUS.PENDING_SUPERINTENDENT;
  return false;
}
function tsbDetailRowsTableHTML(rows){
  if(!Array.isArray(rows) || !rows.length) return `<tr><td colspan="14" style="color:#999;">Belum ada baris kegiatan.</td></tr>`;
  const totals = tsbGrandTotals(rows);
  const body = rows.map(r => `
    <tr>
      <td>${esc(r.mulai||'-')}</td><td>${esc(r.selesai||'-')}</td><td>${r.total_jam ?? '-'}</td>
      <td>${r.hm_awal ?? '-'}</td><td>${r.hm_akhir ?? '-'}</td><td>${r.total_hm ?? '-'}</td>
      <td>${r.bbm_terpakai ?? '-'}</td>
      <td>${esc(r.lokasi||'-')}</td>
      <td>${esc(r.kegiatan||'-')}</td>
      <td>${r.meter ?? '-'}</td><td>${r.m3 ?? '-'}</td><td>${r.ha ?? '-'}</td>
      <td>${r.hm_awal_foto ? `<img class="tsb-foto-thumb" src="${esc(r.hm_awal_foto)}" onclick="window.open('${esc(r.hm_awal_foto)}','_blank')">` : '–'}</td>
      <td>${r.hm_akhir_foto ? `<img class="tsb-foto-thumb" src="${esc(r.hm_akhir_foto)}" onclick="window.open('${esc(r.hm_akhir_foto)}','_blank')">` : '–'}</td>
    </tr>
  `).join('');
  return body + `
    <tr class="tsb-pt-total">
      <td colspan="2">Total</td><td>${fmtNum(totals.jam,1)}</td>
      <td colspan="2"></td><td>${fmtNum(totals.hm,1)}</td>
      <td colspan="8"></td>
    </tr>
  `;
}
function tsbTtdCellHTML(role, name, at, empty){
  if(!name) return `<div class="tsb-ttd-empty">${empty}</div><div class="tsb-ttd-name">( ………………… )</div>`;
  return `<div class="tsb-ttd-stamp" style="background:var(--accent-green-soft,#e5f3ea); color:var(--accent-green,#3E8B5C);">✓ Digital</div>
    <div class="tsb-ttd-name">${esc(name)}</div>
    ${at ? `<div style="font-size:9.5px; color:#777; margin-top:2px;">${esc(fmtTanggalRKH(at.slice(0,10)))}</div>` : ''}`;
}
function openTsbDetailModal(id){
  const row = tsbState.rows.find(r => r.id === id);
  if(!row){ toast('Data tidak ditemukan', true); return; }
  const role = currentProfile?.role;
  const canAct = tsbCanAct(row, role);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:980px;">
      <div class="modal-header">
        <div class="card-title">Detail Timesheet Alat Berat</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="background:var(--panel-soft, rgba(255,255,255,.03)); padding:18px;">

        <div class="tsb-paper">
          <div class="tsb-paper-head">
            <div class="tsb-paper-head-left">
              <img src="logo.png" alt="">
              <div>
                <div class="tsb-ph-title">LAPORAN PEMAKAIAN ALAT<br>(TIME SHEET)</div>
                <div class="tsb-ph-sub">FORMULIR — FM-BS-ADM-05</div>
              </div>
            </div>
            <div class="tsb-paper-head-right">
              <table>
                <tr><td>Status Approval</td><td><b>${esc(row.status_approval||'-')}</b></td></tr>
                <tr><td>Zona</td><td>${esc(row.zona||'-')}</td></tr>
                <tr><td>Dibuat oleh (Staff)</td><td>${esc(row.staff_name||'-')}</td></tr>
              </table>
            </div>
          </div>

          <div class="tsb-paper-meta">
            <div>
              <div><b>Hari &amp; Tanggal</b>: ${esc(fmtTanggalRKH(row.tanggal))}</div>
              <div><b>Nama Pengawas</b>: ${esc(row.nama_pengawas||'-')}</div>
              <div><b>Kontraktor</b>: ${esc(row.kontraktor||'-')}</div>
            </div>
            <div>
              <div><b>Nama Operator</b>: ${esc(row.nama_operator||'-')}</div>
              <div><b>Kode Unit Alat</b>: ${esc(row.kode_unit_alat||'-')}</div>
              <div><b>Jenis Alat</b>: ${esc(row.jenis_alat||'-')}</div>
            </div>
          </div>

          <div class="table-scroll">
            <table class="tsb-paper-table">
              <thead>
                <tr>
                  <th colspan="3">Jam Operator</th>
                  <th colspan="3">Jam Alat / Hours Meter (HM)</th>
                  <th rowspan="2">BBM<br>Terpakai</th>
                  <th rowspan="2">Lokasi</th>
                  <th rowspan="2">Kegiatan /<br>Activity</th>
                  <th colspan="3">Produksi</th>
                  <th rowspan="2">Foto<br>HM Awal</th>
                  <th rowspan="2">Foto<br>HM Akhir</th>
                </tr>
                <tr>
                  <th>Mulai</th><th>Selesai</th><th>Total Jam</th>
                  <th>HM Awal</th><th>HM Akhir</th><th>Total HM</th>
                  <th>Meter</th><th>M³</th><th>Ha</th>
                </tr>
              </thead>
              <tbody>${tsbDetailRowsTableHTML(row.rows)}</tbody>
            </table>
          </div>

          <div class="tsb-paper-foot">
            <div><b>BBM dikirim hari ini</b>: ${row.bbm_dikirim ?? '-'} Ltr</div>
            <div><b>Oli</b>: ${row.oli ?? '-'} Ltr</div>
          </div>
          ${row.keterangan ? `<div style="padding:8px 14px; border-top:1px solid #ccc; font-size:11px;"><b>Keterangan</b>: ${esc(row.keterangan)}</div>` : ''}
          ${row.status_approval===TSB_STATUS.REJECTED && row.rejected_reason ? `<div style="padding:8px 14px; border-top:1px solid #ccc; font-size:11px; color:#a33;"><b>Alasan Ditolak</b> (${esc(row.rejected_by_stage||'-')}): ${esc(row.rejected_reason)}</div>` : ''}

          <div class="tsb-paper-ttd">
            <div>
              <div class="tsb-ttd-role">Operator</div>
              <div class="tsb-ttd-name">${esc(row.nama_operator||'( ………………… )')}</div>
            </div>
            <div>
              <div class="tsb-ttd-role">Pengawas</div>
              <div class="tsb-ttd-name">${esc(row.nama_pengawas||'( ………………… )')}</div>
            </div>
            <div>
              <div class="tsb-ttd-role">Supervisor</div>
              ${tsbTtdCellHTML('supervisor', row.verified_by_name, row.verified_at, 'Belum diverifikasi')}
            </div>
            <div>
              <div class="tsb-ttd-role">Superintendent</div>
              ${tsbTtdCellHTML('superintendent', row.approved_by_name, row.approved_at, 'Belum disetujui')}
            </div>
          </div>
        </div>

      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${canAct ? `
          <button class="btn btn-danger" onclick="openTsbRejectModal(${row.id}, '${role}')">Tolak</button>
          <button class="btn btn-primary" onclick="${role==='supervisor' ? `tsbVerify(${row.id})` : `tsbApprove(${row.id})`}">${role==='supervisor' ? 'Verifikasi' : 'Approve Final'}</button>
        ` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}
async function tsbVerify(id){
  const before = (tsbState.rows || []).find(r => r.id === id) || null;
  const { error } = await supa.from(TSB_TABLE).update({
    status_approval: TSB_STATUS.PENDING_SUPERINTENDENT,
    verified_by: currentUser.id, verified_by_name: currentProfile.full_name, verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal verifikasi: ' + error.message, true); return; }
  logAudit(TSB_TABLE, id, before?.kode_unit_alat, before, { status_approval: TSB_STATUS.PENDING_SUPERINTENDENT }, 'status');
  toast('Timesheet diverifikasi, diteruskan ke Superintendent');
  closeModal();
  renderTsbAtasan('supervisor');
}
async function tsbApprove(id){
  const before = (tsbState.rows || []).find(r => r.id === id) || null;
  const { error } = await supa.from(TSB_TABLE).update({
    status_approval: TSB_STATUS.APPROVED,
    approved_by: currentUser.id, approved_by_name: currentProfile.full_name, approved_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if(error){ toast('Gagal approve: ' + error.message, true); return; }
  logAudit(TSB_TABLE, id, before?.kode_unit_alat, before, { status_approval: TSB_STATUS.APPROVED }, 'status');
  toast('Timesheet disetujui (final)');
  closeModal();
  renderTsbAtasan('superintendent');
}
function openTsbRejectModal(id, role){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'tsbRejectOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:440px;">
      <div class="modal-header"><div class="card-title">Tolak Timesheet</div></div>
      <div class="modal-body">
        <label class="field-label">Alasan Penolakan</label>
        <textarea class="input" id="tsbRejectReason" rows="3" placeholder="Jelaskan alasan penolakan agar staff bisa merevisi…" required></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('tsbRejectOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="submitTsbReject(${id}, '${role}')">Tolak</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function submitTsbReject(id, role){
  const reason = $('#tsbRejectReason').value.trim();
  if(!reason){ toast('Alasan penolakan wajib diisi', true); return; }
  const before = (tsbState.rows || []).find(r => r.id === id) || null;
  const { error } = await supa.from(TSB_TABLE).update({
    status_approval: TSB_STATUS.REJECTED, rejected_reason: reason, rejected_by_stage: role,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  $('#tsbRejectOverlay')?.remove();
  if(error){ toast('Gagal menolak: ' + error.message, true); return; }
  logAudit(TSB_TABLE, id, before?.kode_unit_alat, before, { status_approval: TSB_STATUS.REJECTED, rejected_reason: reason }, 'status');
  toast('Timesheet ditolak, staff akan merevisi');
  closeModal();
  renderTsbAtasan(role);
}

/* ---------------------------------------------------------------------
   10. NAVIGASI: tambah view 'timesheet_alat_berat'
   --------------------------------------------------------------------- */
const _tsbPrevNavigate = navigate;
navigate = async function(view){
  if(view === 'timesheet_alat_berat'){
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
    await renderTimesheetAlatBerat();
    return;
  }
  return _tsbPrevNavigate(view);
};

/* ---------------------------------------------------------------------
   11. SEMBUNYIKAN MENU UNTUK VIEWER
   --------------------------------------------------------------------- */
const _tsbPrevApplyRoleUI = applyRoleUI;
applyRoleUI = function(){
  _tsbPrevApplyRoleUI();
  const el = document.querySelector('.nav-item[data-view="timesheet_alat_berat"]');
  if(el) el.style.display = (currentProfile?.role === 'viewer') ? 'none' : '';
};
