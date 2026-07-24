/* =====================================================================
   SISTEM INFORMASI TERPADU ESTATE 2 — APP LOGIC
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. SUPABASE CLIENT
   --------------------------------------------------------------------- */
// persistSession:false -> setiap kali aplikasi dibuka (reload/tab baru), sesi lama TIDAK
// dipulihkan otomatis, sehingga pengguna selalu diarahkan ke halaman Login terlebih dahulu.
const supa = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
  auth: { persistSession: false }
});

let currentUser = null;
let currentProfile = null;
let currentView = 'beranda';
let sidebarOpenState = false;

// Avatar default/demo — dipakai untuk akun yang belum mengunggah foto profil
// (avatar_url masih kosong), supaya tetap tampil gambar avatar (bukan cuma
// inisial huruf). Berupa SVG data URI generik, jadi tidak butuh file/asset
// tambahan dan tetap jalan offline (PWA).
const DEFAULT_AVATAR_URL = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>
  <defs><clipPath id='avatarClip'><circle cx='12' cy='12' r='11'/></clipPath></defs>
  <circle cx='12' cy='12' r='11' fill='#ffffff' stroke='#000000' stroke-width='1.4'/>
  <g clip-path='url(#avatarClip)' fill='#000000'>
    <circle cx='12' cy='9.6' r='3.6'/>
    <path d='M12 14.2c-4.4 0-8 2.6-8 6.8v3h16v-3c0-4.2-3.6-6.8-8-6.8z'/>
  </g>
</svg>`);

// Mengembalikan URL avatar untuk dipakai: avatar_url akun jika ada,
// atau avatar default/demo jika akun belum punya foto profil.
function avatarUrlOrDefault(url){
  return url || DEFAULT_AVATAR_URL;
}
// Fragmen style CSS inline untuk elemen avatar (selalu pakai background-image,
// baik itu foto asli maupun avatar default).
function avatarBgStyle(url){
  return `background-image:url('${avatarUrlOrDefault(url)}'); background-size:cover; background-position:center;`;
}

// per-table runtime state (cache, filter, sort, page)
const state = {};

/* ---------------------------------------------------------------------
   1. FIELD METADATA (dipakai lintas tabel)
   --------------------------------------------------------------------- */
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
// Grafik "Phasing 2026 vs Bulan Tebang" hanya menampilkan rentang April-Oktober
const PHASING_CHART_MONTHS = MONTHS.slice(3, 10); // ['APR','MAY','JUN','JUL','AUG','SEP','OCT']
/* ---------------------------------------------------------------------
   0b. LOGIN VIA USERNAME
   ---------------------------------------------------------------------
   Supabase Auth secara native tetap butuh email di baliknya. Supaya pengguna
   cukup mengetik "username" (bagian sebelum @) saat login tanpa perlu ubah
   struktur database, kita anggap semua akun memakai satu domain email
   perusahaan yang sama. GANTI nilai di bawah ini sesuai domain email asli
   perusahaan Anda (contoh: jika email staff adalah budi@pns.co.id, isi
   'pns.co.id'). Jika seseorang tetap mengetik email lengkap (mengandung
   '@'), itu juga tetap diterima apa adanya. */
const LOGIN_EMAIL_DOMAIN = 'perusahaan.com';
function usernameToEmail(usernameOrEmail){
  const v = (usernameOrEmail || '').trim().toLowerCase();
  if(!v) return '';
  return v.includes('@') ? v : `${v}@${LOGIN_EMAIL_DOMAIN}`;
}

const STATUS3 = ['Not Yet','Progress','Done'];
const KATEGORI4 = ['Not Yet','Baik','Cukup','Kurang'];
const KATEGORI3 = ['Baik','Cukup','Kurang'];
const BULAN_OPTIONS = Array.from({length:12},(_,i)=>String(i+1));

/* ---------------------------------------------------------------------
   0c. LOGIKA OTOMATIS "KATEGORI PASCA HARVEST"
   ---------------------------------------------------------------------
   Diturunkan langsung dari rumus Excel (Book3.xlsx) yang dipakai tim
   lapangan selama ini:
     Score Kondisi Juringan = Bobot Juringan (35%) x Nilai Juringan
     Score Tunggul          = Bobot Tunggul  (40%) x Nilai Tunggul
     Score Kondisi Gulma    = Bobot Gulma    (25%) x Nilai Gulma
     Nilai per kategori: Baik=3, Cukup=2, Kurang=1
     Score Pasca Harvest    = jumlah ketiga score di atas
     Kategori Pasca Harvest:
       Score <= 0           -> "Not Yet" (belum ada data / belum SUDAH dicek)
       Score <  1.75        -> "Kurang"
       1.75 <= Score < 2.5  -> "Cukup"
       Score >= 2.5         -> "Baik"
   Field "Kategori Pasca Harvest" TIDAK diinput manual lagi — otomatis
   dihitung dari 3 kategori kondisi (Juringan, Tunggul, Gulma) baik saat
   input lewat form (modal tambah/edit) maupun saat import file XLSX.
   --------------------------------------------------------------------- */
const KATEGORI_PASCA_TRIGGER_COLS = ['kategori_kondisi_juringan','kategori_tunggul','kategori_kondisi_gulma'];
const KATEGORI_PASCA_BOBOT = { kategori_kondisi_juringan: 0.35, kategori_tunggul: 0.40, kategori_kondisi_gulma: 0.25 };
const KATEGORI_PASCA_NILAI = { Baik: 3, Cukup: 2, Kurang: 1 };
function computeKategoriPascaHarvest(row){
  const j = row.kategori_kondisi_juringan, t = row.kategori_tunggul, g = row.kategori_kondisi_gulma;
  if(![j,t,g].every(v => KATEGORI_PASCA_NILAI[v] !== undefined)) return 'Not Yet';
  const score = KATEGORI_PASCA_BOBOT.kategori_kondisi_juringan * KATEGORI_PASCA_NILAI[j]
              + KATEGORI_PASCA_BOBOT.kategori_tunggul        * KATEGORI_PASCA_NILAI[t]
              + KATEGORI_PASCA_BOBOT.kategori_kondisi_gulma  * KATEGORI_PASCA_NILAI[g];
  if(score <= 0) return 'Not Yet';
  if(score < 1.75) return 'Kurang';
  if(score < 2.5) return 'Cukup';
  return 'Baik';
}

// Status Pengecekan Pasca HVT sekarang OTOMATIS: SUDAH begitu 3 kategori kondisi
// (Juringan/Tunggul/Gulma) semuanya terisi, BELUM kalau salah satu masih kosong.
// Tidak pernah diinput manual lagi (lihat fieldHTML & saveRecord override).
function computeStatusPengecekanPascaHVT(row){
  const allFilled = KATEGORI_PASCA_TRIGGER_COLS.every(c => row[c] !== null && row[c] !== undefined && row[c] !== '');
  return allFilled ? 'SUDAH' : 'BELUM';
}

/* ---------------------------------------------------------------------
   0d. LOGIKA OTOMATIS "STATUS BULAN" (Kondisi Bulanan)
   ---------------------------------------------------------------------
   Diturunkan dari rumus Excel (Book4.xlsx) rekap kondisi bulanan per petak:
     Nilai per kategori: Baik=3, Cukup=2, Kurang=1
     Bobot tetap: Lalang=25%, Perumpungan=25%, Rayutan=25%,
                  Intensitas Hama=15%, Drainage=5%, Tanggul/Berem=5%  (total 100%)
     Score total = jumlah (Nilai x Bobot) ke-6 kategori tsb
     Status Bulan:
       Score kosong / 0     -> "" (belum ada data terisi, kolom dikosongkan)
       Score >= 2.34         -> "Baik"
       1.67 <= Score < 2.34  -> "Cukup"
       0.01 <= Score < 1.67  -> "Kurang"
   Field "Status Bulan" TIDAK diinput manual lagi — otomatis dihitung dari
   6 kategori kondisi bulanan (Lalang, Perumpungan, Rayutan, Intensitas
   Hama, Drainage, Tanggul/Berem), baik saat input lewat form maupun saat
   import file XLSX.
   --------------------------------------------------------------------- */
const STATUS_BULAN_TRIGGER_COLS = ['kategori_lalang','kategori_perumpungan','kategori_rayutan','kategori_intensitas_hama','kategori_drainage','kategori_tanggul_berem'];
const STATUS_BULAN_BOBOT = {
  kategori_lalang: 0.25,
  kategori_perumpungan: 0.25,
  kategori_rayutan: 0.25,
  kategori_intensitas_hama: 0.15,
  kategori_drainage: 0.05,
  kategori_tanggul_berem: 0.05,
};
const STATUS_BULAN_NILAI = { Baik: 3, Cukup: 2, Kurang: 1 };
function computeStatusBulan(row){
  let score = 0, anyFilled = false;
  for(const col of STATUS_BULAN_TRIGGER_COLS){
    const v = row[col];
    if(STATUS_BULAN_NILAI[v] !== undefined){
      anyFilled = true;
      score += STATUS_BULAN_NILAI[v] * STATUS_BULAN_BOBOT[col];
    }
  }
  if(!anyFilled || score <= 0) return '';
  if(score >= 2.34) return 'Baik';
  if(score >= 1.67) return 'Cukup';
  return 'Kurang';
}

const FIELD_META = {
  petak: { label:'Petak', type:'text', required:true },
  size_rkt: { label:'Size RKT (Ha)', type:'number' },
  luas_rpc: { label:'Luas RPC (Ha)', type:'number' },
  luas_blanking: { label:'Luas Blanking (Ha)', type:'number' },
  varietas: { label:'Varietas', type:'text' },
  status_petak: { label:'Status Petak', type:'text', list:['RC1','RC2','RC3','RC4','RC5','RC6','RC7','RC8','RC9'] },
  action_plan_current_crop_2026: { label:'Action Plan Current Crop 2026', type:'text' },
  phasing_2026: { label:'Phasing 2026', type:'select', options:MONTHS },
  status_progress: { label:'Status Progress', type:'select', options:STATUS3 },
  bapp: { label:'BAPP', type:'date' },
  bulan_tebang: { label:'Bulan Tebang', type:'text' },
  tch_nett_bapp_2026: { label:'TCH Nett BAPP 2026', type:'text' },
  // Estimasi TCH 2026 = data target/estimasi per petak dari tim Estate (sheet
  // tambahan di template Pasca Harvest). SENGAJA TIDAK dimasukkan ke
  // TABLES.pasca_harvest.columns (lihat di bawah) supaya: (1) tidak muncul di
  // form Tambah/Edit admin, dan (2) tidak pernah ikut ditimpa saat admin
  // import ulang file database_template.xlsx bulanan — kolom ini hanya
  // diisi/diupdate lewat proses terpisah (lihat migrations/estimasi_tch_2026.sql).
  estimasi_tch_2026: { label:'Estimasi TCH 2026', type:'number' },
  zona: { label:'Zona', type:'text', list:['A','B','C','D'] },
  superitendent: { label:'Superitendent', type:'text' },
  supervisor: { label:'Supervisor', type:'text' },
  staff: { label:'Staff', type:'text' },
  action_plan: { label:'Action Plan', type:'text' },
  action_plan_2026: { label:'Action Plan 2026', type:'text' },
  msw: { label:'MSW', type:'select', options:MONTHS },
  status_msw: { label:'Status MSW', type:'select', options:STATUS3 },
  furrowing: { label:'Furrowing', type:'select', options:MONTHS },
  status_furrowing: { label:'Status Furrowing', type:'select', options:STATUS3 },
  pps1: { label:'PPS1', type:'select', options:MONTHS },
  status_pps1: { label:'Status PPS 1', type:'select', options:STATUS3 },
  pps2: { label:'PPS2', type:'select', options:MONTHS },
  status_pps2: { label:'Status PPS 2', type:'select', options:STATUS3 },
  phasing_planting: { label:'Phasing Planting', type:'select', options:MONTHS },
  status_planting: { label:'Status Planting', type:'select', options:STATUS3 },
  status_pengecekan_pasca_hvt: { label:'Status Pengecekan Pasca HVT', type:'select', options:['BELUM','SUDAH'] },
  kategori_kondisi_juringan: { label:'Kategori Kondisi Juringan', type:'select', options:KATEGORI4 },
  kategori_tunggul: { label:'Kategori Tunggul', type:'select', options:KATEGORI4 },
  kategori_kondisi_gulma: { label:'Kategori Kondisi Gulma', type:'select', options:KATEGORI4 },
  kategori_pasca_harvest: { label:'Kategori Pasca Harvest', type:'select', options:KATEGORI4 },
  // --- Kondisi Bulanan (dipindahkan dari aplikasi "Estate 2" lama) ---
  bulan: { label:'Bulan', type:'select', options:BULAN_OPTIONS },
  kategori_lalang: { label:'Lalang', type:'select', options:KATEGORI3 },
  kategori_perumpungan: { label:'Perumpungan', type:'select', options:KATEGORI3 },
  kategori_rayutan: { label:'Rayutan', type:'select', options:KATEGORI3 },
  kategori_intensitas_hama: { label:'Intensitas Hama', type:'select', options:KATEGORI3 },
  kategori_drainage: { label:'Drainage', type:'select', options:KATEGORI3 },
  kategori_tanggul_berem: { label:'Tanggul/Berem', type:'select', options:KATEGORI3 },
  status_bulan: { label:'Status Bulan', type:'select', options:KATEGORI3 },
  // --- Produktivitas Kontraktor (dari sheet "Rekap WO", format sederhana:
  //     No, Kontraktor, Kegiatan, Luas BAPP, Ket Hasil) ---
  kontraktor: { label:'Kontraktor', type:'text', required:true },
  kegiatan_pk: { label:'Kegiatan', type:'text', required:true },
  luas_bapp: { label:'Luas BAPP (Ha)', type:'number', required:true },
  ket_hasil: { label:'Ket Hasil', type:'text', required:true, list:['LULUS','TIDAK LULUS'] },
  // --- Actual TK (Ketersediaan Tenaga Kerja Aktual, dari sheet "Rencana Kedatangan TK") ---
  kebutuhan_tk: { label:'Kebutuhan TK (Org)', type:'number', required:true },
  jumlah_aktual_tk: { label:'Jumlah Aktual Tersedia (Org)', type:'number', required:true },
  keterangan_tk: { label:'Keterangan', type:'text' },
  // --- Plan Kedatangan TK (rencana & aktual kedatangan tenaga kerja per gelombang) ---
  tanggal_rencana_tk: { label:'Tanggal Rencana Kedatangan', type:'date' },
  jumlah_rencana_tk: { label:'Jumlah Rencana Kedatangan (Org)', type:'number', required:true },
  tanggal_aktual_tk: { label:'Tanggal Aktual Kedatangan', type:'date' },
  jumlah_aktual_kedatangan_tk: { label:'Jumlah Aktual Kedatangan (Org)', type:'number' },
  // --- Monitoring HE & Implement (dari sheet "Kondisi Unit Estate 2",
  //     gabungan 2 seksi: Unit HE alat berat & Implement Tractor) ---
  kategori_he: { label:'Kategori', type:'select', options:['HE','Implement'], required:true },
  kode_unit_he: { label:'Kode Unit', type:'text', required:true },
  type_he: { label:'Type', type:'select', options:['Exca75','Exca130','BD','Tractor','Ridger WT','Trash Mulcer','Boom Spraying','Rotary','Planter','Blade'], required:true },
  implement_he: { label:'Implement Terpasang', type:'text', list:['-','Bucket','Blade','Boom','Planter'] },
  alokasi_he: { label:'Alokasi / Kegiatan', type:'text' },
  kondisi_he: { label:'Kondisi', type:'select', options:['Baik','Breakdown','Perbaikan Pisau','Perbaikan Bearing'], required:true },
  lokasi_he: { label:'Lokasi', type:'text', list:['WS Est 2','Est 3'] },
  vendor_he: { label:'Vendor', type:'select', options:['PT. HKL','PT. PRN','Internal'] },
};

/* ---------------------------------------------------------------------
   2. TABLE CONFIG (5 MENU)
   --------------------------------------------------------------------- */
const TABLES = {
  pasca_harvest: {
    label: 'Pasca Harvest', eyebrow: 'MODUL 01',
    areaField: 'size_rkt',
    columns: ['petak','size_rkt','varietas','status_petak','action_plan_current_crop_2026','phasing_2026','status_progress','bapp','bulan_tebang','tch_nett_bapp_2026','zona','superitendent','supervisor','staff','status_pengecekan_pasca_hvt','kategori_kondisi_juringan','kategori_tunggul','kategori_kondisi_gulma','kategori_pasca_harvest'],
    listColumns: ['petak','zona','status_progress','estimasi_tch_2026','kategori_kondisi_juringan','kategori_tunggul','kategori_kondisi_gulma','kategori_pasca_harvest'],
  },
  rpc_after_giling: {
    label: 'RPC After Giling', eyebrow: 'MODUL 02',
    areaField: 'luas_rpc',
    columns: ['petak','size_rkt','luas_rpc','varietas','status_petak','action_plan_current_crop_2026','phasing_2026','status_progress','bapp','bulan_tebang','tch_nett_bapp_2026','zona','superitendent','supervisor','staff','action_plan','action_plan_2026','msw','status_msw','furrowing','status_furrowing','pps1','status_pps1','pps2','status_pps2','phasing_planting','status_planting'],
    listColumns: ['petak','size_rkt','luas_rpc','varietas','zona','status_progress','staff','status_planting'],
  },
  extra_planting_after_giling: {
    label: 'Extra Planting After Giling', eyebrow: 'MODUL 03',
    areaField: 'luas_rpc',
    columns: ['petak','size_rkt','luas_rpc','varietas','status_petak','action_plan_current_crop_2026','phasing_2026','status_progress','bapp','bulan_tebang','tch_nett_bapp_2026','zona','superitendent','supervisor','staff','action_plan','action_plan_2026','msw','status_msw','furrowing','status_furrowing','pps1','status_pps1','pps2','status_pps2','phasing_planting','status_planting'],
    listColumns: ['petak','size_rkt','luas_rpc','varietas','zona','status_progress','staff','status_planting'],
  },
  blanking: {
    label: 'Blanking', eyebrow: 'MODUL 04',
    areaField: 'luas_blanking',
    columns: ['petak','size_rkt','luas_blanking','varietas','status_petak','action_plan_current_crop_2026','phasing_2026','status_progress','bapp','bulan_tebang','tch_nett_bapp_2026','zona','superitendent','supervisor','staff','action_plan','msw','status_msw','furrowing','status_furrowing','phasing_planting','status_planting'],
    listColumns: ['petak','size_rkt','luas_blanking','varietas','zona','status_progress','staff','status_planting'],
    // Blanking tidak punya kolom PPS1/PPS2, jadi Monitoring Persiapan Lahan-nya
    // hanya mencakup 3 tahapan ini (menggantikan grafik "Luas per Zona").
    landPrepKeys: ['status_msw','status_furrowing','status_planting'],
    landPrepLabels: ['MSW','Furrowing','Planting'],
  },
  ratoon: {
    label: 'Ratoon', eyebrow: 'MODUL 05',
    areaField: 'size_rkt',
    columns: ['petak','size_rkt','varietas','status_petak','action_plan_current_crop_2026','phasing_2026','status_progress','bapp','bulan_tebang','tch_nett_bapp_2026','zona','superitendent','supervisor','staff','action_plan_2026'],
    listColumns: ['petak','size_rkt','varietas','zona','status_progress','staff','action_plan_2026'],
  },
  kondisi_bulanan: {
    label: 'Kondisi Bulanan', eyebrow: 'MODUL 06',
    areaField: null,
    columns: ['petak','bulan','zona','superitendent','supervisor','staff','kategori_lalang','kategori_perumpungan','kategori_rayutan','kategori_intensitas_hama','kategori_drainage','kategori_tanggul_berem','status_bulan'],
    listColumns: ['petak','bulan','zona','staff','status_bulan','kategori_lalang','kategori_perumpungan','kategori_rayutan'],
    // Berbeda dari tabel master petak (Pasca Harvest, RPC, dst) yang import-nya HANYA
    // memperbarui data yang sudah ada: Kondisi Bulanan adalah log bulanan yang kosong
    // di awal dan satu petak bisa punya banyak baris (satu per bulan). Jadi import di
    // tabel ini BOLEH menambah baris baru, dicocokkan berdasarkan kombinasi Petak + Bulan
    // (bukan Petak saja), supaya data bulan 1 tidak tertimpa saat mengimpor bulan 2, dst.
    importMode: 'upsert',
    importMatchKeys: ['petak','bulan'],
    validateAgainstMaster: true,
    // Skema tabel 'kondisi_bulanan' di database TIDAK punya kolom created_by/updated_by
    // (berbeda dari tabel master lain seperti pasca_harvest), jadi kolom tsb tidak boleh
    // disertakan saat insert/update — kalau disertakan, Supabase menolak dengan error
    // "Could not find the 'created_by' column...".
    hasAuditColumns: false,
  },
};

Object.keys(TABLES).forEach(k => {
  state[k] = { data: [], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:12, filterZona:'', filterSuperitendent:'', filterStaff:'', filterStatus:'', filterPanelOpen:false };
});

/* ---------------------------------------------------------------------
   3. UTIL
   --------------------------------------------------------------------- */
function $(sel){ return document.querySelector(sel); }
function $all(sel){ return Array.from(document.querySelectorAll(sel)); }
function esc(v){ return v===null||v===undefined ? '' : String(v); }
// type bisa: 'success' (default) | 'error' | 'warning' | 'info', atau boolean
// lama (true = error) supaya semua ratusan pemanggilan toast(msg, true) yang
// sudah ada di seluruh modul tetap jalan tanpa diubah satu-satu.
function toast(msg, type='success'){
  const variant = type === true ? 'error' : type === false ? 'success' : (type || 'success');
  const wrap = $('#toastWrap');
  const el = document.createElement('div');
  el.className = 'toast anim-fade-up' + (variant !== 'success' ? ' ' + variant : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(), 300); }, 3400);
}
function badgeForStatus(val){
  const v = (val||'').toString().trim().toLowerCase();
  if(v === 'done' || v === 'sudah' || v === 'baik') return `<span class="badge badge-done">${esc(val)}</span>`;
  if(v === 'progress' || v === 'cukup') return `<span class="badge badge-progress">${esc(val)}</span>`;
  if(v === 'not yet' || v === 'belum' || v === 'kurang' || v === 'not yet bapp') return `<span class="badge badge-notyet">${esc(val)}</span>`;
  if(!v) return `<span class="badge badge-neutral">–</span>`;
  return `<span class="badge badge-neutral">${esc(val)}</span>`;
}
function fmtNum(n, d=2){
  if(n===null||n===undefined||n==='' || isNaN(n)) return '–';
  return Number(n).toLocaleString('id-ID', {minimumFractionDigits:0, maximumFractionDigits:d});
}
// --- Util tanggal untuk kolom bertipe 'date' (mis. BAPP) --------------------
// Nilai tanggal bisa datang dalam banyak bentuk: serial Excel ("46138",
// muncul kalau file Excel-nya format kolomnya "Date" tapi SheetJS baca tanpa
// cellDates), "DD-MM-YYYY", "DD/MM/YYYY", atau ISO "YYYY-MM-DD" (dari kolom
// SQL `date` / input <input type="date">). Semua diseragamkan ke ISO
// YYYY-MM-DD untuk disimpan ke DB, dan ke DD-MM-YYYY untuk ditampilkan.
function excelSerialToISO(serial){
  const n = Math.round(Number(serial));
  const utcMs = (n - 25569) * 86400 * 1000; // epoch Excel: 1899-12-30
  const d = new Date(utcMs);
  if(isNaN(d)) return null;
  return d.toISOString().slice(0,10);
}
function parseAnyDateToISO(v){
  if(v === null || v === undefined || v === '') return null;
  if(v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0,10);
  const s = String(v).trim();
  if(!s) return null;
  if(/^\d+(\.\d+)?$/.test(s)) return excelSerialToISO(s); // serial Excel (angka murni)
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[1]}-${m[2]}-${m[3]}`; // sudah ISO
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; // DD-MM-YYYY / DD/MM/YYYY
  return null; // format tak dikenali — dibiarkan kosong, user isi manual lewat date picker
}
function fmtDateID(iso){
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
// PENTING: wrapper harus `function(...)` biasa (bukan arrow) supaya saat dipasang lewat
// addEventListener, `this` di sini otomatis terikat ke elemen input yang memicu event.
// `this` itu lalu disimpan ke `ctx` dan diteruskan lewat fn.apply(ctx, a) di dalam
// setTimeout — kalau tidak, semua handler yang memakai "this.value" (kotak pencarian di
// seluruh halaman) akan kehilangan referensi ke elemen aslinya dan gagal berjalan.
function debounce(fn, ms){ let t; return function(...a){ const ctx = this; clearTimeout(t); t=setTimeout(()=>fn.apply(ctx, a), ms); }; }
// Kolom TCH Nett BAPP 2026 disimpan sebagai teks (bisa berisi "65,3", "65.3", "TBD", dsb),
// jadi perlu diparse dengan hati-hati sebelum dibandingkan secara numerik (mis. untuk
// menyaring petak dengan TCH < 70 di menu Justifikasi). Mengembalikan NaN jika nilainya
// bukan angka (baris seperti itu diabaikan dari daftar Justifikasi TCH Under 70).
function parseTchNumber(raw){
  if(raw === null || raw === undefined) return NaN;
  let s = raw.toString().trim();
  if(s === '') return NaN;
  s = s.replace(/[^0-9.,-]/g, '');
  if(s === '') return NaN;
  if(s.includes(',') && s.includes('.')){
    if(s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g,'').replace(',', '.');
    else s = s.replace(/,/g,'');
  } else if(s.includes(',')){
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return n;
}

/* ---------------------------------------------------------------------
   4. AUTH
   --------------------------------------------------------------------- */
function setAuthTab(tab){
  $('#tabLogin').classList.toggle('active', tab==='login');
  $('#loginForm').classList.toggle('hidden', tab!=='login');
}

async function handleLogin(e){
  e.preventDefault();
  const btn = $('#loginBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
  $('#loginError').classList.add('hidden');
  const username = $('#loginUsername').value.trim();
  const email = usernameToEmail(username);
  const password = $('#loginPassword').value;
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Masuk ke Dashboard';
  if(error){
    $('#loginError').textContent = 'Gagal masuk: Username atau kata sandi salah.';
    $('#loginError').classList.remove('hidden');
    return false;
  }
  await onAuthenticated(data.user);
  return false;
}

async function handleRegister(e){
  e.preventDefault();
  const btn = $('#regBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
  $('#regError').classList.add('hidden'); $('#regSuccess').classList.add('hidden');
  const full_name = $('#regName').value.trim();
  const username = $('#regUsername').value.trim();
  const email = usernameToEmail(username);
  const password = $('#regPassword').value;
  const { data, error } = await supa.auth.signUp({ email, password, options: { data: { full_name } } });
  btn.disabled = false; btn.textContent = 'Daftar Akun Baru';
  if(error){
    const msg = /already registered|already exists/i.test(error.message)
      ? 'Username sudah dipakai. Silakan pilih username lain.'
      : error.message;
    $('#regError').textContent = 'Gagal mendaftar: ' + msg;
    $('#regError').classList.remove('hidden');
    return false;
  }
  if(data.session){
    await onAuthenticated(data.user);
  } else {
    $('#regSuccess').textContent = 'Pendaftaran berhasil. Silakan masuk dengan username & kata sandi Anda.';
    $('#regSuccess').classList.remove('hidden');
    setAuthTab('login');
  }
  return false;
}

async function handleLogout(){
  await supa.auth.signOut();
  currentUser = null; currentProfile = null;
  resetAllTableState();
  teardownNotifications();
  teardownChat();
  teardownDM();
  teardownPresence();
  $('#appShell').classList.add('hidden');
  $('#loginView').classList.remove('hidden');
}

// Membersihkan seluruh cache data tabel (per modul) + filter/pencarian/
// sorting/halaman yang tersimpan di memori. WAJIB dipanggil setiap kali
// sesi berganti (logout maupun login) agar akun berikutnya yang memakai
// tab/browser yang sama tidak pernah melihat sisa data cache dari akun
// sebelumnya (mis. Admin yang belum difilter zona, sebelum Superintendent
// login di tab yang sama).
function resetAllTableState(){
  Object.keys(TABLES).forEach(k => {
    state[k] = { data: [], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:12, filterZona:'', filterSuperitendent:'', filterStaff:'', filterStatus:'', filterPanelOpen:false };
  });
  if(typeof PRODUKTIVITAS_TABLE !== 'undefined'){
    state[PRODUKTIVITAS_TABLE] = { data:[], loaded:false, search:'', sortKey:'tanggal', sortDir:'desc', page:1, pageSize:14, filterKegiatan:'', filterPekerja:'', filterDari:'', filterSampai:'', filterPanelOpen:false };
  }
  if(typeof MONITORING_MOTOR_TABLE !== 'undefined'){
    state[MONITORING_MOTOR_TABLE] = { data:[], loaded:false, search:'', sortKey:'kode_unit', sortDir:'asc', page:1, pageSize:14, filterStatus:'', filterKondisi:'', filterZona:'', filterPanelOpen:false };
  }
  if(typeof ACTUAL_TK_TABLE !== 'undefined'){
    state[ACTUAL_TK_TABLE] = { data:[], loaded:false, search:'', sortKey:'zona', sortDir:'asc', page:1, pageSize:14, filterZona:'', filterPanelOpen:false };
  }
  if(typeof PLAN_KEDATANGAN_TABLE !== 'undefined'){
    state[PLAN_KEDATANGAN_TABLE] = { data:[], loaded:false, search:'', sortKey:'tanggal_rencana_tk', sortDir:'desc', page:1, pageSize:14, filterZona:'', filterPanelOpen:false };
  }
  if(typeof JUSTIFIKASI_TCH_TABLE !== 'undefined'){
    state[JUSTIFIKASI_TCH_TABLE] = { data:[], loaded:false };
    state.justifikasi_tch_under70 = { search:'', sortKey:'tch_nett_bapp_2026', sortDir:'asc', page:1, pageSize:14, filterZona:'', filterStaff:'', filterPanelOpen:false };
    justifikasiBaseRows = [];
  }
  if(typeof MAINTENANCE_TABLE !== 'undefined'){
    state[MAINTENANCE_TABLE] = {
      data:[], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:14,
      filterStatusHarvest:'', filterNextAction:'', filterKetNextStatus:'', filterPlanMonth:'', filterActualMonth:'', filterPanelOpen:false,
    };
  }
  if(typeof HE_IMPLEMENT_TABLE !== 'undefined'){
    state[HE_IMPLEMENT_TABLE] = {
      data:[], loaded:false, search:'', sortKey:'kode_unit_he', sortDir:'asc', page:1, pageSize:14,
      filterKategori:'', filterType:'', filterKondisi:'', filterVendor:'', filterPanelOpen:false,
    };
  }
  Object.keys(chartInstances).forEach(id => destroyChart(id));
}

// Catat 1 baris riwayat akses tiap kali login berhasil (dibaca lewat menu
// Log History khusus Admin). Sengaja fire-and-forget: kalau insert gagal
// (mis. RLS belum di-setup / offline), jangan sampai memblokir login.
function logAccessHistory(user){
  supa.from('access_log').insert({
    user_id: user.id,
    full_name: currentProfile.full_name || user.email,
    email: user.email,
    role: currentProfile.role,
    user_agent: navigator.userAgent,
  }).then(({ error }) => { if(error) console.warn('[Log History] gagal mencatat akses:', error.message); });
}

async function onAuthenticated(user){
  _lastActivityAt = Date.now(); // reset idle timer tiap kali sesi baru mulai
  resetAllTableState(); // pastikan tidak ada cache tersisa dari sesi/akun sebelumnya
  currentUser = user;
  let { data: profile, error } = await supa.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(!profile){
    // profile belum terbentuk oleh trigger (race condition) -> coba lagi sekali
    await new Promise(r=>setTimeout(r, 900));
    ({ data: profile } = await supa.from('profiles').select('*').eq('id', user.id).maybeSingle());
  }
  currentProfile = profile || { role:'viewer', full_name: user.email, email: user.email };
  logAccessHistory(user);
  applyRoleUI();
  renderNotifSoundToggle();
  $('#loginView').classList.add('hidden');
  $('#appShell').classList.remove('hidden');
  navigate('beranda');
  refreshAllCounts();
  initNotifications();
  initChat();
  initDM();
  initPresence();
  showUpdateReminderOnce();
}

function showUpdateReminderOnce(){
  if(sessionStorage.getItem('update_reminder_shown')) return;
  sessionStorage.setItem('update_reminder_shown', '1');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px; text-align:center;">
      <div class="modal-body" style="padding-top:22px;">
        <div style="font-size:34px; margin-bottom:10px;">⚠️</div>
        <div class="card-title" style="margin-bottom:8px;">Update Terbaru Tersedia</div>
        <p style="color:var(--text-muted); font-size:13px; line-height:1.6;">Harap melakukan hapus history browser untuk mendapatkan Update terbaru.</p>
      </div>
      <div class="modal-footer" style="justify-content:center;">
        <button class="btn btn-primary" onclick="this.closest('.modal-overlay').remove()">Mengerti</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function applyRoleUI(){
  const name = currentProfile.full_name || currentProfile.email || 'Pengguna';
  $('#userName').textContent = name;
  const avatarEl = $('#userAvatar');
  avatarEl.textContent = '';
  avatarEl.style.backgroundImage = `url('${avatarUrlOrDefault(currentProfile.avatar_url)}')`;
  avatarEl.style.backgroundSize = 'cover';
  avatarEl.style.backgroundPosition = 'center';
  avatarEl.style.cursor = 'pointer';
  avatarEl.title = 'Klik untuk ganti foto profil';
  avatarEl.onclick = triggerAvatarUpload;
  renderAvatarEditIcon();
  const pill = $('#userRolePill');
  pill.textContent = currentProfile.role;
  pill.className = 'role-pill role-' + currentProfile.role;
  const zonaRestrict = getUserZonaRestriction();
  pill.title = zonaRestrict ? `Dibatasi ke Zona ${zonaRestrict}` : '';
  pill.textContent = zonaRestrict ? `${currentProfile.role} · Zona ${zonaRestrict}` : currentProfile.role;
  // Menu Administrasi (Kelola Pengguna) hanya ditampilkan untuk role Admin.
  const canOpenAdminMenu = isAdminRole();
  $('#navSection_administrasi').style.display = canOpenAdminMenu ? '' : 'none';
  // Tombol "Ubah Password" di Pengaturan: khusus role NON-Admin (Admin sudah
  // punya jalur sendiri lewat Kelola Pengguna -> Ubah Password akun manapun).
  const pwSettingsBtn = $('#settingsChangePasswordBtn');
  if(pwSettingsBtn) pwSettingsBtn.style.display = isAdminRole() ? 'none' : '';
  // Khusus role Staff: sembunyikan menu Produktivitas, Tenaga Kerja, dan Armada & Aset
  // (bukan bagian tanggung jawab Staff — role lain tidak terpengaruh).
  const hideForStaff = currentProfile.role === 'staff';
  ['navSection_produktivitas','navSection_tenaga_kerja','navSection_armada_aset'].forEach(id => {
    const el = $('#' + id);
    if(el) el.style.display = hideForStaff ? 'none' : '';
  });
}
function isAdminRole(){ return currentProfile?.role === 'admin'; }

// Popup profil ringkas — muncul saat nama/role di topbar diklik.
function openMyProfileModal(){
  const p = currentProfile || {};
  const name = p.full_name || p.email || 'Pengguna';
  const initial = name.trim().charAt(0).toUpperCase();
  const zonaRestrict = getUserZonaRestriction();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:360px;">
      <div class="modal-header">
        <div class="card-title">Profil Saya</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center; padding-top:6px;">
        <div class="user-avatar" style="width:72px; height:72px; font-size:26px; margin:0 auto 14px; ${avatarBgStyle(p.avatar_url)}"></div>
        <div style="font-size:16px; font-weight:700;">${esc(name)}</div>
        <div style="margin-top:6px;">
          <span class="role-pill role-${esc(p.role||'')}">${esc(zonaRestrict ? `${p.role} · Zona ${zonaRestrict}` : (p.role || '–'))}</span>
        </div>
        <div style="text-align:left; margin-top:20px; border-top:1px solid var(--border-soft); padding-top:16px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="color:var(--text-faint);">Username</span><span style="font-weight:600;">${esc((p.email||'').split('@')[0] || '–')}</span></div>
          <div style="display:flex; justify-content:space-between; font-size:13px;"><span style="color:var(--text-faint);">Peran</span><span style="font-weight:600; text-transform:capitalize;">${esc(p.role||'–')}</span></div>
          ${zonaRestrict ? `<div style="display:flex; justify-content:space-between; font-size:13px;"><span style="color:var(--text-faint);">Zona</span><span style="font-weight:600;">${esc(zonaRestrict)}</span></div>` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal(); triggerAvatarUpload();">Ganti Foto</button>
        ${!isAdminRole() ? `<button class="btn btn-primary" onclick="closeModal(); openOwnChangePasswordModal();">Ubah Password</button>` : `<button class="btn btn-primary" onclick="closeModal();">Tutup</button>`}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

/* ---------------------------------------------------------------------
   4b. MATRIKS OTORISASI PER MODUL
   ---------------------------------------------------------------------
   Ringkasan hak akses per role (lihat permintaan otorisasi terbaru):
   - admin        : CRUD + import penuh di modul master (Produktivitas
                    Harian/Kontraktor, Pasca Harvest, RPC After Giling,
                    Extra Planting, Blanking, Ratoon, Maintenance,
                    PC/RPC Eks Non RKT, Kondisi Bulanan); hanya UPDATE
                    (tanpa tambah/hapus) di Justifikasi TCH; CRUD (tanpa
                    import) di Actual TK/Plan Kedatangan TK/Monitoring
                    Motor/Monitoring Aset; hanya lihat di Dashboard
                    Kondisi Petak & Analisa 12 Bulan; kelola semua akun
                    pengguna.
   - manager      : hanya LIHAT semua modul data (tanpa batas zona);
                    hanya bisa mengubah password akun Superintendent.
   - superintendent: hanya LIHAT (dibatasi zona, KECUALI Produktivitas
                    Harian & Kontraktor yang tetap tampil semua zona);
                    CRUD (dibatasi zona) di Justifikasi TCH, Actual TK,
                    Plan Kedatangan TK, Monitoring Motor & Monitoring
                    Aset; hanya bisa mengubah password akun Supervisor.
   - supervisor   : sama persis dengan Superintendent, hanya beda target
                    ubah password -> akun Staff.
   - staff        : sama dengan Supervisor, KECUALI di Kondisi Bulanan
                    staff berhak CRUD (bukan hanya lihat) dibatasi zona;
                    hanya bisa mengubah password akun sendiri.
   - viewer       : hanya lihat, tanpa batas zona, tanpa akses Administrasi.
   Catatan: import/export XLSX tetap eksklusif untuk Admin di semua modul.
   Ini adalah lapisan tampilan (UI). Untuk keamanan penuh, terapkan juga
   RLS yang senada di sisi Supabase & Edge Function admin-users.
   --------------------------------------------------------------------- */
const MODULE_PERMISSIONS = {
  produktivitas_harian:        { edit:['admin'], del:['admin'] },
  produktivitas_kontraktor:    { edit:['admin'], del:['admin'] },
  pasca_harvest:               { edit:['admin'], del:['admin'] },
  rpc_after_giling:            { edit:['admin'], del:['admin'] },
  extra_planting_after_giling: { edit:['admin'], del:['admin'] },
  blanking:                    { edit:['admin'], del:['admin'] },
  ratoon:                      { edit:['admin'], del:['admin'] },
  maintenance:                 { edit:['admin'], del:['admin'] },
  pc_rpc_eks_non_rkt:          { edit:['admin'], del:['admin'] },
  kondisi_bulanan:             { edit:['admin','staff'], del:['admin','staff'] },
  justifikasi_tch_under70:     { edit:['admin','superintendent','supervisor','staff'], del:[] },
  actual_tk:                   { edit:['admin','superintendent','supervisor','staff'], del:['admin','superintendent','supervisor','staff'] },
  plan_kedatangan_tk:          { edit:['admin','superintendent','supervisor','staff'], del:['admin','superintendent','supervisor','staff'] },
  monitoring_motor:            { edit:['admin','superintendent','supervisor','staff'], del:['admin','superintendent','supervisor','staff'] },
  monitoring_aset:             { edit:['admin','superintendent','supervisor','staff'], del:['admin','superintendent','supervisor','staff'] },
  he_implement:                { edit:['admin','superintendent','supervisor','staff','viewer'], del:['admin','superintendent','supervisor','staff','viewer'] },
  dashboard_kondisi:           { edit:[], del:[] },
  analisa_12_bulan:            { edit:[], del:[] },
};
// Modul yang TIDAK dibatasi zona untuk Superintendent/Supervisor/Staff
// (mereka tetap boleh melihat data semua zona di kedua modul ini).
const ZONA_EXEMPT_MODULES = ['produktivitas_harian', 'produktivitas_kontraktor'];

function canEditModule(moduleKey){
  const perm = MODULE_PERMISSIONS[moduleKey];
  if(!perm) return false;
  return perm.edit.includes(currentProfile?.role);
}
function canDeleteModule(moduleKey){
  const perm = MODULE_PERMISSIONS[moduleKey];
  if(!perm) return false;
  return perm.del.includes(currentProfile?.role);
}

/* ---------------------------------------------------------------------
   4c. PEMBATASAN AKSES PER ZONA
   ---------------------------------------------------------------------
   Skema akses:
   - Admin & Manager  -> selalu melihat SEMUA petak/zona di semua menu
     (Dashboard Gabungan, Pasca Harvest, RPC After Giling, Extra
     Planting, Blanking, Ratoon) — tidak dibatasi zona sama sekali.
   - Superintendent, Supervisor & Staff -> dibatasi ke zona yang
     tercatat di profilnya sendiri (diisi lewat halaman Kelola
     Pengguna), KECUALI di Produktivitas Harian & Produktivitas
     Kontraktor (lihat ZONA_EXEMPT_MODULES) yang tetap tampil semua
     zona. Hak CRUD per modul mengikuti MODULE_PERMISSIONS di atas.
   - Viewer -> tidak dibatasi zona, hanya bisa melihat.
   Catatan: pembatasan ini adalah lapisan tampilan (UI). Untuk keamanan
   penuh di sisi server, tambahkan juga Row Level Security (RLS) pada
   tabel Supabase berdasarkan kolom "zona" dan profil pengguna (lihat
   file supabase_rls_zona.sql — cukup ganti kondisi peran di dalamnya
   agar 'superintendent' DAN 'supervisor' sama-sama dibatasi, sama
   seperti di sini).
   --------------------------------------------------------------------- */
function getUserZonaRestriction(moduleKey){
  if(!currentProfile) return null;
  if(!['superintendent','supervisor','staff'].includes(currentProfile.role)) return null;
  if(moduleKey && ZONA_EXEMPT_MODULES.includes(moduleKey)) return null;
  const z = (currentProfile.zona || '').toString().trim();
  return z ? z.toUpperCase() : null;
}
function rowMatchesZona(row, zonaRestrict){
  if(!zonaRestrict) return true;
  return (row.zona || '').toString().trim().toUpperCase() === zonaRestrict;
}

// Pembatasan tambahan KHUSUS role Staff & Supervisor (lebih sempit dari zona): mereka
// hanya boleh melihat baris di modul petak (Pasca Harvest, RPC After Giling, Extra
// Planting After Giling, Blanking, Ratoon, Kondisi Bulanan) yang kolom 'staff'/
// 'supervisor'-nya cocok dengan nama akun mereka sendiri di tabel profiles. Role lain
// (admin/manager/superintendent/viewer) tidak kena pembatasan ini.
// Nama pembanding diambil dari currentProfile.full_name (fallback ke email), jadi
// full_name akun Staff/Supervisor WAJIB persis sama dengan isi kolom Staff/Supervisor
// di data (mis. "Riki Priyadi"), sensitif spasi tapi tidak sensitif huruf besar/kecil.
function getUserPersonRestriction(){
  if(!currentProfile) return null;
  const role = currentProfile.role;
  if(role !== 'staff' && role !== 'supervisor') return null;
  const column = role === 'staff' ? 'staff' : 'supervisor';
  const name = (currentProfile.full_name || currentProfile.email || '').toString().trim();
  return name ? { column, name: name.toUpperCase() } : null;
}
function rowMatchesPerson(row, personRestrict){
  if(!personRestrict) return true;
  return (row[personRestrict.column] || '').toString().trim().toUpperCase() === personRestrict.name;
}

/* ---------------------------------------------------------------------
   4d. NOTIFIKASI AKTIVITAS ADMIN (untuk Manager & Superintendent)
   ---------------------------------------------------------------------
   Setiap kali ADMIN menambah/mengedit/menghapus/mengimpor/mengekspor
   data, satu (atau beberapa, dikelompokkan per zona) baris dicatat ke
   tabel `notifications`. Manager melihat semuanya; Superintendent hanya
   melihat yang zona-nya cocok dengan zona di profilnya — pemfilteran
   ini ditegakkan oleh RLS di database (lihat notifications_schema.sql),
   bukan cuma di sisi tampilan.
   --------------------------------------------------------------------- */
const ACTION_LABEL_VERB = { tambah:'menambahkan', edit:'mengedit', hapus:'menghapus', import:'mengimpor', export:'mengekspor' };
const ACTION_ICON = { tambah:'➕', edit:'✏️', hapus:'🗑️', import:'📥', export:'📤' };

function summarizePetakList(list){
  const clean = (list || []).map(v => (v||'').toString().trim()).filter(Boolean);
  if(clean.length <= 3) return clean.join(', ');
  return `${clean.slice(0,3).join(', ')}, dan ${clean.length - 3} petak lainnya`;
}

// Mencatat satu notifikasi untuk satu kelompok petak (biasanya 1 zona).
// Tidak melakukan apa-apa jika yang beraksi bukan Admin, sesuai aturan:
// notifikasi ini khusus untuk aktivitas ADMIN.
async function logNotification({ table, action, petakList, zona }){
  if(currentProfile?.role !== 'admin') return;
  // Modul non-petak (Produktivitas Harian, Monitoring Motor, dst) tidak terdaftar
  // di TABLES generik, jadi pakai label fallback supaya tidak error.
  const cfg = TABLES[table] || { label: table === PRODUKTIVITAS_TABLE ? 'Produktivitas Harian' : (table === MONITORING_MOTOR_TABLE ? 'Monitoring Motor' : (table === MONITORING_ASET_TABLE ? 'Monitoring Aset' : (table === PK_TABLE ? 'Produktivitas Kontraktor' : (table === ACTUAL_TK_TABLE ? 'Actual TK' : (table === PLAN_KEDATANGAN_TABLE ? 'Plan Kedatangan TK' : (table === MAINTENANCE_TABLE ? 'Maintenance' : (table === HE_IMPLEMENT_TABLE ? 'Monitoring HE & Implement' : table))))))) };
  const list = (petakList || []).map(v => (v||'').toString().trim()).filter(Boolean);
  const jumlah = list.length || 1;
  const verb = ACTION_LABEL_VERB[action] || action;
  const actorName = currentProfile.full_name || currentProfile.email || 'Admin';
  const zonaLabel = zona ? ` (Zona ${zona})` : '';
  const message = list.length
    ? `${actorName} ${verb} ${jumlah} data petak${zonaLabel} di ${cfg.label}: ${summarizePetakList(list)}`
    : `${actorName} ${verb} data di modul ${cfg.label}${zonaLabel}`;

  const { error } = await supa.from('notifications').insert({
    actor_id: currentUser.id,
    actor_name: actorName,
    table_key: table,
    action,
    zona: zona ? zona.toString().trim().toUpperCase() : null,
    petak: list.slice(0, 30).join(', ') || null,
    jumlah,
    message,
  });
  if(error) console.error('Gagal mencatat notifikasi:', error.message);
  else if(window.sendPushTrigger){
    sendPushTrigger({
      roles: ['manager', 'superintendent', 'supervisor'],
      zona: zona || undefined,
      exclude_user_id: currentUser.id,
      title: 'Aktivitas Admin',
      body: message,
      tag: 'admin-activity',
    });
  }
}

// Untuk aksi massal (import/export): kelompokkan baris berdasarkan zona
// supaya Superintendent tiap zona tetap dapat notifikasi yang relevan saja.
async function logNotificationGrouped(table, action, rows){
  if(currentProfile?.role !== 'admin') return;
  const groups = {};
  (rows || []).forEach(r => {
    const z = (r.zona || '').toString().trim().toUpperCase();
    const key = z || '(TANPA ZONA)';
    (groups[key] = groups[key] || []).push(r.petak);
  });
  for(const key of Object.keys(groups)){
    await logNotification({ table, action, petakList: groups[key], zona: key === '(TANPA ZONA)' ? null : key });
  }
}

function canSeeNotifications(){
  return ['manager','superintendent','supervisor'].includes(currentProfile?.role);
}

/* ---------------------------------------------------------------------
   4d-2. SUARA NOTIFIKASI (Notifikasi Admin & Chat Tim)
   ---------------------------------------------------------------------
   Bunyi disintesis langsung lewat Web Audio API — tidak perlu file audio
   eksternal (mp3/wav) yang harus di-hosting terpisah. Browser modern
   memblokir audio sebelum ada interaksi pengguna sama sekali di halaman,
   jadi AudioContext baru benar-benar "dibuka" saat pengguna klik apa saja
   pertama kali (mis. saat mengisi form login) — setelahnya notifikasi &
   chat baru akan berbunyi otomatis secara realtime.
   --------------------------------------------------------------------- */
let audioCtx = null;
function getAudioCtx(){
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if(!Ctx) return null;
  if(!audioCtx) audioCtx = new Ctx();
  if(audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
  return audioCtx;
}
document.addEventListener('click', () => getAudioCtx(), { once:true });

// Status suara notifikasi (default: AKTIF). Disimpan di memori saja
// (bukan localStorage) karena berganti tiap sesi/reload, sesuai batasan
// lingkungan; pengguna bisa mematikan/menyalakan lewat tombol speaker
// di topbar.
let notifSoundEnabled = true;

function playTone(freqs, { duration = 0.14, gap = 0.05, type = 'sine', volume = 0.16 } = {}){
  if(!notifSoundEnabled) return;
  const ctx = getAudioCtx();
  if(!ctx) return;
  try {
    let t = ctx.currentTime;
    freqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + duration + 0.03);
      t += duration + gap;
    });
  } catch(e){ /* abaikan bila audio tidak tersedia/diblokir browser */ }
}

// Bunyi khas notifikasi aktivitas Admin: dua nada pendek naik ("ding-ding")
function playNotificationSound(){ playTone([740, 988], { duration:0.12, gap:0.03, type:'sine', volume:0.16 }); }
// Bunyi khas pesan Chat Tim baru: satu nada "pop" lembut & lebih pendek
function playChatSound(){ playTone([560], { duration:0.11, gap:0, type:'triangle', volume:0.15 }); }

const SOUND_ICON_ON = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;
const SOUND_ICON_OFF = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M23 9l-6 6M17 9l6 6"/></svg>`;

function renderNotifSoundToggle(){
  const btn = $('#notifSoundToggle');
  const icon = $('#notifSoundIcon');
  const stateLabel = $('#notifSoundStateLabel');
  const sw = $('#notifSoundSwitch');
  if(icon) icon.innerHTML = notifSoundEnabled ? SOUND_ICON_ON : SOUND_ICON_OFF;
  if(stateLabel) stateLabel.textContent = notifSoundEnabled ? 'Aktif' : 'Nonaktif';
  if(sw){ sw.classList.toggle('on', notifSoundEnabled); sw.setAttribute('aria-checked', String(notifSoundEnabled)); }
  if(!btn) return;
  btn.title = notifSoundEnabled ? 'Matikan suara notifikasi' : 'Aktifkan suara notifikasi';
  btn.classList.toggle('btn-sound-muted', !notifSoundEnabled);
}

function toggleNotifSound(){
  notifSoundEnabled = !notifSoundEnabled;
  renderNotifSoundToggle();
  if(notifSoundEnabled) playTone([660], { duration:0.08, volume:0.12 }); // bunyi kecil sebagai konfirmasi
  toast(notifSoundEnabled ? 'Suara notifikasi diaktifkan' : 'Suara notifikasi dimatikan');
}

let notifPollTimer = null;
let notifCache = [];
let notifReadIds = new Set();
let notifSoundInitialized = false; // cegah bunyi "palsu" saat pemuatan notifikasi pertama kali

function initNotifications(){
  const wrap = $('#notifWrap');
  if(!wrap) return;
  if(!canSeeNotifications()){
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'inline-flex';
  notifSoundInitialized = false; // muat pertama tidak boleh berbunyi
  loadNotifications();
  if(notifPollTimer) clearInterval(notifPollTimer);
  notifPollTimer = setInterval(loadNotifications, 30000); // polling ringan tiap 30 detik
}
function teardownNotifications(){
  if(notifPollTimer){ clearInterval(notifPollTimer); notifPollTimer = null; }
  notifCache = []; notifReadIds = new Set(); notifSoundInitialized = false;
  const wrap = $('#notifWrap'); if(wrap) wrap.style.display = 'none';
  $('#notifPanel')?.classList.add('hidden');
}

async function loadNotifications(){
  if(!canSeeNotifications()) return;
  // RLS di tabel notifications sudah otomatis membatasi baris yang boleh
  // dilihat: Manager semua, Superintendent hanya sesuai zona profilnya.
  const previousIds = new Set(notifCache.map(n => n.id));
  const { data, error } = await supa.from('notifications').select('*').order('created_at', { ascending:false }).limit(60);
  if(error){ console.error('Gagal memuat notifikasi:', error.message); return; }
  // Notifikasi baru = ada di hasil terbaru tapi belum ada di cache sebelumnya.
  // Bunyi HANYA dimainkan setelah pemuatan pertama berhasil, supaya notifikasi
  // lama yang sudah ada sebelum login tidak ikut berbunyi.
  const newOnes = (data || []).filter(n => !previousIds.has(n.id));
  notifCache = data || [];
  const { data: reads, error: readErr } = await supa.from('notification_reads').select('notification_id').eq('user_id', currentUser.id);
  if(readErr){ console.error('Gagal memuat status baca notifikasi:', readErr.message); }
  notifReadIds = new Set((reads || []).map(r => r.notification_id));
  renderNotifBadge();
  if(!$('#notifPanel')?.classList.contains('hidden')) renderNotifPanel();
  if(notifSoundInitialized && newOnes.length) playNotificationSound();
  notifSoundInitialized = true;
}

function renderNotifBadge(){
  const badge = $('#notifBadge');
  if(!badge) return;
  const unread = notifCache.filter(n => !notifReadIds.has(n.id)).length;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
}

function timeAgo(iso){
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if(diffSec < 60) return 'baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if(diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if(diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if(diffDay < 7) return `${diffDay} hari lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}

// Panel dropdown (notif/pengaturan/online) di HP ikut dipindah JS ke dalam
// .sidebar (lihat relocateTopbarUtility/relocateSettingsAndLogout). Masalahnya
// .sidebar punya CSS `transform` (buat animasi slide) yang bikin browser
// menjadikannya "containing block" baru, jadi panel yang position:fixed jadi
// KEPOTONG ke kotak sidebar (250px), bukan ke layar penuh. Fix: pindahkan
// elemen panel-nya sendiri (bukan tombolnya) langsung jadi anak <body> saat
// pertama dibuka di layar <=880px, supaya position:fixed benar-benar relatif
// ke viewport. Sekali dipindah dibiarkan permanen di body (aman, id tetap
// sama jadi semua kode lain yang pakai getElementById tidak terpengaruh).
function portalPanelToBodyOnMobile(panel){
  if(!panel || window.innerWidth > 880) return;
  if(panel.parentElement === document.body) return;
  document.body.appendChild(panel);
}

function toggleNotificationPanel(){
  const panel = $('#notifPanel');
  if(!panel) return;
  portalPanelToBodyOnMobile(panel);
  const willOpen = panel.classList.contains('hidden');
  $('#onlinePanel')?.classList.add('hidden'); // tutup panel online kalau lagi terbuka
  $('#settingsPanel')?.classList.add('hidden');
  panel.classList.toggle('hidden');
  if(willOpen){ renderNotifPanel(); markAllNotificationsRead(); }
}

function renderNotifPanel(){
  const panel = $('#notifPanel');
  if(!panel) return;
  if(!notifCache.length){
    panel.innerHTML = `<div class="notif-panel-header"><span>Notifikasi</span></div><div class="notif-empty">Belum ada notifikasi.</div>`;
    return;
  }
  panel.innerHTML = `
    <div class="notif-panel-header">
      <span>Notifikasi</span>
      <button class="notif-markall" onclick="markAllNotificationsRead()">Tandai semua dibaca</button>
    </div>
    <div class="notif-list">
      ${notifCache.map(n => `
        <div class="notif-item ${notifReadIds.has(n.id) ? '' : 'unread'}">
          <span class="notif-icon">${ACTION_ICON[n.action] || '•'}</span>
          <div class="notif-body">
            <div class="notif-msg">${esc(n.message)}</div>
            <div class="notif-meta">${esc(TABLES[n.table_key]?.label || n.table_key)} · ${timeAgo(n.created_at)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function markAllNotificationsRead(){
  const unread = notifCache.filter(n => !notifReadIds.has(n.id));
  if(!unread.length) return;
  const rows = unread.map(n => ({ notification_id: n.id, user_id: currentUser.id }));
  const { error } = await supa.from('notification_reads').upsert(rows, { onConflict: 'notification_id,user_id' });
  if(error){ console.error('Gagal menandai notifikasi dibaca:', error.message); return; }
  unread.forEach(n => notifReadIds.add(n.id));
  renderNotifBadge();
  renderNotifPanel();
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('notifWrap');
  const panel = document.getElementById('notifPanel');
  if(wrap && panel && !wrap.contains(e.target) && !panel.contains(e.target)) panel.classList.add('hidden');
});

/* ---------------------------------------------------------------------
   4e. CHAT TIM (REALTIME)
   ---------------------------------------------------------------------
   Satu ruang chat bersama untuk SEMUA akun (Admin/Manager/Superintendent/
   Staff/Viewer) — bukan pesan pribadi (DM). Menggunakan Supabase Realtime
   (postgres_changes) sehingga pesan baru langsung muncul di semua
   perangkat yang sedang online tanpa perlu refresh/polling.
   Jalankan chat_schema.sql di SQL Editor Supabase sebelum memakai fitur
   ini (membuat tabel chat_messages + RLS + mengaktifkan Realtime-nya).
   --------------------------------------------------------------------- */
let chatChannel = null;
let chatMessagesCache = [];
let chatUnreadCount = 0;
const CHAT_HISTORY_LIMIT = 150;

function escapeHtml(str){
  return (str ?? '').toString()
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

async function initChat(){
  await loadChatMessages();
  if(chatChannel) return; // hindari subscribe dobel kalau initChat terpanggil lagi
  chatChannel = supa.channel('chat_messages_stream')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages' }, (payload) => {
      chatMessagesCache.push(payload.new);
      if(chatMessagesCache.length > CHAT_HISTORY_LIMIT) chatMessagesCache.shift();
      const isOwnMessage = payload.new.sender_id === currentUser?.id;
      if(currentView === 'chat'){
        renderChatMessages();
        scrollChatToBottom();
      } else if(!isOwnMessage){
        chatUnreadCount++;
        updateChatBadge();
      }
      // Bunyi notifikasi untuk pesan dari user lain, di halaman manapun
      // pengguna sedang berada (termasuk saat sedang membuka Chat Tim).
      if(!isOwnMessage) playChatSound();
      // Bubble notif muncul untuk pesan dari user lain, di halaman manapun
      // pengguna sedang berada (kecuali sedang membuka halaman Chat Tim itu
      // sendiri, karena pesannya sudah langsung terlihat di sana).
      if(!isOwnMessage && currentView !== 'chat'){
        showChatBubbleNotif(payload.new);
      }
    })
    .subscribe();
}

// Menampilkan bubble notifikasi mengambang di pojok kanan bawah setiap kali
// ada pesan chat baru dari user lain (mirip notifikasi WhatsApp/Messenger).
// Klik bubble -> langsung membuka menu Chat Tim. Otomatis hilang setelah
// beberapa detik, atau bisa ditutup manual lewat tombol ×.
const CHAT_BUBBLE_AUTOHIDE_MS = 6000;
const CHAT_BUBBLE_MAX_STACK = 3;

function showChatBubbleNotif(msg){
  const wrap = $('#chatNotifWrap');
  if(!wrap) return;

  // Batasi jumlah bubble yang menumpuk di layar agar tidak berantakan.
  while(wrap.children.length >= CHAT_BUBBLE_MAX_STACK){
    wrap.removeChild(wrap.firstElementChild);
  }

  const senderName = msg.sender_name || 'Pengguna';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-notif';
  bubble.innerHTML = `
    <div class="chat-bubble-notif-avatar" style="${avatarBgStyle(msg.sender_avatar_url)}"></div>
    <div class="chat-bubble-notif-body">
      <div class="chat-bubble-notif-tag">CHAT TIM · PESAN BARU</div>
      <div class="chat-bubble-notif-head">
        <span class="chat-bubble-notif-sender">${escapeHtml(senderName)}</span>
        <button class="chat-bubble-notif-close" title="Tutup" aria-label="Tutup">&times;</button>
      </div>
      <div class="chat-bubble-notif-msg">${escapeHtml(msg.message || '')}</div>
    </div>
  `;

  const dismiss = () => {
    if(!bubble.isConnected) return;
    bubble.classList.add('leaving');
    setTimeout(() => bubble.remove(), 180);
  };

  bubble.addEventListener('click', (e) => {
    if(e.target.closest('.chat-bubble-notif-close')){ dismiss(); return; }
    dismiss();
    navigate('chat');
  });

  wrap.appendChild(bubble);
  setTimeout(dismiss, CHAT_BUBBLE_AUTOHIDE_MS);
}

function teardownChat(){
  if(chatChannel){ supa.removeChannel(chatChannel); chatChannel = null; }
  chatMessagesCache = [];
  chatUnreadCount = 0;
  updateChatBadge();
  const notifWrap = $('#chatNotifWrap');
  if(notifWrap) notifWrap.innerHTML = '';
}

/* ---------------------------------------------------------------------
   4f. STATUS ONLINE PENGGUNA (Supabase Realtime Presence)
   ---------------------------------------------------------------------
   Memakai fitur Presence bawaan Supabase Realtime (bukan tabel database
   terpisah) — setiap perangkat yang sedang membuka aplikasi (dalam
   keadaan login) "melacak" dirinya sendiri ke satu channel bersama.
   Semua perangkat lain yang online otomatis tahu siapa saja yang online
   secara langsung (tanpa polling), lengkap dengan nama & role, dan
   status akan hilang otomatis begitu tab ditutup / koneksi terputus /
   logout — tidak perlu skema tabel atau migrasi SQL tambahan.
   --------------------------------------------------------------------- */
let presenceChannel = null;
let onlineUsersState = {}; // hasil presenceChannel.presenceState(): { [user_id]: [{full_name, role, ...}] }

function initPresence(){
  if(presenceChannel || !currentUser) return; // hindari subscribe dobel
  presenceChannel = supa.channel('online-users', {
    config: { presence: { key: currentUser.id } }
  });
  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      onlineUsersState = presenceChannel.presenceState();
      renderOnlineIndicators();
    })
    .subscribe(async (status) => {
      if(status === 'SUBSCRIBED'){
        await presenceChannel.track({
          full_name: currentProfile?.full_name || currentProfile?.email || 'Pengguna',
          role: currentProfile?.role || 'viewer',
          zona: currentProfile?.zona || null,
          online_at: new Date().toISOString(),
        });
      }
    });
}

function teardownPresence(){
  if(presenceChannel){
    presenceChannel.untrack().catch(()=>{});
    supa.removeChannel(presenceChannel);
    presenceChannel = null;
  }
  onlineUsersState = {};
  renderOnlineIndicators();
}

// Daftar unik pengguna online: satu user bisa punya beberapa entri (mis.
// membuka 2 tab), jadi diringkas jadi satu entri per user_id (presence key).
function getOnlineUsersList(){
  return Object.entries(onlineUsersState).map(([userId, metas]) => {
    const m = metas[0] || {};
    return { id: userId, full_name: m.full_name || 'Pengguna', role: m.role || '-' };
  });
}
function isUserOnline(userId){
  return Object.prototype.hasOwnProperty.call(onlineUsersState, userId) && onlineUsersState[userId].length > 0;
}

function renderOnlineIndicators(){
  const list = getOnlineUsersList();
  const countEl = $('#onlineCountLabel');
  if(countEl) countEl.textContent = `${list.length} Online`;
  if(!$('#onlinePanel')?.classList.contains('hidden')) renderOnlinePanel();
  updateUsersOnlineIndicators();
}

function renderOnlinePanel(){
  const panel = $('#onlinePanel');
  if(!panel) return;
  const list = getOnlineUsersList().sort((a,b) => (a.id===currentUser?.id ? -1 : b.id===currentUser?.id ? 1 : a.full_name.localeCompare(b.full_name)));
  panel.innerHTML = `
    <div class="notif-panel-header"><span>Pengguna Online (${list.length})</span></div>
    <div class="notif-list">
      ${list.length ? list.map(u => `
        <div class="notif-item">
          <span class="online-dot online-dot-live" style="margin-top:4px;"></span>
          <div class="notif-body">
            <div class="notif-msg">${esc(u.full_name)}${u.id===currentUser?.id ? ' <span style="color:var(--text-faint);">(Anda)</span>' : ''}</div>
            <div class="notif-meta">${esc(u.role)}</div>
          </div>
          ${u.id!==currentUser?.id ? `<button class="btn btn-outline btn-sm" style="padding:3px 8px; font-size:11px; margin-left:auto; flex-shrink:0;" onclick="toggleOnlinePanel(); startDMWith('${u.id}')">Pesan</button>` : ''}
        </div>
      `).join('') : `<div class="notif-empty">Tidak ada pengguna lain yang online.</div>`}
    </div>
  `;
}

function toggleOnlinePanel(){
  const panel = $('#onlinePanel');
  if(!panel) return;
  portalPanelToBodyOnMobile(panel);
  const willOpen = panel.classList.contains('hidden');
  $('#notifPanel')?.classList.add('hidden'); // tutup panel notifikasi kalau lagi terbuka
  $('#settingsPanel')?.classList.add('hidden');
  panel.classList.toggle('hidden');
  if(willOpen) renderOnlinePanel();
}

document.addEventListener('click', (e) => {
  const wrap = document.getElementById('chatOnlineWrap');
  const panel = document.getElementById('onlinePanel');
  if(wrap && panel && !wrap.contains(e.target) && !panel.contains(e.target)) panel.classList.add('hidden');
});

/* ---- Menu Pengaturan (gabungan Tema + Suara Notifikasi) ---- */
function toggleSettingsPanel(){
  const panel = $('#settingsPanel');
  if(!panel) return;
  portalPanelToBodyOnMobile(panel);
  const willOpen = panel.classList.contains('hidden');
  $('#notifPanel')?.classList.add('hidden');
  $('#onlinePanel')?.classList.add('hidden');
  panel.classList.toggle('hidden');
  if(willOpen) syncSettingsPanelState();
}
function syncSettingsPanelState(){
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const themeLabel = $('#themeStateLabel');
  if(themeLabel) themeLabel.textContent = isLight ? 'Terang' : 'Gelap';
  const themeSwitch = $('#themeSwitch');
  if(themeSwitch){ themeSwitch.classList.toggle('on', !isLight); themeSwitch.setAttribute('aria-checked', String(!isLight)); }
  renderNotifSoundToggle();
  if(typeof syncTvModeSwitch === 'function') syncTvModeSwitch();
  const verLabel = $('#checkUpdateVersionLabel');
  if(verLabel && window.APP_VERSION) verLabel.textContent = 'v' + window.APP_VERSION;
}
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('settingsWrap');
  const panel = document.getElementById('settingsPanel');
  if(wrap && panel && !wrap.contains(e.target) && !panel.contains(e.target)) panel.classList.add('hidden');
});

// Memperbarui titik hijau/abu-abu di tabel "Kelola Pengguna" (kalau sedang
// terbuka) tanpa perlu memuat ulang seluruh tabel dari database.
function updateUsersOnlineIndicators(){
  if(currentView !== 'users') return;
  $all('[id^="onlineDot_"]').forEach(dot => {
    const id = dot.id.replace('onlineDot_', '');
    const online = isUserOnline(id);
    dot.classList.toggle('online-dot-live', online);
    const label = $('#onlineLabel_' + id);
    if(label) label.textContent = online ? 'Online' : 'Offline';
  });
}

async function loadChatMessages(){
  const { data, error } = await supa.from('chat_messages').select('*').order('created_at', { ascending:false }).limit(CHAT_HISTORY_LIMIT);
  if(error){ console.error('Gagal memuat chat:', error.message); return; }
  chatMessagesCache = (data || []).slice().reverse();
}

function updateChatBadge(){
  const el = $('#chatUnreadBadge');
  if(!el) return;
  if(chatUnreadCount > 0){ el.textContent = chatUnreadCount > 99 ? '99+' : chatUnreadCount; el.classList.remove('hidden'); }
  else { el.classList.add('hidden'); }
}

async function renderChat(){
  $('#pageEyebrow').textContent = 'REALTIME · SELURUH AKUN';
  $('#pageTitle').textContent = 'Chat Tim';
  chatUnreadCount = 0;
  updateChatBadge();

  $('#pageContent').innerHTML = `
    <div class="card chat-card">
      <div class="card-header">
        <div>
          <div class="card-title">Chat Tim</div>
          <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px;">Satu ruang chat untuk semua akun · pesan tersinkron secara realtime</div>
        </div>
        <div class="notif-wrap chat-online-wrap" id="chatOnlineWrap" title="Pengguna yang sedang online">
          <button class="btn btn-outline btn-sm" onclick="toggleOnlinePanel()">
            <span class="online-dot online-dot-live"></span>
            <span id="onlineCountLabel">– Online</span>
          </button>
          <div class="notif-panel online-panel hidden" id="onlinePanel"></div>
        </div>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <form class="chat-input-bar" id="chatForm" onsubmit="return sendChatMessage(event)">
        <textarea class="input chat-textarea" id="chatInput" rows="1" placeholder="Tulis pesan… (Enter untuk kirim, Shift+Enter untuk baris baru)" onkeydown="handleChatKeydown(event)" required></textarea>
        <button class="btn btn-primary btn-icon chat-send-btn" type="submit" title="Kirim">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>
        </button>
      </form>
    </div>
  `;
  if(!chatMessagesCache.length) await loadChatMessages();
  renderChatMessages();
  renderOnlineIndicators();
  scrollChatToBottom();
  // Auto-focus hanya di layar besar (desktop). Di HP, auto-focus bikin
  // keyboard langsung muncul & browser "melompat/zoom" ke form chat begitu
  // menu dibuka — jadi di layar <=880px baris ini sengaja dilewati.
  if(window.innerWidth > 880) $('#chatInput')?.focus();
}

function renderChatMessages(){
  const wrap = $('#chatMessages');
  if(!wrap) return;
  if(!chatMessagesCache.length){
    wrap.innerHTML = `<div class="empty-state">Belum ada pesan. Mulai percakapan tim di sini.</div>`;
    return;
  }
  wrap.innerHTML = chatMessagesCache.map(m=>{
    const isOwn = m.sender_id === currentUser?.id;
    const time = new Date(m.created_at).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    return `
      <div class="chat-msg ${isOwn ? 'own' : ''}">
        <div class="chat-avatar" style="${avatarBgStyle(m.sender_avatar_url)}"></div>
        <div class="chat-bubble-wrap">
          <div class="chat-meta">
            <span class="chat-sender">${escapeHtml(m.sender_name || 'Pengguna')}</span>
            ${m.sender_role ? `<span class="role-pill role-${escapeHtml(m.sender_role)}">${escapeHtml(m.sender_role)}</span>` : ''}
            <span class="chat-time">${escapeHtml(time)}</span>
          </div>
          <div class="chat-bubble">${escapeHtml(m.message)}</div>
        </div>
      </div>`;
  }).join('');
}

function scrollChatToBottom(){
  const wrap = $('#chatMessages');
  if(wrap) wrap.scrollTop = wrap.scrollHeight;
}

function handleChatKeydown(event){
  if(event.key === 'Enter' && !event.shiftKey){
    event.preventDefault();
    $('#chatForm')?.requestSubmit();
  }
}

async function sendChatMessage(event){
  event.preventDefault();
  const input = $('#chatInput');
  const text = (input?.value || '').trim();
  if(!text) return false;
  input.value = '';
  input.style.height = '';
  const { error } = await supa.from('chat_messages').insert({
    sender_id: currentUser.id,
    sender_name: currentProfile.full_name || currentProfile.email || 'Pengguna',
    sender_role: currentProfile.role || null,
    message: text,
  });
  if(error){ toast('Gagal mengirim pesan: ' + error.message, true); input.value = text; }
  return false;
}

/* ---------------------------------------------------------------------
   4e-2. PESAN LANGSUNG (DIRECT MESSAGE / DM, REALTIME 1-ke-1)
   ---------------------------------------------------------------------
   Berbeda dari "Chat Tim" (satu ruang bersama untuk semua akun), fitur
   ini memungkinkan setiap pengguna mengirim pesan PRIBADI ke satu
   pengguna lain secara langsung (1-ke-1), lengkap dengan status online,
   badge belum dibaca, dan status "Terkirim/Dibaca".
   Jalankan dm_schema.sql di SQL Editor Supabase sebelum memakai fitur
   ini (membuat tabel direct_messages + RLS + mengaktifkan Realtime-nya,
   serta memastikan tabel `profiles` bisa dibaca oleh semua akun yang
   sudah login supaya daftar penerima pesan bisa dimuat).
   --------------------------------------------------------------------- */
let dmChannel = null;
let dmDirectory = [];           // daftar semua pengguna lain (dari tabel profiles)
let dmMessagesCache = {};       // { [idPenggunaLawanBicara]: [pesan, ...] }
let dmUnreadByUser = {};        // { [idPenggunaLawanBicara]: jumlahBelumDibaca }
let dmActiveUserId = null;      // id lawan bicara yang percakapannya sedang terbuka
const DM_HISTORY_LIMIT = 1000;

async function loadDMDirectory(){
  const { data, error } = await supa.from('profiles')
    .select('id, full_name, email, role, zona, avatar_url')
    .neq('id', currentUser.id)
    .order('full_name', { ascending:true });
  if(error){ console.error('Gagal memuat daftar pengguna untuk Pesan Langsung:', error.message); dmDirectory = []; return; }
  dmDirectory = data || [];
}

async function loadAllDMMessages(){
  const { data, error } = await supa.from('direct_messages')
    .select('*')
    .or(`sender_id.eq.${currentUser.id},recipient_id.eq.${currentUser.id}`)
    .order('created_at', { ascending:true })
    .limit(DM_HISTORY_LIMIT);
  if(error){ console.error('Gagal memuat pesan langsung:', error.message); return; }
  dmMessagesCache = {}; dmUnreadByUser = {};
  (data || []).forEach(m => {
    const otherId = m.sender_id === currentUser.id ? m.recipient_id : m.sender_id;
    (dmMessagesCache[otherId] = dmMessagesCache[otherId] || []).push(m);
    if(m.recipient_id === currentUser.id && !m.read_at){
      dmUnreadByUser[otherId] = (dmUnreadByUser[otherId] || 0) + 1;
    }
  });
  updateDMBadge();
}

async function initDM(){
  await loadDMDirectory();
  await loadAllDMMessages();
  if(dmChannel) return; // hindari subscribe dobel kalau initDM terpanggil lagi
  dmChannel = supa.channel('direct_messages_stream')
    .on('postgres_changes', { event:'INSERT', schema:'public', table:'direct_messages' }, (payload) => {
      handleIncomingDM(payload.new);
    })
    .on('postgres_changes', { event:'UPDATE', schema:'public', table:'direct_messages' }, (payload) => {
      handleDMUpdate(payload.new);
    })
    .subscribe();
}

function teardownDM(){
  if(dmChannel){ supa.removeChannel(dmChannel); dmChannel = null; }
  dmDirectory = []; dmMessagesCache = {}; dmUnreadByUser = {}; dmActiveUserId = null;
  updateDMBadge();
}

// RLS pada tabel direct_messages hanya mengizinkan baris yang melibatkan
// pengguna yang sedang login untuk terlihat lewat Realtime, jadi event
// INSERT/UPDATE yang sampai ke sini sudah pasti relevan (dikirim OLEH atau
// UNTUK pengguna ini).
function handleIncomingDM(msg){
  const isOwn = msg.sender_id === currentUser?.id;
  const otherId = isOwn ? msg.recipient_id : msg.sender_id;
  (dmMessagesCache[otherId] = dmMessagesCache[otherId] || []).push(msg);

  if(currentView === 'dm' && dmActiveUserId === otherId){
    renderDMMessages();
    scrollDMToBottom();
    if(!isOwn) markDMConversationRead(otherId);
  } else if(!isOwn){
    dmUnreadByUser[otherId] = (dmUnreadByUser[otherId] || 0) + 1;
    updateDMBadge();
  }

  if(!isOwn){
    playChatSound();
    if(!(currentView === 'dm' && dmActiveUserId === otherId)) showDMBubbleNotif(msg);
  }

  if(currentView === 'dm') renderDMUserList();
}

// Menangani update status "Dibaca" (read_at) yang dikirim balik oleh
// lawan bicara, supaya centang "Terkirim" -> "Dibaca" berubah realtime.
function handleDMUpdate(msg){
  const isOwn = msg.sender_id === currentUser?.id;
  const otherId = isOwn ? msg.recipient_id : msg.sender_id;
  const list = dmMessagesCache[otherId];
  if(!list) return;
  const idx = list.findIndex(m => m.id === msg.id);
  if(idx !== -1) list[idx] = msg;
  if(currentView === 'dm' && dmActiveUserId === otherId) renderDMMessages();
}

function updateDMBadge(){
  const el = $('#dmUnreadBadge');
  if(!el) return;
  const total = Object.values(dmUnreadByUser).reduce((a,b)=>a+b, 0);
  if(total > 0){ el.textContent = total > 99 ? '99+' : total; el.classList.remove('hidden'); }
  else { el.classList.add('hidden'); }
}

// Bubble notifikasi mengambang untuk pesan langsung baru — sama seperti
// bubble Chat Tim, tapi klik akan langsung membuka percakapan pribadi
// dengan pengirimnya.
function showDMBubbleNotif(msg){
  const wrap = $('#chatNotifWrap');
  if(!wrap) return;
  while(wrap.children.length >= CHAT_BUBBLE_MAX_STACK){ wrap.removeChild(wrap.firstElementChild); }

  const senderName = msg.sender_name || 'Pengguna';

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble-notif';
  bubble.innerHTML = `
    <div class="chat-bubble-notif-avatar" style="${avatarBgStyle(msg.sender_avatar_url)}"></div>
    <div class="chat-bubble-notif-body">
      <div class="chat-bubble-notif-tag">PESAN LANGSUNG · BARU</div>
      <div class="chat-bubble-notif-head">
        <span class="chat-bubble-notif-sender">${escapeHtml(senderName)}</span>
        <button class="chat-bubble-notif-close" title="Tutup" aria-label="Tutup">&times;</button>
      </div>
      <div class="chat-bubble-notif-msg">${escapeHtml(msg.message || '')}</div>
    </div>
  `;

  const dismiss = () => {
    if(!bubble.isConnected) return;
    bubble.classList.add('leaving');
    setTimeout(() => bubble.remove(), 180);
  };

  bubble.addEventListener('click', (e) => {
    if(e.target.closest('.chat-bubble-notif-close')){ dismiss(); return; }
    dismiss();
    startDMWith(msg.sender_id);
  });

  wrap.appendChild(bubble);
  setTimeout(dismiss, CHAT_BUBBLE_AUTOHIDE_MS);
}

async function renderDM(){
  $('#pageEyebrow').textContent = 'PRIBADI · SATU LAWAN SATU';
  $('#pageTitle').textContent = 'Pesan Langsung';

  if(!dmDirectory.length) await loadDMDirectory();

  $('#pageContent').innerHTML = `
    <div class="card dm-card">
      <div class="dm-layout">
        <div class="dm-sidebar">
          <div class="dm-sidebar-header">
            <div class="card-title">Pesan Langsung</div>
            <input class="input dm-search" id="dmSearchInput" placeholder="Cari nama pengguna…" oninput="renderDMUserList()">
          </div>
          <div class="dm-user-list" id="dmUserList"></div>
        </div>
        <div class="dm-conversation" id="dmConversation"></div>
      </div>
    </div>
  `;
  renderDMUserList();
  if(dmActiveUserId) openDMConversation(dmActiveUserId);
}

function renderDMUserList(){
  const wrap = $('#dmUserList');
  if(!wrap) return;
  const q = ($('#dmSearchInput')?.value || '').trim().toLowerCase();

  const list = dmDirectory
    .filter(u => !q || (u.full_name||'').toLowerCase().includes(q) || (u.email||'').toLowerCase().includes(q))
    .map(u => {
      const msgs = dmMessagesCache[u.id] || [];
      const last = msgs[msgs.length - 1];
      return { ...u, lastMsg: last, lastTime: last ? new Date(last.created_at).getTime() : 0, unread: dmUnreadByUser[u.id] || 0 };
    })
    .sort((a,b) => b.lastTime - a.lastTime || (a.full_name||'').localeCompare(b.full_name||''));

  if(!list.length){
    wrap.innerHTML = `<div class="empty-state" style="padding:28px 16px;">Tidak ada pengguna ditemukan.</div>`;
    return;
  }

  wrap.innerHTML = list.map(u => {
    const online = isUserOnline(u.id);
    const previewPrefix = u.lastMsg ? (u.lastMsg.sender_id === currentUser.id ? 'Anda: ' : '') : '';
    const preview = u.lastMsg ? escapeHtml(previewPrefix + u.lastMsg.message) : 'Belum ada pesan';
    return `
      <div class="dm-user-item ${dmActiveUserId===u.id ? 'active':''}" onclick="openDMConversation('${u.id}')">
        <div class="dm-user-avatar-wrap">
          <div class="dm-user-avatar" style="${avatarBgStyle(u.avatar_url)}"></div>
          <span class="dm-user-online-dot ${online?'live':''}"></span>
        </div>
        <div class="dm-user-info">
          <div class="dm-user-name">${escapeHtml(u.full_name || u.email || 'Pengguna')}</div>
          <div class="dm-user-preview">${preview}</div>
        </div>
        ${u.unread ? `<span class="dm-user-badge">${u.unread > 99 ? '99+' : u.unread}</span>` : ''}
      </div>`;
  }).join('');
}

function openDMConversation(userId){
  dmActiveUserId = userId;
  $all('.dm-user-item').forEach((el, i) => {}); // no-op placeholder (active class ditentukan ulang lewat render di bawah)
  renderDMUserList();

  const user = dmDirectory.find(u => u.id === userId);
  const wrap = $('#dmConversation');
  if(!wrap) return;
  if(!user){
    wrap.innerHTML = `<div class="empty-state">Pengguna tidak ditemukan.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="dm-conversation-header">
      <div class="dm-user-avatar" style="${avatarBgStyle(user.avatar_url)}"></div>
      <div>
        <div class="card-title" style="font-size:14px;">${escapeHtml(user.full_name || user.email || 'Pengguna')}</div>
        <div style="font-size:11px; color:var(--text-faint);">${isUserOnline(userId) ? 'Online' : 'Offline'}${user.role ? ' · ' + escapeHtml(user.role) : ''}</div>
      </div>
    </div>
    <div class="chat-messages" id="dmMessages"></div>
    <form class="chat-input-bar" id="dmForm" onsubmit="return sendDMMessage(event)">
      <textarea class="input chat-textarea" id="dmInput" rows="1" placeholder="Tulis pesan pribadi… (Enter untuk kirim, Shift+Enter untuk baris baru)" onkeydown="handleDMKeydown(event)" required></textarea>
      <button class="btn btn-primary btn-icon chat-send-btn" type="submit" title="Kirim">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg>
      </button>
    </form>
  `;
  renderDMMessages();
  scrollDMToBottom();
  // Sama seperti chat tim: jangan auto-focus di HP supaya tidak tiba-tiba
  // zoom/keyboard muncul begitu buka percakapan.
  if(window.innerWidth > 880) $('#dmInput')?.focus();
  markDMConversationRead(userId);
}

function renderDMMessages(){
  const wrap = $('#dmMessages');
  if(!wrap || !dmActiveUserId) return;
  const msgs = dmMessagesCache[dmActiveUserId] || [];
  if(!msgs.length){
    wrap.innerHTML = `<div class="empty-state">Belum ada pesan. Mulai percakapan pribadi di sini.</div>`;
    return;
  }
  const lastOwnIdx = msgs.map(m=>m.sender_id).lastIndexOf(currentUser?.id);
  wrap.innerHTML = msgs.map((m, idx) => {
    const isOwn = m.sender_id === currentUser?.id;
    const time = new Date(m.created_at).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const showReadStatus = isOwn && idx === lastOwnIdx;
    return `
      <div class="chat-msg ${isOwn ? 'own' : ''}">
        <div class="chat-avatar" style="${avatarBgStyle(isOwn ? currentProfile?.avatar_url : (dmDirectory.find(u=>u.id===dmActiveUserId)||{}).avatar_url)}"></div>
        <div class="chat-bubble-wrap">
          <div class="chat-meta">
            <span class="chat-sender">${escapeHtml(m.sender_name || 'Pengguna')}</span>
            <span class="chat-time">${escapeHtml(time)}</span>
          </div>
          <div class="chat-bubble">${escapeHtml(m.message)}</div>
          ${showReadStatus ? `<div class="dm-read-status">${m.read_at ? '<span class="dm-msg-check">✓✓</span> Dibaca' : '✓ Terkirim'}</div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function scrollDMToBottom(){
  const wrap = $('#dmMessages');
  if(wrap) wrap.scrollTop = wrap.scrollHeight;
}

function handleDMKeydown(event){
  if(event.key === 'Enter' && !event.shiftKey){
    event.preventDefault();
    $('#dmForm')?.requestSubmit();
  }
}

async function sendDMMessage(event){
  event.preventDefault();
  if(!dmActiveUserId) return false;
  const input = $('#dmInput');
  const text = (input?.value || '').trim();
  if(!text) return false;
  input.value = ''; input.style.height = '';
  const recipient = dmDirectory.find(u => u.id === dmActiveUserId);
  const { error } = await supa.from('direct_messages').insert({
    sender_id: currentUser.id,
    recipient_id: dmActiveUserId,
    sender_name: currentProfile.full_name || currentProfile.email || 'Pengguna',
    recipient_name: recipient?.full_name || recipient?.email || 'Pengguna',
    message: text,
  });
  if(error){ toast('Gagal mengirim pesan: ' + error.message, true); input.value = text; }
  return false;
}

// Menandai semua pesan MASUK dari lawan bicara tertentu sebagai sudah
// dibaca (read_at diisi). Dipanggil setiap kali percakapan dengan
// pengguna tsb dibuka, atau saat pesan baru masuk ketika percakapannya
// sedang aktif terbuka di layar.
async function markDMConversationRead(userId){
  if(dmUnreadByUser[userId]){
    dmUnreadByUser[userId] = 0;
    updateDMBadge();
  }
  const { error } = await supa.from('direct_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('sender_id', userId)
    .eq('recipient_id', currentUser.id)
    .is('read_at', null);
  if(error) console.error('Gagal menandai pesan sebagai dibaca:', error.message);
}

// Shortcut untuk membuka (atau memulai) percakapan pribadi dengan seorang
// pengguna dari mana saja di aplikasi (mis. dari halaman Kelola Pengguna
// atau panel Pengguna Online), tanpa perlu pengguna mencarinya manual
// lewat menu Pesan Langsung.
async function startDMWith(userId){
  await navigate('dm');
  openDMConversation(userId);
}
function renderAvatarEditIcon(){
  const avatarEl = $('#userAvatar');
  if(!avatarEl) return;
  avatarEl.style.position = 'relative';
  let overlay = document.getElementById('avatarEditIcon');
  if(!overlay){
    overlay = document.createElement('div');
    overlay.id = 'avatarEditIcon';
    overlay.style.cssText = 'position:absolute; bottom:-2px; right:-2px; width:15px; height:15px; background:var(--accent-gold); border-radius:50%; display:flex; align-items:center; justify-content:center; border:2px solid var(--sidebar); pointer-events:none;';
    overlay.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#12200D" stroke-width="3"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z"/><circle cx="12" cy="13" r="4"/></svg>`;
  }
  avatarEl.appendChild(overlay); // re-append (textContent='' above may have removed it)
}
function ensureAvatarFileInput(){
  let inp = document.getElementById('avatarFileInput');
  if(!inp){
    inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'avatarFileInput'; inp.className = 'hidden';
    inp.addEventListener('change', handleAvatarFileChange);
    document.body.appendChild(inp);
  }
  return inp;
}
function triggerAvatarUpload(){
  ensureAvatarFileInput().click();
}
async function handleAvatarFileChange(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!file.type.startsWith('image/')){ toast('File harus berupa gambar', true); return; }
  if(file.size > 2*1024*1024){ toast('Ukuran gambar maksimal 2MB', true); return; }
  openAvatarCropModal(file);
}

/* ---------------------------------------------------------------------
   4b. ATUR TATA LETAK FOTO PROFIL (geser + zoom) sebelum disimpan.
   Canvas persegi, drag mouse/jari buat geser, slider buat zoom. Hasil
   akhir di-crop jadi gambar persegi baru (JPEG) baru diunggah.
   --------------------------------------------------------------------- */
function openAvatarCropModal(file){
  const VP = 280; // ukuran viewport persegi di layar (px)
  const objUrl = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const st = { scale: 1, minScale: 1, x: 0, y: 0, dragging: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    st.minScale = Math.max(VP / img.naturalWidth, VP / img.naturalHeight);
    st.scale = st.minScale;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'avatarCropOverlay';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:360px; text-align:center;">
        <div class="modal-header"><div class="card-title">Atur Tata Letak Foto Profil</div><button class="btn btn-outline btn-icon" onclick="document.getElementById('avatarCropOverlay').remove()">✕</button></div>
        <div class="modal-body">
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">Geser gambar untuk atur posisi, pakai slider untuk zoom.</p>
          <div id="avatarCropViewport" style="width:${VP}px; height:${VP}px; margin:0 auto; border-radius:12px; overflow:hidden; position:relative; background:var(--bg-elevated); cursor:grab; touch-action:none;">
            <img id="avatarCropImg" src="${objUrl}" style="position:absolute; top:50%; left:50%; transform-origin:center; user-select:none; pointer-events:none;">
          </div>
          <input type="range" id="avatarCropZoom" min="0" max="100" value="0" style="width:100%; margin-top:16px;">
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" onclick="document.getElementById('avatarCropOverlay').remove()">Batal</button>
          <button class="btn btn-primary" id="avatarCropSaveBtn">Simpan Foto</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const vp = document.getElementById('avatarCropViewport');
    const imEl = document.getElementById('avatarCropImg');
    const zoomEl = document.getElementById('avatarCropZoom');

    function clamp(){
      const dispW = img.naturalWidth * st.scale, dispH = img.naturalHeight * st.scale;
      const maxX = Math.max(0, (dispW - VP) / 2), maxY = Math.max(0, (dispH - VP) / 2);
      st.x = Math.min(maxX, Math.max(-maxX, st.x));
      st.y = Math.min(maxY, Math.max(-maxY, st.y));
    }
    function render(){
      clamp();
      imEl.style.width = (img.naturalWidth * st.scale) + 'px';
      imEl.style.height = (img.naturalHeight * st.scale) + 'px';
      imEl.style.transform = `translate(calc(-50% + ${st.x}px), calc(-50% + ${st.y}px))`;
    }
    render();

    zoomEl.addEventListener('input', () => {
      st.scale = st.minScale * (1 + (zoomEl.value / 100) * 2); // sampai 3x skala minimum
      render();
    });

    function pointerDown(clientX, clientY){ st.dragging = true; st.sx = clientX; st.sy = clientY; st.ox = st.x; st.oy = st.y; vp.style.cursor = 'grabbing'; }
    function pointerMove(clientX, clientY){ if(!st.dragging) return; st.x = st.ox + (clientX - st.sx); st.y = st.oy + (clientY - st.sy); render(); }
    function pointerUp(){ st.dragging = false; vp.style.cursor = 'grab'; }

    vp.addEventListener('mousedown', (e) => pointerDown(e.clientX, e.clientY));
    window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', pointerUp);
    vp.addEventListener('touchstart', (e) => { const t = e.touches[0]; pointerDown(t.clientX, t.clientY); }, { passive: true });
    vp.addEventListener('touchmove', (e) => { const t = e.touches[0]; pointerMove(t.clientX, t.clientY); }, { passive: true });
    vp.addEventListener('touchend', pointerUp);

    document.getElementById('avatarCropSaveBtn').onclick = async () => {
      const OUT = 480;
      const canvas = document.createElement('canvas');
      canvas.width = OUT; canvas.height = OUT;
      const ctx = canvas.getContext('2d');
      const imgLeft = VP/2 + st.x - (img.naturalWidth*st.scale)/2;
      const imgTop = VP/2 + st.y - (img.naturalHeight*st.scale)/2;
      const srcX = -imgLeft / st.scale, srcY = -imgTop / st.scale, srcSize = VP / st.scale;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);
      canvas.toBlob(async (blob) => {
        URL.revokeObjectURL(objUrl);
        document.getElementById('avatarCropOverlay')?.remove();
        if(blob) await uploadAvatarBlob(blob);
      }, 'image/jpeg', 0.92);
    };
  };
  img.src = objUrl;
}
async function uploadAvatarBlob(blob){
  toast('Mengunggah foto profil…');
  const path = `${currentUser.id}/avatar.jpg`;
  const { error: upErr } = await supa.storage.from('avatars').upload(path, blob, { upsert: true, cacheControl: '3600', contentType: 'image/jpeg' });
  if(upErr){ toast('Gagal mengunggah foto: ' + upErr.message, true); return; }
  const { data: pub } = supa.storage.from('avatars').getPublicUrl(path);
  const avatarUrl = pub.publicUrl + '?t=' + Date.now();
  const { error: updErr } = await supa.from('profiles').update({ avatar_url: avatarUrl }).eq('id', currentUser.id);
  if(updErr){ toast('Gagal menyimpan foto profil: ' + updErr.message, true); return; }
  currentProfile.avatar_url = avatarUrl;
  applyRoleUI();
  toast('Foto profil berhasil diperbarui');
}

/* ---------------------------------------------------------------------
   5. NAVIGATION
   --------------------------------------------------------------------- */
function toggleSidebar(){
  sidebarOpenState = !sidebarOpenState;
  $('#sidebar').classList.toggle('open', sidebarOpenState);
  const bd = $('#sidebarBackdrop'); if(bd) bd.classList.toggle('show', sidebarOpenState);
}

/* --- Pindahkan cluster jam/status online/tombol aksi/profil dari topbar
   ke dalam sidebar saat layar selebar HP/tablet kecil (<=880px), supaya
   topbar jadi ringkas (cuma hamburger + judul halaman). Saat layar melebar
   lagi, cluster dikembalikan ke topbar seperti semula. ------------------- */
function relocateTopbarUtility(){
  const cluster = document.getElementById('topbarUtilityCluster');
  const sidebarTarget = document.getElementById('sidebarUtilityBar');
  const topbar = document.querySelector('.topbar');
  if(!cluster || !sidebarTarget || !topbar) return;
  const isMobile = window.innerWidth <= 880;
  if(isMobile && cluster.parentElement !== sidebarTarget){
    sidebarTarget.appendChild(cluster);
    cluster.classList.add('in-sidebar');
  } else if(!isMobile && cluster.parentElement !== topbar){
    topbar.appendChild(cluster);
    cluster.classList.remove('in-sidebar');
  }
}
let _rtuTimer = null;
window.addEventListener('resize', function(){ clearTimeout(_rtuTimer); _rtuTimer = setTimeout(relocateTopbarUtility, 120); });
relocateTopbarUtility();

/* --- Pindahkan tombol Pengaturan & Keluar ke bagian paling bawah sidebar
   saat HP/tablet kecil (<=880px), supaya cluster atas tetap ringkas (cuma
   jam, muat ulang, notifikasi, profil). Saat layar melebar lagi, keduanya
   dikembalikan ke posisi asal di topbar. -------------------------------- */
function relocateSettingsAndLogout(){
  const settingsWrap = document.getElementById('settingsWrap');
  const logoutBtn = document.getElementById('topbarLogoutBtn');
  const bottomBar = document.getElementById('sidebarBottomUtility');
  const iconRow = document.querySelector('.topbar-icon-row');
  const userChip = document.querySelector('.user-chip-topbar');
  if(!settingsWrap || !logoutBtn || !bottomBar || !iconRow || !userChip) return;
  const isMobile = window.innerWidth <= 880;
  if(isMobile){
    if(settingsWrap.parentElement !== bottomBar) bottomBar.appendChild(settingsWrap);
    if(logoutBtn.parentElement !== bottomBar) bottomBar.appendChild(logoutBtn);
  } else {
    if(settingsWrap.parentElement !== iconRow) iconRow.appendChild(settingsWrap);
    if(logoutBtn.parentElement !== userChip) userChip.appendChild(logoutBtn);
  }
}
let _rslTimer = null;
window.addEventListener('resize', function(){ clearTimeout(_rslTimer); _rslTimer = setTimeout(relocateSettingsAndLogout, 120); });
relocateSettingsAndLogout();

/* --- Hide/Collapse Sub Menu per Section ---------------------------------
   Setiap section sidebar (Ringkasan, Komunikasi, Produktivitas, Menu Data,
   Armada & Aset, Kondisi Petak, Administrasi) bisa disembunyikan/dibuka
   sendiri-sendiri dengan mengklik judul section. Status collapse disimpan
   di localStorage supaya tetap sama saat halaman dimuat ulang. --------- */
const NAV_SECTION_STORAGE_KEY = 'navSectionCollapsed_v1';
function loadNavSectionState(){
  try{ return JSON.parse(localStorage.getItem(NAV_SECTION_STORAGE_KEY) || '{}'); }
  catch(e){ return {}; }
}
function saveNavSectionState(key, collapsed){
  const st = loadNavSectionState();
  st[key] = collapsed;
  try{ localStorage.setItem(NAV_SECTION_STORAGE_KEY, JSON.stringify(st)); }catch(e){}
}
function toggleNavSection(key){
  const el = document.getElementById('navSection_' + key);
  if(!el) return;
  const collapsed = el.classList.toggle('collapsed');
  const btn = el.querySelector('.nav-section-label');
  if(btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  saveNavSectionState(key, collapsed);
}
function applyStoredNavSectionState(){
  const st = loadNavSectionState();
  Object.keys(st).forEach(key=>{
    const el = document.getElementById('navSection_' + key);
    if(!el) return;
    el.classList.toggle('collapsed', !!st[key]);
    const btn = el.querySelector('.nav-section-label');
    if(btn) btn.setAttribute('aria-expanded', st[key] ? 'false' : 'true');
  });
}
applyStoredNavSectionState();
const STAFF_BLOCKED_VIEWS = ['produktivitas_harian','produktivitas_kontraktor','actual_tk','plan_kedatangan_tk','monitoring_motor','monitoring_aset','he_implement'];
async function navigate(view){
  if(currentProfile?.role === 'staff' && STAFF_BLOCKED_VIEWS.includes(view)){
    toast('Menu ini tidak tersedia untuk role Staff', true);
    view = 'dashboard';
  }
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
  if(view === 'dashboard') await renderDashboard();
  else if(view === 'users') await renderUsers();
  else if(view === 'log_history') await renderLogHistory();
  else if(view === 'chat') await renderChat();
  else if(view === 'dm') await renderDM();
  else if(view === 'dashboard_kondisi') await renderDashboardKondisi();
  else if(view === 'analisa_12_bulan') await renderAnalisa12Bulan();
  else if(view === 'produktivitas_harian') await renderProduktivitas();
  else if(view === 'produktivitas_kontraktor') await renderProduktivitasKontraktor();
  else if(view === 'monitoring_motor') await renderMonitoringMotor();
  else if(view === 'monitoring_aset') await renderMonitoringAset();
  else if(view === 'he_implement') await renderHeImplement();
  else if(view === 'actual_tk') await renderActualTK();
  else if(view === 'plan_kedatangan_tk') await renderPlanKedatanganTK();
  else if(view === 'justifikasi_tch_under70') await renderJustifikasiTCH();
  else if(view === 'maintenance') await renderMaintenance();
  else if(view === 'pc_rpc_eks_non_rkt') await renderPcRpc();
  else await renderTablePage(view);
}
function refreshCurrentView(){
  if(TABLES[currentView]) state[currentView].loaded = false;
  if(currentView === 'dashboard_kondisi' || currentView === 'analisa_12_bulan' || currentView === 'kondisi_bulanan') petakMasterCache = null;
  if(currentView === 'produktivitas_harian') produktivitasCache.loaded = false;
  if(currentView === 'produktivitas_kontraktor' && typeof PK_TABLE !== 'undefined') state[PK_TABLE].loaded = false;
  if(currentView === 'monitoring_motor' && typeof MONITORING_MOTOR_TABLE !== 'undefined') state[MONITORING_MOTOR_TABLE].loaded = false;
  if(currentView === 'monitoring_aset' && typeof MONITORING_ASET_TABLE !== 'undefined') state[MONITORING_ASET_TABLE].loaded = false;
  if(currentView === 'he_implement' && typeof HE_IMPLEMENT_TABLE !== 'undefined') state[HE_IMPLEMENT_TABLE].loaded = false;
  if(currentView === 'actual_tk' && typeof ACTUAL_TK_TABLE !== 'undefined') state[ACTUAL_TK_TABLE].loaded = false;
  if(currentView === 'plan_kedatangan_tk' && typeof PLAN_KEDATANGAN_TABLE !== 'undefined') state[PLAN_KEDATANGAN_TABLE].loaded = false;
  if(currentView === 'justifikasi_tch_under70'){
    state['pasca_harvest'].loaded = false; // data sumbernya adalah Pasca Harvest, jadi ikut dimuat ulang
    if(typeof JUSTIFIKASI_TCH_TABLE !== 'undefined') state[JUSTIFIKASI_TCH_TABLE].loaded = false;
  }
  if(currentView === 'maintenance' && typeof MAINTENANCE_TABLE !== 'undefined') state[MAINTENANCE_TABLE].loaded = false;
  if(currentView === 'pc_rpc_eks_non_rkt' && typeof PC_RPC_TABLE !== 'undefined') state[PC_RPC_TABLE].loaded = false;
  navigate(currentView);
  toast('Data dimuat ulang');
}

/* ---------------------------------------------------------------------
   6. DATA FETCH
   --------------------------------------------------------------------- */
// Tabel yang TIDAK punya kolom 'zona' di database sendiri, jadi tidak bisa
// difilter langsung lewat query .ilike('zona', ...) (akan error "column does
// not exist"). Pembatasan zona untuk tabel ini dilakukan secara tidak
// langsung: cocokkan kolom 'petak'-nya terhadap daftar petak zona pengguna
// yang diambil dari tabel master 'pasca_harvest' (yang memang punya zona).
// (kondisi_bulanan sudah punya kolom 'zona' sendiri sejak ditambahkan, jadi
// tidak perlu lagi masuk daftar ini — filter zona langsung lewat query biasa.)
const TABLES_WITHOUT_ZONA_COLUMN = [];

async function ensureData(table){
  if(state[table].loaded) return state[table].data;
  const zonaRestrict = getUserZonaRestriction();
  const personRestrict = getUserPersonRestriction();
  const noZonaColumn = TABLES_WITHOUT_ZONA_COLUMN.includes(table);
  let query = supa.from(table).select('*').order('id', { ascending:false });
  if(zonaRestrict && !noZonaColumn) query = query.ilike('zona', zonaRestrict); // tanpa wildcard = pencocokan persis, tidak peka huruf besar/kecil
  if(personRestrict && TABLES[table]?.columns.includes(personRestrict.column)) query = query.ilike(personRestrict.column, personRestrict.name);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat ' + table + ': ' + error.message, true); return []; }
  let rows = data || [];
  if(zonaRestrict && noZonaColumn){
    const masterRows = await ensureData('pasca_harvest');
    const zonaPetakSet = new Set(masterRows.map(r => (r.petak||'').toString().trim().toUpperCase()));
    rows = rows.filter(r => zonaPetakSet.has((r.petak||'').toString().trim().toUpperCase()));
  } else if(zonaRestrict){
    // Penyaring tambahan di sisi klien untuk berjaga-jaga (mis. spasi tak terduga pada data)
    rows = rows.filter(r => rowMatchesZona(r, zonaRestrict));
  }
  // Penyaring tambahan di sisi klien untuk pembatasan per-orang (Staff/Supervisor),
  // berjaga-jaga terhadap spasi/huruf besar-kecil yang tak terduga pada data.
  if(personRestrict && TABLES[table]?.columns.includes(personRestrict.column)){
    rows = rows.filter(r => rowMatchesPerson(r, personRestrict));
  }
  state[table].data = rows;
  state[table].loaded = true;
  return state[table].data;
}
// Data master petak (tabel 'petak') dipakai sebagai referensi oleh Dashboard Kondisi
// Petak & Analisa 12 Bulan, tapi TIDAK ditampilkan sebagai menu CRUD tersendiri
// (hanya dibaca). Di-cache supaya tidak query berulang saat pindah antar view.
let petakMasterCache = null;
// Peta Petak -> {zona, superitendent, supervisor, staff}, dibangun dari tabel 'pasca_harvest'
// (386 petak master). Dipakai oleh dropdown/datalist kolom Petak di modal Tambah/Edit Data
// supaya begitu Petak dipilih, kolom Zona/Superitendent/Supervisor/Staff terisi otomatis
// sesuai penugasan petak tsb, tanpa harus ketik ulang manual & rawan typo.
let currentPetakZonaMap = new Map();
async function getPetakZonaMap(){
  const rows = await ensureData('pasca_harvest');
  const map = new Map();
  rows.forEach(r => {
    const key = (r.petak || '').toString().trim().toUpperCase();
    if(!key || map.has(key)) return; // ambil kemunculan pertama saja per kode petak
    map.set(key, { petak: r.petak, zona: r.zona, superitendent: r.superitendent, supervisor: r.supervisor, staff: r.staff });
  });
  return map;
}
// Dipanggil dari atribut oninput pada field Petak (lihat petakFieldHTML). Mengisi
// Zona/Superitendent/Supervisor/Staff dari data master, TAPI tidak menimpa field yang
// sedang dikunci/disabled (mis. Zona yang dikunci ke zona akun pengguna terbatas).
function onPetakSelected(petakVal){
  const form = $('#recordForm');
  if(!form) return;
  const key = (petakVal || '').toString().trim().toUpperCase();
  const info = currentPetakZonaMap.get(key);
  if(!info) return;
  ['zona','superitendent','supervisor','staff'].forEach(col => {
    const el = form.elements[col];
    if(!el || el.disabled) return;
    if(info[col] !== undefined && info[col] !== null && info[col] !== '') el.value = info[col];
  });
}
async function ensurePetakMaster(){
  if(petakMasterCache) return petakMasterCache;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from('petak').select('*');
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat data master petak: ' + error.message, true); return petakMasterCache || []; }
  petakMasterCache = zonaRestrict ? (data || []).filter(r => rowMatchesZona(r, zonaRestrict)) : (data || []);
  return petakMasterCache;
}

async function refreshAllCounts(){
  const zonaRestrict = getUserZonaRestriction();
  for(const t of Object.keys(TABLES)){
    const el = $('#countBadge_' + t);
    if(zonaRestrict && TABLES_WITHOUT_ZONA_COLUMN.includes(t)){
      // Tabel tanpa kolom 'zona' (mis. kondisi_bulanan) tidak bisa dihitung
      // langsung lewat query .ilike('zona', ...) — pakai data yang sudah
      // dibatasi zona lewat ensureData() (dicocokkan ke master Pasca Harvest).
      const rows = await ensureData(t);
      if(el) el.textContent = rows.length ?? '0';
      continue;
    }
    let query = supa.from(t).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    if(el) el.textContent = count ?? '0';
  }
  {
    const zonaRestrictPH = getUserZonaRestriction('produktivitas_harian');
    let query = supa.from(PRODUKTIVITAS_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrictPH) query = query.ilike('zona', zonaRestrictPH);
    const { count } = await query;
    const el = $('#countBadge_produktivitas_harian');
    if(el) el.textContent = count ?? '0';
  }
  {
    const { count } = await supa.from(PK_TABLE).select('id', { count:'exact', head:true });
    const el = $('#countBadge_produktivitas_kontraktor');
    if(el) el.textContent = count ?? '0';
  }
  {
    let query = supa.from(MONITORING_MOTOR_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_monitoring_motor');
    if(el) el.textContent = count ?? '0';
  }
  {
    const { count } = await supa.from(MONITORING_ASET_TABLE).select('id', { count:'exact', head:true });
    const el = $('#countBadge_monitoring_aset');
    if(el) el.textContent = count ?? '0';
  }
  {
    const { count } = await supa.from(HE_IMPLEMENT_TABLE).select('id', { count:'exact', head:true });
    const el = $('#countBadge_he_implement');
    if(el) el.textContent = count ?? '0';
  }
  {
    let query = supa.from(ACTUAL_TK_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_actual_tk');
    if(el) el.textContent = count ?? '0';
  }
  {
    let query = supa.from(PLAN_KEDATANGAN_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_plan_kedatangan_tk');
    if(el) el.textContent = count ?? '0';
  }
  {
    let query = supa.from(MAINTENANCE_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_maintenance');
    if(el) el.textContent = count ?? '0';
  }
  {
    let query = supa.from(PC_RPC_TABLE).select('id', { count:'exact', head:true });
    if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
    const { count } = await query;
    const el = $('#countBadge_pc_rpc_eks_non_rkt');
    if(el) el.textContent = count ?? '0';
  }
  {
    // Badge Justifikasi TCH Under 70 dihitung dari data Pasca Harvest secara langsung
    // (bukan tabel tersendiri), supaya selalu sinkron begitu data Pasca Harvest diimpor/diubah.
    const el = $('#countBadge_justifikasi_tch_under70');
    if(el){
      let query = supa.from('pasca_harvest').select('petak, tch_nett_bapp_2026, zona');
      if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
      const { data, error } = await query;
      if(error){ el.textContent = '0'; }
      else {
        const rows = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data||[]);
        const cnt = rows.filter(r => { const n = parseTchNumber(r.tch_nett_bapp_2026); return !isNaN(n) && n > 0 && n < JUSTIFIKASI_TCH_THRESHOLD; }).length;
        el.textContent = cnt;
      }
    }
  }
}

/* ---------------------------------------------------------------------
   7. RENDER: TABLE PAGE (per menu)
   --------------------------------------------------------------------- */
async function renderTablePage(table){
  const cfg = TABLES[table];
  $('#pageEyebrow').textContent = cfg.eyebrow;
  $('#pageTitle').textContent = cfg.label;
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureData(table);
  paintTablePage(table, rows);
}

function computeKPIs(table, rows, statusField){
  const cfg = TABLES[table];
  const field = statusField || 'status_progress';
  const total = rows.length;
  const areaSum = rows.reduce((s,r)=> s + (parseFloat(r[cfg.areaField])||0), 0);
  const done = rows.filter(r => (r[field]||'').toLowerCase()==='done').length;
  const pctDone = total ? Math.round((done/total)*100) : 0;
  const zonas = new Set(rows.map(r=>r.zona).filter(Boolean));
  // Rata-rata TCH Nett BAPP 2026: hanya dihitung dari petak yang kolomnya sudah
  // terisi angka valid (bukan "TBD"/kosong/dsb, lihat parseTchNumber). Petak yang
  // statusnya masih "Progress" (belum final BAPP-nya) dan petak dengan nilai TCH "0"
  // (belum benar-benar terisi) dikecualikan supaya tidak ikut jadi pembagi maupun
  // menarik rata-rata ke bawah secara keliru.
  const tchValues = rows
    .filter(r => (r.status_progress||'').toString().trim().toLowerCase() !== 'progress')
    .map(r => parseTchNumber(r.tch_nett_bapp_2026))
    .filter(n => !isNaN(n) && n !== 0);
  const avgTch = tchValues.length ? tchValues.reduce((a,b)=>a+b,0) / tchValues.length : 0;
  return { total, areaSum, pctDone, doneCount: done, zonaCount: zonas.size, avgTch, tchCount: tchValues.length };
}

function aggregateCount(rows, key){
  const m = {};
  rows.forEach(r => { const v = (r[key] ?? '(kosong)').toString().trim() || '(kosong)'; m[v] = (m[v]||0)+1; });
  return m;
}
function aggregateSum(rows, groupKey, valKey){
  const m = {};
  rows.forEach(r => { const v = (r[groupKey] ?? '(kosong)').toString().trim() || '(kosong)'; m[v] = (m[v]||0) + (parseFloat(r[valKey])||0); });
  return m;
}
// Menyamakan format bulan yang berbeda-beda (mis. kolom Phasing 2026 berisi "APR",
// sedangkan kolom Bulan Tebang berisi "Apr-26") menjadi kode 3-huruf standar (JAN..DEC)
// sesuai daftar MONTHS, supaya keduanya bisa dibandingkan per bulan yang sama.
function normalizeMonthToken(raw){
  if(raw === null || raw === undefined) return '';
  const alphaPart = raw.toString().trim().match(/[A-Za-z]+/);
  if(!alphaPart) return '';
  const code = alphaPart[0].slice(0,3).toUpperCase();
  return MONTHS.includes(code) ? code : '';
}
function aggregateSumByMonthToken(rows, monthKey, valKey){
  const m = {};
  (rows||[]).forEach(r => {
    const code = normalizeMonthToken(r[monthKey]);
    if(!code) return;
    m[code] = (m[code]||0) + (parseFloat(r[valKey])||0);
  });
  return m;
}
function aggregateMultiCount(rows, keys, categories){
  // Hasil: { kolom: { kategori: jumlah } } — dipakai untuk grafik kelompok multi-kolom
  const result = {};
  keys.forEach(k=>{
    result[k] = {};
    categories.forEach(c => result[k][c] = 0);
    rows.forEach(r=>{
      const raw = (r[k] ?? 'Not Yet').toString().trim() || 'Not Yet';
      if(result[k][raw] === undefined) result[k][raw] = 0;
      result[k][raw]++;
    });
  });
  return result;
}
function aggregateMultiSum(rows, keys, categories, valKey){
  // Sama seperti aggregateMultiCount, tapi menjumlahkan nilai kolom luas (valKey)
  // per kategori, bukan menghitung jumlah baris/petak.
  const result = {};
  keys.forEach(k=>{
    result[k] = {};
    categories.forEach(c => result[k][c] = 0);
    rows.forEach(r=>{
      const raw = (r[k] ?? 'Not Yet').toString().trim() || 'Not Yet';
      if(result[k][raw] === undefined) result[k][raw] = 0;
      result[k][raw] += (parseFloat(r[valKey]) || 0);
    });
  });
  return result;
}
function aggregatePivot(rows, groupKey, statusKey, categories){
  // Hasil: { nilai_groupKey: { kategori_statusKey: jumlah } } — dipakai untuk grafik
  // grouped bar dengan sumbu-X berupa nilai dinamis (mis. nama staff), dipecah per status.
  const result = {};
  (rows||[]).forEach(r=>{
    const g = (r[groupKey] ?? '(kosong)').toString().trim() || '(kosong)';
    if(!result[g]){ result[g] = {}; categories.forEach(c => result[g][c] = 0); }
    const s = (r[statusKey] ?? categories[0]).toString().trim() || categories[0];
    if(result[g][s] === undefined) result[g][s] = 0;
    result[g][s]++;
  });
  return result;
}
function colorForLabel(label){
  const v = (label||'').toString().trim().toLowerCase();
  if(v === 'done' || v === 'sudah' || v === 'baik') return '#5FAE7D';
  if(v === 'progress' || v === 'cukup') return '#D9A94A';
  if(v === 'not yet' || v === 'belum' || v === 'kurang' || v === 'not yet bapp') return '#C1543C';
  return '#5B8FA8';
}
const CHART_PALETTE = ['#D9A94A','#5FAE7D','#5B8FA8','#C1543C','#9C7FBD','#7FB5A3','#D8886B','#8AA0C9'];

function uniqueValues(rows, field){
  return Array.from(new Set(rows.map(r => (r[field] ?? '').toString().trim()).filter(v => v !== '')))
    .sort((a,b) => a.localeCompare(b));
}
function resetFilters(table){
  const st = state[table];
  st.filterZona = ''; st.filterSuperitendent = ''; st.filterStaff = ''; st.filterStatus = '';
  st.page = 1;
  paintTablePage(table, state[table].data);
}
// Klik angka Done/Progress/Not Yet di card "Monitoring Persiapan Lahan" ->
// muncul panel daftar petak (auto-hide: klik lagi angka yg sama = nutup,
// klik angka lain = ganti isi). Muncul di semua modul yg punya LAND_PREP_KEYS
// (RPC After Giling, Extra Planting, Blanking, dst) — bukan cuma satu modul.
function toggleLandPrepDetail(table, key, label, status){
  const panel = document.getElementById(`landPrepDetailPanel_${table}`);
  if(!panel) return;
  const thisKey = key + '|' + status;
  if(panel.dataset.openKey === thisKey){ panel.innerHTML = ''; panel.dataset.openKey = ''; return; }
  const rows = (window.__landPrepDetailRows && window.__landPrepDetailRows[table]) || [];
  const list = rows.filter(r => ((r[key] ?? 'Not Yet').toString().trim() || 'Not Yet') === status);
  panel.dataset.openKey = thisKey;
  const color = status === 'Done' ? 'var(--accent-green)' : status === 'Progress' ? 'var(--accent-gold)' : 'var(--accent-red)';
  panel.innerHTML = `
    <div class="card" style="margin-bottom:16px; border-left:3px solid ${color};">
      <div class="card-header">
        <span class="card-title">${esc(label)} — ${esc(status)} (${list.length} petak)</span>
        <span style="cursor:pointer; font-size:12px; color:var(--text-faint);" onclick="toggleLandPrepDetail('${table}','${key}','${esc(label)}','${status}')">✕ Tutup</span>
      </div>
      <div class="card-body" style="padding:0; max-height:260px; overflow:auto;">
        <table class="data-table" style="font-size:12.5px;">
          <thead><tr><th>Petak</th><th>Zona</th><th>Staff</th></tr></thead>
          <tbody>
            ${list.length ? list.map(r => `<tr><td>${esc(r.petak||'-')}</td><td>${esc(r.zona||'-')}</td><td>${esc(r.staff||'-')}</td></tr>`).join('') : `<tr><td colspan="3" style="text-align:center; color:var(--text-faint); padding:14px;">Tidak ada petak</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
// Klik angka Selesai Tebang/Sudah Pengecekan/Belum Pengecekan di card "Status
// Pengecekan Pasca HVT by Staff" -> muncul panel daftar petak (auto-hide: klik lagi
// angka yg sama = nutup, klik angka lain = ganti isi). status: 'ALL'|'SUDAH'|'BELUM'.
function toggleStaffPengecekanDetail(table, staffName, label, status){
  const panel = document.getElementById(`pengecekanStaffDetailPanel_${table}`);
  if(!panel) return;
  const thisKey = staffName + '|' + status;
  if(panel.dataset.openKey === thisKey){ panel.innerHTML = ''; panel.dataset.openKey = ''; return; }
  const rows = (window.__staffPengecekanDetailRows && window.__staffPengecekanDetailRows[table]) || [];
  const list = rows.filter(r => {
    let name = (r.staff || '').toString().trim() || '(Tanpa Staff)';
    if(name === 'Vacant'){
      const z = (r.zona || '').toString().trim().toUpperCase();
      name = z ? `Vacant Zona ${z}` : 'Vacant';
    }
    if(name !== staffName) return false;
    if(status === 'ALL') return true;
    const st2 = (r.status_pengecekan_pasca_hvt || '').toString().trim().toUpperCase();
    return status === 'SUDAH' ? st2 === 'SUDAH' : st2 !== 'SUDAH';
  });
  panel.dataset.openKey = thisKey;
  const color = status === 'SUDAH' ? 'var(--accent-green)' : status === 'BELUM' ? 'var(--accent-red)' : 'var(--accent-blue)';
  panel.innerHTML = `
    <div class="card" style="margin-top:12px; margin-bottom:16px; border-left:3px solid ${color};">
      <div class="card-header">
        <span class="card-title">${esc(staffName)} — ${esc(label)} (${list.length} petak)</span>
        <span style="cursor:pointer; font-size:12px; color:var(--text-faint);" onclick="toggleStaffPengecekanDetail('${table}','${esc(staffName)}','${esc(label)}','${status}')">✕ Tutup</span>
      </div>
      <div class="card-body" style="padding:0; max-height:260px; overflow:auto;">
        <table class="data-table" style="font-size:12.5px;">
          <thead><tr><th>Petak</th><th>Zona</th><th>Status Pengecekan</th></tr></thead>
          <tbody>
            ${list.length ? list.map(r => `<tr><td>${esc(r.petak||'-')}</td><td>${esc(r.zona||'-')}</td><td>${esc((r.status_pengecekan_pasca_hvt||'BELUM').toString().toUpperCase())}</td></tr>`).join('') : `<tr><td colspan="3" style="text-align:center; color:var(--text-faint); padding:14px;">Tidak ada petak</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}
function toggleFilterPanel(table){
  state[table].filterPanelOpen = !state[table].filterPanelOpen;
  paintTablePage(table, state[table].data);
}
function paintTablePage(table, allRows){
  const cfg = TABLES[table];
  const st = state[table];

  const zonaOptions = uniqueValues(allRows, 'zona');
  const superOptions = uniqueValues(allRows, 'superitendent');
  const staffOptions = uniqueValues(allRows, 'staff');
  const statusOptions = uniqueValues(allRows, 'status_progress');
  const filterActive = !!(st.filterZona || st.filterSuperitendent || st.filterStaff || st.filterStatus);
  const filterCount = [st.filterZona, st.filterSuperitendent, st.filterStaff, st.filterStatus].filter(Boolean).length;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona ?? '').toString().trim() === st.filterZona);
  if(st.filterSuperitendent) rows = rows.filter(r => (r.superitendent ?? '').toString().trim() === st.filterSuperitendent);
  if(st.filterStaff) rows = rows.filter(r => (r.staff ?? '').toString().trim() === st.filterStaff);
  if(st.filterStatus) rows = rows.filter(r => (r.status_progress ?? '').toString().trim() === st.filterStatus);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => cfg.listColumns.some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows; // dipakai untuk KPI & grafik: mengikuti filter & pencarian yang aktif
  // Modul yang punya kolom Phasing Planting / Status Planting (RPC After Giling,
  // Extra Planting After Giling, Blanking) menampilkan grafik & KPI berdasarkan
  // kegiatan PLANTING (bukan progress harvest/giling) sesuai permintaan.
  const hasPlantingFields = cfg.columns.includes('phasing_planting') && cfg.columns.includes('status_planting');
  const kpi = computeKPIs(table, filteredRows, hasPlantingFields ? 'status_planting' : 'status_progress');
  rows = [...rows].sort((a,b)=>{
    const av=(a[st.sortKey]??''), bv=(b[st.sortKey]??'');
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);

  const statusAgg = aggregateCount(filteredRows, hasPlantingFields ? 'status_planting' : 'status_progress');
  const zonaAgg = aggregateSum(filteredRows, 'zona', cfg.areaField);
  const monthAgg = aggregateSum(filteredRows, hasPlantingFields ? 'phasing_planting' : 'phasing_2026', cfg.areaField);

  const isPascaHarvest = table === 'pasca_harvest';
  // Kondisi Bulanan tidak punya field luas/zona/varietas/status_progress seperti modul lain
  // (areaField-nya null), jadi KPI & grafiknya perlu ditangani secara khusus supaya tidak
  // memanggil method pada nilai null (penyebab halaman macet di spinner).
  const isKondisiBulanan = table === 'kondisi_bulanan';
  const KB_STATUS_CATS = ['Baik','Cukup','Kurang'];
  const kbBaikCount = isKondisiBulanan ? filteredRows.filter(r => r.status_bulan === 'Baik').length : 0;
  const kbCukupCount = isKondisiBulanan ? filteredRows.filter(r => r.status_bulan === 'Cukup').length : 0;
  const kbKurangCount = isKondisiBulanan ? filteredRows.filter(r => r.status_bulan === 'Kurang').length : 0;
  const kbStatusAgg = isKondisiBulanan ? aggregateCount(filteredRows, 'status_bulan') : null;
  const KB_KATEGORI_KEYS = ['kategori_lalang','kategori_perumpungan','kategori_rayutan','kategori_intensitas_hama','kategori_drainage','kategori_tanggul_berem'];
  const KB_KATEGORI_LABELS = ['Lalang','Perumpungan','Rayutan','Intensitas Hama','Drainage','Tanggul/Berem'];
  const kbKategoriMulti = isKondisiBulanan ? aggregateMultiCount(filteredRows, KB_KATEGORI_KEYS, KB_STATUS_CATS) : null;
  const KATEGORI_KEYS = ['kategori_kondisi_juringan','kategori_tunggul','kategori_kondisi_gulma','kategori_pasca_harvest'];
  const KATEGORI_LABELS = ['Kondisi Juringan','Tunggul','Kondisi Gulma','Pasca Harvest'];
  const KATEGORI_CATS = ['Baik','Cukup','Kurang']; // 'Not Yet' sengaja tidak ditampilkan di grafik
  // Hanya petak yang Status Progress-nya "Done" (sudah selesai harvest) yang dihitung
  const harvestedRows = isPascaHarvest ? filteredRows.filter(r => (r.status_progress ?? '').toString().trim().toLowerCase() === 'done') : null;
  const pengecekanAgg = isPascaHarvest ? (() => {
    // Sengaja tidak pakai aggregateCount biasa: field yang kosong/belum diisi harus
    // dihitung sebagai "BELUM" (merah), bukan jatuh ke kategori '(kosong)' terpisah
    // yang tidak berwarna semantik — itu penyebab grafik donut lama bisa tampil
    // seolah 100% SUDAH padahal sebagian petak sebenarnya belum dicek.
    const m = { SUDAH:0, BELUM:0 };
    harvestedRows.forEach(r => {
      const status = (r.status_pengecekan_pasca_hvt || '').toString().trim().toUpperCase();
      if(status === 'SUDAH') m.SUDAH++; else m.BELUM++;
    });
    return m;
  })() : null;
  const PENGECEKAN_CATS = ['BELUM','SUDAH'];
  const pengecekanStaffPivot = isPascaHarvest ? aggregatePivot(harvestedRows, 'staff', 'status_pengecekan_pasca_hvt', PENGECEKAN_CATS) : null;
  const pengecekanStaffNames = pengecekanStaffPivot ? Object.keys(pengecekanStaffPivot).sort((a,b)=>a.localeCompare(b)) : [];
  // Rekap per staff: 1) jumlah petak sudah selesai tebang (semua baris Done milik
  // staff tsb, apapun status pengecekannya), 2) sudah dicek, 3) belum dicek (termasuk
  // yang kolomnya masih kosong — dianggap belum, bukan diabaikan).
  const staffPengecekanStats = {};
  if(isPascaHarvest){
    harvestedRows.forEach(r => {
      let name = (r.staff || '').toString().trim() || '(Tanpa Staff)';
      // "Vacant" (petak belum ada staff tebang) dipecah per Zona supaya lebih
      // jelas mana yang vacant di Zona A vs Zona B, bukan digabung jadi satu kartu.
      if(name === 'Vacant'){
        const z = (r.zona || '').toString().trim().toUpperCase();
        name = z ? `Vacant Zona ${z}` : 'Vacant';
      }
      if(!staffPengecekanStats[name]) staffPengecekanStats[name] = { total:0, sudah:0, belum:0 };
      staffPengecekanStats[name].total++;
      const status = (r.status_pengecekan_pasca_hvt || '').toString().trim().toUpperCase();
      if(status === 'SUDAH') staffPengecekanStats[name].sudah++;
      else staffPengecekanStats[name].belum++;
    });
  }
  const staffPengecekanNames = Object.keys(staffPengecekanStats).sort((a,b)=>a.localeCompare(b));
  // Cache baris per staff buat panel detail "Status Pengecekan Pasca HVT by Staff"
  // (klik angka Selesai Tebang/Sudah/Belum Pengecekan) — dibaca oleh toggleStaffPengecekanDetail().
  if(isPascaHarvest){ window.__staffPengecekanDetailRows = window.__staffPengecekanDetailRows || {}; window.__staffPengecekanDetailRows[table] = harvestedRows; }
  const kategoriMulti = isPascaHarvest ? aggregateMultiCount(harvestedRows, KATEGORI_KEYS, KATEGORI_CATS) : null;

  // Monitoring Persiapan Lahan: menggantikan grafik "Luas per Zona" khusus pada modul
  // yang punya seluruh kolom status persiapan lahan (MSW, Furrowing, PPS1, PPS2, Planting)
  // — yaitu RPC After Giling & Extra Planting After Giling. Menampilkan jumlah petak per
  // status (Not Yet/Progress/Done) untuk tiap tahapan persiapan lahan tsb.
  const LAND_PREP_KEYS = cfg.landPrepKeys || ['status_msw','status_furrowing','status_pps1','status_pps2','status_planting'];
  const LAND_PREP_LABELS = cfg.landPrepLabels || ['MSW','Furrowing','PPS 1','PPS 2','Planting'];
  const hasLandPrepFields = LAND_PREP_KEYS.every(k => cfg.columns.includes(k));
  const landPrepMulti = hasLandPrepFields ? aggregateMultiSum(filteredRows, LAND_PREP_KEYS, STATUS3, cfg.areaField) : null;
  // Cache rows per table buat panel detail Monitoring Persiapan Lahan (klik angka
  // Done/Progress/Not Yet) — dibaca sama toggleLandPrepDetail(), gak lewat re-render.
  if(hasLandPrepFields){ window.__landPrepDetailRows = window.__landPrepDetailRows || {}; window.__landPrepDetailRows[table] = filteredRows; }

  // Khusus Pasca Harvest: grafik "Luas per Bulan Phasing 2026" dibuat jadi perbandingan
  // antara rencana (Phasing 2026) dengan realisasi (Bulan Tebang). Phasing 2026 HARUS
  // dihitung dari SEMUA petak (rencana/target keseluruhan sesuai filter aktif), bukan
  // hanya yang sudah Done — kalau dibatasi ke Done, garis rencana jadi ikut terpotong
  // dan tidak mencerminkan target sesungguhnya (lihat pivot table pembanding: total
  // Phasing 2026 = Total Luas keseluruhan). Bulan Tebang tetap wajar hanya terisi untuk
  // petak yang statusnya sudah Done (petak lain nilainya "Not Yet BAPP" dan otomatis
  // diabaikan oleh normalizeMonthToken/aggregateSumByMonthToken karena bukan kode bulan).
  let monthCompareSeries = null;
  if(isPascaHarvest){
    const phasingAllAgg = aggregateSumByMonthToken(filteredRows, 'phasing_2026', cfg.areaField);
    const tebangDoneAgg = aggregateSumByMonthToken(filteredRows, 'bulan_tebang', cfg.areaField);
    monthCompareSeries = {
      'Phasing 2026': PHASING_CHART_MONTHS.map(m => phasingAllAgg[m] || 0),
      'Bulan Tebang (Aktual)': PHASING_CHART_MONTHS.map(m => tebangDoneAgg[m] || 0),
    };
  }

  const zonaRestrict = getUserZonaRestriction();

  $('#pageContent').innerHTML = `
    ${zonaRestrict ? `<div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Menampilkan data khusus <b style="color:var(--accent-gold);">Zona ${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.
      </div>
    </div>` : ''}
    <div class="kpi-grid anim-stagger">
      ${isKondisiBulanan ? `
      ${kpiCard('Total Catatan', kpi.total, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Kondisi Baik', kbBaikCount, filterActive ? 'sesuai filter' : 'dari seluruh catatan', 'var(--accent-green)', 'kualitas')}
      ${kpiCard('Kondisi Cukup', kbCukupCount, filterActive ? 'sesuai filter' : 'dari seluruh catatan', 'var(--accent-gold)', 'kualitas')}
      ${kpiCard('Kondisi Kurang', kbKurangCount, 'Perlu perhatian', 'var(--accent-red)', 'kualitas')}
      ` : `
      ${kpiCard('Total Petak', kpi.total, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Total Luas', fmtNum(kpi.areaSum)+' Ha', (filterActive ? (cfg.areaField||'').replace('_',' ')+' · sesuai filter' : (cfg.areaField||'').replace('_',' ')), 'var(--accent-green)', 'luas')}
      ${kpiCard(hasPlantingFields ? 'Progress Planting Selesai' : 'Progress Selesai', kpi.pctDone+'%', (filterActive ? `${kpi.doneCount} dari ${kpi.total} petak ${hasPlantingFields ? 'Planting ' : ''}Done (sesuai filter)` : `${kpi.doneCount} dari ${kpi.total} petak ${hasPlantingFields ? 'Planting ' : ''}Done`), 'var(--accent-blue)', 'progress')}
      ${kpiCard('Rata-rata TCH', kpi.tchCount ? fmtNum(kpi.avgTch, 1) : '–', filterActive ? `dari ${kpi.tchCount} petak bernilai (sesuai filter)` : `dari ${kpi.tchCount} petak bernilai`, 'var(--accent-red)', 'progress')}
      `}
    </div>

    ${!isKondisiBulanan ? `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; align-items:center; gap:10px; padding:12px 18px; flex-wrap:wrap;">
        <span style="font-size:12px; color:var(--text-muted); white-space:nowrap;">Filter Status Progress:</span>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatusChart_${table}">
          <option value="">Semua Status</option>
          ${statusOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        ${st.filterStatus ? `<span style="font-size:11px; color:var(--text-faint);">Grafik &amp; tabel di bawah mengikuti filter ini</span>` : ''}
      </div>
    </div>
    ` : ''}

    ${isKondisiBulanan ? `
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Kategori Kondisi (Baik/Cukup/Kurang)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_kb_kategori"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Status Bulan</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_status_${table}"></canvas></div></div></div>
    </div>
    ` : `
    <div class="chart-grid">
      <div class="card"><div class="card-header">
          <span class="card-title">${isPascaHarvest ? 'Phasing 2026 vs Bulan Tebang' : (hasPlantingFields ? 'Luas per Bulan Phasing Planting' : 'Luas per Bulan Phasing 2026')}</span>
          ${isPascaHarvest ? `<span style="font-size:11px; color:var(--text-faint);">Bulan Tebang: khusus petak Done</span>` : ''}
        </div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_month_${table}"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">${hasPlantingFields ? 'Distribusi Status Planting' : 'Distribusi Status Progress'}</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_status_${table}"></canvas></div></div></div>
    </div>
    ${hasLandPrepFields ? `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Monitoring Persiapan Lahan</span></div>
      <div class="card-body">
        <div style="display:flex; gap:18px; flex-wrap:wrap; justify-content:space-between;">
          ${LAND_PREP_KEYS.map((k,i) => {
            const notYet = landPrepMulti[k]['Not Yet'] || 0;
            const progress = landPrepMulti[k]['Progress'] || 0;
            const done = landPrepMulti[k]['Done'] || 0;
            return `
            <div style="flex:1; min-width:110px; text-align:center; padding:6px 4px; border-right:${i < LAND_PREP_KEYS.length-1 ? '1px solid var(--border-soft)' : 'none'};">
              <div style="font-weight:700; color:var(--text-primary); font-size:13px; margin-bottom:10px; letter-spacing:.3px;">${esc(LAND_PREP_LABELS[i])}</div>
              <div style="font-size:10.5px; color:var(--accent-green); text-transform:uppercase; letter-spacing:.4px;">Done</div>
              <div style="font-weight:700; color:var(--accent-green); font-size:15px; margin-bottom:8px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleLandPrepDetail('${table}','${k}','${esc(LAND_PREP_LABELS[i])}','Done')">${fmtNum(done)}</div>
              <div style="font-size:10.5px; color:var(--accent-gold); text-transform:uppercase; letter-spacing:.4px;">Progress</div>
              <div style="font-weight:700; color:var(--accent-gold); font-size:15px; margin-bottom:8px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleLandPrepDetail('${table}','${k}','${esc(LAND_PREP_LABELS[i])}','Progress')">${fmtNum(progress)}</div>
              <div style="font-size:10.5px; color:var(--accent-red); text-transform:uppercase; letter-spacing:.4px;">Not Yet</div>
              <div style="font-weight:700; color:var(--accent-red); font-size:15px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleLandPrepDetail('${table}','${k}','${esc(LAND_PREP_LABELS[i])}','Not Yet')">${fmtNum(notYet)}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div id="landPrepDetailPanel_${table}"></div>
    ` : (isPascaHarvest ? '' : `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Luas per Zona</span></div>
        <div class="card-body"><div class="chart-box-sm"><canvas id="chart_zona_${table}"></canvas></div></div>
    </div>
    `)}
    `}

    ${isPascaHarvest ? `
    <div class="chart-grid">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Kategori Kondisi Lapangan Pasca Panen</span>
          <span style="font-size:11px; color:var(--text-faint);">${harvestedRows.length} petak status Done</span>
        </div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_kategori_kondisi"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Status Pengecekan Pasca HVT</span>
          <span style="font-size:11px; color:var(--text-faint);">${harvestedRows.length} petak status Done</span>
        </div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pengecekan_hvt"></canvas></div></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px; margin-bottom:16px;">
      <div class="card-header">
        <span class="card-title">Status Pengecekan Pasca HVT by Staff</span>
        <span style="font-size:11px; color:var(--text-faint);">${harvestedRows.length} petak status Done</span>
      </div>
      <div class="card-body">
        <div style="display:flex; gap:18px; flex-wrap:wrap; justify-content:space-between;">
          ${staffPengecekanNames.map((name, i) => {
            const s = staffPengecekanStats[name];
            return `
            <div style="flex:1; min-width:120px; text-align:center; padding:6px 4px; border-right:${i < staffPengecekanNames.length-1 ? '1px solid var(--border-soft)' : 'none'};">
              <div style="font-weight:700; color:var(--text-primary); font-size:13px; margin-bottom:10px; letter-spacing:.3px; min-height:34px; display:flex; align-items:center; justify-content:center; line-height:1.25;">${esc(name)}</div>
              <div style="font-size:10.5px; color:var(--accent-blue); text-transform:uppercase; letter-spacing:.4px;">Selesai Tebang</div>
              <div style="font-weight:700; color:var(--accent-blue); font-size:15px; margin-bottom:8px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleStaffPengecekanDetail('${table}','${esc(name)}','Selesai Tebang','ALL')">${s.total}</div>
              <div style="font-size:10.5px; color:var(--accent-green); text-transform:uppercase; letter-spacing:.4px;">Sudah Pengecekan</div>
              <div style="font-weight:700; color:var(--accent-green); font-size:15px; margin-bottom:8px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleStaffPengecekanDetail('${table}','${esc(name)}','Sudah Pengecekan','SUDAH')">${s.sudah}</div>
              <div style="font-size:10.5px; color:var(--accent-red); text-transform:uppercase; letter-spacing:.4px;">Belum Pengecekan</div>
              <div style="font-weight:700; color:var(--accent-red); font-size:15px; cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleStaffPengecekanDetail('${table}','${esc(name)}','Belum Pengecekan','BELUM')">${s.belum}</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div id="pengecekanStaffDetailPanel_${table}"></div>` : ''}

    <div class="card">
      <div class="table-toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" placeholder="Cari petak, staff, varietas…" id="searchInput_${table}" value="${esc(st.search)}">
        </div>
        <button class="btn ${filterActive ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="toggleFilterPanel('${table}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetFilters('${table}')" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImport('${table}')" title="${cfg.importMode==='upsert' ? 'Baris dengan Petak+Bulan yang sudah ada akan diperbarui, yang belum ada akan ditambahkan.' : 'Hanya memperbarui petak yang sudah ada. Tidak menambah petak baru.'}">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX ${cfg.importMode==='upsert' ? '(Tambah/Update)' : '(Update)'}
          </button>
          <input type="file" id="importFile_${table}" accept=".xlsx,.xls" class="hidden" onchange="handleImportFile('${table}', this)">
          ${renderExportMenu('table', table)}` : ''}
          ${canEditModule(table) ? `<button class="btn btn-primary btn-sm" onclick="openRecordModal('${table}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        ${!zonaRestrict ? `<select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_${table}">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
        </select>` : ''}
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterSuperitendent_${table}">
          <option value="">Superitendent: Semua</option>
          ${superOptions.map(s=>`<option value="${esc(s)}" ${st.filterSuperitendent===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStaff_${table}">
          <option value="">Staff: Semua</option>
          ${staffOptions.map(s=>`<option value="${esc(s)}" ${st.filterStaff===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatus_${table}">
          <option value="">Status: Semua</option>
          ${statusOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            ${cfg.listColumns.map(c => `<th onclick="sortTable('${table}','${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${cfg.listColumns.length+1}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map(r => `<tr>
                ${cfg.listColumns.map(c => `<td>${renderCell(c, r[c])}</td>`).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openRecordModal('${table}', ${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule(table) ? `<button class="btn btn-danger btn-sm" onclick="confirmDelete('${table}', ${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changePage('${table}', -1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changePage('${table}', 1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  $('#searchInput_'+table).addEventListener('input', debounce(function(){
    st.search = this.value; st.page = 1; paintTablePage(table, state[table].data);
    setTimeout(()=>{ const inp = $('#searchInput_'+table); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));

  $('#filterZona_'+table)?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintTablePage(table, state[table].data); });
  $('#filterSuperitendent_'+table)?.addEventListener('change', function(){ st.filterSuperitendent = this.value; st.page = 1; paintTablePage(table, state[table].data); });
  $('#filterStaff_'+table)?.addEventListener('change', function(){ st.filterStaff = this.value; st.page = 1; paintTablePage(table, state[table].data); });
  $('#filterStatus_'+table)?.addEventListener('change', function(){ st.filterStatus = this.value; st.page = 1; paintTablePage(table, state[table].data); });
  $('#filterStatusChart_'+table)?.addEventListener('change', function(){ st.filterStatus = this.value; st.page = 1; paintTablePage(table, state[table].data); });

  if(isKondisiBulanan){
    drawStatusProgressBar('chart_status_'+table, kbStatusAgg);
    const kbSeriesMap = {};
    KB_STATUS_CATS.forEach(cat => { kbSeriesMap[cat] = KB_KATEGORI_KEYS.map(k => kbKategoriMulti[k][cat] || 0); });
    drawGroupedBar('chart_kb_kategori', KB_KATEGORI_LABELS, kbSeriesMap);
  } else {
    drawStatusProgressBar('chart_status_'+table, statusAgg);
    if(isPascaHarvest){
      drawLineMulti('chart_month_'+table, PHASING_CHART_MONTHS, monthCompareSeries, ['#D9A94A','#5FAE7D'], true);
    } else {
      drawBar('chart_month_'+table, monthAgg, MONTHS);
    }
    if(!hasLandPrepFields && !isPascaHarvest){
      drawDonut('chart_zona_'+table, zonaAgg);
    }
  }

  if(isPascaHarvest){
    const seriesMap = {};
    KATEGORI_CATS.forEach(cat => { seriesMap[cat] = KATEGORI_KEYS.map(k => kategoriMulti[k][cat] || 0); });
    drawGroupedBar('chart_kategori_kondisi', KATEGORI_LABELS, seriesMap);
    drawStatusProgressBar('chart_pengecekan_hvt', pengecekanAgg);
  }
}

function renderCell(col, val){
  if(col === 'petak') return `<span class="petak-tag">${esc(val)}</span>`;
  if(col.startsWith('status_') || col === 'status_progress') return badgeForStatus(val);
  if(col.startsWith('kategori_')) return badgeForStatus(val);
  if(col === 'size_rkt' || col === 'luas_rpc' || col === 'luas_blanking' || col === 'estimasi_tch_2026') return val==null? '–' : fmtNum(val);
  if(FIELD_META[col] && FIELD_META[col].type === 'date'){
    const d = fmtDateID(val);
    return d ? esc(d) : '<span style="color:var(--text-faint)">–</span>';
  }
  return esc(val) || '<span style="color:var(--text-faint)">–</span>';
}
function kpiCard(label, value, sub, color, theme){
  return `<div class="kpi-card"${theme ? ` data-theme="${theme}"` : ''} style="--tone:${color}"><div class="kpi-accent" style="background:${color}"></div>
    <div class="kpi-label">${label}</div><div class="kpi-value">${value}</div><div class="kpi-sub">${sub}</div></div>`;
}
function sortTable(table, key){
  const st = state[table];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintTablePage(table, st.data);
}
function changePage(table, delta){
  state[table].page += delta;
  paintTablePage(table, state[table].data);
}

/* ---------------------------------------------------------------------
   8. CHARTS
   --------------------------------------------------------------------- */
const chartInstances = {};
function destroyChart(id){ if(chartInstances[id]){ chartInstances[id].destroy(); delete chartInstances[id]; } }
function cssVar(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
let CHART_TEXT = cssVar('--chart-text', '#93A79A');
let CHART_GRID = cssVar('--chart-grid', 'rgba(147,167,154,0.12)');
let CHART_BORDER = cssVar('--chart-border', '#1B2E25');

// Aktifkan plugin data label (angka/persentase tampil langsung di atas grafik)
if(typeof ChartDataLabels !== 'undefined'){ Chart.register(ChartDataLabels); }
// Paksa render chart di resolusi tinggi tetap (min. 2x), supaya tidak
// buram saat browser di-zoom selain 100% (window.devicePixelRatio ikut
// berubah nilainya kalau zoom browser diubah, bikin canvas under-render).
Chart.defaults.devicePixelRatio = Math.max(2, window.devicePixelRatio || 1);
// PENTING: matikan animasi transisi warna (fade-in dari transparent) bawaan
// Chart.js 4.4.4. Ini sumber bug "Uncaught TypeError: this._fn is not a
// function" (chart.umd.min.js -> color animation interpolator) yang bikin
// grafik gagal digambar TANPA pesan error yang kelihatan di layar (errornya
// cuma nongol di console browser). Bug ini paling gampang kepicu saat
// browser di-zoom selain 100% (ukuran container jadi pecahan/fractional),
// karena Chart.js otomatis bikin resize+update ekstra pas render pertama
// yang bentrok sama animasi warna yang lagi jalan. Karena dashboard ini
// data-heavy (bukan butuh animasi), paling aman animasi dimatikan total.
Chart.defaults.animation = false;
Chart.defaults.animations = false;
Chart.defaults.transitions.active.animation.duration = 0;
let DL_STYLE = {
  color: cssVar('--chart-dl-text', '#EDEBE2'), font:{ size:10, weight:'600', family:"'IBM Plex Mono', monospace" },
  textStrokeColor: cssVar('--chart-dl-stroke', 'rgba(10,20,15,0.6)'), textStrokeWidth:3, clip:false,
};

/* --- REFINEMENT: tooltip & font grafik ikut tema kartu, bukan default
   Chart.js polos (kotak hitam standar). Satu tempat, semua grafik di
   seluruh modul (app.js, tv-mode.js, dst) otomatis ikut ke-upgrade
   karena semua pakai Chart.defaults global. --- */
function applyChartTheme(){
  Chart.defaults.font.family = cssVar('--font-body', "'Inter', sans-serif");
  Chart.defaults.plugins.tooltip.backgroundColor = cssVar('--bg-elevated', '#182922');
  Chart.defaults.plugins.tooltip.titleColor = cssVar('--text-primary', '#EDEBE2');
  Chart.defaults.plugins.tooltip.bodyColor = cssVar('--text-muted', '#93A79A');
  Chart.defaults.plugins.tooltip.borderColor = cssVar('--border', 'rgba(147,167,154,0.18)');
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.boxPadding = 5;
  Chart.defaults.plugins.tooltip.usePointStyle = true;
  Chart.defaults.plugins.tooltip.titleFont = { weight:'600', size:12 };
  Chart.defaults.plugins.tooltip.bodyFont = { size:11.5 };
}
applyChartTheme();

/* --- Animasi global grafik: semua chart di seluruh modul otomatis "muncul
   satu-satu" (stagger per titik/bar/dataset) tiap kali digambar ulang
   (navigate, filter, reload). Satu konfigurasi di Chart.defaults, gak
   perlu sentuh drawBar/drawLine/drawDonut/dst satu-satu. Hormat
   prefers-reduced-motion (animasi dimatikan kalau user set minim gerak). */
const CHART_REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
Chart.defaults.animation = CHART_REDUCE_MOTION ? false : {
  duration: 850,
  easing: 'easeOutQuart',
  delay: (ctx) => {
    let delay = 0;
    if (ctx.type === 'data' && ctx.mode === 'default' && !ctx.dropped) {
      delay = ctx.dataIndex * 45 + ctx.datasetIndex * 90;
      ctx.dropped = true;
    }
    return delay;
  },
};
Chart.defaults.transitions = Chart.defaults.transitions || {};
Chart.defaults.transitions.active = { animation: { duration: CHART_REDUCE_MOTION ? 0 : 250 } };

/* Tema gelap/terang: simpan pilihan, refresh warna grafik saat berganti tema */
function toggleTheme(){
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  root.setAttribute('data-theme', next);
  try{ localStorage.setItem('theme', next); }catch(e){}
  const themeLabel = document.getElementById('themeStateLabel');
  if(themeLabel) themeLabel.textContent = next === 'light' ? 'Terang' : 'Gelap';
  const themeSwitch = document.getElementById('themeSwitch');
  if(themeSwitch){ themeSwitch.classList.toggle('on', next === 'dark'); themeSwitch.setAttribute('aria-checked', next === 'dark'); }
  CHART_TEXT = cssVar('--chart-text', CHART_TEXT);
  CHART_GRID = cssVar('--chart-grid', CHART_GRID);
  CHART_BORDER = cssVar('--chart-border', CHART_BORDER);
  DL_STYLE = { ...DL_STYLE, color: cssVar('--chart-dl-text', DL_STYLE.color), textStrokeColor: cssVar('--chart-dl-stroke', DL_STYLE.textStrokeColor) };
  applyChartTheme();
  if(typeof currentView !== 'undefined' && currentView && typeof navigate === 'function') navigate(currentView);
}
function dlValue(v){ const n = Number(v); return (!n && n!==0) || n===0 ? '' : fmtNum(n,2); }
function dlPercentPlugin(){
  return { ...DL_STYLE, anchor:'center', align:'center',
    formatter:(value, ctx)=>{
      const arr = ctx.dataset.data.map(x=>Number(x)||0);
      const total = arr.reduce((a,b)=>a+b,0);
      if(!total || !value) return '';
      return Math.round(value/total*100) + '%';
    } };
}

function drawDonut(canvasId, dataMap, semantic, customColors){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const labels = Object.keys(dataMap), values = Object.values(dataMap);
  const colors = customColors ? labels.map(l => customColors[l] || '#5B8FA8') : (semantic ? labels.map(colorForLabel) : CHART_PALETTE);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'doughnut',
    data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderColor:CHART_BORDER, borderWidth:2, borderRadius:4, spacing:2, hoverOffset:8, hoverBorderWidth:0 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, usePointStyle:true, pointStyle:'circle', font:{size:11} } }, datalabels: dlPercentPlugin() }, cutout:'62%',
      animation:{ animateRotate:true, animateScale:true } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawDonut", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
// Bar horizontal tunggal bertumpuk (gaya "Monitoring Replanting/Blanking" di
// slide) untuk status Done/Progress/Not Yet. Warna semantik tetap: Done hijau,
// Progress kuning, Not Yet merah, dengan label persentase di tiap segmen.
function drawStatusProgressBar(canvasId, dataMap){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  // Urut otomatis Hijau(Done/Sudah/Baik) -> Kuning(Progress/Cukup) -> Merah(Not Yet/Belum/Kurang)
  // berdasarkan warna semantik colorForLabel, jadi dipakai untuk pasangan status apapun
  // (Done/Progress/Not Yet, Baik/Cukup/Kurang, BELUM/SUDAH, dst) tanpa perlu daftar label tetap.
  // Urutan ikut referensi: Merah(Not Yet/Belum/Kurang) -> Kuning(Progress/Cukup) -> Hijau(Done/Sudah/Baik)
  const RANK = { '#C1543C':0, '#D9A94A':1, '#5FAE7D':2 };
  const orderedLabels = Object.keys(dataMap).sort((a,b) => (RANK[colorForLabel(a)] ?? 3) - (RANK[colorForLabel(b)] ?? 3));
  const values = orderedLabels.map(l => dataMap[l] || 0);
  const colors = orderedLabels.map(colorForLabel);
  const total = values.reduce((a,b)=>a+b,0);
  // Segmen dengan value 0 tidak digambar sama sekali (biar gak muncul garis/kotak
  // tipis nyempil di antara 2 segmen lain, kayak referensi yang cuma nampilin
  // segmen yang punya nilai).
  const drawIdx = values.map((v,i)=>i).filter(i => values[i] > 0);
  const n = drawIdx.length;
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels:[''], datasets: drawIdx.map((i,pos) => {
      const isFirst = pos === 0, isLast = pos === n-1;
      return { label:orderedLabels[i], data:[values[i]], backgroundColor:colors[i], barThickness:56,
        borderRadius:{ topLeft:isFirst?28:0, bottomLeft:isFirst?28:0, topRight:isLast?28:0, bottomRight:isLast?28:0 },
        borderSkipped:false };
    }) },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      layout:{ padding:4 },
      scales:{ x:{ stacked:true, display:false, max: total || 1 }, y:{ stacked:true, display:false } },
      plugins:{
        legend:{ position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, font:{size:11},
          generateLabels: chart => orderedLabels.map((l,i)=>({ text:l, fillStyle:colors[i], strokeStyle:colors[i], fontColor:CHART_TEXT })) } },
        datalabels:{ ...DL_STYLE, anchor:'center', align:'center', color:'#fff',
          font:{ weight:'800', size:12 }, textStrokeColor:'#000', textStrokeWidth:1,
          formatter:(value)=>{ if(!total || !value) return ''; return Math.round(value/total*100) + '%'; } }
      }
    }
  });
  }catch(e){ console.error("Chart render gagal:", "drawStatusProgressBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
// Bar horizontal tunggal bertumpuk untuk kategori bebas (bukan status
// Done/Progress/Not Yet), memakai palet warna umum (CHART_PALETTE) dan
// menampilkan label persentase di tiap segmen — gaya sama seperti
// drawStatusProgressBar tapi untuk kategori apa saja (mis. Action Plan).
function drawCategoryProgressBar(canvasId, dataMap, orderKeys){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const orderedLabels = orderKeys ? orderKeys.filter(l => dataMap.hasOwnProperty(l)) : Object.keys(dataMap);
  const values = orderedLabels.map(l => dataMap[l] || 0);
  const colors = orderedLabels.map((l,i) => CHART_PALETTE[i % CHART_PALETTE.length]);
  const total = values.reduce((a,b)=>a+b,0);
  const drawIdx = values.map((v,i)=>i).filter(i => values[i] > 0);
  const n = drawIdx.length;
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels:[''], datasets: drawIdx.map((i,pos) => {
      const isFirst = pos === 0, isLast = pos === n-1;
      return { label:orderedLabels[i], data:[values[i]], backgroundColor:colors[i], barThickness:56,
        borderRadius:{ topLeft:isFirst?28:0, bottomLeft:isFirst?28:0, topRight:isLast?28:0, bottomRight:isLast?28:0 },
        borderSkipped:false };
    }) },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false,
      layout:{ padding:4 },
      scales:{ x:{ stacked:true, display:false, max: total || 1 }, y:{ stacked:true, display:false } },
      plugins:{
        legend:{ position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, font:{size:11},
          generateLabels: chart => orderedLabels.map((l,i)=>({ text:l, fillStyle:colors[i], strokeStyle:colors[i], fontColor:CHART_TEXT })) } },
        tooltip:{ callbacks:{ label:(ctx)=> `${ctx.dataset.label}: ${ctx.raw}` } },
        datalabels:{ ...DL_STYLE, anchor:'center', align:'center', color:'#fff',
          font:{ weight:'800', size:12 }, textStrokeColor:'#000', textStrokeWidth:1,
          formatter:(value)=>{ if(!total || !value) return ''; return Math.round(value/total*100) + '%'; } }
      }
    }
  });
  }catch(e){ console.error("Chart render gagal:", "drawCategoryProgressBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function drawGroupedBar(canvasId, categories, seriesMap, colors){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const seriesNames = Object.keys(seriesMap);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels: categories, datasets: seriesNames.map((s,i) => ({ label:s, data:seriesMap[s], backgroundColor: colors ? colors[i % colors.length] : colorForLabel(s), borderRadius:7, maxBarThickness:26 })) },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top:22 } },
      plugins:{ legend:{ position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, font:{size:11} } },
        datalabels:{ ...DL_STYLE, anchor:'end', align:'top', offset:2, formatter:dlValue } },
      scales:{ x:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} }, y:{ ticks:{color:CHART_TEXT, font:{size:10.5}, precision:0}, grid:{color:CHART_GRID} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawGroupedBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
// Bar chart sederhana per status (Done/Progress/Not Yet) dengan warna semantik tetap
function drawStatusBar(canvasId, dataMap){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const labels = Object.keys(dataMap), values = Object.values(dataMap);
  const colors = labels.map(colorForLabel);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderRadius:7, maxBarThickness:70 }] },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top:22 } }, plugins:{
        legend:{ display:true, position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, font:{size:11},
          generateLabels: chart => labels.map((l,i)=>({ text:l, fillStyle:colors[i], strokeStyle:colors[i], fontColor:CHART_TEXT })) } },
        datalabels:{ ...DL_STYLE, anchor:'end', align:'top', offset:2, formatter:dlValue } },
      scales:{ x:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} }, y:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{color:CHART_GRID} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawStatusBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function fmtDDMMM(iso){
  if(!iso) return '';
  try{
    // Ambil cuma bagian YYYY-MM-DD; kolom tanggal kadang berisi timestamp
    // penuh (mis. "2026-07-24T10:00:00+00:00"), yang kalau ditempel lagi
    // dengan "T00:00:00" jadi string tanggal tidak valid -> new Date()
    // Invalid Date -> toLocaleDateString() throw RangeError. Karena baris
    // ini biasa dipanggil sebagai argumen drawStackedBar/drawLineMulti
    // (dieval SEBELUM masuk fungsi), exception di sini bisa bikin
    // grafik-grafik setelahnya di baris kode yang sama batal digambar
    // sama sekali walau tidak ada error yang kelihatan di grafik itu sendiri.
    const datePart = iso.toString().slice(0,10);
    const d = new Date(datePart + 'T00:00:00');
    if(isNaN(d.getTime())) return '';
    const dd = String(d.getDate()).padStart(2,'0');
    const mmm = d.toLocaleDateString('id-ID', { month:'short' });
    return `${dd}-${mmm}`;
  }catch(e){ return ''; }
}
function drawBar(canvasId, dataMap, orderKeys){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  let labels = Object.keys(dataMap);
  if(orderKeys) labels = orderKeys.filter(k => dataMap[k] !== undefined);
  const values = labels.map(l => dataMap[l]);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:values, backgroundColor: labels.map((l,i)=>CHART_PALETTE[i % CHART_PALETTE.length]), borderRadius:7, maxBarThickness:34 }] },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top:22 } }, plugins:{legend:{display:false},
        datalabels:{ ...DL_STYLE, anchor:'end', align:'top', offset:2, formatter:dlValue } },
      scales:{ x:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} }, y:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{color:CHART_GRID} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function drawHBar(canvasId, dataMap){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const labels = Object.keys(dataMap), values = Object.values(dataMap);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:values, backgroundColor: labels.map((l,i)=>CHART_PALETTE[i % CHART_PALETTE.length]), borderRadius:7, maxBarThickness:18 }] },
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, layout:{ padding:{ right:34 } }, plugins:{legend:{display:false},
        datalabels:{ ...DL_STYLE, anchor:'end', align:'right', offset:4, formatter:dlValue } },
      scales:{ x:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{color:CHART_GRID} }, y:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawHBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function drawStackedBar(canvasId, categories, seriesMap, stacked, colors){
  try{
  if(stacked === undefined) stacked = true;
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const seriesNames = Object.keys(seriesMap);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'bar',
    data:{ labels: categories, datasets: seriesNames.map((s,i)=>({ label:s, data:seriesMap[s], backgroundColor: (colors ? colors[i%colors.length] : CHART_PALETTE[i%CHART_PALETTE.length]), borderRadius:7, maxBarThickness:40 })) },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top:22 } },
      plugins:{ legend:{ position:'bottom', labels:{color:CHART_TEXT, boxWidth:11, font:{size:11}} },
        datalabels:{ ...DL_STYLE, anchor:'center', align:'center', formatter:dlValue } },
      scales:{ x:{ stacked, ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} }, y:{ stacked, ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{color:CHART_GRID} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawStackedBar", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function drawLineMulti(canvasId, categories, seriesMap, colors, showLabels){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const seriesNames = Object.keys(seriesMap);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'line',
    data:{ labels: categories, datasets: seriesNames.map((s,i) => ({
      label:s, data:seriesMap[s],
      borderColor: colors ? colors[i % colors.length] : CHART_PALETTE[i % CHART_PALETTE.length],
      backgroundColor: colors ? colors[i % colors.length] : CHART_PALETTE[i % CHART_PALETTE.length],
      tension:0.3, spanGaps:true, fill:false, pointRadius:3, pointHoverRadius:5,
      // Data ganjil (index 0, dst) label di atas titik, data genap di bawah,
      // supaya angka 2 garis yang berdekatan tidak saling tumpuk.
      datalabels: showLabels ? { anchor: i % 2 === 0 ? 'end' : 'start', align: i % 2 === 0 ? 'top' : 'bottom' } : { display:false },
    })) },
    options:{ responsive:true, maintainAspectRatio:false, layout:{ padding:{ top:22, bottom:14 } },
      plugins:{ legend:{ position:'bottom', labels:{ color:CHART_TEXT, boxWidth:11, font:{size:11} } },
        datalabels: showLabels ? { ...DL_STYLE, offset:4, formatter:dlValue } : { display:false } },
      scales:{ x:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{display:false} }, y:{ ticks:{color:CHART_TEXT, font:{size:10.5}}, grid:{color:CHART_GRID} } } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawLineMulti", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}
function drawPie(canvasId, dataMap){
  try{
  destroyChart(canvasId);
  const ctx = document.getElementById(canvasId); if(!ctx) return;
  const labels = Object.keys(dataMap), values = Object.values(dataMap);
  chartInstances[canvasId] = new Chart(ctx, {
    type:'pie',
    data:{ labels, datasets:[{ data:values, backgroundColor:CHART_PALETTE, borderColor:CHART_BORDER, borderWidth:2 }] },
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:'bottom', labels:{color:CHART_TEXT, boxWidth:11, font:{size:11}} }, datalabels: dlPercentPlugin() },
      animation:{ animateRotate:true, animateScale:true } }
  });
  }catch(e){ console.error("Chart render gagal:", "drawPie", e); const _el = document.getElementById(canvasId); if(_el && _el.parentElement) _el.parentElement.insertAdjacentHTML('beforeend', '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:11.5px;color:var(--accent-red,#C1543C);text-align:center;padding:10px;">Grafik gagal dimuat, coba Muat Ulang</div>'); }
}

/* ---------------------------------------------------------------------
   9. DASHBOARD GABUNGAN
   --------------------------------------------------------------------- */
async function renderDashboard(){
  $('#pageEyebrow').textContent = 'RINGKASAN SEASON 2026';
  $('#pageTitle').textContent = 'Dashboard Gabungan';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  const tableKeys = Object.keys(TABLES);
  const allData = {};
  for(const t of tableKeys) allData[t] = await ensureData(t);

  // ensureData() sudah membatasi data sesuai Zona akun yang login (lihat 4c).
  // Admin selalu melihat semua zona; role lain (termasuk Superintendent)
  // otomatis hanya melihat zona penugasannya masing-masing.
  const restrictZona = getUserZonaRestriction();
  if(restrictZona){
    $('#pageEyebrow').textContent = `RINGKASAN SEASON 2026 — ZONA ${restrictZona}`;
  }

  // "Total Petak" mengacu ke jumlah petak fisik (master data = modul Pasca
  // Harvest, 385 petak). Modul RPC After Giling / Extra Planting / Blanking /
  // Ratoon adalah proses/tahapan pada SEBAGIAN petak yang sama, bukan petak
  // baru — jadi tidak dijumlahkan ke Total Petak agar tidak dobel hitung.
  let staffSet = new Set();
  const perCategory = {};
  tableKeys.forEach(t=>{
    const cfg = TABLES[t]; const rows = allData[t];
    const luas = rows.reduce((s,r)=>s+(parseFloat(r[cfg.areaField])||0),0);
    const done = rows.filter(r=>(r.status_progress||'').toLowerCase()==='done').length;
    rows.forEach(r=>{ if(r.staff && r.staff!=='Vacant') staffSet.add(r.staff); });
    perCategory[cfg.label] = { total: rows.length, luas, done, pct: rows.length? Math.round(done/rows.length*100):0 };
  });
  const masterRows = allData['pasca_harvest'] || [];
  // Kondisi Bulanan tidak punya kolom luas sendiri (satu petak bisa punya banyak baris,
  // satu per bulan) — jadi "Luas (Ha)"-nya dihitung dari luas petak UNIK (master Pasca
  // Harvest, size_rkt) yang sudah pernah disurvey/dicatat di Kondisi Bulanan, bukan 0.
  {
    const areaByPetak = {};
    masterRows.forEach(r => { const p=(r.petak||'').toString().trim(); if(p) areaByPetak[p] = parseFloat(r[TABLES['pasca_harvest'].areaField]) || 0; });
    const surveyedPetaks = new Set((allData['kondisi_bulanan']||[]).map(r => (r.petak||'').toString().trim()).filter(Boolean));
    let surveyedLuas = 0;
    surveyedPetaks.forEach(p => { surveyedLuas += areaByPetak[p] || 0; });
    // "% Selesai" Kondisi Bulanan TIDAK bisa pakai status_progress (kolom itu tidak ada
    // di tabel Kondisi Bulanan) — jadi dihitung dari proporsi petak yang SUDAH SELESAI
    // TEBANG (status_progress = Done di master Pasca Harvest) yang SUDAH disurvey/
    // dicatat kondisinya di Kondisi Bulanan. Ini mencerminkan progres monitoring pasca
    // tebang, karena pengecekan kondisi bulanan memang baru relevan setelah petak ditebang.
    const doneTebangPetaks = new Set(masterRows.filter(r => (r.status_progress||'').toString().trim().toLowerCase()==='done').map(r => (r.petak||'').toString().trim()).filter(Boolean));
    let surveyedDoneCount = 0;
    surveyedPetaks.forEach(p => { if(doneTebangPetaks.has(p)) surveyedDoneCount++; });
    const kbPct = doneTebangPetaks.size ? Math.round(surveyedDoneCount/doneTebangPetaks.size*100) : 0;
    if(perCategory['Kondisi Bulanan']){
      perCategory['Kondisi Bulanan'].luas = surveyedLuas;
      perCategory['Kondisi Bulanan'].done = surveyedDoneCount;
      perCategory['Kondisi Bulanan'].pct = kbPct;
      perCategory['Kondisi Bulanan'].pctNote = `${surveyedDoneCount} dari ${doneTebangPetaks.size} petak selesai tebang sudah disurvey`;
    }
  }
  const totalPetak = masterRows.length;
  const totalPetakDone = masterRows.filter(r=>(r.status_progress||'').toLowerCase()==='done').length;
  const overallPct = totalPetak ? Math.round(totalPetakDone/totalPetak*100) : 0;
  const pascaHarvestLuas = masterRows.reduce((s,r)=>s+(parseFloat(r[TABLES['pasca_harvest'].areaField])||0),0);
  // "Total Luas" di Dashboard Gabungan disamakan dengan Total Luas di menu
  // Pasca Harvest (data master petak) untuk SEMUA akun — bukan hasil
  // penjumlahan lintas modul (yang bisa dobel hitung karena RPC After
  // Giling/Extra Planting/Blanking/Ratoon adalah proses pada petak yang sama).
  // ensureData('pasca_harvest') sudah otomatis membatasi data sesuai zona
  // akun yang login (Superintendent), jadi nilai ini otomatis sesuai
  // cakupan masing-masing akun.
  const dashboardTotalLuas = pascaHarvestLuas;

  const statusSeries = ['Not Yet','Progress','Done'];
  const stackedData = {};
  statusSeries.forEach(s => { stackedData[s] = tableKeys.map(t => allData[t].filter(r=>(r.status_progress||'Not Yet')===s || ((r.status_progress||'').toLowerCase()===s.toLowerCase())).length); });

  const luasPerCategory = {}; tableKeys.forEach(t=> luasPerCategory[TABLES[t].label] = perCategory[TABLES[t].label].luas);
  // "Luas Gabungan per Zona" disamakan dengan cakupan "Total Petak" (385 petak master
  // Pasca Harvest) — bukan hasil penjumlahan lintas modul, karena RPC After Giling/
  // Extra Planting/Blanking/Ratoon adalah proses pada petak yang sama sehingga akan
  // dobel hitung luasnya kalau digabung.
  const zonaCombined = {};
  masterRows.forEach(r => { const z=(r.zona||'').toString().trim(); if(!z) return; zonaCombined[z]=(zonaCombined[z]||0)+(parseFloat(r[TABLES['pasca_harvest'].areaField])||0); });

  // Komparasi Estimasi TCH 2026 vs TCH Nett 2026, April s/d Oktober.
  // - Estimasi TCH 2026: dirata-ratakan per bulan berdasarkan Phasing 2026 (rencana
  //   bulan tebang), karena Estimasi TCH memang dipatok di awal per rencana phasing.
  // - TCH Nett 2026: dirata-ratakan per bulan berdasarkan Bulan Tebang aktual
  //   (tch_nett_bapp_2026 hanya terisi setelah petak benar-benar di-BAPP).
  const TCH_MONTHS = [
    { key:'apr', label:'Apr' }, { key:'may', label:'Mei' }, { key:'jun', label:'Jun' },
    { key:'jul', label:'Jul' }, { key:'aug', label:'Agu' }, { key:'sep', label:'Sep' }, { key:'oct', label:'Okt' },
  ];
  const estByMonth = Object.fromEntries(TCH_MONTHS.map(m=>[m.key,{sum:0,n:0}]));
  const nettByMonth = Object.fromEntries(TCH_MONTHS.map(m=>[m.key,{sum:0,n:0}]));
  const monthKeyOf = v => (v||'').toString().trim().slice(0,3).toLowerCase();
  masterRows.forEach(r=>{
    const estKey = monthKeyOf(r.phasing_2026);
    if(estKey in estByMonth && r.estimasi_tch_2026 !== null && r.estimasi_tch_2026 !== ''){ estByMonth[estKey].sum += parseFloat(r.estimasi_tch_2026) || 0; estByMonth[estKey].n++; }
    const nettKey = monthKeyOf(r.bulan_tebang);
    if(nettKey in nettByMonth && r.tch_nett_bapp_2026 !== null && r.tch_nett_bapp_2026 !== ''){ nettByMonth[nettKey].sum += parseFloat(r.tch_nett_bapp_2026) || 0; nettByMonth[nettKey].n++; }
  });
  const avgOf = o => o.n ? Math.round((o.sum/o.n)*100)/100 : 0;
  const tchSeries = {
    'Estimasi TCH 2026': TCH_MONTHS.map(m=>avgOf(estByMonth[m.key])),
    'TCH Nett 2026': TCH_MONTHS.map(m=>avgOf(nettByMonth[m.key])),
  };

  $('#pageContent').innerHTML = `
    ${restrictZona ? `<div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Menampilkan data khusus <b style="color:var(--accent-gold);">Zona ${esc(restrictZona.toUpperCase())}</b> sesuai penugasan akun Anda.
      </div>
    </div>` : ''}
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Petak', totalPetak, 'petak (data master Pasca Harvest)', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Total Luas', fmtNum(dashboardTotalLuas)+' Ha', 'sesuai luas Pasca Harvest', 'var(--accent-green)', 'luas')}
      ${kpiCard('Progress Selesai', overallPct+'%', 'status Done · Pasca Harvest', 'var(--accent-blue)', 'progress')}
      ${kpiCard('Total Staff', staffSet.size, 'staff unik ditugaskan', 'var(--accent-red)', 'staff')}
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Status Progress per Modul</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_dash_stacked"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Proporsi Luas per Modul</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_dash_pie"></canvas></div></div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header">
          <span class="card-title">Luas Gabungan per Zona</span>
          <span style="font-size:11px; color:var(--text-faint);">${totalPetak} petak master Pasca Harvest</span>
        </div>
        <div class="card-body"><div class="chart-box-sm"><canvas id="chart_dash_zona"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Ringkasan per Modul</span></div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="font-size:12.5px;">
            <thead><tr><th>Modul</th><th>Petak</th><th>Luas (Ha)</th><th>% Selesai</th></tr></thead>
            <tbody>
              ${tableKeys.map(t=>{ const c=perCategory[TABLES[t].label]; return `<tr>
                <td>${TABLES[t].label}</td><td>${c.total}</td><td>${fmtNum(c.luas)}</td>
                <td><div style="display:flex; align-items:center; gap:8px;" ${c.pctNote ? `title="${esc(c.pctNote)}"` : ''}><div class="cane-progress" style="width:60px;">${Array.from({length:10}).map((_,i)=>`<i class="${i < Math.round(c.pct/10) ? 'filled':''}"></i>`).join('')}</div><span>${c.pct}%</span></div></td>
              </tr>`; }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card" style="grid-column:1 / -1;">
        <div class="card-header">
          <span class="card-title">Komparasi Estimasi TCH 2026 vs TCH Nett 2026</span>
          <span style="font-size:11px; color:var(--text-faint);">April – Oktober 2026</span>
        </div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_dash_tch"></canvas></div></div>
      </div>
    </div>
  `;

  drawStackedBar('chart_dash_stacked', tableKeys.map(t=>TABLES[t].label), stackedData);
  drawPie('chart_dash_pie', luasPerCategory);
  drawBar('chart_dash_zona', zonaCombined);
  drawLineMulti('chart_dash_tch', TCH_MONTHS.map(m=>m.label), tchSeries, ['#D9A441','#4C9F70'], true);
}

/* ---------------------------------------------------------------------
   9b. DASHBOARD KONDISI PETAK  (dipindahkan dari aplikasi "Estate 2" lama)
   --------------------------------------------------------------------- */
let kondisiGridMonth = null;
function setKondisiGridMonth(v){ kondisiGridMonth = (v === 'all') ? 'all' : Number(v); renderDashboardKondisi(); }

const KATEGORI_KONDISI = [
  { key:'kategori_lalang',           label:'Lalang' },
  { key:'kategori_perumpungan',      label:'Perumpungan' },
  { key:'kategori_rayutan',          label:'Rayutan' },
  { key:'kategori_intensitas_hama',  label:'Intensitas Hama' },
  { key:'kategori_drainage',         label:'Drainage' },
  { key:'kategori_tanggul_berem',    label:'Tanggul/Berem' },
];

async function renderDashboardKondisi(){
  $('#pageEyebrow').textContent = 'PEMANTAUAN RUTIN';
  $('#pageTitle').textContent = 'Dashboard Kondisi Petak';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  // Catatan: tabel referensi 'petak' sering kosong/tidak sinkron, jadi dipakai
  // 'pasca_harvest' sebagai sumber daftar petak master (konsisten dengan validasi
  // import di bagian lain aplikasi yang juga memakai 'pasca_harvest' sebagai acuan).
  const md = await ensureData('pasca_harvest');
  const kd = await ensureData('kondisi_bulanan');

  const monthsWithData = [...new Set(kd.map(k => Number(k.bulan)))].filter(m => !isNaN(m)).sort((a,b) => b-a);
  const selectedMonth = kondisiGridMonth || monthsWithData[0] || 1;
  const isAllMonths = selectedMonth === 'all';
  const bulanLabel = isAllMonths ? 'Semua Bulan' : ('Bulan ' + selectedMonth);

  const selectedRecs = isAllMonths ? kd : kd.filter(k => Number(k.bulan) === Number(selectedMonth));
  const baikCount = selectedRecs.filter(r => r.status_bulan === 'Baik').length;
  const cukupCount = selectedRecs.filter(r => r.status_bulan === 'Cukup').length;
  const kurangCount = selectedRecs.filter(r => r.status_bulan === 'Kurang').length;

  const surveyedPetakSet = new Set(selectedRecs.map(k => k.petak).filter(Boolean));
  const luasSurveyed = md.filter(m => surveyedPetakSet.has(m.petak)).reduce((s,m) => s + (parseFloat(m.size_rkt)||0), 0);
  const luasTebang = md.filter(m => (m.bulan_tebang||'').toString().trim() !== '').reduce((s,m) => s + (parseFloat(m.size_rkt)||0), 0);
  const totalLuas = md.reduce((s,m) => s + (parseFloat(m.size_rkt)||0), 0);

  const monthOptions = '<option value="all" '+(isAllMonths?'selected':'')+'>Semua Bulan</option>' +
    Array.from({length:12},(_,i)=>i+1)
    .map(m => `<option value="${m}" ${(!isAllMonths && m===Number(selectedMonth))?'selected':''}>Bulan ${m}</option>`).join('');

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
        <div style="font-size:12.5px; color:var(--text-muted);">Data per: ${new Date().toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric'})}</div>
        <label style="font-size:12.5px; color:var(--text-muted); display:flex; align-items:center; gap:8px;">
          Filter Bulan
          <select class="input" style="width:auto;" onchange="setKondisiGridMonth(this.value)">${monthOptions}</select>
        </label>
      </div>
    </div>

    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Luas Dipantau', fmtNum(totalLuas,1)+' Ha', 'Blok kebun terdaftar', 'var(--accent-gold)', 'luas')}
      ${kpiCard('Luas Survey vs Tebang', `${fmtNum(luasSurveyed,1)} / ${fmtNum(luasTebang,1)} Ha`, 'Disurvey vs sudah tebang — '+bulanLabel, 'var(--accent-blue)', 'progress')}
      ${kpiCard('Kondisi Baik', baikCount, (selectedRecs.length ? Math.round(baikCount/selectedRecs.length*100) : 0)+'% — '+bulanLabel, 'var(--accent-green)', 'kualitas')}
      ${kpiCard('Kondisi Cukup', cukupCount, bulanLabel, 'var(--accent-gold)', 'kualitas')}
      ${kpiCard('Kondisi Kurang', kurangCount, 'Perlu perhatian — '+bulanLabel, 'var(--accent-red)', 'kualitas')}
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Rekap Kondisi per Bulan (Baik/Cukup/Kurang)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_kondisi_trend"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Persentase Kondisi Baik per Kategori (Bulan 1–12)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_kondisi_kategori"></canvas></div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Peta Grid Kondisi Petak — ${bulanLabel}</span></div>
      <div class="card-body">
        <div id="petakGrid" class="petak-grid"></div>
        <div class="petak-grid-legend">
          <span><i class="dot" style="background:var(--accent-green)"></i> Baik</span>
          <span><i class="dot" style="background:var(--accent-gold)"></i> Cukup</span>
          <span><i class="dot" style="background:var(--accent-red)"></i> Kurang</span>
          <span><i class="dot" style="background:var(--bg-elevated)"></i> Belum ada data</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><span class="card-title">Persentase Kondisi Baik per Kategori per Bulan</span></div>
      <div class="card-body" style="padding:0;">
        <div class="table-wrap" style="max-height:380px; overflow:auto;">
          <table class="data-table">
            <thead><tr><th>Bulan</th><th>Lalang</th><th>Perumpungan</th><th>Rayutan</th><th>Intensitas Hama</th><th>Drainage</th><th>Tanggul/Berem</th></tr></thead>
            <tbody id="kategoriPersenTbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const monthLabels = Array.from({length:12},(_,i)=>i+1);

  const trendSeries = { Baik:[], Cukup:[], Kurang:[] };
  monthLabels.forEach(m => {
    const recs = kd.filter(k => Number(k.bulan) === m);
    trendSeries.Baik.push(recs.filter(r => r.status_bulan==='Baik').length);
    trendSeries.Cukup.push(recs.filter(r => r.status_bulan==='Cukup').length);
    trendSeries.Kurang.push(recs.filter(r => r.status_bulan==='Kurang').length);
  });
  drawStackedBar('chart_kondisi_trend', monthLabels.map(m=>'B'+m), trendSeries);

  const persenByKategori = {};
  KATEGORI_KONDISI.forEach(kat => {
    persenByKategori[kat.label] = monthLabels.map(m => {
      const recs = kd.filter(k => Number(k.bulan)===m && k[kat.key]);
      if(!recs.length) return null;
      const baik = recs.filter(r => r[kat.key]==='Baik').length;
      return Math.round((baik/recs.length)*1000)/10;
    });
  });
  drawLineMulti('chart_kondisi_kategori', monthLabels.map(m=>'Bulan '+m), persenByKategori);

  $('#kategoriPersenTbody').innerHTML = monthLabels.map((m,i) => `
    <tr${m===Number(selectedMonth) ? ' style="background:var(--bg-card-hover); font-weight:600;"' : ''}>
      <td>Bulan ${m}</td>
      ${KATEGORI_KONDISI.map(kat => { const v = persenByKategori[kat.label][i]; return `<td>${v===null?'–':v+'%'}</td>`; }).join('')}
    </tr>`).join('');

  const gridMap = {};
  if(isAllMonths){
    // Ambil status dari bulan terbaru yang tersedia untuk tiap petak
    const latestBulanPerPetak = {};
    kd.forEach(k => {
      const b = Number(k.bulan);
      if(isNaN(b) || !k.petak) return;
      if(latestBulanPerPetak[k.petak] === undefined || b > latestBulanPerPetak[k.petak]){
        latestBulanPerPetak[k.petak] = b;
        gridMap[k.petak] = k.status_bulan;
      }
    });
  } else {
    kd.filter(k => Number(k.bulan)===Number(selectedMonth)).forEach(k => { gridMap[k.petak] = k.status_bulan; });
  }
  $('#petakGrid').innerHTML = md.map(m => {
    const st = gridMap[m.petak];
    const bg = st==='Baik' ? 'var(--accent-green)' : st==='Cukup' ? 'var(--accent-gold)' : st==='Kurang' ? 'var(--accent-red)' : 'var(--bg-elevated)';
    return `<div class="petak-cell" title="${esc(m.petak)}: ${st||'Belum ada data'}" style="background:${bg}"></div>`;
  }).join('');
}

/* ---------------------------------------------------------------------
   9c. ANALISA 12 BULAN  (dipindahkan dari aplikasi "Estate 2" lama)
   --------------------------------------------------------------------- */
let analisaKriteria = 'status_bulan';
function setAnalisaKriteria(v){ analisaKriteria = v; renderAnalisa12Bulan(); }
const ANALISA_KRITERIA_OPTIONS = [
  { value:'status_bulan',              label:'Status Keseluruhan' },
  { value:'kategori_lalang',           label:'Lalang' },
  { value:'kategori_perumpungan',      label:'Perumpungan' },
  { value:'kategori_rayutan',          label:'Rayutan' },
  { value:'kategori_intensitas_hama',  label:'Intensitas Serangan Hama' },
  { value:'kategori_drainage',         label:'Drainage' },
  { value:'kategori_tanggul_berem',    label:'Tanggul / Berem' },
];

async function renderAnalisa12Bulan(){
  $('#pageEyebrow').textContent = 'TREN TAHUNAN';
  $('#pageTitle').textContent = 'Analisa Kondisi Bulan 1–12';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;

  const kd = await ensureData('kondisi_bulanan');

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; justify-content:flex-end;">
        <select class="input" style="width:auto;" onchange="setAnalisaKriteria(this.value)">
          ${ANALISA_KRITERIA_OPTIONS.map(k => `<option value="${k.value}" ${k.value===analisaKriteria?'selected':''}>${k.label}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Tren Jumlah Petak per Kategori — Bulan 1 s/d 12</span></div>
      <div class="card-body"><div class="chart-box"><canvas id="chart_analisa_trend"></canvas></div></div>
    </div>

    <div class="chart-grid">
      <div class="card">
        <div class="card-header"><span class="card-title">Jumlah Data Terisi per Bulan</span></div>
        <div class="card-body"><div class="chart-box-sm"><canvas id="chart_analisa_coverage"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-header"><span class="card-title">Ringkasan per Bulan</span></div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="font-size:12.5px;">
            <thead><tr><th>Bulan</th><th>Baik</th><th>Cukup</th><th>Kurang</th><th>Total Data</th></tr></thead>
            <tbody id="analisaTbody"></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  const monthLabels = Array.from({length:12},(_,i)=>i+1);
  const trendSeries = { Baik:[], Cukup:[], Kurang:[] };
  const coverageMap = {};
  const rowsHtml = [];
  monthLabels.forEach(m => {
    const recs = kd.filter(k => Number(k.bulan)===m && k[analisaKriteria]);
    const baik = recs.filter(r => r[analisaKriteria]==='Baik').length;
    const cukup = recs.filter(r => r[analisaKriteria]==='Cukup').length;
    const kurang = recs.filter(r => r[analisaKriteria]==='Kurang').length;
    trendSeries.Baik.push(baik); trendSeries.Cukup.push(cukup); trendSeries.Kurang.push(kurang);
    coverageMap['B'+m] = recs.length;
    rowsHtml.push(`<tr><td>Bulan ${m}</td><td><b style="color:#6FCB74;">${baik}</b></td><td><b style="color:#E3C33C;">${cukup}</b></td><td><b style="color:#F0A392;">${kurang}</b></td><td>${recs.length}</td></tr>`);
  });

  drawGroupedBar('chart_analisa_trend', monthLabels.map(m=>'Bulan '+m), trendSeries,
    [colorForLabel('Baik'), colorForLabel('Cukup'), colorForLabel('Kurang')]);
  drawBar('chart_analisa_coverage', coverageMap);
  $('#analisaTbody').innerHTML = rowsHtml.join('');
}

/* ---------------------------------------------------------------------
   10. CRUD MODAL
   --------------------------------------------------------------------- */
async function openRecordModal(table, id){
  const cfg = TABLES[table];
  const record = id ? state[table].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule(table);
  const zonaRestrict = getUserZonaRestriction();
  // Kolom Petak butuh data master (petak -> zona/superitendent/supervisor/staff) supaya
  // bisa dibuat dropdown/datalist yang auto-isi kolom terkait. Dimuat SEBELUM modal
  // dirender (biasanya sudah ada di cache dari ensureData, jadi nyaris instan).
  const needsPetakMaster = cfg.columns.includes('petak') &&
    ['zona','superitendent','supervisor','staff'].some(c => cfg.columns.includes(c));
  currentPetakZonaMap = needsPetakMaster ? await getPetakZonaMap() : new Map();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — ${cfg.label}</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${zonaRestrict ? `<p style="font-size:11.5px; color:var(--text-faint); margin:-4px 0 14px;">Zona terkunci ke <b>${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.</p>` : ''}
        <form id="recordForm" class="form-grid">
          ${cfg.columns.map(col => {
            // Kolom Petak: dropdown/datalist dari data master, memicu auto-isi
            // Zona/Superitendent/Supervisor/Staff saat sebuah petak dipilih.
            if(col === 'petak' && needsPetakMaster) return table === 'kondisi_bulanan'
              ? kbPetakFieldHTML(record ? record[col] : '', readonly)
              : petakFieldHTML(record ? record[col] : '', readonly);
            // Kolom "zona" dikunci ke zona akun untuk user yang dibatasi zonanya,
            // agar data baru tidak bisa dibuat/dipindah ke zona lain.
            if(col === 'zona' && zonaRestrict) return fieldHTML(col, record ? record[col] : zonaRestrict, true);
            return fieldHTML(col, record ? record[col] : '', readonly);
          }).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveRecord('${table}'${record ? ',' + record.id : ''})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if(table === 'pasca_harvest') updateKategoriPascaHarvestPreview();
  if(table === 'kondisi_bulanan') updateStatusBulanPreview();
}
// Field Petak sebagai <input> + <datalist>: pengguna bisa mengetik untuk memfilter (seperti
// dropdown pencarian) ATAU memilih langsung dari daftar. Begitu nilainya cocok persis dengan
// salah satu petak di data master (lihat oninput -> onPetakSelected), Zona/Superitendent/
// Supervisor/Staff otomatis terisi. Tetap bisa diketik manual untuk petak yang belum ada di
// master (mis. petak baru), supaya tidak mengunci input jadi pilihan tertutup.
function petakFieldHTML(val, readonly){
  const meta = FIELD_META.petak;
  const dis = readonly ? 'disabled' : '';
  const entries = [...currentPetakZonaMap.values()].sort((a,b) =>
    (a.petak||'').toString().localeCompare((b.petak||'').toString(), 'id', { numeric:true }));
  const options = entries.map(e => `<option value="${esc(e.petak)}"></option>`).join('');
  const input = `<input class="input" list="dl_petak_master" name="petak" value="${esc(val)}" ${dis} ${meta.required?'required':''} oninput="onPetakSelected(this.value)"><datalist id="dl_petak_master">${options}</datalist>`;
  return `<div><label class="field-label">${meta.label} <span style="font-weight:400; color:var(--text-faint);">(ketik atau pilih dari daftar)</span></label>${input}</div>`;
}
// Field Petak KHUSUS Kondisi Bulanan: kode wilayah (PNS/KDS) TIDAK bisa diketik bebas,
// staff cuma boleh PILIH dari dropdown; nomor petaknya (6 digit sisanya) baru yang bisa
// diketik/dipilih. Kedua bagian digabung ke <input type="hidden" name="petak"> supaya
// saveRecord() tetap dapat nilai petak lengkap seperti biasa (mis. "PNS051902").
function kbPetakFieldHTML(val, readonly){
  const meta = FIELD_META.petak;
  const dis = readonly ? 'disabled' : '';
  const v = (val || '').toString().toUpperCase();
  const prefix = (v.slice(0,3) === 'KDS') ? 'KDS' : 'PNS';
  const suffix = v.slice(0,3) === 'PNS' || v.slice(0,3) === 'KDS' ? v.slice(3) : '';
  const suffixOptions = (petak) => Array.from(new Set(
    [...currentPetakZonaMap.values()]
      .filter(e => (e.petak||'').toString().toUpperCase().startsWith(petak))
      .map(e => (e.petak||'').toString().slice(3))
  )).sort((a,b) => a.localeCompare(b, 'id', { numeric:true }));
  const dl = suffixOptions(prefix).map(s => `<option value="${esc(s)}"></option>`).join('');
  return `<div>
    <label class="field-label">${meta.label} <span style="font-weight:400; color:var(--text-faint);">(pilih kode wilayah, lalu ketik/pilih nomor petak)</span></label>
    <div style="display:flex; gap:8px;">
      <select class="input" id="kbPetakPrefix" style="max-width:110px; flex:none;" ${dis} onchange="kbPetakCombine()">
        <option value="PNS" ${prefix==='PNS'?'selected':''}>PNS</option>
        <option value="KDS" ${prefix==='KDS'?'selected':''}>KDS</option>
      </select>
      <input class="input" id="kbPetakSuffix" list="dl_kb_petak_suffix" placeholder="No. Petak, mis. 051902" value="${esc(suffix)}" ${dis} ${meta.required?'required':''} oninput="kbPetakCombine()">
    </div>
    <datalist id="dl_kb_petak_suffix">${dl}</datalist>
    <input type="hidden" name="petak" id="petakHiddenCombined" value="${esc(v)}">
  </div>`;
}
function kbPetakCombine(){
  const prefix = $('#kbPetakPrefix')?.value || 'PNS';
  const suffix = ($('#kbPetakSuffix')?.value || '').trim();
  const combined = prefix + suffix;
  const hidden = $('#petakHiddenCombined');
  if(hidden) hidden.value = combined;
  const dl = $('#dl_kb_petak_suffix');
  if(dl){
    const opts = Array.from(new Set(
      [...currentPetakZonaMap.values()]
        .filter(e => (e.petak||'').toString().toUpperCase().startsWith(prefix))
        .map(e => (e.petak||'').toString().slice(3))
    )).sort((a,b) => a.localeCompare(b, 'id', { numeric:true }));
    dl.innerHTML = opts.map(s => `<option value="${esc(s)}"></option>`).join('');
  }
  onPetakSelected(combined);
}
function fieldHTML(col, val, readonly){
  const meta = FIELD_META[col] || { label: col, type:'text' };
  const dis = readonly ? 'disabled' : '';
  let input;
  if(col === 'status_pengecekan_pasca_hvt'){
    // Otomatis: SUDAH begitu kategori Juringan+Tunggul+Gulma semua terisi (lihat
    // computeStatusPengecekanPascaHVT) — tidak pernah diinput manual. Nilai awal
    // pakai data tersimpan (edit) / BELUM (baru); live update saat 3 kategori diubah
    // ditangani updateKategoriPascaHarvestPreview().
    const shown = val || 'BELUM';
    input = `<input class="input" id="field_status_pengecekan_pasca_hvt" name="status_pengecekan_pasca_hvt" type="text" value="${esc(shown)}" disabled style="font-weight:600; color:${shown==='SUDAH'?'var(--accent-green)':'var(--accent-red-text)'};">`;
    return `<div><label class="field-label">${meta.label} <span style="font-weight:400; color:var(--text-faint);">(otomatis)</span></label>${input}</div>`;
  }
  if(col === 'kategori_pasca_harvest'){
    // Otomatis dihitung dari kategori_kondisi_juringan + kategori_tunggul + kategori_kondisi_gulma
    // (lihat computeKategoriPascaHarvest) — tidak pernah diinput manual.
    input = `<input class="input" id="field_kategori_pasca_harvest" name="kategori_pasca_harvest" type="text" value="${esc(val || 'Not Yet')}" disabled style="font-weight:600;">`;
    return `<div><label class="field-label">${meta.label} <span style="font-weight:400; color:var(--text-faint);">(otomatis)</span></label>${input}</div>`;
  }
  if(col === 'status_bulan'){
    // Otomatis dihitung dari 6 kategori kondisi bulanan (lihat computeStatusBulan) — tidak diinput manual.
    input = `<input class="input" id="field_status_bulan" name="status_bulan" type="text" value="${esc(val || '')}" disabled style="font-weight:600;">`;
    return `<div><label class="field-label">${meta.label} <span style="font-weight:400; color:var(--text-faint);">(otomatis)</span></label>${input}</div>`;
  }
  if(meta.type === 'select'){
    const triggerAttr = KATEGORI_PASCA_TRIGGER_COLS.includes(col) ? ` onchange="updateKategoriPascaHarvestPreview()"`
      : STATUS_BULAN_TRIGGER_COLS.includes(col) ? ` onchange="updateStatusBulanPreview()"` : '';
    input = `<select class="input" name="${col}" ${dis}${triggerAttr}><option value="">–</option>${meta.options.map(o=>`<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}</select>`;
  } else if(meta.list){
    input = `<input class="input" list="dl_${col}" name="${col}" value="${esc(val)}" ${dis} ${meta.required?'required':''}><datalist id="dl_${col}">${meta.list.map(o=>`<option value="${o}">`).join('')}</datalist>`;
  } else if(meta.type === 'number'){
    input = `<input class="input" type="number" step="0.01" name="${col}" value="${val??''}" ${dis}>`;
  } else if(meta.type === 'date'){
    input = `<input class="input" type="date" name="${col}" value="${esc(val)}" ${dis} ${meta.required?'required':''}>`;
  } else {
    input = `<input class="input" type="text" name="${col}" value="${esc(val)}" ${dis} ${meta.required?'required':''}>`;
  }
  return `<div><label class="field-label">${meta.label}</label>${input}</div>`;
}
function closeModal(){ const m = $('#modalOverlay'); if(m) m.remove(); }

// Hitung ulang & tampilkan "Kategori Pasca Harvest" secara live di modal, setiap kali
// salah satu dari 3 kategori kondisi (Juringan/Tunggul/Gulma) diubah oleh pengguna.
function updateKategoriPascaHarvestPreview(){
  const field = $('#field_kategori_pasca_harvest');
  const form = $('#recordForm');
  if(!field || !form) return;
  const row = {};
  KATEGORI_PASCA_TRIGGER_COLS.forEach(c => { row[c] = form.elements[c] ? form.elements[c].value : ''; });
  const kategori = computeKategoriPascaHarvest(row);
  field.value = kategori;
  field.style.color = kategori === 'Baik' ? 'var(--accent-green)' : kategori === 'Cukup' ? 'var(--accent-gold)' : kategori === 'Kurang' ? 'var(--accent-red)' : '';
  const pengecekanField = $('#field_status_pengecekan_pasca_hvt');
  if(pengecekanField){
    const status = computeStatusPengecekanPascaHVT(row);
    pengecekanField.value = status;
    pengecekanField.style.color = status === 'SUDAH' ? 'var(--accent-green)' : 'var(--accent-red-text)';
  }
}
function updateStatusBulanPreview(){
  const field = $('#field_status_bulan');
  const form = $('#recordForm');
  if(!field || !form) return;
  const row = {};
  STATUS_BULAN_TRIGGER_COLS.forEach(c => { row[c] = form.elements[c] ? form.elements[c].value : ''; });
  const status = computeStatusBulan(row);
  field.value = status || '(belum lengkap)';
  field.style.color = status === 'Baik' ? 'var(--accent-green)' : status === 'Cukup' ? 'var(--accent-gold)' : status === 'Kurang' ? 'var(--accent-red)' : 'var(--text-faint)';
}

// Dialog konfirmasi generik (Promise<boolean>) — dipakai buat peringatan
// non-destruktif kayak deteksi duplikat petak, beda dari confirmDelete yg
// khusus buat hapus data.
function confirmDialog(message, okLabel){
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'genericConfirmOverlay';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:420px;">
        <div class="modal-header"><div class="card-title">Konfirmasi</div></div>
        <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px; white-space:pre-line;">${esc(message)}</p></div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="genericConfirmCancel">Batal</button>
          <button class="btn btn-primary" id="genericConfirmOk">${esc(okLabel || 'Lanjutkan')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    $('#genericConfirmCancel').onclick = () => { overlay.remove(); resolve(false); };
    $('#genericConfirmOk').onclick = () => { overlay.remove(); resolve(true); };
  });
}

// Preview data hasil baca file Excel SEBELUM benar-benar disimpan ke database
// (Promise<boolean> — true kalau user klik "Lanjutkan Import"). Dipakai oleh
// semua modul import (handleImportFile generik, Produktivitas, Kontraktor,
// Maintenance, PC/RPC) supaya user bisa cek dulu kolom & isi data yang
// kebaca dari file sebelum ada perubahan permanen di database.
function showExcelImportPreview(rows, columns, opts={}){
  return new Promise(resolve => {
    const previewCols = (columns && columns.length ? columns : Object.keys(rows[0] || {})).slice(0, 8);
    const previewRows = rows.slice(0, 15);
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay'; overlay.id = 'excelPreviewOverlay';
    overlay.innerHTML = `
      <div class="modal-box anim-scale-in" style="max-width:820px;">
        <div class="modal-header">
          <div class="card-title">Preview Data ${opts.label ? esc(opts.label) : ''}</div>
          <button class="btn btn-outline btn-icon" id="excelPreviewClose">✕</button>
        </div>
        <div class="modal-body">
          <div class="excel-preview-meta">
            <span><b>${rows.length}</b> baris terbaca dari file${previewCols.length < (columns||[]).length ? ` · menampilkan ${previewCols.length} dari ${columns.length} kolom` : ''}${rows.length > previewRows.length ? ` · 15 baris pertama ditampilkan` : ''}</span>
          </div>
          <div class="excel-preview-wrap">
            <table class="excel-preview-table">
              <thead><tr>${previewCols.map(c => `<th>${esc((FIELD_META && FIELD_META[c] && FIELD_META[c].label) || c)}</th>`).join('')}</tr></thead>
              <tbody>${previewRows.map(r => `<tr>${previewCols.map(c => `<td>${esc(r[c] === null || r[c] === undefined ? '–' : r[c])}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="excelPreviewCancel">Batal</button>
          <button class="btn btn-primary" id="excelPreviewOk">Lanjutkan Import (${rows.length} baris)</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = (val) => { overlay.remove(); resolve(val); };
    $('#excelPreviewClose').onclick = () => close(false);
    $('#excelPreviewCancel').onclick = () => close(false);
    $('#excelPreviewOk').onclick = () => close(true);
  });
}
// Bangun daftar baris audit (belum di-insert) dari 1 record: bandingin
// before vs after per kolom. Dipakai bareng2 sama versi form (satu-satu)
// maupun import/bulk edit (banyak sekaligus, di-insert 1x biar hemat call).
function buildFieldAuditRows(table, recordId, petak, before, after, columns, source){
  const rows = [];
  columns.forEach(col => {
    const oldV = before ? (before[col] ?? null) : null;
    const newV = after[col] ?? null;
    if(String(oldV ?? '') === String(newV ?? '')) return;
    rows.push({
      table_name: table, record_id: recordId, petak: petak || null,
      field: col, field_label: FIELD_META[col]?.label || col,
      old_value: oldV === null ? null : String(oldV),
      new_value: newV === null ? null : String(newV),
      changed_by: currentUser?.id || null,
      changed_by_name: currentProfile?.full_name || currentProfile?.username || '',
      source: source || 'form',
    });
  });
  return rows;
}
// Insert bulk ke field_audit_log (fire-and-forget). Terima array baris hasil
// buildFieldAuditRows dari 1 atau banyak record sekaligus.
function insertFieldAuditRows(rows){
  if(!rows || !rows.length) return;
  supa.from('field_audit_log').insert(rows).then(({ error }) => {
    if(error) console.warn('[Audit] gagal mencatat perubahan:', error.message);
  });
}
// Catat perubahan per-kolom ke tabel field_audit_log (fire-and-forget, gak
// blokir alur simpan kalau tabelnya belum dibuat / gagal insert). Dibaca
// lewat menu Log History tab "Riwayat Perubahan Data".
function logFieldAudit(table, recordId, petak, before, after, columns, source){
  insertFieldAuditRows(buildFieldAuditRows(table, recordId, petak, before, after, columns, source));
}
async function saveRecord(table, id){
  const form = $('#recordForm');
  const cfg = TABLES[table];
  const payload = {};
  cfg.columns.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(table === 'pasca_harvest') payload.kategori_pasca_harvest = computeKategoriPascaHarvest(payload);
  if(table === 'kondisi_bulanan') payload.status_bulan = computeStatusBulan(payload) || null;
  if(!payload.petak){ toast('Kolom Petak wajib diisi', true); return; }
  // --- Deteksi bulan bolong (khusus Kondisi Bulanan) ---
  // Skenario: petak A bulan 1 udah diinput, staff lanjut input bulan 3,
  // padahal bulan 2 belum pernah diisi. Warning ini nangkep bulan yg
  // "dilompatin" itu sebelum data ke-save, biar staff sadar & gak lupa.
  if(table === 'kondisi_bulanan' && payload.bulan){
    const curBulan = parseInt(payload.bulan, 10);
    if(!isNaN(curBulan) && curBulan > 1){
      const petakNorm = payload.petak.toString().trim().toLowerCase();
      const bulanTerisi = new Set(
        (state[table]?.data || [])
          .filter(r => (r.petak||'').toString().trim().toLowerCase() === petakNorm && r.id !== id)
          .map(r => parseInt(r.bulan, 10))
          .filter(n => !isNaN(n))
      );
      const bulanBolong = [];
      for(let b = 1; b < curBulan; b++){ if(!bulanTerisi.has(b)) bulanBolong.push(b); }
      if(bulanBolong.length){
        toast(`Gagal simpan: Petak "${payload.petak}" Bulan ${bulanBolong.join(', ')} belum diinput. Isi bulan tersebut dulu sebelum Bulan ${curBulan}.`, true);
        return;
      }
    }
  }
  // --- Deteksi duplikat petak (khusus tambah data baru) ---
  if(!id){
    const petakNorm = payload.petak.toString().trim().toLowerCase();
    const dup = (state[table]?.data || []).find(r => (r.petak||'').toString().trim().toLowerCase() === petakNorm);
    if(dup){
      const lanjut = await confirmDialog(`Petak "${payload.petak}" sudah ada di data ${cfg.label || table} (baris ID ${dup.id}).\nTetap simpan sebagai baris baru?`, 'Tetap Simpan');
      if(!lanjut) return;
    }
  }
  const before = id ? { ...(state[table]?.data || []).find(r => r.id === id) } : null;
  const hasAudit = cfg.hasAuditColumns !== false;
  if(hasAudit) payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(table).update(payload).eq('id', id).select();
  } else {
    if(hasAudit) payload.created_by = currentUser.id;
    res = await supa.from(table).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  if(id) logFieldAudit(table, id, payload.petak, before, payload, cfg.columns); // riwayat perubahan per-kolom
  await logNotification({ table, action: id ? 'edit' : 'tambah', petakList: [payload.petak], zona: payload.zona });
  closeModal();
  state[table].loaded = false;
  await ensureData(table);
  paintTablePage(table, state[table].data);
  refreshAllCounts();
}

function confirmDelete(table, id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDelete('${table}', ${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDelete(table, id){
  const rec = state[table].data.find(r => r.id === id); // ambil info petak/zona sebelum baris terhapus
  const { error } = await supa.from(table).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table, action:'hapus', petakList: [rec?.petak], zona: rec?.zona });
  state[table].loaded = false;
  await ensureData(table);
  paintTablePage(table, state[table].data);
  refreshAllCounts();
}

/* ---------------------------------------------------------------------
   11. EXPORT / IMPORT XLSX
   --------------------------------------------------------------------- */
// ===== Micro-interaction progress bar untuk proses import file (dipakai semua modul) =====
function showImportProgress(){
  if(document.getElementById('importProgressToast')) return;
  const el = document.createElement('div');
  el.id = 'importProgressToast';
  el.className = 'import-progress-toast';
  el.innerHTML = `
    <div class="import-progress-head">
      <span id="importProgressLabel">Membaca file…</span>
      <span id="importProgressPct">0%</span>
    </div>
    <div class="import-progress-bar"><div class="import-progress-fill" id="importProgressFill" style="width:0%"></div></div>
  `;
  document.body.appendChild(el);
}
function setImportProgress(pct, label){
  const fill = document.getElementById('importProgressFill');
  const pctEl = document.getElementById('importProgressPct');
  const labelEl = document.getElementById('importProgressLabel');
  const v = Math.min(100, Math.max(0, pct));
  if(fill) fill.style.width = v + '%';
  if(pctEl) pctEl.textContent = Math.round(v) + '%';
  if(label && labelEl) labelEl.textContent = label;
}
function hideImportProgress(success){
  const el = document.getElementById('importProgressToast');
  if(!el) return;
  if(success){
    setImportProgress(100, 'Selesai');
    setTimeout(()=> el.remove(), 700);
  } else {
    el.remove();
  }
}

function triggerImport(table){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFile_'+table).click();
}
async function handleImportFile(table, input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const cfg = TABLES[table];
  // Menyamakan nama kolom supaya tidak sensitif terhadap spasi/underscore/garis-miring
  // (mis. "Intensitas_Hama", "Intensitas Hama", dan "intensitas hama" dianggap sama).
  const normalizeHeaderKey = s => (s ?? '').toString().trim().toLowerCase().replace(/[\s_/-]+/g, '');
  const reader = new FileReader();
  reader.onprogress = (e)=>{ if(e.lengthComputable) setImportProgress((e.loaded/e.total)*30, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(32, 'Memproses data…');
      const wb = XLSX.read(e.target.result, { type:'array' });
      // File template bisa berisi lebih dari satu sheet (mis. sheet "Petunjuk" di
      // depan, lalu sheet data sesungguhnya). Cari sheet yang benar-benar punya
      // kolom "Petak" di header-nya, alih-alih selalu mengambil sheet pertama.
      const petakNormKey = normalizeHeaderKey(FIELD_META.petak.label); // "petak"
      let sheetName = wb.SheetNames.find(name => {
        const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, blankrows:false })[0] || [];
        return headerRow.some(h => normalizeHeaderKey(h) === petakNormKey);
      });
      if(!sheetName) sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws, { defval:null });
      if(!json.length){ hideImportProgress(false); toast('File kosong atau format tidak dikenali', true); return; }
      // Peta nama kolom asli (persis seperti di file) berdasarkan versi ternormalisasinya,
      // dipakai sebagai fallback ketika nama kolom di file tidak 100% sama dengan label field.
      const normToRawKey = {};
      Object.keys(json[0]).forEach(k => { normToRawKey[normalizeHeaderKey(k)] = k; });
      const zonaRestrict = getUserZonaRestriction();
      const payloadRows = json.map(row=>{
        const o = {};
        cfg.columns.forEach(c=>{
          const label = FIELD_META[c].label;
          let v;
          if(row[c] !== undefined) v = row[c];
          else if(row[label] !== undefined) v = row[label];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)];
            v = rawKey !== undefined ? row[rawKey] : null;
          }
          if(FIELD_META[c].type === 'number' && v !== null && v !== '') v = parseFloat(v);
          if(FIELD_META[c].type === 'date' && v !== null && v !== '') v = parseAnyDateToISO(v);
          if(v === '' ) v = null;
          o[c] = v === undefined ? null : v;
        });
        // Paksa kolom zona ke zona akun untuk user yang dibatasi zonanya,
        // agar impor massal tidak bisa menambahkan data ke zona lain.
        // (hanya berlaku untuk tabel yang memang punya kolom 'zona')
        if(zonaRestrict && cfg.columns.includes('zona')) o.zona = zonaRestrict;
        if(table === 'pasca_harvest') { o.kategori_pasca_harvest = computeKategoriPascaHarvest(o); o.status_pengecekan_pasca_hvt = computeStatusPengecekanPascaHVT(o); }
        if(table === 'kondisi_bulanan') o.status_bulan = computeStatusBulan(o) || null;
        if(cfg.hasAuditColumns !== false) o.updated_by = currentUser.id;
        return o;
      }).filter(r=>r.petak);
      if(!payloadRows.length){ hideImportProgress(false); toast('Tidak ditemukan kolom "petak" pada file. Gunakan template database_template.xlsx', true); return; }

      hideImportProgress(true);
      const userConfirmedImport = await showExcelImportPreview(payloadRows, cfg.columns, { label: cfg.label });
      if(!userConfirmedImport){ toast('Import dibatalkan', 'info'); input.value=''; return; }
      showImportProgress();
      setImportProgress(38, 'Mencocokkan data…');

      // Sebagian besar tabel (master petak: Pasca Harvest, RPC, dst) hanya boleh
      // DIPERBARUI lewat import — tidak pernah menambah petak baru. Tapi tabel log
      // bulanan seperti Kondisi Bulanan memang butuh menambah baris baru (kosong di
      // awal, terisi tiap bulan), jadi importMode-nya 'upsert'.
      const importMode = cfg.importMode || 'update_only';
      const matchKeys = cfg.importMatchKeys || ['petak'];
      const normKeyPart = (col, v) => col === 'petak'
        ? (v ?? '').toString().trim().toUpperCase()
        : (v ?? '').toString().trim().toLowerCase();
      const buildKey = row => matchKeys.map(k => normKeyPart(k, row[k])).join('||');

      const existingRows = await ensureData(table);
      const existingMap = new Map();
      const existingRowById = new Map(); // buat bandingin before/after (audit trail)
      existingRows.forEach(r => { const key = buildKey(r); if(key) existingMap.set(key, r.id); existingRowById.set(r.id, r); });

      // Untuk tabel bertipe 'upsert' (mis. Kondisi Bulanan), validasi dulu apakah kode
      // Petak di file benar-benar terdaftar sebagai petak yang sudah ada di database.
      // Sumber daftar petak yang dipakai adalah tabel 'pasca_harvest' (385 petak yang
      // sama seperti yang tampil di menu Pasca Harvest) — BUKAN tabel 'petak' terpisah,
      // karena tabel 'petak' itu dipakai khusus untuk Dashboard Kondisi Petak dan
      // datanya bisa kosong/tidak sinkron dengan daftar petak yang sesungguhnya dipakai.
      let masterPetakSet = null;
      if(cfg.validateAgainstMaster){
        const petakMasterRows = await ensureData('pasca_harvest');
        masterPetakSet = new Set(petakMasterRows.map(m => normKeyPart('petak', m.petak)));
      }

      const matched = [];
      const toInsert = [];
      const unmatchedPetak = [];
      const notInMaster = [];
      payloadRows.forEach(o=>{
        if(masterPetakSet && !masterPetakSet.has(normKeyPart('petak', o.petak))){
          notInMaster.push(o.petak);
          return;
        }
        const key = buildKey(o);
        const id = existingMap.get(key);
        if(id) matched.push({ id, payload: o });
        else if(importMode === 'upsert') toInsert.push(o);
        else unmatchedPetak.push(o.petak);
      });

      if(!matched.length && !toInsert.length){
        const reason = notInMaster.length
          ? `Semua ${notInMaster.length} baris berisi kode Petak yang tidak ditemukan di data master (contoh: "${notInMaster[0]}"). Pastikan kode Petak di file sama persis dengan yang ada di menu Pasca Harvest.`
          : 'Tidak ada petak yang cocok dengan data yang sudah ada. Impor dibatalkan (tidak menambah petak baru).';
        hideImportProgress(false);
        toast(reason, true);
        return;
      }

      setImportProgress(45, 'Menyimpan data…');
      const totalOps = matched.length + toInsert.length;
      let doneOps = 0;
      const bumpProgress = ()=>{ doneOps++; setImportProgress(45 + (doneOps/totalOps)*50, 'Menyimpan data…'); };

      const updateResults = await Promise.all(matched.map(m => supa.from(table).update(m.payload).eq('id', m.id).then(r=>{ bumpProgress(); return r; })));
      const failedUpdate = updateResults.filter(r => r.error);
      const successUpdate = matched.length - failedUpdate.length;

      let successInsert = 0, failedInsert = 0, insertErrorMsg = '';
      if(toInsert.length){
        const insertPayloads = toInsert.map(o => cfg.hasAuditColumns !== false ? { ...o, created_by: currentUser.id } : o);
        // Insert satu per satu (bukan satu batch besar) supaya satu baris yang bermasalah
        // tidak menggagalkan seluruh baris lain, dan pesan error aslinya bisa ditangkap.
        const insertResults = await Promise.all(insertPayloads.map(p => supa.from(table).insert(p).then(r=>{ bumpProgress(); return r; })));
        insertResults.forEach(r=>{
          if(r.error){ failedInsert++; if(!insertErrorMsg) insertErrorMsg = r.error.message; }
          else successInsert++;
        });
      }
      hideImportProgress(true);

      // Riwayat Perubahan Data: cuma baris UPDATE yang dibandingin before/after
      // (baris INSERT baru gak ada "before"-nya, jadi gak dicatat per-kolom).
      const auditRows = [];
      matched.forEach((m, i) => {
        if(updateResults[i].error) return;
        const before = existingRowById.get(m.id);
        auditRows.push(...buildFieldAuditRows(table, m.id, m.payload.petak || before?.petak, before, m.payload, cfg.columns, 'import'));
      });
      insertFieldAuditRows(auditRows);

      if(successUpdate) await logNotificationGrouped(table, 'import', matched.filter((_,i)=>!updateResults[i].error).map(m=>m.payload));
      if(successInsert) await logNotificationGrouped(table, 'import', toInsert);

      let msg = '';
      if(successUpdate) msg += `${successUpdate} baris diperbarui`;
      if(successInsert) msg += (msg ? ', ' : '') + `${successInsert} baris baru ditambahkan`;
      if(unmatchedPetak.length) msg += (msg ? ', ' : '') + `${unmatchedPetak.length} baris dilewati (petak tidak ditemukan)`;
      if(notInMaster.length) msg += (msg ? ', ' : '') + `${notInMaster.length} baris dilewati (kode Petak tidak dikenali)`;
      if(failedUpdate.length) msg += (msg ? ', ' : '') + `${failedUpdate.length} gagal diperbarui`;
      if(failedInsert) msg += (msg ? ', ' : '') + `${failedInsert} gagal ditambahkan${insertErrorMsg ? ' — ' + insertErrorMsg : ''}`;
      if(!msg) msg = 'Tidak ada data yang diproses';
      toast(msg, (successUpdate + successInsert) === 0);

      state[table].loaded = false;
      await ensureData(table);
      paintTablePage(table, state[table].data);
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

/* =======================================================================
   MODUL: PRODUKTIVITAS HARIAN PLANTATION  (berdasar sheet "Report")
   =======================================================================
   Modul ini dibuat terpisah dari sistem TABLES/paintTablePage generik di
   atas, karena bentuk datanya berbeda dari tabel master petak: ini adalah
   LOG HARIAN (banyak baris per hari, per pekerja, per kegiatan), bukan
   satu baris per petak. Gaya visual (card, kpi-card, chart-box, tombol,
   modal) tetap memakai class CSS yang sama supaya menyatu dengan menu lain.
   ------------------------------------------------------------------- */
const PRODUKTIVITAS_TABLE = 'produktivitas_harian';

// Kolom disesuaikan persis dengan header sheet "Report" pada file
// Produktivitas_Harian_Plantation_2_Upload.xlsx:
// TANGGAL, Harian Plantation, PETAK, KA DEPT, LUAS WO, NO WO, STATUS PETAK,
// KEGIATAN, Satuan, HASIL, HK, HK Tidak Hadir, KETERANGAN, PENGAWAS.
// "zona" bukan kolom dari Excel — dipakai internal aplikasi untuk pembatasan
// akses per zona (lihat 4c. PEMBATASAN AKSES PER ZONA).
const PRODUKTIVITAS_COLUMNS = [
  'tanggal','harian_plantation','petak','ka_dept','luas_wo','no_wo','status_petak',
  'kegiatan','satuan','hasil','hk','hk_tidak_hadir',
  'keterangan','pengawas','zona',
];
const PRODUKTIVITAS_LIST_COLUMNS = ['tanggal','harian_plantation','petak','kegiatan','satuan','hasil','hk','hk_tidak_hadir','produktivitas_pct'];

Object.assign(FIELD_META, {
  tanggal: { label:'Tanggal', type:'date', required:true },
  harian_plantation: { label:'Harian Plantation', type:'text', required:true, list:[] },
  ka_dept: { label:'KA Dept', type:'text', list:[] },
  luas_wo: { label:'Luas WO (Ha)', type:'number' },
  no_wo: { label:'No WO', type:'text' },
  kegiatan: { label:'Kegiatan', type:'text', list:[] },
  satuan: { label:'Satuan', type:'text', list:['HA','IKAT'] },
  hasil: { label:'Hasil', type:'number' },
  hk: { label:'HK', type:'number' },
  hk_tidak_hadir: { label:'HK Tidak Hadir', type:'number' },
  keterangan: { label:'Keterangan', type:'text' },
  pengawas: { label:'Pengawas', type:'text' },
});

// Norma HK/Ha (target produktivitas) per kegiatan — diambil dari sheet "Report"
// (tabel "Norma HK/Ha" di H1:J5) dan disilangkan dengan baris NORMA pada
// sheet rekap per-pekerja (mis. sheet "Lutfi Firmansah", "Mahmud Irawan", dst)
// pada file Produktivitas_Harian_Plantation_2_Upload.xlsx. Angka menyatakan
// target satuan HASIL yang harus dicapai per 1 HK. Kegiatan yang di sheet
// rekap masih bernilai #DIV/0! (belum ada standarnya) diberi norma:null.
// Ubah/lengkapi nilai di bawah bila standar berubah.
const KEGIATAN_NORMA = {
  'CUTTING SEEDLING':          { satuan:'HA',   norma:null },
  'MECHANICAL PLANTING':       { satuan:'HA',   norma:0.04 },
  'PLANTING':                  { satuan:'HA',   norma:null },
  'PLANTING/ BLANKING':        { satuan:'HA',   norma:0.04 },
  'BLANKING':                  { satuan:'HA',   norma:0.05 },
  'EXTRA PLANTING (BAGAL)':    { satuan:'HA',   norma:0.05 },
  'BOOM SPRAY TEPI JALAN':     { satuan:'HA',   norma:null },
  'IRRIGATION':                { satuan:'HA',   norma:null },
  'MECHANICAL WEEDING':        { satuan:'HA',   norma:null },
  'WEEDING FRAME':             { satuan:'HA',   norma:0.6 },
  'POST SPRAYING 1':           { satuan:'HA',   norma:0.6 },
  'POST SPRAYING 2':           { satuan:'HA',   norma:0.6 },
  'POST SPRAYING 3':           { satuan:'HA',   norma:0.6 },
  'TEBANG BIBIT':              { satuan:'IKAT', norma:0.142857 },
};
FIELD_META.kegiatan.list = Object.keys(KEGIATAN_NORMA);

state[PRODUKTIVITAS_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'tanggal', sortDir:'desc', page:1, pageSize:14,
  filterKegiatan:'', filterPekerja:'', filterDari:'', filterSampai:'', filterPanelOpen:false,
};

// Normalisasi nama kegiatan: trim, kapital semua, dan rapikan spasi ganda
// supaya "Planting/Blanking" maupun "Planting/  Blanking" tetap cocok
// dengan kunci di KEGIATAN_NORMA.
function normalizeKegiatanKey(kegiatan){
  return (kegiatan||'').toString().trim().toUpperCase().replace(/\s+/g, ' ');
}
// Norma /HK sekarang bisa diupdate langsung dari UI (tabel "Ringkasan per Kegiatan").
// Nilai hasil update disimpan di tabel Supabase "norma_kegiatan" dan menimpa (override)
// nilai bawaan di KEGIATAN_NORMA, supaya perubahan permanen & konsisten untuk semua akun
// (bukan cuma tersimpan lokal di satu browser). Perlu tabel berikut dibuat dulu di
// Supabase SQL Editor:
//   create table if not exists norma_kegiatan (
//     kegiatan text primary key, satuan text, norma numeric,
//     updated_by uuid references profiles(id), updated_at timestamptz default now()
//   );
//   alter table norma_kegiatan enable row level security;
//   create policy "norma_kegiatan_select" on norma_kegiatan for select using (true);
//   create policy "norma_kegiatan_upsert" on norma_kegiatan for insert with check (
//     auth.uid() in (select id from profiles where role = 'admin')
//   );
//   create policy "norma_kegiatan_update" on norma_kegiatan for update using (
//     auth.uid() in (select id from profiles where role = 'admin')
//   );
const NORMA_TABLE = 'norma_kegiatan';
let normaOverrides = {};
let normaOverridesLoaded = false;
async function ensureNormaOverrides(){
  if(normaOverridesLoaded) return normaOverrides;
  const { data, error } = await supa.from(NORMA_TABLE).select('*');
  if(!error && data){
    data.forEach(r => {
      const key = normalizeKegiatanKey(r.kegiatan);
      normaOverrides[key] = { satuan: r.satuan || (KEGIATAN_NORMA[key]?.satuan) || '-', norma: (r.norma===null||r.norma===undefined) ? null : parseFloat(r.norma) };
    });
  }
  // Kalau tabelnya belum dibuat di Supabase, `error` akan terisi (mis. 42P01) —
  // dibiarkan diam-diam supaya fitur lain tetap jalan pakai nilai bawaan KEGIATAN_NORMA,
  // sampai tabelnya dibuat.
  normaOverridesLoaded = true;
  return normaOverrides;
}
async function saveNormaKegiatan(idx){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengubah Norma /HK', true); return; }
  const row = state[PRODUKTIVITAS_TABLE]._perKegiatanRows?.[idx];
  if(!row) return;
  const inp = $('#normaInput_'+idx);
  if(!inp) return;
  const raw = inp.value.trim();
  const normaVal = raw === '' ? null : parseFloat(raw.replace(',', '.'));
  if(raw !== '' && isNaN(normaVal)){ toast('Norma harus berupa angka', true); return; }
  const key = normalizeKegiatanKey(row.kegiatan);
  const { error } = await supa.from(NORMA_TABLE).upsert({
    kegiatan: key, satuan: row.satuan, norma: normaVal,
    updated_by: currentUser.id, updated_at: new Date().toISOString(),
  }, { onConflict:'kegiatan' });
  if(error){ toast('Gagal menyimpan norma (pastikan tabel norma_kegiatan sudah dibuat): ' + error.message, true); return; }
  normaOverrides[key] = { satuan: row.satuan, norma: normaVal };
  toast('Norma /HK "' + row.kegiatan + '" berhasil diperbarui');
  paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
}
function produktivitasNormaFor(kegiatan){
  const key = normalizeKegiatanKey(kegiatan);
  return normaOverrides[key] || KEGIATAN_NORMA[key] || null;
}
function produktivitasPct(row){
  const info = produktivitasNormaFor(row.kegiatan);
  const hk = parseFloat(row.hk) || 0;
  const hasil = parseFloat(row.hasil) || 0;
  if(!info || !info.norma || !hk) return null;
  const target = info.norma * hk;
  if(!target) return null;
  return (hasil / target) * 100;
}

async function ensureProduktivitasData(){
  const st = state[PRODUKTIVITAS_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction('produktivitas_harian');
  let query = supa.from(PRODUKTIVITAS_TABLE).select('*').order('tanggal', { ascending:false }).order('id', { ascending:false });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat Produktivitas Harian: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data||[]);
  st.loaded = true;
  return st.data;
}

async function renderProduktivitas(){
  $('#pageEyebrow').textContent = 'PRODUKTIVITAS HARIAN';
  $('#pageTitle').textContent = 'Produktivitas Harian Plantation';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureProduktivitasData();
  await ensureNormaOverrides();
  paintProduktivitas(rows);
}

function resetProduktivitasFilters(){
  const st = state[PRODUKTIVITAS_TABLE];
  st.filterKegiatan=''; st.filterPekerja=''; st.filterDari=''; st.filterSampai='';
  st.page = 1;
  paintProduktivitas(st.data);
}
function toggleProduktivitasFilterPanel(){
  state[PRODUKTIVITAS_TABLE].filterPanelOpen = !state[PRODUKTIVITAS_TABLE].filterPanelOpen;
  paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
}
function sortProduktivitas(key){
  const st = state[PRODUKTIVITAS_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintProduktivitas(st.data);
}
function changeProduktivitasPage(delta){
  state[PRODUKTIVITAS_TABLE].page += delta;
  paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
}

function paintProduktivitas(allRows){
  const st = state[PRODUKTIVITAS_TABLE];
  const zonaRestrict = getUserZonaRestriction('produktivitas_harian');

  const kegiatanOptions = uniqueValues(allRows, 'kegiatan');
  const pekerjaOptions = uniqueValues(allRows, 'harian_plantation');
  const filterActive = !!(st.filterKegiatan || st.filterPekerja || st.filterDari || st.filterSampai);
  const filterCount = [st.filterKegiatan, st.filterPekerja, st.filterDari, st.filterSampai].filter(Boolean).length;

  let rows = allRows;
  if(st.filterKegiatan) rows = rows.filter(r => (r.kegiatan||'').toString().trim() === st.filterKegiatan);
  if(st.filterPekerja) rows = rows.filter(r => (r.harian_plantation||'').toString().trim() === st.filterPekerja);
  if(st.filterDari) rows = rows.filter(r => (r.tanggal||'') >= st.filterDari);
  if(st.filterSampai) rows = rows.filter(r => (r.tanggal||'') <= st.filterSampai);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['harian_plantation','petak','kegiatan','ka_dept','no_wo','pengawas'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  const totalCatatan = filteredRows.length;
  const totalHK = filteredRows.reduce((s,r)=>s+(parseFloat(r.hk)||0),0);
  const totalHKTidakHadir = filteredRows.reduce((s,r)=>s+(parseFloat(r.hk_tidak_hadir)||0),0);
  const pctList = filteredRows.map(produktivitasPct).filter(v => v !== null);
  const avgPct = pctList.length ? (pctList.reduce((a,b)=>a+b,0)/pctList.length) : null;

  const byPekerja = {};
  filteredRows.forEach(r=>{
    const pct = produktivitasPct(r);
    if(pct === null) return;
    const nama = (r.harian_plantation||'(tanpa nama)').toString().trim() || '(tanpa nama)';
    if(!byPekerja[nama]) byPekerja[nama] = { sum:0, n:0 };
    byPekerja[nama].sum += pct; byPekerja[nama].n++;
  });
  const pekerjaPctMap = {};
  Object.entries(byPekerja).forEach(([k,v]) => pekerjaPctMap[k] = Math.round(v.sum / v.n));

  const kegiatanAgg = aggregateCount(filteredRows, 'kegiatan');

  const dateKeys = Array.from(new Set(filteredRows.map(r=>r.tanggal).filter(Boolean))).sort();
  const hkByDate = {}, hkTidakByDate = {};
  filteredRows.forEach(r=>{
    if(!r.tanggal) return;
    hkByDate[r.tanggal] = (hkByDate[r.tanggal]||0) + (parseFloat(r.hk)||0);
    hkTidakByDate[r.tanggal] = (hkTidakByDate[r.tanggal]||0) + (parseFloat(r.hk_tidak_hadir)||0);
  });
  const trendSeries = {
    'HK Hadir': dateKeys.map(d=>hkByDate[d]||0),
    'HK Tidak Hadir': dateKeys.map(d=>hkTidakByDate[d]||0),
  };

  const perKegiatan = {};
  filteredRows.forEach(r=>{
    const k = (r.kegiatan||'(kosong)').toString().trim() || '(kosong)';
    if(!perKegiatan[k]) perKegiatan[k] = { hasil:0, hk:0 };
    perKegiatan[k].hasil += (parseFloat(r.hasil)||0);
    perKegiatan[k].hk += (parseFloat(r.hk)||0);
  });
  const perKegiatanRows = Object.entries(perKegiatan).map(([k,v])=>{
    const info = produktivitasNormaFor(k);
    const target = (info && info.norma) ? info.norma * v.hk : null;
    const pct = (target && target>0) ? (v.hasil/target*100) : null;
    return { kegiatan:k, satuan:(info?info.satuan:'-'), hasil:v.hasil, hk:v.hk, norma:(info?info.norma:null), pct };
  }).sort((a,b)=> b.hk - a.hk);

  const kegiatanPctMap = {};
  perKegiatanRows.forEach(r => { if(r.pct !== null) kegiatanPctMap[r.kegiatan] = Math.round(r.pct); });
  state[PRODUKTIVITAS_TABLE]._perKegiatanRows = perKegiatanRows;

  rows = [...rows].sort((a,b)=>{
    let av, bv;
    if(st.sortKey === 'produktivitas_pct'){ av = produktivitasPct(a) ?? -1; bv = produktivitasPct(b) ?? -1; }
    else { av = a[st.sortKey] ?? ''; bv = b[st.sortKey] ?? ''; }
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);

  $('#pageContent').innerHTML = `
    ${zonaRestrict ? `<div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Menampilkan data khusus <b style="color:var(--accent-gold);">Zona ${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.
      </div>
    </div>` : ''}
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Catatan', totalCatatan, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Total HK Hadir', fmtNum(totalHK,1), filterActive ? 'sesuai filter' : 'seluruh catatan', 'var(--accent-green)', 'waktu')}
      ${kpiCard('Total HK Tidak Hadir', fmtNum(totalHKTidakHadir,1), 'perlu perhatian bila tinggi', 'var(--accent-red)', 'waktu')}
      ${kpiCard('Rata-rata Produktivitas', avgPct===null ? '–' : Math.round(avgPct)+'%', pctList.length ? `dari ${pctList.length} baris ber-norma` : 'belum ada norma cocok', 'var(--accent-blue)', 'progress')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Produktivitas Rata-rata per Pekerja (%)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_prod_pekerja"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Kegiatan</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_prod_kegiatan"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Tren Harian: HK Hadir vs Tidak Hadir</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_prod_tren"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Produktivitas per Kegiatan (%)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_prod_kegiatan_pct"></canvas></div></div></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><span class="card-title">Ringkasan per Kegiatan — Aktual vs Norma</span></div>
      <div class="card-body" style="padding:0;">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Kegiatan</th><th>Satuan</th><th>Total Hasil</th><th>Total HK</th><th>Norma /HK</th><th>Produktivitas</th>
            </tr></thead>
            <tbody>
              ${perKegiatanRows.length===0 ? `<tr><td colspan="6"><div class="empty-state">Belum ada data.</div></td></tr>` :
                perKegiatanRows.map((r,i)=>`<tr>
                  <td>${esc(r.kegiatan)}</td>
                  <td>${esc(r.satuan)}</td>
                  <td>${fmtNum(r.hasil)}</td>
                  <td>${fmtNum(r.hk)}</td>
                  <td>${isAdminRole() ? `
                    <div style="display:flex; align-items:center; gap:6px;">
                      <input type="number" step="0.001" id="normaInput_${i}" class="input" style="width:90px; padding:4px 6px; font-size:12px;" value="${r.norma===null?'':r.norma}" placeholder="belum diset">
                      <button class="btn btn-outline btn-sm" onclick="saveNormaKegiatan(${i})">Simpan</button>
                    </div>
                  ` : (r.norma===null ? '<span style="color:var(--text-faint)">belum diset</span>' : fmtNum(r.norma,3))}</td>
                  <td>${r.pct===null ? '–' : badgeForStatus(r.pct>=100?'Baik':(r.pct>=80?'Cukup':'Kurang')) + ` <span style="font-family:var(--font-mono); font-size:11.5px;">${Math.round(r.pct)}%</span>`}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Harian (${rows.length} baris)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari nama/petak/kegiatan…" id="searchInput_produktivitas" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="toggleProduktivitasFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetProduktivitasFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportProduktivitas()" title="Menambah baris baru dari sheet Report (Excel).">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX (Sheet Report)
          </button>
          <input type="file" id="importFileProduktivitas" accept=".xlsx,.xls" class="hidden" onchange="handleImportProduktivitas(this)">
          ${renderExportMenu('produktivitas')}` : ''}
          ${canEditModule('produktivitas_harian') ? `<button class="btn btn-primary btn-sm" onclick="openProduktivitasModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKegiatan_prod">
          <option value="">Kegiatan: Semua</option>
          ${kegiatanOptions.map(k=>`<option value="${esc(k)}" ${st.filterKegiatan===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterPekerja_prod">
          <option value="">Pekerja: Semua</option>
          ${pekerjaOptions.map(p=>`<option value="${esc(p)}" ${st.filterPekerja===p?'selected':''}>${esc(p)}</option>`).join('')}
        </select>
        <label style="font-size:11.5px; color:var(--text-faint); display:flex; align-items:center; gap:6px;">Dari
          <input class="input" type="date" style="width:auto; padding:6px 9px; font-size:12px;" id="filterDari_prod" value="${esc(st.filterDari)}">
        </label>
        <label style="font-size:11.5px; color:var(--text-faint); display:flex; align-items:center; gap:6px;">Sampai
          <input class="input" type="date" style="width:auto; padding:6px 9px; font-size:12px;" id="filterSampai_prod" value="${esc(st.filterSampai)}">
        </label>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            ${PRODUKTIVITAS_LIST_COLUMNS.map(c => `<th onclick="sortProduktivitas('${c}')">${c==='produktivitas_pct'?'Produktivitas':FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${PRODUKTIVITAS_LIST_COLUMNS.length+1}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map(r => {
                const pct = produktivitasPct(r);
                return `<tr>
                ${PRODUKTIVITAS_LIST_COLUMNS.map(c => {
                  if(c==='produktivitas_pct') return `<td>${pct===null ? '<span style="color:var(--text-faint)">–</span>' : badgeForStatus(pct>=100?'Baik':(pct>=80?'Cukup':'Kurang')) + ` <span style="font-family:var(--font-mono); font-size:11px;">${Math.round(pct)}%</span>`}</td>`;
                  if(c==='petak') return `<td><span class="petak-tag">${esc(r[c])}</span></td>`;
                  if(c==='hasil' || c==='hk' || c==='hk_tidak_hadir') return `<td>${r[c]==null?'–':fmtNum(r[c])}</td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openProduktivitasModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('produktivitas_harian') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteProduktivitas(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`;}).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeProduktivitasPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeProduktivitasPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  // Grafik digambar SEGERA setelah HTML ter-render, SEBELUM wiring listener
  // apapun di bawah. Ini sengaja dipisah try/catch sendiri: kalau ada error
  // di kode wiring (mis. elemen filter belum ada di DOM), grafik tetap
  // muncul karena tidak lagi ketahan/gagal ikut oleh error yang tidak terkait.
  drawHBar('chart_prod_pekerja', pekerjaPctMap);
  drawDonut('chart_prod_kegiatan', kegiatanAgg);
  drawStackedBar('chart_prod_tren', dateKeys.map(fmtDDMMM), trendSeries, false, ['#5FAE7D','#C1543C']);
  drawBar('chart_prod_kegiatan_pct', kegiatanPctMap);

  try{
    $('#searchInput_produktivitas')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_produktivitas'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterKegiatan_prod')?.addEventListener('change', function(){ st.filterKegiatan = this.value; st.page = 1; paintProduktivitas(st.data); });
    $('#filterPekerja_prod')?.addEventListener('change', function(){ st.filterPekerja = this.value; st.page = 1; paintProduktivitas(st.data); });
    $('#filterDari_prod')?.addEventListener('change', function(){ st.filterDari = this.value; st.page = 1; paintProduktivitas(st.data); });
    $('#filterSampai_prod')?.addEventListener('change', function(){ st.filterSampai = this.value; st.page = 1; paintProduktivitas(st.data); });
  }catch(e){ console.error('Wiring listener Produktivitas Harian gagal:', e); }
}

function openProduktivitasModal(id){
  const record = id ? state[PRODUKTIVITAS_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('produktivitas_harian');
  const zonaRestrict = getUserZonaRestriction('produktivitas_harian');
  // Dropdown Harian Plantation & KA Dept diisi dari nama-nama yang sudah pernah
  // dientri di data (bukan daftar tetap), supaya tetap sinkron kalau ada nama
  // pekerja/departemen baru, tapi tetap disodorkan sebagai pilihan cepat.
  FIELD_META.harian_plantation.list = uniqueValues(state[PRODUKTIVITAS_TABLE].data, 'harian_plantation');
  FIELD_META.ka_dept.list = uniqueValues(state[PRODUKTIVITAS_TABLE].data, 'ka_dept');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — Produktivitas Harian</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${zonaRestrict ? `<p style="font-size:11.5px; color:var(--text-faint); margin:-4px 0 14px;">Zona terkunci ke <b>${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.</p>` : ''}
        <form id="recordFormProd" class="form-grid">
          ${PRODUKTIVITAS_COLUMNS.map(col => {
            if(col === 'zona' && zonaRestrict) return fieldHTML(col, record ? record[col] : zonaRestrict, true);
            return fieldHTML(col, record ? record[col] : '', readonly);
          }).join('')}
        </form>
        <p style="font-size:11px; color:var(--text-faint); margin-top:10px;">
          Norma kegiatan terpilih: <span id="normaHint">–</span>
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveProduktivitas(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const kegiatanInput = overlay.querySelector('[name="kegiatan"]');
  const satuanInput = overlay.querySelector('[name="satuan"]');
  const normaHint = overlay.querySelector('#normaHint');
  function updateNormaHint(){
    const info = produktivitasNormaFor(kegiatanInput.value);
    if(info){
      if(satuanInput && !satuanInput.value) satuanInput.value = info.satuan;
      normaHint.textContent = info.norma ? `${info.norma} ${info.satuan} per HK` : 'belum ada standar norma untuk kegiatan ini';
    } else {
      normaHint.textContent = '–';
    }
  }
  kegiatanInput?.addEventListener('input', updateNormaHint);
  kegiatanInput?.addEventListener('change', updateNormaHint);
  updateNormaHint();
}

async function saveProduktivitas(id){
  const form = $('#recordFormProd');
  const payload = {};
  PRODUKTIVITAS_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.petak){ toast('Kolom Petak wajib diisi', true); return; }
  if(!payload.tanggal){ toast('Kolom Tanggal wajib diisi', true); return; }
  if(!payload.harian_plantation){ toast('Kolom Harian Plantation wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(PRODUKTIVITAS_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(PRODUKTIVITAS_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: PRODUKTIVITAS_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.petak], zona: payload.zona });
  closeModal();
  state[PRODUKTIVITAS_TABLE].loaded = false;
  await ensureProduktivitasData();
  paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteProduktivitas(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteProduktivitas(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteProduktivitas(id){
  const rec = state[PRODUKTIVITAS_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(PRODUKTIVITAS_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: PRODUKTIVITAS_TABLE, action:'hapus', petakList: [rec?.petak], zona: rec?.zona });
  state[PRODUKTIVITAS_TABLE].loaded = false;
  await ensureProduktivitasData();
  paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
  refreshAllCounts();
}

function triggerImportProduktivitas(){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFileProduktivitas').click();
}
// Pemetaan header Excel (huruf kecil semua, untuk pencocokan) -> nama kolom
// database. Persis 14 kolom sheet "Report" + "zona" (kolom internal aplikasi,
// opsional, boleh tidak ada di file Excel).
const PRODUKTIVITAS_HEADER_MAP = {
  'tanggal':'tanggal',
  'harian plantation':'harian_plantation',
  'petak':'petak',
  'ka dept':'ka_dept',
  'luas wo':'luas_wo',
  'no wo':'no_wo',
  'status petak':'status_petak',
  'kegiatan':'kegiatan',
  'satuan':'satuan',
  'hasil':'hasil',
  'hk':'hk',
  'hk tidak hadir':'hk_tidak_hadir',
  'keterangan':'keterangan',
  'pengawas':'pengawas',
  'zona':'zona',
};
function excelSerialToISODate(v){
  if(v instanceof Date) return v.toISOString().slice(0,10);
  if(typeof v === 'number'){
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0,10);
  }
  return v ? v.toString().trim() : null;
}
async function handleImportProduktivitas(input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });
      // Cari baris header (baris yang mengandung sel "PETAK") di tiap sheet,
      // karena file export/report sering punya baris judul di atas header
      // (mis. header baru muncul di baris ke-7, bukan baris pertama).
      function findHeaderRowIndex(sheet){
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, blankrows:false, defval:null });
        for(let i=0; i<Math.min(rows.length, 30); i++){
          const row = rows[i] || [];
          if(row.some(h => (h||'').toString().trim().toLowerCase() === 'petak')) return i;
        }
        return -1;
      }
      let sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'report');
      let headerRowIdx = sheetName ? findHeaderRowIndex(wb.Sheets[sheetName]) : -1;
      if(!sheetName || headerRowIdx === -1){
        for(const name of wb.SheetNames){
          const idx = findHeaderRowIndex(wb.Sheets[name]);
          if(idx !== -1){ sheetName = name; headerRowIdx = idx; break; }
        }
      }
      if(!sheetName) sheetName = wb.SheetNames[0];
      let json;
      if(headerRowIdx > 0){
        // Header tidak di baris pertama: baca manual mulai dari baris header.
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header:1, blankrows:false, defval:null });
        const headerRow = rows[headerRowIdx].map(h => (h||'').toString().trim());
        json = rows.slice(headerRowIdx+1).map(r=>{
          const o = {};
          headerRow.forEach((h,i)=>{ if(h) o[h] = r[i] !== undefined ? r[i] : null; });
          return o;
        }).filter(r => Object.values(r).some(v => v!==null && v!==''));
      } else {
        json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:null });
      }
      if(!json.length){ toast('Sheet kosong atau format tidak dikenali', true); return; }

      const zonaRestrict = getUserZonaRestriction('produktivitas_harian');
      const rowsToInsert = json.map(row=>{
        const o = {};
        Object.entries(row).forEach(([rawKey, v])=>{
          const norm = rawKey.toString().trim().toLowerCase();
          const col = PRODUKTIVITAS_HEADER_MAP[norm];
          if(!col) return;
          if(col === 'tanggal') o[col] = excelSerialToISODate(v);
          else if(FIELD_META[col]?.type === 'number') o[col] = (v===null||v==='') ? null : parseFloat(v);
          else o[col] = (v===null||v==='') ? null : v.toString().trim();
        });
        if(zonaRestrict) o.zona = zonaRestrict;
        o.created_by = currentUser.id;
        o.updated_by = currentUser.id;
        return o;
      }).filter(r => r.petak);

      if(!rowsToInsert.length){ toast('Tidak ditemukan kolom "PETAK" pada sheet. Pastikan header sama seperti sheet Report.', true); return; }

      hideImportProgress(true);
      const confirmedProduktivitas = await showExcelImportPreview(rowsToInsert, PRODUKTIVITAS_COLUMNS, { label: 'Produktivitas Harian' });
      if(!confirmedProduktivitas){ toast('Import dibatalkan', 'info'); return; }
      showImportProgress();
      setImportProgress(45, 'Menyimpan data…');

      // Cegah data dobel saat file yang sama/overlap diimpor ulang: baris
      // dengan kombinasi tanggal+harian_plantation+petak+kegiatan yang sudah
      // ada di database di-UPDATE, bukan di-INSERT lagi.
      const rowKey = r => [r.tanggal, r.harian_plantation, r.petak, r.kegiatan].join('||').toLowerCase();
      await ensureProduktivitasData();
      const existingById = {};
      state[PRODUKTIVITAS_TABLE].data.forEach(r => { existingById[rowKey(r)] = r.id; });
      const seenInFile = {};
      const toUpdate = [], toInsert = [];
      rowsToInsert.forEach(p=>{
        const key = rowKey(p);
        const existingId = seenInFile[key] || existingById[key];
        if(existingId){ toUpdate.push({ id:existingId, payload:p }); seenInFile[key] = existingId; }
        else { toInsert.push(p); }
      });

      const results = await Promise.all([
        ...toInsert.map(p => supa.from(PRODUKTIVITAS_TABLE).insert(p)),
        ...toUpdate.map(u => supa.from(PRODUKTIVITAS_TABLE).update(u.payload).eq('id', u.id)),
      ]);
      const failed = results.filter(r=>r.error);
      const success = rowsToInsert.length - failed.length;
      if(success) await logNotificationGrouped(PRODUKTIVITAS_TABLE, 'import', rowsToInsert.slice(0, success));
      let msg = `${toInsert.length} baris ditambahkan, ${toUpdate.length} baris diperbarui`;
      if(failed.length) msg += `, ${failed.length} gagal${failed[0].error ? ' — ' + failed[0].error.message : ''}`;
      hideImportProgress(true);
      toast(msg, failed.length === rowsToInsert.length);

      state[PRODUKTIVITAS_TABLE].loaded = false;
      await ensureProduktivitasData();
      paintProduktivitas(state[PRODUKTIVITAS_TABLE].data);
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

/* =======================================================================
   MODUL: MONITORING MOTOR  (berdasar sheet "Summary" pada file
   _Timesheet_Motor_2026.xlsx)
   =======================================================================
   Master data unit motor (1 baris per unit), BUKAN log harian — mirip pola
   modul master petak (TABLES generik), tapi kolomnya berbeda (bukan
   petak/luas), jadi dibuat modul tersendiri seperti Produktivitas Harian.
   Kolom mengikuti persis header sheet "Summary":
     No | Kode Unit | Status | PJ | Kadept | Zona | Kondisi | Ket
   ("No" tidak disimpan — nomor urut ditampilkan otomatis dari urutan tabel).
   Sesuai permintaan: hanya CRUD (tambah/lihat/edit/hapus), TANPA fitur
   export/import XLSX.
   ------------------------------------------------------------------- */
const MONITORING_MOTOR_TABLE = 'monitoring_motor';

const MONITORING_MOTOR_COLUMNS = ['kode_unit','status','pj','kadept','zona','kondisi','ket'];
const MONITORING_MOTOR_LIST_COLUMNS = ['kode_unit','status','pj','kadept','zona','kondisi','ket'];

Object.assign(FIELD_META, {
  kode_unit: { label:'Kode Unit', type:'text', required:true },
  status: { label:'Status', type:'text', list:['Internal','Sewa'] },
  pj: { label:'PJ', type:'text' },
  kadept: { label:'Kadept', type:'text' },
  kondisi: { label:'Kondisi', type:'text', list:['Baik','Cukup','Kurang','Rusak'] },
  ket: { label:'Keterangan', type:'text' },
  // "zona" memakai FIELD_META.zona yang sudah didefinisikan di bagian 1 (list A-D).
});

// --- Field khusus modul Monitoring Aset (berdasar sheet "Data Aset") ---
Object.assign(FIELD_META, {
  coa_asset: { label:'COA Asset', type:'text', list:['1340-311','1340-313','1340-412','1340-413','1340-414','1340-415','1340-416','1340-490','1340-612'] },
  sub_kategori_aset: { label:'Sub Kategori Assets', type:'text', required:true, list:['TRACTOR - NEW HOLLAND','BULLDOZER - LIUGONG','IMPLEMENT HARROW','IMPLEMENT KAIR','ROTASLASHER','IMPLEMENT RATOONER','IMPLEMENT LAIN-LAIN','BOOM SPRAYER','INSTALASI AIR'] },
  kode_aset: { label:'Kode Aset Baru', type:'text', required:true },
  nama_aset: { label:'Nama Asset', type:'text', required:true },
});

state[MONITORING_MOTOR_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'kode_unit', sortDir:'asc', page:1, pageSize:14,
  filterStatus:'', filterKondisi:'', filterZona:'', filterPanelOpen:false,
};

async function ensureMonitoringMotorData(){
  const st = state[MONITORING_MOTOR_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(MONITORING_MOTOR_TABLE).select('*').order('kode_unit', { ascending:true });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat Monitoring Motor: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data||[]);
  st.loaded = true;
  return st.data;
}

async function renderMonitoringMotor(){
  $('#pageEyebrow').textContent = 'ARMADA & ASET';
  $('#pageTitle').textContent = 'Monitoring Motor';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureMonitoringMotorData();
  paintMonitoringMotor(rows);
}

function resetMonitoringMotorFilters(){
  const st = state[MONITORING_MOTOR_TABLE];
  st.filterStatus=''; st.filterKondisi=''; st.filterZona='';
  st.page = 1;
  paintMonitoringMotor(st.data);
}
function toggleMonitoringMotorFilterPanel(){
  state[MONITORING_MOTOR_TABLE].filterPanelOpen = !state[MONITORING_MOTOR_TABLE].filterPanelOpen;
  paintMonitoringMotor(state[MONITORING_MOTOR_TABLE].data);
}
function sortMonitoringMotor(key){
  const st = state[MONITORING_MOTOR_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintMonitoringMotor(st.data);
}
function changeMonitoringMotorPage(delta){
  state[MONITORING_MOTOR_TABLE].page += delta;
  paintMonitoringMotor(state[MONITORING_MOTOR_TABLE].data);
}

function paintMonitoringMotor(allRows){
  const st = state[MONITORING_MOTOR_TABLE];
  const zonaRestrict = getUserZonaRestriction();

  const statusOptions = uniqueValues(allRows, 'status');
  const kondisiOptions = uniqueValues(allRows, 'kondisi');
  const zonaOptions = uniqueValues(allRows, 'zona');
  const filterActive = !!(st.filterStatus || st.filterKondisi || st.filterZona);
  const filterCount = [st.filterStatus, st.filterKondisi, st.filterZona].filter(Boolean).length;

  let rows = allRows;
  if(st.filterStatus) rows = rows.filter(r => (r.status||'').toString().trim() === st.filterStatus);
  if(st.filterKondisi) rows = rows.filter(r => (r.kondisi||'').toString().trim() === st.filterKondisi);
  if(st.filterZona) rows = rows.filter(r => (r.zona||'').toString().trim() === st.filterZona);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['kode_unit','pj','kadept','ket'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  const totalUnit = filteredRows.length;
  const totalBaik = filteredRows.filter(r => (r.kondisi||'').toString().trim().toLowerCase() === 'baik').length;
  const totalBermasalah = filteredRows.filter(r => ['cukup','kurang','rusak'].includes((r.kondisi||'').toString().trim().toLowerCase())).length;
  const zonaSet = new Set(filteredRows.map(r=>r.zona).filter(Boolean));

  const kondisiAgg = aggregateCount(filteredRows, 'kondisi');
  const statusAgg = aggregateCount(filteredRows, 'status');
  const zonaAgg = aggregateCount(filteredRows, 'zona');

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey] ?? '').toString(), bv = (b[st.sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, 'id', { numeric:true });
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const startNo = (st.page-1)*st.pageSize;

  $('#pageContent').innerHTML = `
    ${zonaRestrict ? `<div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Menampilkan data khusus <b style="color:var(--accent-gold);">Zona ${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.
      </div>
    </div>` : ''}
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Unit Motor', totalUnit, filterActive ? 'unit (sesuai filter)' : 'seluruh unit', 'var(--accent-gold)', 'truk')}
      ${kpiCard('Kondisi Baik', totalBaik, totalUnit ? Math.round(totalBaik/totalUnit*100)+'% dari total' : '–', 'var(--accent-green)', 'kualitas')}
      ${kpiCard('Perlu Perhatian', totalBermasalah, 'kondisi Cukup/Kurang/Rusak', 'var(--accent-red)', 'kualitas')}
      ${kpiCard('Jumlah Zona', zonaSet.size, 'zona tercakup', 'var(--accent-blue)', 'petak')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Kondisi</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_motor_kondisi"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Status</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_motor_status"></canvas></div></div></div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header"><span class="card-title">Jumlah Unit per Zona</span></div>
      <div class="card-body"><div class="chart-box"><canvas id="chart_motor_zona"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Unit Motor (${rows.length} unit)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari kode unit/PJ/kadept…" id="searchInput_motor" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="toggleMonitoringMotorFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetMonitoringMotorFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${canEditModule('monitoring_motor') ? `<button class="btn btn-primary btn-sm" onclick="openMonitoringMotorModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Unit
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatus_motor">
          <option value="">Status: Semua</option>
          ${statusOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKondisi_motor">
          <option value="">Kondisi: Semua</option>
          ${kondisiOptions.map(k=>`<option value="${esc(k)}" ${st.filterKondisi===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_motor">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${MONITORING_MOTOR_LIST_COLUMNS.map(c => `<th onclick="sortMonitoringMotor('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${MONITORING_MOTOR_LIST_COLUMNS.length+2}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r, i) => `<tr>
                <td>${startNo + i + 1}</td>
                ${MONITORING_MOTOR_LIST_COLUMNS.map(c => {
                  if(c==='kode_unit') return `<td><span class="petak-tag">${esc(r[c])}</span></td>`;
                  if(c==='kondisi') return `<td>${badgeForStatus(r[c])}</td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openMonitoringMotorModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('monitoring_motor') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteMonitoringMotor(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} unit</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeMonitoringMotorPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeMonitoringMotorPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawStatusProgressBar('chart_motor_kondisi', kondisiAgg);
  drawDonut('chart_motor_status', statusAgg, false);
  drawBar('chart_motor_zona', zonaAgg);

  try{
    $('#searchInput_motor')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintMonitoringMotor(state[MONITORING_MOTOR_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_motor'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterStatus_motor')?.addEventListener('change', function(){ st.filterStatus = this.value; st.page = 1; paintMonitoringMotor(st.data); });
    $('#filterKondisi_motor')?.addEventListener('change', function(){ st.filterKondisi = this.value; st.page = 1; paintMonitoringMotor(st.data); });
    $('#filterZona_motor')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintMonitoringMotor(st.data); });
  }catch(e){ console.error('Wiring listener Monitoring Motor gagal:', e); }
}

function openMonitoringMotorModal(id){
  const record = id ? state[MONITORING_MOTOR_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('monitoring_motor');
  const zonaRestrict = getUserZonaRestriction();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Unit' : 'Tambah Unit Motor'} — Monitoring Motor</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${zonaRestrict ? `<p style="font-size:11.5px; color:var(--text-faint); margin:-4px 0 14px;">Zona terkunci ke <b>${esc(zonaRestrict)}</b> sesuai penugasan akun Anda.</p>` : ''}
        <form id="recordFormMotor" class="form-grid">
          ${MONITORING_MOTOR_COLUMNS.map(col => {
            if(col === 'zona' && zonaRestrict) return fieldHTML(col, record ? record[col] : zonaRestrict, true);
            return fieldHTML(col, record ? record[col] : '', readonly);
          }).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveMonitoringMotor(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveMonitoringMotor(id){
  const form = $('#recordFormMotor');
  const payload = {};
  MONITORING_MOTOR_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    payload[col] = v === '' ? null : v;
  });
  if(!payload.kode_unit){ toast('Kolom Kode Unit wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(MONITORING_MOTOR_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(MONITORING_MOTOR_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Unit baru berhasil ditambahkan');
  await logNotification({ table: MONITORING_MOTOR_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kode_unit], zona: payload.zona });
  closeModal();
  state[MONITORING_MOTOR_TABLE].loaded = false;
  await ensureMonitoringMotorData();
  paintMonitoringMotor(state[MONITORING_MOTOR_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteMonitoringMotor(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Unit?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Data unit motor akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteMonitoringMotor(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteMonitoringMotor(id){
  const rec = state[MONITORING_MOTOR_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(MONITORING_MOTOR_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Unit berhasil dihapus');
  await logNotification({ table: MONITORING_MOTOR_TABLE, action:'hapus', petakList: [rec?.kode_unit], zona: rec?.zona });
  state[MONITORING_MOTOR_TABLE].loaded = false;
  await ensureMonitoringMotorData();
  paintMonitoringMotor(state[MONITORING_MOTOR_TABLE].data);
  refreshAllCounts();
}

/* =======================================================================
   MODUL: MONITORING ASET  (berdasar sheet "Data Aset" pada file
   DATA_ASSET_ALL_2026_UPDATE.xlsx)
   =======================================================================
   Master data aset/alat (1 baris per unit aset), mengikuti persis header
   sheet "Data Aset":
     No | COA Asset | Sub Kategori Assets | Kode Aset Baru | Nama Asset | Kondisi
   ("No" tidak disimpan — nomor urut ditampilkan otomatis dari urutan tabel).
   Sesuai permintaan: hanya CRUD (tambah/lihat/edit/hapus) + analisa data,
   TANPA fitur export/import XLSX.
   ------------------------------------------------------------------- */
const MONITORING_ASET_TABLE = 'monitoring_aset';

const MONITORING_ASET_COLUMNS = ['coa_asset','sub_kategori_aset','kode_aset','nama_aset','kondisi'];
const MONITORING_ASET_LIST_COLUMNS = ['coa_asset','sub_kategori_aset','kode_aset','nama_aset','kondisi'];

state[MONITORING_ASET_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'kode_aset', sortDir:'asc', page:1, pageSize:14,
  filterSubKategori:'', filterKondisi:'', filterCoa:'', filterPanelOpen:false,
};

async function ensureMonitoringAsetData(){
  const st = state[MONITORING_ASET_TABLE];
  if(st.loaded) return st.data;
  const { data, error } = await supa.from(MONITORING_ASET_TABLE).select('*').order('kode_aset', { ascending:true });
  if(error){ toast('Gagal memuat Monitoring Aset: ' + error.message, true); return []; }
  st.data = data || [];
  st.loaded = true;
  return st.data;
}

async function renderMonitoringAset(){
  $('#pageEyebrow').textContent = 'ARMADA & ASET';
  $('#pageTitle').textContent = 'Monitoring Aset';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureMonitoringAsetData();
  paintMonitoringAset(rows);
}

function resetMonitoringAsetFilters(){
  const st = state[MONITORING_ASET_TABLE];
  st.filterSubKategori=''; st.filterKondisi=''; st.filterCoa='';
  st.page = 1;
  paintMonitoringAset(st.data);
}
function toggleMonitoringAsetFilterPanel(){
  state[MONITORING_ASET_TABLE].filterPanelOpen = !state[MONITORING_ASET_TABLE].filterPanelOpen;
  paintMonitoringAset(state[MONITORING_ASET_TABLE].data);
}
function sortMonitoringAset(key){
  const st = state[MONITORING_ASET_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintMonitoringAset(st.data);
}
function changeMonitoringAsetPage(delta){
  state[MONITORING_ASET_TABLE].page += delta;
  paintMonitoringAset(state[MONITORING_ASET_TABLE].data);
}

function paintMonitoringAset(allRows){
  const st = state[MONITORING_ASET_TABLE];

  const subKategoriOptions = uniqueValues(allRows, 'sub_kategori_aset');
  const kondisiOptions = uniqueValues(allRows, 'kondisi');
  const coaOptions = uniqueValues(allRows, 'coa_asset');
  const filterActive = !!(st.filterSubKategori || st.filterKondisi || st.filterCoa);
  const filterCount = [st.filterSubKategori, st.filterKondisi, st.filterCoa].filter(Boolean).length;

  let rows = allRows;
  if(st.filterSubKategori) rows = rows.filter(r => (r.sub_kategori_aset||'').toString().trim() === st.filterSubKategori);
  if(st.filterKondisi) rows = rows.filter(r => (r.kondisi||'').toString().trim() === st.filterKondisi);
  if(st.filterCoa) rows = rows.filter(r => (r.coa_asset||'').toString().trim() === st.filterCoa);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['kode_aset','nama_aset','coa_asset','sub_kategori_aset'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  const totalAset = filteredRows.length;
  const totalBaik = filteredRows.filter(r => (r.kondisi||'').toString().trim().toLowerCase() === 'baik').length;
  const totalBermasalah = filteredRows.filter(r => ['cukup','kurang','rusak'].includes((r.kondisi||'').toString().trim().toLowerCase())).length;
  const subKategoriSet = new Set(filteredRows.map(r=>r.sub_kategori_aset).filter(Boolean));

  const kondisiAgg = aggregateCount(filteredRows, 'kondisi');
  const subKategoriAgg = aggregateCount(filteredRows, 'sub_kategori_aset');
  const coaAgg = aggregateCount(filteredRows, 'coa_asset');

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey] ?? '').toString(), bv = (b[st.sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, 'id', { numeric:true });
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const startNo = (st.page-1)*st.pageSize;

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Aset', totalAset, filterActive ? 'unit (sesuai filter)' : 'seluruh unit', 'var(--accent-gold)', 'truk')}
      ${kpiCard('Kondisi Baik', totalBaik, totalAset ? Math.round(totalBaik/totalAset*100)+'% dari total' : '–', 'var(--accent-green)', 'kualitas')}
      ${kpiCard('Perlu Perhatian', totalBermasalah, 'kondisi Cukup/Kurang/Rusak', 'var(--accent-red)', 'kualitas')}
      ${kpiCard('Jumlah Sub Kategori', subKategoriSet.size, 'sub kategori tercakup', 'var(--accent-blue)', 'petak')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Kondisi</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_aset_kondisi"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Jumlah Aset per COA</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_aset_coa"></canvas></div></div></div>
    </div>
    <div class="card" style="margin-bottom:14px;">
      <div class="card-header"><span class="card-title">Jumlah Aset per Sub Kategori</span></div>
      <div class="card-body"><div class="chart-box"><canvas id="chart_aset_subkategori"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Aset (${rows.length} unit)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari kode/nama/COA…" id="searchInput_aset" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="toggleMonitoringAsetFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetMonitoringAsetFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${canEditModule('monitoring_aset') ? `<button class="btn btn-primary btn-sm" onclick="openMonitoringAsetModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Aset
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterCoa_aset">
          <option value="">COA Asset: Semua</option>
          ${coaOptions.map(c=>`<option value="${esc(c)}" ${st.filterCoa===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterSubKategori_aset">
          <option value="">Sub Kategori: Semua</option>
          ${subKategoriOptions.map(s=>`<option value="${esc(s)}" ${st.filterSubKategori===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKondisi_aset">
          <option value="">Kondisi: Semua</option>
          ${kondisiOptions.map(k=>`<option value="${esc(k)}" ${st.filterKondisi===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${MONITORING_ASET_LIST_COLUMNS.map(c => `<th onclick="sortMonitoringAset('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${MONITORING_ASET_LIST_COLUMNS.length+2}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r, i) => `<tr>
                <td>${startNo + i + 1}</td>
                ${MONITORING_ASET_LIST_COLUMNS.map(c => {
                  if(c==='kode_aset') return `<td><span class="petak-tag">${esc(r[c])}</span></td>`;
                  if(c==='kondisi') return `<td>${badgeForStatus(r[c])}</td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openMonitoringAsetModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('monitoring_aset') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteMonitoringAset(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} unit</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeMonitoringAsetPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeMonitoringAsetPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawStatusProgressBar('chart_aset_kondisi', kondisiAgg);
  drawHBar('chart_aset_coa', coaAgg);
  drawHBar('chart_aset_subkategori', subKategoriAgg);

  try{
    $('#searchInput_aset')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintMonitoringAset(state[MONITORING_ASET_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_aset'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterCoa_aset')?.addEventListener('change', function(){ st.filterCoa = this.value; st.page = 1; paintMonitoringAset(st.data); });
    $('#filterSubKategori_aset')?.addEventListener('change', function(){ st.filterSubKategori = this.value; st.page = 1; paintMonitoringAset(st.data); });
    $('#filterKondisi_aset')?.addEventListener('change', function(){ st.filterKondisi = this.value; st.page = 1; paintMonitoringAset(st.data); });
  }catch(e){ console.error('Wiring listener Monitoring Aset gagal:', e); }
}

function openMonitoringAsetModal(id){
  const record = id ? state[MONITORING_ASET_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('monitoring_aset');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Aset' : 'Tambah Aset'} — Monitoring Aset</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormAset" class="form-grid">
          ${MONITORING_ASET_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveMonitoringAset(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveMonitoringAset(id){
  const form = $('#recordFormAset');
  const payload = {};
  MONITORING_ASET_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    payload[col] = v === '' ? null : v;
  });
  if(!payload.kode_aset){ toast('Kolom Kode Aset Baru wajib diisi', true); return; }
  if(!payload.nama_aset){ toast('Kolom Nama Asset wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(MONITORING_ASET_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(MONITORING_ASET_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Aset baru berhasil ditambahkan');
  await logNotification({ table: MONITORING_ASET_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kode_aset] });
  closeModal();
  state[MONITORING_ASET_TABLE].loaded = false;
  await ensureMonitoringAsetData();
  paintMonitoringAset(state[MONITORING_ASET_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteMonitoringAset(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Aset?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Data aset akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteMonitoringAset(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteMonitoringAset(id){
  const rec = state[MONITORING_ASET_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(MONITORING_ASET_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Aset berhasil dihapus');
  await logNotification({ table: MONITORING_ASET_TABLE, action:'hapus', petakList: [rec?.kode_aset] });
  state[MONITORING_ASET_TABLE].loaded = false;
  await ensureMonitoringAsetData();
  paintMonitoringAset(state[MONITORING_ASET_TABLE].data);
  refreshAllCounts();
}

/* =======================================================================
   MODUL: MONITORING HE & IMPLEMENT
   =======================================================================
   Berdasarkan sheet "Kondisi Unit Estate 2" (2 seksi digabung jadi 1 tabel):
   - Unit HE (alat berat: Excavator, BD, Tractor) -> kategori_he = 'HE'
   - Implement Tractor (Ridger, Trash Mulcer, Boom Spraying, Rotary,
     Planter, Blade) -> kategori_he = 'Implement'
   CRUD terbuka untuk SEMUA role kecuali Manager (lihat MODULE_PERMISSIONS
   'he_implement' di atas). Manager tetap bisa melihat data + grafik. */
const HE_IMPLEMENT_TABLE = 'he_implement';
const HE_IMPLEMENT_COLUMNS = ['kategori_he','kode_unit_he','type_he','implement_he','alokasi_he','kondisi_he','lokasi_he','vendor_he'];
const HE_IMPLEMENT_LIST_COLUMNS = ['kategori_he','kode_unit_he','type_he','implement_he','alokasi_he','kondisi_he','lokasi_he','vendor_he'];

state[HE_IMPLEMENT_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'kode_unit_he', sortDir:'asc', page:1, pageSize:14,
  filterKategori:'', filterType:'', filterKondisi:'', filterVendor:'', filterPanelOpen:false,
};

async function ensureHeImplementData(){
  const st = state[HE_IMPLEMENT_TABLE];
  if(st.loaded) return st.data;
  const { data, error } = await supa.from(HE_IMPLEMENT_TABLE).select('*').order('kode_unit_he', { ascending:true });
  if(error){ toast('Gagal memuat Monitoring HE & Implement: ' + error.message, true); return []; }
  st.data = data || [];
  st.loaded = true;
  return st.data;
}

async function renderHeImplement(){
  $('#pageEyebrow').textContent = 'ARMADA & ASET';
  $('#pageTitle').textContent = 'Monitoring HE & Implement';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureHeImplementData();
  paintHeImplement(rows);
}

function resetHeImplementFilters(){
  const st = state[HE_IMPLEMENT_TABLE];
  st.filterKategori=''; st.filterType=''; st.filterKondisi=''; st.filterVendor='';
  st.page = 1;
  paintHeImplement(st.data);
}
function toggleHeImplementFilterPanel(){
  state[HE_IMPLEMENT_TABLE].filterPanelOpen = !state[HE_IMPLEMENT_TABLE].filterPanelOpen;
  paintHeImplement(state[HE_IMPLEMENT_TABLE].data);
}
function sortHeImplement(key){
  const st = state[HE_IMPLEMENT_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintHeImplement(st.data);
}
function changeHeImplementPage(delta){
  state[HE_IMPLEMENT_TABLE].page += delta;
  paintHeImplement(state[HE_IMPLEMENT_TABLE].data);
}

function paintHeImplement(allRows){
  const st = state[HE_IMPLEMENT_TABLE];

  const kategoriOptions = uniqueValues(allRows, 'kategori_he');
  const typeOptions = uniqueValues(allRows, 'type_he');
  const kondisiOptions = uniqueValues(allRows, 'kondisi_he');
  const vendorOptions = uniqueValues(allRows, 'vendor_he');
  const filterActive = !!(st.filterKategori || st.filterType || st.filterKondisi || st.filterVendor);
  const filterCount = [st.filterKategori, st.filterType, st.filterKondisi, st.filterVendor].filter(Boolean).length;

  let rows = allRows;
  if(st.filterKategori) rows = rows.filter(r => (r.kategori_he||'').toString().trim() === st.filterKategori);
  if(st.filterType) rows = rows.filter(r => (r.type_he||'').toString().trim() === st.filterType);
  if(st.filterKondisi) rows = rows.filter(r => (r.kondisi_he||'').toString().trim() === st.filterKondisi);
  if(st.filterVendor) rows = rows.filter(r => (r.vendor_he||'').toString().trim() === st.filterVendor);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['kode_unit_he','type_he','implement_he','alokasi_he','lokasi_he','vendor_he'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  // ---- KPI & Analisa ----
  const totalUnit = filteredRows.length;
  const totalHE = filteredRows.filter(r => (r.kategori_he||'').trim() === 'HE').length;
  const totalImplement = filteredRows.filter(r => (r.kategori_he||'').trim() === 'Implement').length;
  const totalBaik = filteredRows.filter(r => (r.kondisi_he||'').toString().trim().toLowerCase() === 'baik').length;
  const totalBreakdown = filteredRows.filter(r => (r.kondisi_he||'').toString().trim().toLowerCase() === 'breakdown').length;
  const availabilityRate = totalUnit ? Math.round(totalBaik/totalUnit*100) : 0;

  const kategoriAgg = aggregateCount(filteredRows, 'kategori_he');
  const kondisiAgg = aggregateCount(filteredRows, 'kondisi_he');
  const typeAgg = aggregateCount(filteredRows, 'type_he');
  const vendorAgg = aggregateCount(filteredRows, 'vendor_he');

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey] ?? '').toString(), bv = (b[st.sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, 'id', { numeric:true });
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const startNo = (st.page-1)*st.pageSize;

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Unit', totalUnit, filterActive ? 'unit (sesuai filter)' : 'HE + Implement', 'var(--accent-gold)', 'truk')}
      ${kpiCard('Unit HE', totalHE, 'alat berat (Exca/BD/Tractor)', 'var(--accent-blue)', 'truk')}
      ${kpiCard('Unit Implement', totalImplement, 'implement tractor', 'var(--accent-green)', 'truk')}
      ${kpiCard('Availability Rate', availabilityRate + '%', `${totalBaik} Baik / ${totalBreakdown} Breakdown`, totalBreakdown ? 'var(--accent-red)' : 'var(--accent-green)', 'progress')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Distribusi Kondisi (Baik vs Breakdown)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_he_kondisi"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Proporsi Kategori (HE vs Implement)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_he_kategori"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Jumlah Unit per Type</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_he_type"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Jumlah Unit per Vendor</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_he_vendor"></canvas></div></div></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Unit HE & Implement (${rows.length} unit)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari kode/type/vendor…" id="searchInput_he">
        <button class="btn btn-outline btn-sm" onclick="toggleHeImplementFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetHeImplementFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${canEditModule('he_implement') ? `<button class="btn btn-primary btn-sm" onclick="openHeImplementModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Unit
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKategori_he">
          <option value="">Kategori: Semua</option>
          ${kategoriOptions.map(k=>`<option value="${esc(k)}" ${st.filterKategori===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterType_he">
          <option value="">Type: Semua</option>
          ${typeOptions.map(t=>`<option value="${esc(t)}" ${st.filterType===t?'selected':''}>${esc(t)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKondisi_he">
          <option value="">Kondisi: Semua</option>
          ${kondisiOptions.map(k=>`<option value="${esc(k)}" ${st.filterKondisi===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterVendor_he">
          <option value="">Vendor: Semua</option>
          ${vendorOptions.map(v=>`<option value="${esc(v)}" ${st.filterVendor===v?'selected':''}>${esc(v)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${HE_IMPLEMENT_LIST_COLUMNS.map(c => `<th onclick="sortHeImplement('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.map((r,i)=>`
              <tr>
                <td>${startNo+i+1}</td>
                ${HE_IMPLEMENT_LIST_COLUMNS.map(c => {
                  if(c === 'kondisi_he'){
                    const v = (r.kondisi_he||'').toString().trim().toLowerCase();
                    const cls = v === 'baik' ? 'badge-green' : (v === 'breakdown' ? 'badge-red' : 'badge-gray');
                    return `<td>${r.kondisi_he ? `<span class="status-badge ${cls}">${esc(r.kondisi_he)}</span>` : '<span style="color:var(--text-faint)">–</span>'}</td>`;
                  }
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                ${currentProfile?.role !== 'manager' ? `<td>
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn-outline btn-sm" onclick="openHeImplementModal(${r.id})">Lihat/Edit</button>
                    ${canDeleteModule('he_implement') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteHeImplement(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} unit</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeHeImplementPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeHeImplementPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawDonut('chart_he_kondisi', kondisiAgg, false, { 'Baik':'#5FAE7D', 'Breakdown':'#C1543C' });
  drawDonut('chart_he_kategori', kategoriAgg, false, { 'HE':'#5B8FA8', 'Implement':'#D9A94A' });
  drawHBar('chart_he_type', typeAgg);
  drawHBar('chart_he_vendor', vendorAgg);

  try{
    const searchInp = $('#searchInput_he');
    if(searchInp){
      searchInp.value = st.search;
      searchInp.addEventListener('input', debounce(function(){
        st.search = this.value; st.page = 1; paintHeImplement(state[HE_IMPLEMENT_TABLE].data);
        setTimeout(()=>{ const inp = $('#searchInput_he'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
      }, 300));
    }
    $('#filterKategori_he')?.addEventListener('change', function(){ st.filterKategori = this.value; st.page = 1; paintHeImplement(st.data); });
    $('#filterType_he')?.addEventListener('change', function(){ st.filterType = this.value; st.page = 1; paintHeImplement(st.data); });
    $('#filterKondisi_he')?.addEventListener('change', function(){ st.filterKondisi = this.value; st.page = 1; paintHeImplement(st.data); });
    $('#filterVendor_he')?.addEventListener('change', function(){ st.filterVendor = this.value; st.page = 1; paintHeImplement(st.data); });
  }catch(e){ console.error('Wiring listener HE Implement gagal:', e); }
}

function openHeImplementModal(id){
  const record = id ? state[HE_IMPLEMENT_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('he_implement');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Unit' : 'Tambah Unit'} — Monitoring HE & Implement</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormHe" class="form-grid">
          ${HE_IMPLEMENT_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveHeImplement(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveHeImplement(id){
  const form = $('#recordFormHe');
  const payload = {};
  HE_IMPLEMENT_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    payload[col] = v === '' ? null : v;
  });
  if(!payload.kategori_he){ toast('Kolom Kategori wajib diisi', true); return; }
  if(!payload.kode_unit_he){ toast('Kolom Kode Unit wajib diisi', true); return; }
  if(!payload.type_he){ toast('Kolom Type wajib diisi', true); return; }
  if(!payload.kondisi_he){ toast('Kolom Kondisi wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(HE_IMPLEMENT_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(HE_IMPLEMENT_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Unit baru berhasil ditambahkan');
  await logNotification({ table: HE_IMPLEMENT_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kode_unit_he] });
  closeModal();
  state[HE_IMPLEMENT_TABLE].loaded = false;
  await ensureHeImplementData();
  paintHeImplement(state[HE_IMPLEMENT_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteHeImplement(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Unit?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Data unit akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteHeImplement(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteHeImplement(id){
  const rec = state[HE_IMPLEMENT_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(HE_IMPLEMENT_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Unit berhasil dihapus');
  await logNotification({ table: HE_IMPLEMENT_TABLE, action:'hapus', petakList: [rec?.kode_unit_he] });
  state[HE_IMPLEMENT_TABLE].loaded = false;
  await ensureHeImplementData();
  paintHeImplement(state[HE_IMPLEMENT_TABLE].data);
  refreshAllCounts();
}

/* =======================================================================
   MODUL: ACTUAL TK (Ketersediaan Tenaga Kerja Aktual)
   =======================================================================
   Berdasarkan sheet "Rencana Kedatangan TK": per Zona/Plantation, kebutuhan
   tenaga kerja dibandingkan dengan jumlah aktual yang tersedia dari tiap
   kontraktor. CRUD murni (tambah/lihat/edit/hapus), tanpa impor/ekspor. */
const ACTUAL_TK_TABLE = 'actual_tk';
const ACTUAL_TK_COLUMNS = ['zona','kontraktor','kebutuhan_tk','jumlah_aktual_tk','keterangan_tk'];
const ACTUAL_TK_LIST_COLUMNS = ['zona','kontraktor','kebutuhan_tk','jumlah_aktual_tk','keterangan_tk'];

state[ACTUAL_TK_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'zona', sortDir:'asc', page:1, pageSize:14,
  filterZona:'', filterPanelOpen:false,
};

async function ensureActualTKData(){
  const st = state[ACTUAL_TK_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(ACTUAL_TK_TABLE).select('*').order('zona', { ascending:true });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat Actual TK: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data||[]);
  st.loaded = true;
  return st.data;
}

async function renderActualTK(){
  $('#pageEyebrow').textContent = 'TENAGA KERJA';
  $('#pageTitle').textContent = 'Actual TK';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureActualTKData();
  paintActualTK(rows);
}

function resetActualTKFilters(){
  const st = state[ACTUAL_TK_TABLE];
  st.filterZona = ''; st.page = 1;
  paintActualTK(st.data);
}
function toggleActualTKFilterPanel(){
  state[ACTUAL_TK_TABLE].filterPanelOpen = !state[ACTUAL_TK_TABLE].filterPanelOpen;
  paintActualTK(state[ACTUAL_TK_TABLE].data);
}
function sortActualTK(key){
  const st = state[ACTUAL_TK_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintActualTK(st.data);
}
function changeActualTKPage(delta){
  state[ACTUAL_TK_TABLE].page += delta;
  paintActualTK(state[ACTUAL_TK_TABLE].data);
}

function paintActualTK(allRows){
  const st = state[ACTUAL_TK_TABLE];
  const zonaOptions = uniqueValues(allRows, 'zona');
  const filterActive = !!st.filterZona;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona||'').toString().trim().toUpperCase() === st.filterZona.toUpperCase());
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['zona','kontraktor','keterangan_tk'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }

  const totalKebutuhan = rows.reduce((s,r)=> s + (parseFloat(r.kebutuhan_tk)||0), 0);
  const totalAktual = rows.reduce((s,r)=> s + (parseFloat(r.jumlah_aktual_tk)||0), 0);
  const totalVar = totalAktual - totalKebutuhan;
  const kontraktorSet = new Set(rows.map(r=>r.kontraktor).filter(Boolean));

  const kebutuhanPerZona = aggregateSum(rows, 'zona', 'kebutuhan_tk');
  const aktualPerZona = aggregateSum(rows, 'zona', 'jumlah_aktual_tk');

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey] ?? '').toString(), bv = (b[st.sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, 'id', { numeric:true });
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const startNo = (st.page-1)*st.pageSize;

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Kebutuhan TK', fmtNum(totalKebutuhan,0), 'org (sesuai filter)', 'var(--accent-gold)', 'staff')}
      ${kpiCard('Aktual Tersedia', fmtNum(totalAktual,0), 'org tersedia', 'var(--accent-green)', 'staff')}
      ${kpiCard('Var (+/-)', (totalVar>=0?'+':'') + fmtNum(totalVar,0), totalVar>=0 ? 'surplus tenaga kerja' : 'kekurangan tenaga kerja', totalVar>=0 ? 'var(--accent-green)' : 'var(--accent-red)', 'staff')}
      ${kpiCard('Jumlah Kontraktor', kontraktorSet.size, 'kontraktor tercakup', 'var(--accent-blue)', 'staff')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Kebutuhan TK per Zona</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_actualtk_kebutuhan"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Aktual Tersedia per Zona</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_actualtk_aktual"></canvas></div></div></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Actual TK (${rows.length} baris)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari zona/kontraktor…" id="searchInput_actualtk" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="toggleActualTKFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${st.filterZona ? ' (1)' : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetActualTKFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${canEditModule('actual_tk') ? `<button class="btn btn-primary btn-sm" onclick="openActualTKModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_actualtk">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${ACTUAL_TK_LIST_COLUMNS.map(c => `<th onclick="sortActualTK('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            <th>Var (+/-)</th>
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${ACTUAL_TK_LIST_COLUMNS.length+3}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r, i) => {
                const v = (parseFloat(r.jumlah_aktual_tk)||0) - (parseFloat(r.kebutuhan_tk)||0);
                return `<tr>
                <td>${startNo + i + 1}</td>
                ${ACTUAL_TK_LIST_COLUMNS.map(c => {
                  if(c==='zona') return `<td><span class="petak-tag">${esc(r[c])}</span></td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td><span style="color:${v>=0?'var(--accent-green)':'var(--accent-red)'}; font-weight:600;">${v>=0?'+':''}${fmtNum(v,0)}</span></td>
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openActualTKModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('actual_tk') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteActualTK(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`;}).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeActualTKPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeActualTKPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawHBar('chart_actualtk_kebutuhan', kebutuhanPerZona);
  drawHBar('chart_actualtk_aktual', aktualPerZona);

  try{
    $('#searchInput_actualtk')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintActualTK(state[ACTUAL_TK_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_actualtk'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterZona_actualtk')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintActualTK(st.data); });
  }catch(e){ console.error('Wiring listener Actual TK gagal:', e); }
}

function openActualTKModal(id){
  const record = id ? state[ACTUAL_TK_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('actual_tk');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit' : 'Tambah Data'} — Actual TK</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormActualTK" class="form-grid">
          ${ACTUAL_TK_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveActualTK(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveActualTK(id){
  const form = $('#recordFormActualTK');
  const payload = {};
  ACTUAL_TK_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    payload[col] = v === '' ? null : v;
  });
  if(!payload.zona){ toast('Kolom Zona wajib diisi', true); return; }
  if(!payload.kontraktor){ toast('Kolom Kontraktor wajib diisi', true); return; }
  if(payload.kebutuhan_tk===null){ toast('Kolom Kebutuhan TK wajib diisi', true); return; }
  if(payload.jumlah_aktual_tk===null){ toast('Kolom Jumlah Aktual Tersedia wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(ACTUAL_TK_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(ACTUAL_TK_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: ACTUAL_TK_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kontraktor], zona: payload.zona });
  closeModal();
  state[ACTUAL_TK_TABLE].loaded = false;
  await ensureActualTKData();
  paintActualTK(state[ACTUAL_TK_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteActualTK(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data Actual TK?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteActualTK(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteActualTK(id){
  const rec = state[ACTUAL_TK_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(ACTUAL_TK_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: ACTUAL_TK_TABLE, action:'hapus', petakList: [rec?.kontraktor], zona: rec?.zona });
  state[ACTUAL_TK_TABLE].loaded = false;
  await ensureActualTKData();
  paintActualTK(state[ACTUAL_TK_TABLE].data);
  refreshAllCounts();
}

/* =======================================================================
   MODUL: PLAN KEDATANGAN TK (Rencana & Aktual Kedatangan Tenaga Kerja)
   =======================================================================
   Berdasarkan sheet "Rencana Kedatangan TK": setiap baris mewakili satu
   gelombang rencana kedatangan tenaga kerja untuk kontraktor tertentu di
   suatu zona, lengkap dengan realisasi aktualnya. Bisa ditambah bebas
   untuk gelombang ke-1, ke-2, dst. CRUD murni, tanpa impor/ekspor. */
const PLAN_KEDATANGAN_TABLE = 'plan_kedatangan_tk';
const PLAN_KEDATANGAN_COLUMNS = ['zona','kontraktor','tanggal_rencana_tk','jumlah_rencana_tk','tanggal_aktual_tk','jumlah_aktual_kedatangan_tk','keterangan_tk'];
const PLAN_KEDATANGAN_LIST_COLUMNS = ['zona','kontraktor','tanggal_rencana_tk','jumlah_rencana_tk','tanggal_aktual_tk','jumlah_aktual_kedatangan_tk','keterangan_tk'];

state[PLAN_KEDATANGAN_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'tanggal_rencana_tk', sortDir:'desc', page:1, pageSize:14,
  filterZona:'', filterPanelOpen:false,
};

async function ensurePlanKedatanganData(){
  const st = state[PLAN_KEDATANGAN_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(PLAN_KEDATANGAN_TABLE).select('*').order('tanggal_rencana_tk', { ascending:false });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat Plan Kedatangan TK: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data||[]);
  st.loaded = true;
  return st.data;
}

async function renderPlanKedatanganTK(){
  $('#pageEyebrow').textContent = 'TENAGA KERJA';
  $('#pageTitle').textContent = 'Plan Kedatangan TK';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensurePlanKedatanganData();
  paintPlanKedatanganTK(rows);
}

function resetPlanKedatanganFilters(){
  const st = state[PLAN_KEDATANGAN_TABLE];
  st.filterZona = ''; st.page = 1;
  paintPlanKedatanganTK(st.data);
}
function togglePlanKedatanganFilterPanel(){
  state[PLAN_KEDATANGAN_TABLE].filterPanelOpen = !state[PLAN_KEDATANGAN_TABLE].filterPanelOpen;
  paintPlanKedatanganTK(state[PLAN_KEDATANGAN_TABLE].data);
}
function sortPlanKedatangan(key){
  const st = state[PLAN_KEDATANGAN_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintPlanKedatanganTK(st.data);
}
function changePlanKedatanganPage(delta){
  state[PLAN_KEDATANGAN_TABLE].page += delta;
  paintPlanKedatanganTK(state[PLAN_KEDATANGAN_TABLE].data);
}

function paintPlanKedatanganTK(allRows){
  const st = state[PLAN_KEDATANGAN_TABLE];
  const zonaOptions = uniqueValues(allRows, 'zona');
  const filterActive = !!st.filterZona;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona||'').toString().trim().toUpperCase() === st.filterZona.toUpperCase());
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['zona','kontraktor','keterangan_tk'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }

  const totalRencana = rows.reduce((s,r)=> s + (parseFloat(r.jumlah_rencana_tk)||0), 0);
  const totalAktual = rows.reduce((s,r)=> s + (parseFloat(r.jumlah_aktual_kedatangan_tk)||0), 0);
  const totalVar = totalAktual - totalRencana;
  const kontraktorSet = new Set(rows.map(r=>r.kontraktor).filter(Boolean));

  const rencanaPerZona = aggregateSum(rows, 'zona', 'jumlah_rencana_tk');
  const aktualPerZona = aggregateSum(rows, 'zona', 'jumlah_aktual_kedatangan_tk');

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey] ?? '').toString(), bv = (b[st.sortKey] ?? '').toString();
    const cmp = av.localeCompare(bv, 'id', { numeric:true });
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const startNo = (st.page-1)*st.pageSize;

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Rencana Kedatangan', fmtNum(totalRencana,0), 'org (sesuai filter)', 'var(--accent-gold)', 'staff')}
      ${kpiCard('Aktual Kedatangan', fmtNum(totalAktual,0), 'org sudah datang', 'var(--accent-green)', 'staff')}
      ${kpiCard('Var (+/-)', (totalVar>=0?'+':'') + fmtNum(totalVar,0), totalVar>=0 ? 'sesuai/lebih dari rencana' : 'masih kurang dari rencana', totalVar>=0 ? 'var(--accent-green)' : 'var(--accent-red)', 'staff')}
      ${kpiCard('Jumlah Kontraktor', kontraktorSet.size, 'kontraktor tercakup', 'var(--accent-blue)', 'staff')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Rencana Kedatangan per Zona</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_plantk_rencana"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Aktual Kedatangan per Zona</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_plantk_aktual"></canvas></div></div></div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data Plan Kedatangan TK (${rows.length} baris)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari zona/kontraktor…" id="searchInput_plantk" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="togglePlanKedatanganFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${st.filterZona ? ' (1)' : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetPlanKedatanganFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${canEditModule('plan_kedatangan_tk') ? `<button class="btn btn-primary btn-sm" onclick="openPlanKedatanganModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Rencana
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_plantk">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${PLAN_KEDATANGAN_LIST_COLUMNS.map(c => `<th onclick="sortPlanKedatangan('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            <th>Var (+/-)</th>
            <th>Aksi</th>
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${PLAN_KEDATANGAN_LIST_COLUMNS.length+3}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r, i) => {
                const hasAktual = r.jumlah_aktual_kedatangan_tk !== null && r.jumlah_aktual_kedatangan_tk !== undefined && r.jumlah_aktual_kedatangan_tk !== '';
                const v = (parseFloat(r.jumlah_aktual_kedatangan_tk)||0) - (parseFloat(r.jumlah_rencana_tk)||0);
                return `<tr>
                <td>${startNo + i + 1}</td>
                ${PLAN_KEDATANGAN_LIST_COLUMNS.map(c => {
                  if(c==='zona') return `<td><span class="petak-tag">${esc(r[c])}</span></td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>${hasAktual ? `<span style="color:${v>=0?'var(--accent-green)':'var(--accent-red)'}; font-weight:600;">${v>=0?'+':''}${fmtNum(v,0)}</span>` : '<span style="color:var(--text-faint)">–</span>'}</td>
                <td>
                  <div style="display:flex; gap:6px;">
                    <button class="btn btn-outline btn-sm" onclick="openPlanKedatanganModal(${r.id})">Lihat/Edit</button>
                    ${canDeleteModule('plan_kedatangan_tk') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeletePlanKedatangan(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`;}).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changePlanKedatanganPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changePlanKedatanganPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawHBar('chart_plantk_rencana', rencanaPerZona);
  drawHBar('chart_plantk_aktual', aktualPerZona);

  try{
    $('#searchInput_plantk')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintPlanKedatanganTK(state[PLAN_KEDATANGAN_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_plantk'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterZona_plantk')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintPlanKedatanganTK(st.data); });
  }catch(e){ console.error('Wiring listener Plan Kedatangan TK gagal:', e); }
}

function openPlanKedatanganModal(id){
  const record = id ? state[PLAN_KEDATANGAN_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('plan_kedatangan_tk');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit' : 'Tambah Rencana'} — Plan Kedatangan TK</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormPlanTK" class="form-grid">
          ${PLAN_KEDATANGAN_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="savePlanKedatangan(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function savePlanKedatangan(id){
  const form = $('#recordFormPlanTK');
  const payload = {};
  PLAN_KEDATANGAN_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    payload[col] = v === '' ? null : v;
  });
  if(!payload.zona){ toast('Kolom Zona wajib diisi', true); return; }
  if(!payload.kontraktor){ toast('Kolom Kontraktor wajib diisi', true); return; }
  if(payload.jumlah_rencana_tk===null){ toast('Kolom Jumlah Rencana Kedatangan wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(PLAN_KEDATANGAN_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(PLAN_KEDATANGAN_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Rencana baru berhasil ditambahkan');
  await logNotification({ table: PLAN_KEDATANGAN_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kontraktor], zona: payload.zona });
  closeModal();
  state[PLAN_KEDATANGAN_TABLE].loaded = false;
  await ensurePlanKedatanganData();
  paintPlanKedatanganTK(state[PLAN_KEDATANGAN_TABLE].data);
  refreshAllCounts();
}

function confirmDeletePlanKedatangan(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Rencana Kedatangan?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeletePlanKedatangan(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeletePlanKedatangan(id){
  const rec = state[PLAN_KEDATANGAN_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(PLAN_KEDATANGAN_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: PLAN_KEDATANGAN_TABLE, action:'hapus', petakList: [rec?.kontraktor], zona: rec?.zona });
  state[PLAN_KEDATANGAN_TABLE].loaded = false;
  await ensurePlanKedatanganData();
  paintPlanKedatanganTK(state[PLAN_KEDATANGAN_TABLE].data);
  refreshAllCounts();
}

/* =======================================================================
   MODUL: JUSTIFIKASI TCH UNDER 70
   =======================================================================
   Menu ini BUKAN tabel input tersendiri — daftarnya diturunkan (derived)
   secara otomatis dari data menu 'Pasca Harvest' (kolom TCH Nett BAPP 2026),
   disaring hanya petak dengan TCH < 70. Karena datanya selalu dihitung
   ulang dari cache/`ensureData('pasca_harvest')` setiap kali menu ini
   dibuka (atau setiap kali data Pasca Harvest diimpor/ditambah/diedit,
   yang otomatis membatalkan cache tsb), daftar Justifikasi TCH Under 70
   SELALU ikut ter-update tanpa perlu proses sinkronisasi manual apa pun.
   Satu-satunya data yang benar-benar disimpan sendiri di sini adalah kolom
   "Keterangan" (catatan justifikasi per petak), yang disimpan di tabel
   Supabase terpisah `justifikasi_tch_keterangan` (lihat query SQL yang
   disertakan terpisah) supaya tidak perlu mengubah skema tabel
   `pasca_harvest` yang sudah ada.
   ------------------------------------------------------------------- */
const JUSTIFIKASI_TCH_TABLE = 'justifikasi_tch_keterangan';
const JUSTIFIKASI_TCH_THRESHOLD = 70;

state[JUSTIFIKASI_TCH_TABLE] = { data:[], loaded:false };
state.justifikasi_tch_under70 = {
  search:'', sortKey:'tch_nett_bapp_2026', sortDir:'asc', page:1, pageSize:14,
  filterZona:'', filterStaff:'', filterKeterangan:'', filterPanelOpen:false,
};
let justifikasiBaseRows = [];   // hasil gabungan Pasca Harvest (TCH<70) + Keterangan, dihitung ulang tiap buka menu
let justifikasiPageRows = [];   // baris yang sedang tampil di halaman aktif (dipakai referensi tombol Simpan)
let justifikasiGroupsCurrent = []; // ringkasan grup Justifikasi yang sedang tampil (dipakai referensi modal daftar petak)

async function ensureJustifikasiKeteranganData(){
  const st = state[JUSTIFIKASI_TCH_TABLE];
  if(st.loaded) return st.data;
  const { data, error } = await supa.from(JUSTIFIKASI_TCH_TABLE).select('*');
  if(error){ toast('Gagal memuat keterangan Justifikasi TCH: ' + error.message, true); return []; }
  st.data = data || [];
  st.loaded = true;
  return st.data;
}

function buildJustifikasiTCHRows(pascaRows, keteranganRows){
  const ketMap = {};
  (keteranganRows||[]).forEach(k => { ketMap[(k.petak||'').toString().trim()] = k; });
  return (pascaRows||[])
    .map(r => {
      const tch = parseTchNumber(r.tch_nett_bapp_2026);
      const ket = ketMap[(r.petak||'').toString().trim()];
      return { ...r, _tch: tch, keterangan: ket ? (ket.keterangan || '') : '' };
    })
    // TCH bernilai 0 (atau kosong) sengaja DIKECUALIKAN — biasanya berarti petak belum
    // ditebang/belum ada data BAPP, bukan TCH rendah yang butuh justifikasi.
    .filter(r => !isNaN(r._tch) && r._tch > 0 && r._tch < JUSTIFIKASI_TCH_THRESHOLD);
}

async function renderJustifikasiTCH(){
  $('#pageEyebrow').textContent = 'JUSTIFIKASI';
  $('#pageTitle').textContent = 'Justifikasi TCH Under 70';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  // Selalu ambil data Pasca Harvest & Keterangan terbaru (memakai cache masing-masing
  // yang otomatis batal setiap ada import/tambah/edit/hapus di Pasca Harvest), sehingga
  // daftar TCH Under 70 di menu ini selalu sinkron dengan data Pasca Harvest terkini.
  const [pascaRows, ketRows] = await Promise.all([
    ensureData('pasca_harvest'),
    ensureJustifikasiKeteranganData(),
  ]);
  justifikasiBaseRows = buildJustifikasiTCHRows(pascaRows, ketRows);
  paintJustifikasiTCH(justifikasiBaseRows);
}

function resetJustifikasiFilters(){
  const st = state.justifikasi_tch_under70;
  st.filterZona = ''; st.filterStaff = ''; st.filterKeterangan = ''; st.page = 1;
  paintJustifikasiTCH(justifikasiBaseRows);
}
function toggleJustifikasiFilterPanel(){
  state.justifikasi_tch_under70.filterPanelOpen = !state.justifikasi_tch_under70.filterPanelOpen;
  paintJustifikasiTCH(justifikasiBaseRows);
}
function sortJustifikasiTCH(key){
  const st = state.justifikasi_tch_under70;
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintJustifikasiTCH(justifikasiBaseRows);
}
function changeJustifikasiPage(delta){
  state.justifikasi_tch_under70.page += delta;
  paintJustifikasiTCH(justifikasiBaseRows);
}

function paintJustifikasiTCH(allRows){
  const st = state.justifikasi_tch_under70;

  const zonaOptions = uniqueValues(allRows, 'zona');
  const staffOptions = uniqueValues(allRows, 'staff');
  const filterActive = !!(st.filterZona || st.filterStaff || st.filterKeterangan);
  const filterCount = [st.filterZona, st.filterStaff, st.filterKeterangan].filter(Boolean).length;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona||'').toString().trim() === st.filterZona);
  if(st.filterStaff) rows = rows.filter(r => (r.staff||'').toString().trim() === st.filterStaff);
  if(st.filterKeterangan === 'belum') rows = rows.filter(r => !(r.keterangan||'').toString().trim());
  else if(st.filterKeterangan === 'sudah') rows = rows.filter(r => !!(r.keterangan||'').toString().trim());
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['petak','zona','staff','superitendent','varietas'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  const totalPetak = filteredRows.length;
  const totalLuas = filteredRows.reduce((s,r)=> s + (parseFloat(r.size_rkt)||0), 0);
  const avgTch = totalPetak ? (filteredRows.reduce((s,r)=> s + (isNaN(r._tch)?0:r._tch), 0) / totalPetak) : 0;
  const belumKeteranganRows = filteredRows.filter(r => !(r.keterangan||'').toString().trim());
  const sudahKeteranganRows = filteredRows.filter(r => !!(r.keterangan||'').toString().trim());
  const belumKeteranganCount = belumKeteranganRows.length;
  const belumKeteranganLuas = belumKeteranganRows.reduce((s,r)=> s + (parseFloat(r.size_rkt)||0), 0);
  const sudahKeteranganCount = sudahKeteranganRows.length;
  const sudahKeteranganLuas = sudahKeteranganRows.reduce((s,r)=> s + (parseFloat(r.size_rkt)||0), 0);

  // Ringkasan per teks Justifikasi (Keterangan): kelompokkan petak yang punya
  // teks keterangan SAMA PERSIS, jumlahkan luasnya & hitung jumlah petaknya.
  const justifikasiGroupMap = new Map();
  sudahKeteranganRows.forEach(r => {
    const key = (r.keterangan||'').toString().trim();
    if(!key) return;
    const g = justifikasiGroupMap.get(key) || { luas:0, petak:0, rows:[] };
    g.luas += parseFloat(r.size_rkt) || 0;
    g.petak += 1;
    g.rows.push(r);
    justifikasiGroupMap.set(key, g);
  });
  const justifikasiGroups = [...justifikasiGroupMap.entries()].map(([teks,g]) => ({ teks, ...g }));
  justifikasiGroupsCurrent = justifikasiGroups;
  const justifikasiGroupTotalLuas = justifikasiGroups.reduce((s,g)=> s + g.luas, 0);
  const justifikasiGroupTotalPetak = justifikasiGroups.reduce((s,g)=> s + g.petak, 0);

  rows = [...rows].sort((a,b)=>{
    let av, bv, cmp;
    if(st.sortKey === 'tch_nett_bapp_2026' || st.sortKey === 'size_rkt'){
      av = st.sortKey==='tch_nett_bapp_2026' ? a._tch : parseFloat(a.size_rkt);
      bv = st.sortKey==='tch_nett_bapp_2026' ? b._tch : parseFloat(b.size_rkt);
      const na = isNaN(av) ? -Infinity : av, nb = isNaN(bv) ? -Infinity : bv;
      cmp = na - nb;
    } else {
      av = (a[st.sortKey] ?? '').toString(); bv = (b[st.sortKey] ?? '').toString();
      cmp = av.localeCompare(bv, 'id', { numeric:true });
    }
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  justifikasiPageRows = pageRows;
  const startNo = (st.page-1)*st.pageSize;

  const sortArrow = (key) => st.sortKey===key ? (st.sortDir==='asc' ? ' ▲' : ' ▼') : '';

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-red);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted); line-height:1.6;">
        Daftar petak dari menu <b>Pasca Harvest</b> dengan <b style="color:var(--accent-red);">TCH Nett BAPP 2026 &lt; 70</b> (nilai 0/kosong tidak ditampilkan, karena biasanya berarti petak belum tebang/belum ada data BAPP).
        Daftar ini otomatis diperbarui setiap kali data Pasca Harvest diimpor/ditambah/diedit — isi kolom
        <b>Keterangan</b> di bawah untuk mencatat justifikasi/alasan rendahnya TCH pada petak tersebut.
      </div>
    </div>
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Petak Under 70', totalPetak, filterActive ? 'petak (sesuai filter)' : 'petak TCH < 70', 'var(--accent-red)', 'petak')}
      ${kpiCard('Total Luas Terkait', fmtNum(totalLuas)+' Ha', 'size RKT petak terkait', 'var(--accent-gold)', 'luas')}
      ${kpiCard('Rata-rata TCH', fmtNum(avgTch), 'ton/ha (sesuai filter)', 'var(--accent-blue)', 'progress')}
      ${kpiCard('Sudah Ada Keterangan', sudahKeteranganCount, fmtNum(sudahKeteranganLuas)+' Ha terkait', 'var(--accent-green)', 'kualitas')}
      ${kpiCard('Belum Ada Keterangan', belumKeteranganCount, fmtNum(belumKeteranganLuas)+' Ha terkait', 'var(--accent-red)', 'kualitas')}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Ringkasan Justifikasi (${justifikasiGroups.length} kategori)</span></div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>Justifikasi</th>
            <th style="text-align:right;">Luas (Ha)</th>
            <th style="text-align:right;">Jumlah Petak</th>
          </tr></thead>
          <tbody>
            ${justifikasiGroups.length===0 ? `<tr><td colspan="3"><div class="empty-state">Belum ada keterangan yang diisi.</div></td></tr>` :
              justifikasiGroups.map((g,gi) => `<tr>
                <td style="white-space:normal;">${esc(g.teks)}</td>
                <td style="text-align:right; cursor:pointer; color:var(--accent-gold); text-decoration:underline dotted;" class="font-mono" onclick="openJustifikasiGroupModal(${gi})" title="Lihat daftar petak">${fmtNum(g.luas)}</td>
                <td style="text-align:right; cursor:pointer; color:var(--accent-gold); text-decoration:underline dotted;" class="font-mono" onclick="openJustifikasiGroupModal(${gi})" title="Lihat daftar petak">${g.petak}</td>
              </tr>`).join('')}
          </tbody>
          ${justifikasiGroups.length>0 ? `<tfoot><tr style="font-weight:700; background:var(--bg-elevated);">
            <td>Grand Total</td>
            <td style="text-align:right;" class="font-mono">${fmtNum(justifikasiGroupTotalLuas)}</td>
            <td style="text-align:right;" class="font-mono">${justifikasiGroupTotalPetak}</td>
          </tr></tfoot>` : ''}
        </table>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Justifikasi TCH Under 70 (${rows.length} petak)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari petak/zona/staff…" id="searchInput_justifikasi" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="toggleJustifikasiFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetJustifikasiFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${renderExportMenu('justifikasi')}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_justifikasi">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStaff_justifikasi">
          <option value="">Staff: Semua</option>
          ${staffOptions.map(s=>`<option value="${esc(s)}" ${st.filterStaff===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKeterangan_justifikasi">
          <option value="">Keterangan: Semua</option>
          <option value="belum" ${st.filterKeterangan==='belum'?'selected':''}>Belum Ada Keterangan</option>
          <option value="sudah" ${st.filterKeterangan==='sudah'?'selected':''}>Sudah Ada Keterangan</option>
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            <th onclick="sortJustifikasiTCH('petak')">Petak${sortArrow('petak')}</th>
            <th onclick="sortJustifikasiTCH('size_rkt')">Size RKT (Ha)${sortArrow('size_rkt')}</th>
            <th onclick="sortJustifikasiTCH('varietas')">Varietas${sortArrow('varietas')}</th>
            <th onclick="sortJustifikasiTCH('zona')">Zona${sortArrow('zona')}</th>
            <th onclick="sortJustifikasiTCH('staff')">Staff${sortArrow('staff')}</th>
            <th onclick="sortJustifikasiTCH('bulan_tebang')">Bulan Tebang${sortArrow('bulan_tebang')}</th>
            <th onclick="sortJustifikasiTCH('tch_nett_bapp_2026')">TCH Nett BAPP 2026${sortArrow('tch_nett_bapp_2026')}</th>
            <th style="min-width:150px;">Keterangan</th>
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="9"><div class="empty-state">Tidak ada petak dengan TCH Nett BAPP 2026 di bawah 70.</div></td></tr>` :
              pageRows.map((r,i) => `<tr>
                <td>${startNo+i+1}</td>
                <td><span class="petak-tag">${esc(r.petak)}</span></td>
                <td>${r.size_rkt==null?'–':fmtNum(r.size_rkt)}</td>
                <td>${esc(r.varietas) || '<span style="color:var(--text-faint)">–</span>'}</td>
                <td>${esc(r.zona) || '<span style="color:var(--text-faint)">–</span>'}</td>
                <td>${esc(r.staff) || '<span style="color:var(--text-faint)">–</span>'}</td>
                <td>${esc(r.bulan_tebang) || '<span style="color:var(--text-faint)">–</span>'}</td>
                <td><span class="badge badge-notyet">${isNaN(r._tch) ? esc(r.tch_nett_bapp_2026) : fmtNum(r._tch)}</span></td>
                <td>
                  <button class="btn btn-outline btn-sm" onclick="openJustifikasiKeteranganModal(${i})">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>
                    Lihat${(r.keterangan||'').toString().trim() ? '' : ' — belum diisi'}
                  </button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? (startNo+1) : 0}–${startNo+pageRows.length} dari ${rows.length} petak</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeJustifikasiPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeJustifikasiPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  $('#searchInput_justifikasi')?.addEventListener('input', debounce(function(){
    st.search = this.value; st.page = 1; paintJustifikasiTCH(justifikasiBaseRows);
    setTimeout(()=>{ const inp = $('#searchInput_justifikasi'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));
  $('#filterZona_justifikasi')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintJustifikasiTCH(justifikasiBaseRows); });
  $('#filterStaff_justifikasi')?.addEventListener('change', function(){ st.filterStaff = this.value; st.page = 1; paintJustifikasiTCH(justifikasiBaseRows); });
  $('#filterKeterangan_justifikasi')?.addEventListener('change', function(){ st.filterKeterangan = this.value; st.page = 1; paintJustifikasiTCH(justifikasiBaseRows); });
}

function openJustifikasiKeteranganModal(i){
  const row = justifikasiPageRows[i];
  if(!row) return;
  const editable = canEditModule('justifikasi_tch_under70');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">Detail Justifikasi TCH — ${esc(row.petak)}</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid" style="margin-bottom:16px;">
          <div><label class="field-label">Petak</label><div>${esc(row.petak)}</div></div>
          <div><label class="field-label">Zona</label><div>${esc(row.zona) || '–'}</div></div>
          <div><label class="field-label">Size RKT (Ha)</label><div>${row.size_rkt==null?'–':fmtNum(row.size_rkt)}</div></div>
          <div><label class="field-label">Varietas</label><div>${esc(row.varietas) || '–'}</div></div>
          <div><label class="field-label">Staff</label><div>${esc(row.staff) || '–'}</div></div>
          <div><label class="field-label">Bulan Tebang</label><div>${esc(row.bulan_tebang) || '–'}</div></div>
          <div><label class="field-label">TCH Nett BAPP 2026</label><div><span class="badge badge-notyet">${isNaN(row._tch) ? esc(row.tch_nett_bapp_2026) : fmtNum(row._tch)}</span></div></div>
        </div>
        <label class="field-label">Keterangan / Justifikasi</label>
        ${editable
          ? `<textarea class="input chat-textarea" style="min-height:110px; resize:vertical;" id="ketModalInput" placeholder="Tulis justifikasi…">${esc(row.keterangan)}</textarea>`
          : `<div style="white-space:pre-wrap; line-height:1.6; color:var(--text-primary);">${esc(row.keterangan) || '<span style="color:var(--text-faint)">Belum ada keterangan.</span>'}</div>`}
      </div>
      ${editable ? `<div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" onclick="saveJustifikasiKeterangan(${i})">Simpan</button>
      </div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
}

function openJustifikasiGroupModal(gi){
  const group = justifikasiGroupsCurrent[gi];
  if(!group) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:760px;">
      <div class="modal-header">
        <div class="card-title">Daftar Petak — ${group.petak} petak, ${fmtNum(group.luas)} Ha</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:12.5px; color:var(--text-muted); margin:-4px 0 14px;">Justifikasi: <b style="color:var(--text-primary);">${esc(group.teks)}</b></p>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Petak</th><th>Zona</th><th style="text-align:right;">Size (Ha)</th><th>Varietas</th><th>Staff</th><th>Bulan Tebang</th><th style="text-align:right;">TCH Nett</th>
            </tr></thead>
            <tbody>
              ${group.rows.map(r => `<tr>
                <td><span class="petak-tag">${esc(r.petak)}</span></td>
                <td>${esc(r.zona) || '–'}</td>
                <td style="text-align:right;" class="font-mono">${r.size_rkt==null?'–':fmtNum(r.size_rkt)}</td>
                <td>${esc(r.varietas) || '–'}</td>
                <td>${esc(r.staff) || '–'}</td>
                <td>${esc(r.bulan_tebang) || '–'}</td>
                <td style="text-align:right;"><span class="badge badge-notyet">${isNaN(r._tch) ? esc(r.tch_nett_bapp_2026) : fmtNum(r._tch)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function saveJustifikasiKeterangan(i){
  const row = justifikasiPageRows[i];
  if(!row) return;
  const input = $('#ketModalInput');
  const value = input ? input.value.trim() : '';
  const payload = {
    petak: row.petak,
    keterangan: value || null,
    zona: row.zona || null,
    updated_by: currentUser.id,
    updated_at: new Date().toISOString(),
  };
  const existing = state[JUSTIFIKASI_TCH_TABLE].data.find(k => (k.petak||'').toString().trim() === (row.petak||'').toString().trim());
  let res;
  if(existing){
    res = await supa.from(JUSTIFIKASI_TCH_TABLE).update(payload).eq('id', existing.id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(JUSTIFIKASI_TCH_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan keterangan: ' + res.error.message, true); return; }
  toast('Keterangan berhasil disimpan');
  await logNotification({ table: JUSTIFIKASI_TCH_TABLE, action: existing ? 'edit' : 'tambah', petakList: [row.petak] });
  state[JUSTIFIKASI_TCH_TABLE].loaded = false;
  await ensureJustifikasiKeteranganData();
  row.keterangan = value; // sinkronkan cache lokal supaya tidak perlu render ulang seluruh daftar
  closeModal();
  paintJustifikasiTCH(justifikasiBaseRows);
}



/* =======================================================================
   MODUL: PRODUKTIVITAS KONTRAKTOR (berdasar sheet "Rekap WO")
   =======================================================================
   Modul ini menampilkan & mengelola data produktivitas kontraktor dengan
   struktur SEDERHANA yang mengikuti persis format file Excel acuan
   (Produktivitas_Kontraktor_Upload.xlsx, sheet "Rekap WO"):
       No | Kontraktor | Kegiatan | Luas BAPP | Ket Hasil
   Kolom "No" pada file sumber hanyalah nomor urut baris sehingga TIDAK
   disimpan sebagai data — nomor urut ditampilkan otomatis mengikuti
   urutan tabel. Tambah/lihat/edit/hapus data (CRUD) dan import/export
   XLSX pada menu ini murni mengikuti 4 kolom data: Kontraktor, Kegiatan,
   Luas BAPP, dan Ket Hasil.
   ------------------------------------------------------------------- */
const PK_TABLE = 'produktivitas_kontraktor';

const PK_COLUMNS = ['kontraktor','kegiatan_pk','luas_bapp','ket_hasil'];
const PK_LIST_COLUMNS = ['kontraktor','kegiatan_pk','luas_bapp','ket_hasil'];

state[PK_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'id', sortDir:'desc', page:1, pageSize:14,
  filterKontraktor:'', filterKegiatan:'', filterKetHasil:'', filterPanelOpen:false,
};

async function ensureProduktivitasKontraktorData(){
  const st = state[PK_TABLE];
  if(st.loaded) return st.data;
  const { data, error } = await supa.from(PK_TABLE).select('*').order('id', { ascending:true });
  if(error){ toast('Gagal memuat Produktivitas Kontraktor: ' + error.message, true); return []; }
  st.data = data || [];
  st.loaded = true;
  return st.data;
}

async function renderProduktivitasKontraktor(){
  $('#pageEyebrow').textContent = 'PRODUKTIVITAS';
  $('#pageTitle').textContent = 'Produktivitas Kontraktor';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureProduktivitasKontraktorData();
  paintProduktivitasKontraktor(rows);
}

function resetPKFilters(){
  const st = state[PK_TABLE];
  st.filterKontraktor=''; st.filterKegiatan=''; st.filterKetHasil='';
  st.page = 1;
  paintProduktivitasKontraktor(st.data);
}
function togglePKFilterPanel(){
  state[PK_TABLE].filterPanelOpen = !state[PK_TABLE].filterPanelOpen;
  paintProduktivitasKontraktor(state[PK_TABLE].data);
}
function sortPK(key){
  const st = state[PK_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintProduktivitasKontraktor(st.data);
}
function changePKPage(delta){
  state[PK_TABLE].page += delta;
  paintProduktivitasKontraktor(state[PK_TABLE].data);
}

function paintProduktivitasKontraktor(allRows){
  const st = state[PK_TABLE];

  const kontraktorOptions = uniqueValues(allRows, 'kontraktor');
  const kegiatanOptions = uniqueValues(allRows, 'kegiatan_pk');
  const ketHasilOptions = uniqueValues(allRows, 'ket_hasil');
  const filterActive = !!(st.filterKontraktor || st.filterKegiatan || st.filterKetHasil);
  const filterCount = [st.filterKontraktor, st.filterKegiatan, st.filterKetHasil].filter(Boolean).length;

  let rows = allRows;
  if(st.filterKontraktor) rows = rows.filter(r => (r.kontraktor||'').toString().trim() === st.filterKontraktor);
  if(st.filterKegiatan) rows = rows.filter(r => (r.kegiatan_pk||'').toString().trim() === st.filterKegiatan);
  if(st.filterKetHasil) rows = rows.filter(r => (r.ket_hasil||'').toString().trim() === st.filterKetHasil);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => ['kontraktor','kegiatan_pk','ket_hasil'].some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows;

  // --- KPI ---
  const totalWO = filteredRows.length;
  const totalLuasBAPP = filteredRows.reduce((s,r)=>s+(parseFloat(r.luas_bapp)||0),0);
  const kontraktorSet = new Set(filteredRows.map(r=>r.kontraktor).filter(Boolean));
  const totalLulus = filteredRows.filter(r => (r.ket_hasil||'').toString().trim().toUpperCase() === 'LULUS').length;
  const pctLulus = totalWO ? Math.round(totalLulus/totalWO*100) : 0;

  // --- Analisa Ket Hasil ---
  const ketHasilAgg = aggregateCount(filteredRows, 'ket_hasil');

  // --- Analisa Luas BAPP per Kegiatan ---
  const kegiatanAgg = {};
  filteredRows.forEach(r=>{
    const k = (r.kegiatan_pk||'(tanpa kegiatan)').toString().trim() || '(tanpa kegiatan)';
    kegiatanAgg[k] = (kegiatanAgg[k]||0) + (parseFloat(r.luas_bapp)||0);
  });
  Object.keys(kegiatanAgg).forEach(k=> kegiatanAgg[k] = Math.round(kegiatanAgg[k]*100)/100);

  // --- Analisa per Kontraktor ---
  const byKontraktor = {};
  filteredRows.forEach(r=>{
    const k = (r.kontraktor||'(tanpa kontraktor)').toString().trim() || '(tanpa kontraktor)';
    if(!byKontraktor[k]) byKontraktor[k] = { jumlahWO:0, luasBAPP:0, lulus:0, tidakLulus:0 };
    const b = byKontraktor[k];
    b.jumlahWO++;
    b.luasBAPP += (parseFloat(r.luas_bapp)||0);
    const kh = (r.ket_hasil||'').toString().trim().toUpperCase();
    if(kh === 'LULUS') b.lulus++; else if(kh) b.tidakLulus++;
  });
  const kontraktorRows = Object.entries(byKontraktor).map(([k,v])=>({
    kontraktor:k, jumlahWO:v.jumlahWO, luasBAPP:v.luasBAPP,
    lulus:v.lulus, tidakLulus:v.tidakLulus,
    pctLulus: v.jumlahWO ? Math.round(v.lulus/v.jumlahWO*100) : 0,
  })).sort((a,b)=> b.luasBAPP - a.luasBAPP);

  const luasByKontraktor = {}; kontraktorRows.forEach(r=>luasByKontraktor[r.kontraktor]=Math.round(r.luasBAPP*100)/100);
  const jumlahWOByKontraktor = {}; kontraktorRows.forEach(r=>jumlahWOByKontraktor[r.kontraktor]=r.jumlahWO);

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

  $('#pageContent').innerHTML = `
    <div class="card" style="margin-bottom:16px; border-left:3px solid var(--accent-gold);">
      <div class="card-body" style="padding:12px 18px; font-size:13px; color:var(--text-muted);">
        Data mengikuti struktur sheet <b>Rekap WO</b>: Kontraktor, Kegiatan, Luas BAPP, dan Ket Hasil.
        Tambah data, edit, hapus, serta import/export XLSX pada menu ini hanya menggunakan keempat kolom tersebut.
      </div>
    </div>

    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total WO', totalWO, filterActive ? 'WO (sesuai filter)' : 'WO tercatat', 'var(--accent-gold)', 'truk')}
      ${kpiCard('Total Luas BAPP', fmtNum(totalLuasBAPP,2)+' Ha', 'akumulasi luas terealisasi', 'var(--accent-green)', 'luas')}
      ${kpiCard('Jumlah Kontraktor', kontraktorSet.size, 'kontraktor aktif', 'var(--accent-blue)', 'staff')}
      ${kpiCard('% Lulus', pctLulus+'%', `${totalLulus} dari ${totalWO} WO Lulus`, 'var(--accent-red)', 'progress')}
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Analisa Ket Hasil (Lulus vs Tidak Lulus)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pk_kethasil"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Jumlah WO per Kontraktor</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pk_jumlahwo"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Total Luas BAPP per Kontraktor (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pk_luasbapp"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Total Luas BAPP per Kegiatan (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pk_kegiatan"></canvas></div></div></div>
    </div>

    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><span class="card-title">Analisa per Kontraktor</span></div>
      <div class="card-body" style="padding:0;">
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th>Kontraktor</th><th>Jumlah WO</th><th>Total Luas BAPP (Ha)</th><th>Lulus</th><th>Tidak Lulus</th><th>% Lulus</th>
            </tr></thead>
            <tbody>
              ${kontraktorRows.length===0 ? `<tr><td colspan="6"><div class="empty-state">Belum ada data.</div></td></tr>` :
                kontraktorRows.map(r=>`<tr>
                  <td>${esc(r.kontraktor)}</td>
                  <td>${r.jumlahWO}</td>
                  <td>${fmtNum(r.luasBAPP,2)}</td>
                  <td>${r.lulus}</td>
                  <td>${r.tidakLulus}</td>
                  <td>${badgeForStatus(r.pctLulus>=90?'Baik':(r.pctLulus>=70?'Cukup':'Kurang'))} <span style="font-family:var(--font-mono); font-size:11.5px;">${r.pctLulus}%</span></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header" style="flex-wrap:wrap; gap:10px;">
        <span class="card-title">Data WO Kontraktor (${rows.length} baris)</span>
        <input class="input" style="max-width:220px;" placeholder="Cari Kontraktor/Kegiatan…" id="searchInput_pk" value="${esc(st.search)}">
        <button class="btn btn-outline btn-sm" onclick="togglePKFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetPKFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportPK()" title="Import dari file Excel (sheet Rekap WO): Kontraktor, Kegiatan, Luas BAPP, Ket Hasil.">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX
          </button>
          <input type="file" id="importFilePK" accept=".xlsx,.xls" class="hidden" onchange="handleImportProduktivitasKontraktor(this)">
          ${renderExportMenu('pk')}` : ''}
          ${canEditModule('produktivitas_kontraktor') ? `<button class="btn btn-primary btn-sm" onclick="openPKModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKontraktor_pk">
          <option value="">Kontraktor: Semua</option>
          ${kontraktorOptions.map(k=>`<option value="${esc(k)}" ${st.filterKontraktor===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKegiatan_pk">
          <option value="">Kegiatan: Semua</option>
          ${kegiatanOptions.map(k=>`<option value="${esc(k)}" ${st.filterKegiatan===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKetHasil_pk">
          <option value="">Ket Hasil: Semua</option>
          ${ketHasilOptions.map(k=>`<option value="${esc(k)}" ${st.filterKetHasil===k?'selected':''}>${esc(k)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th>No</th>
            ${PK_LIST_COLUMNS.map(c => `<th onclick="sortPK('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${PK_LIST_COLUMNS.length+2}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map((r,i) => `<tr>
                <td>${pageStartNo + i + 1}</td>
                ${PK_LIST_COLUMNS.map(c => {
                  if(c==='ket_hasil') return `<td>${badgeForStatus(r[c])}</td>`;
                  if(c==='luas_bapp') return `<td>${r[c]==null?'–':fmtNum(r[c], 2)}</td>`;
                  return `<td>${esc(r[c]) || '<span style="color:var(--text-faint)">–</span>'}</td>`;
                }).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openPKModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('produktivitas_kontraktor') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeletePK(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changePKPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changePKPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawDonut('chart_pk_kethasil', ketHasilAgg);
  drawHBar('chart_pk_jumlahwo', jumlahWOByKontraktor);
  drawHBar('chart_pk_luasbapp', luasByKontraktor);
  drawHBar('chart_pk_kegiatan', kegiatanAgg);

  try{
    $('#searchInput_pk')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintProduktivitasKontraktor(state[PK_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_pk'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterKontraktor_pk')?.addEventListener('change', function(){ st.filterKontraktor = this.value; st.page = 1; paintProduktivitasKontraktor(st.data); });
    $('#filterKegiatan_pk')?.addEventListener('change', function(){ st.filterKegiatan = this.value; st.page = 1; paintProduktivitasKontraktor(st.data); });
    $('#filterKetHasil_pk')?.addEventListener('change', function(){ st.filterKetHasil = this.value; st.page = 1; paintProduktivitasKontraktor(st.data); });
  }catch(e){ console.error('Wiring listener Produktivitas Kontraktor gagal:', e); }
}

function openPKModal(id){
  const record = id ? state[PK_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('produktivitas_kontraktor');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — Produktivitas Kontraktor</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormPK" class="form-grid">
          ${PK_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="savePK(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function savePK(id){
  const form = $('#recordFormPK');
  const payload = {};
  PK_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.kontraktor){ toast('Kolom Kontraktor wajib diisi', true); return; }
  if(!payload.kegiatan_pk){ toast('Kolom Kegiatan wajib diisi', true); return; }
  if(payload.luas_bapp === null || payload.luas_bapp === undefined || isNaN(payload.luas_bapp)){ toast('Kolom Luas BAPP wajib diisi', true); return; }
  if(!payload.ket_hasil){ toast('Kolom Ket Hasil wajib diisi', true); return; }
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(PK_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(PK_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: PK_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.kontraktor] });
  closeModal();
  state[PK_TABLE].loaded = false;
  await ensureProduktivitasKontraktorData();
  paintProduktivitasKontraktor(state[PK_TABLE].data);
  refreshAllCounts();
}

function confirmDeletePK(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data WO akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeletePK(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeletePK(id){
  const rec = state[PK_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(PK_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: PK_TABLE, action:'hapus', petakList: [rec?.kontraktor] });
  state[PK_TABLE].loaded = false;
  await ensureProduktivitasKontraktorData();
  paintProduktivitasKontraktor(state[PK_TABLE].data);
  refreshAllCounts();
}

function triggerImportPK(){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFilePK').click();
}

// Peta header sheet "Rekap WO" (dinormalisasi: huruf kecil, tanda baca
// dihilangkan, spasi dirapikan) -> nama kolom database. Kolom "No" pada
// file sumber sengaja tidak dipetakan karena hanya nomor urut baris.
function pkNormalizeHeader(s){
  return (s ?? '').toString().trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const PK_HEADER_MAP = {
  [pkNormalizeHeader('Kontrtaktor')]: 'kontraktor', // sesuai typo asli di header file sumber
  [pkNormalizeHeader('Kontraktor')]: 'kontraktor',
  [pkNormalizeHeader('Kegiatan')]: 'kegiatan_pk',
  [pkNormalizeHeader('Luas BAPP')]: 'luas_bapp',
  [pkNormalizeHeader('Ket Hasil')]: 'ket_hasil',
};
const PK_NUMBER_COLUMNS = new Set(['luas_bapp']);

async function handleImportProduktivitasKontraktor(input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });

      // 1) Cari sheet "Rekap WO" (atau sheet manapun yang header-nya cocok
      //    dengan format sumber: Kontraktor, Kegiatan, Luas BAPP, Ket Hasil)
      let sheetName = wb.SheetNames.find(n => pkNormalizeHeader(n).includes('rekap wo'));
      let headerRowIdx = -1, ws = null;
      const candidateNames = sheetName ? [sheetName, ...wb.SheetNames] : wb.SheetNames;
      for(const name of candidateNames){
        const testWs = wb.Sheets[name];
        const raw = XLSX.utils.sheet_to_json(testWs, { header:1, blankrows:false, defval:null });
        const idx = raw.findIndex(row => {
          const norm = (row||[]).map(pkNormalizeHeader);
          return (norm.includes(pkNormalizeHeader('Kontrtaktor')) || norm.includes(pkNormalizeHeader('Kontraktor')))
              && norm.includes(pkNormalizeHeader('Luas BAPP'));
        });
        if(idx !== -1){ sheetName = name; headerRowIdx = idx; ws = testWs; break; }
      }
      if(!ws || headerRowIdx === -1){
        toast('Sheet dengan kolom Kontraktor, Kegiatan, Luas BAPP, Ket Hasil tidak ditemukan pada file ini', true);
        return;
      }

      // 2) Baca baris data memakai baris header yang ditemukan
      const json = XLSX.utils.sheet_to_json(ws, { range: headerRowIdx, defval:null });
      if(!json.length){ toast('Sheet Rekap WO kosong', true); return; }

      let skippedKontraktor = 0, skippedLuasBapp = 0;
      const payloadRows = [];
      json.forEach(row=>{
        const o = {};
        Object.keys(row).forEach(rawKey=>{
          const col = PK_HEADER_MAP[pkNormalizeHeader(rawKey)];
          if(!col) return;
          let v = row[rawKey];
          if(PK_NUMBER_COLUMNS.has(col)){
            v = (v === null || v === undefined || v.toString().trim() === '' || v.toString().trim() === '-') ? null : parseFloat(v);
          } else {
            v = (v === null || v === undefined || v.toString().trim() === '') ? null : v.toString().trim();
          }
          o[col] = v;
        });
        if(!o.kontraktor){ skippedKontraktor++; return; }
        if(o.luas_bapp === null || o.luas_bapp === undefined || isNaN(o.luas_bapp)){ skippedLuasBapp++; return; }
        o.updated_by = currentUser.id;
        payloadRows.push(o);
      });

      if(!payloadRows.length){
        toast(`Tidak ada baris valid untuk diimpor (dilewati: ${skippedKontraktor} tanpa Kontraktor, ${skippedLuasBapp} Luas BAPP kosong)`, true);
        return;
      }

      hideImportProgress(true);
      const confirmedPK = await showExcelImportPreview(payloadRows, PK_COLUMNS, { label: 'Produktivitas Kontraktor (akan mengganti data lama)' });
      if(!confirmedPK){ toast('Import dibatalkan', 'info'); return; }
      showImportProgress();

      // 3) Format sumber tidak punya kunci unik per baris (mis. No. WO), jadi
      //    tidak bisa dicocokkan baris-per-baris seperti tabel master petak.
      //    File yang diimpor dianggap SEBAGAI data yang seharusnya tampil di
      //    dashboard (bukan tambahan) — jadi data lama diganti total dengan
      //    isi file baru supaya import ulang tidak menumpuk/dobel.
      const { error: delError } = await supa.from(PK_TABLE).delete().gt('id', 0);
      if(delError){ toast('Gagal menghapus data lama sebelum impor: ' + delError.message, true); return; }

      const insertPayloads = payloadRows.map(o => ({ ...o, created_by: currentUser.id }));
      const insertResults = await Promise.all(insertPayloads.map(p => supa.from(PK_TABLE).insert(p)));
      let successInsert = 0, failedInsert = 0, insertErrorMsg = '';
      insertResults.forEach(r=>{
        if(r.error){ failedInsert++; if(!insertErrorMsg) insertErrorMsg = r.error.message; }
        else successInsert++;
      });

      if(successInsert) await logNotificationGrouped(PK_TABLE, 'import', payloadRows.slice(0, successInsert));

      let msg = '';
      if(successInsert) msg += `Data diganti dengan ${successInsert} baris WO dari file`;
      const skippedTotal = skippedKontraktor + skippedLuasBapp;
      if(skippedTotal) msg += (msg ? ', ' : '') + `${skippedTotal} baris dilewati (Kontraktor/Luas BAPP kosong)`;
      if(failedInsert) msg += (msg ? ', ' : '') + `${failedInsert} gagal ditambahkan${insertErrorMsg ? ' — ' + insertErrorMsg : ''}`;
      if(!msg) msg = 'Tidak ada data yang diproses';
      hideImportProgress(true);
      toast(msg, successInsert === 0);

      state[PK_TABLE].loaded = false;
      await ensureProduktivitasKontraktorData();
      paintProduktivitasKontraktor(state[PK_TABLE].data);
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
   12. KELOLA PENGGUNA (ADMIN)
   --------------------------------------------------------------------- */
// Menentukan apakah akun yang sedang login boleh mengganti password akun `target`.
// - admin           -> boleh untuk siapa saja.
// - manager         -> TIDAK BOLEH sama sekali (hanya lihat, tanpa tombol aksi apa pun).
// - superintendent  -> hanya akun ber-role 'supervisor'.
// - supervisor      -> hanya akun ber-role 'staff'.
// - staff           -> hanya akun milik sendiri.
// - viewer          -> tidak boleh sama sekali.
// PENTING: ini baru pembatasan di sisi tampilan. Supaya benar-benar aman,
// Edge Function `admin-users` (action update_password) juga wajib memvalidasi
// aturan yang sama di sisi server sebelum mengeksekusi perubahan password.
function canManagePassword(target){
  const role = currentProfile?.role;
  if(!role || !target) return false;
  if(role === 'admin') return true;
  if(role === 'manager') return false;
  if(role === 'superintendent') return target.role === 'supervisor';
  if(role === 'supervisor') return target.role === 'staff';
  if(role === 'staff') return target.id === currentUser.id;
  return false;
}

async function renderUsers(){
  $('#pageEyebrow').textContent = 'ADMINISTRASI';
  $('#pageTitle').textContent = 'Kelola Pengguna';
  if(!isAdminRole()){
    $('#pageContent').innerHTML = `<div class="empty-state">Halaman ini hanya dapat diakses oleh Admin.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const { data: profiles, error } = await supa.from('profiles').select('*').order('created_at', { ascending:false });
  if(error){ $('#pageContent').innerHTML = `<div class="empty-state">Gagal memuat: ${error.message}</div>`; return; }

  $('#pageContent').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Daftar Pengguna (${profiles.length})</span>
        <button class="btn btn-primary btn-sm" onclick="openCreateUserModal()">+ Tambah Pengguna</button>
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Zona</th><th>Online</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            ${profiles.map(p=>`
              <tr>
                <td>${esc(p.full_name)}</td>
                <td><span class="petak-tag">${esc((p.email||'').split('@')[0])}</span></td>
                <td>
                  <select class="input" style="padding:5px 8px; font-size:12px;" id="role_${p.id}" ${p.id===currentUser.id?'disabled':''}>
                    ${['admin','manager','superintendent','supervisor','staff','viewer'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${r}</option>`).join('')}
                  </select>
                </td>
                <td><input class="input" style="padding:5px 8px; font-size:12px; width:70px;" id="zona_${p.id}" value="${esc(p.zona)}"></td>
                <td>
                  <span class="user-online-status" id="userOnlineStatus_${p.id}">
                    <span class="online-dot" id="onlineDot_${p.id}"></span>
                    <span id="onlineLabel_${p.id}">Offline</span>
                  </span>
                </td>
                <td>
                  <label style="display:flex; align-items:center; gap:6px; font-size:12px;">
                    <input type="checkbox" id="active_${p.id}" ${p.is_active?'checked':''} ${p.id===currentUser.id?'disabled':''}> Aktif
                  </label>
                </td>
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  <button class="btn btn-primary btn-sm" onclick="saveUser('${p.id}')" ${p.id===currentUser.id?'disabled':''}>Simpan</button>
                  <button class="btn btn-outline btn-sm" onclick="startDMWith('${p.id}')" ${p.id===currentUser.id?'disabled':''}>Pesan</button>
                  <button class="btn btn-outline btn-sm" onclick="openChangePasswordModal('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}', '${p.role}')">Ubah Password</button>
                  <button class="btn btn-danger btn-sm" onclick="confirmDeleteUser('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}')" ${p.id===currentUser.id?'disabled':''}>Hapus</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <p style="color:var(--text-faint); font-size:12px; margin-top:12px;">Gunakan "Tambah Pengguna" untuk membuatkan akun baru (fitur pendaftaran mandiri sudah dinonaktifkan).</p>
  `;
  updateUsersOnlineIndicators();
}
// Riwayat akses (login) tiap akun — khusus Admin. Baris dicatat otomatis oleh
// logAccessHistory() tiap kali ada login sukses (lihat onAuthenticated()).
let logHistoryState = { search:'', page:1, pageSize:20, rows:[], tab:'akses' };
let fieldAuditState = { search:'', page:1, pageSize:20, rows:[] };
function switchLogHistoryTab(tab){ logHistoryState.tab = tab; renderLogHistory(); }
function logHistoryTabBar(){
  return `<div style="display:flex; gap:8px; padding:14px 18px 0;">
    <button class="btn btn-sm ${logHistoryState.tab==='akses' ? 'btn-primary' : 'btn-outline'}" onclick="switchLogHistoryTab('akses')">Riwayat Akses Login</button>
    <button class="btn btn-sm ${logHistoryState.tab==='audit' ? 'btn-primary' : 'btn-outline'}" onclick="switchLogHistoryTab('audit')">Riwayat Perubahan Data</button>
  </div>`;
}
async function renderLogHistory(){
  $('#pageEyebrow').textContent = 'ADMINISTRASI';
  $('#pageTitle').textContent = 'Log History';
  if(!isAdminRole()){
    $('#pageContent').innerHTML = `<div class="empty-state">Halaman ini hanya dapat diakses oleh Admin.</div>`;
    return;
  }
  $('#pageContent').innerHTML = `${logHistoryTabBar()}<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  if(logHistoryState.tab === 'audit'){
    const { data, error } = await supa.from('field_audit_log')
      .select('*').order('created_at', { ascending:false }).limit(500);
    if(error){
      $('#pageContent').innerHTML = `${logHistoryTabBar()}<div class="empty-state">Gagal memuat riwayat perubahan: ${esc(error.message)}<br><span style="font-size:12px; color:var(--text-faint);">Pastikan tabel field_audit_log sudah dibuat (lihat field_audit_log_schema.sql).</span></div>`;
      return;
    }
    fieldAuditState.rows = data || [];
    fieldAuditState.page = 1;
    drawFieldAuditTable();
    return;
  }
  const { data, error } = await supa.from('access_log')
    .select('*').order('logged_in_at', { ascending:false }).limit(500);
  if(error){
    $('#pageContent').innerHTML = `${logHistoryTabBar()}<div class="empty-state">Gagal memuat log: ${esc(error.message)}<br><span style="font-size:12px; color:var(--text-faint);">Pastikan tabel access_log sudah dibuat (lihat access_log_schema.sql).</span></div>`;
    return;
  }
  logHistoryState.rows = data || [];
  logHistoryState.page = 1;
  drawLogHistoryTable();
}
function drawFieldAuditTable(){
  const st = fieldAuditState;
  const q = st.search.trim().toLowerCase();
  const filtered = !q ? st.rows : st.rows.filter(r =>
    (r.petak||'').toLowerCase().includes(q) ||
    (r.table_name||'').toLowerCase().includes(q) ||
    (r.field_label||r.field||'').toLowerCase().includes(q) ||
    (r.changed_by_name||'').toLowerCase().includes(q));
  const totalPages = Math.max(1, Math.ceil(filtered.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = filtered.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const fmtWaktu = iso => new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  $('#pageContent').innerHTML = `
    ${logHistoryTabBar()}
    <div class="card" style="margin-top:14px;">
      <div class="card-header">
        <span class="card-title">Riwayat Perubahan Data (${filtered.length})</span>
        <input class="input" style="max-width:240px;" placeholder="Cari petak / modul / kolom / nama…" value="${esc(st.search)}" oninput="fieldAuditState.search=this.value; drawFieldAuditTable();">
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Waktu</th><th>Modul</th><th>Petak</th><th>Kolom</th><th>Dari</th><th>Jadi</th><th>Diubah Oleh</th><th>Sumber</th></tr></thead>
          <tbody>
            ${pageRows.length ? pageRows.map(r => `
              <tr>
                <td>${esc(fmtWaktu(r.created_at))}</td>
                <td>${esc(TABLES[r.table_name]?.label || r.table_name)}</td>
                <td><span class="petak-tag">${esc(r.petak || '–')}</span></td>
                <td>${esc(r.field_label || r.field)}</td>
                <td style="color:var(--accent-red-text);">${esc(r.old_value ?? '–')}</td>
                <td style="color:var(--accent-green);">${esc(r.new_value ?? '–')}</td>
                <td>${esc(r.changed_by_name || '–')}</td>
                <td><span class="status-badge">${esc({form:'Form', import:'Import XLSX', bulk_edit:'Edit Massal'}[r.source] || r.source || 'Form')}</span></td>
              </tr>
            `).join('') : `<tr><td colspan="8" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada riwayat perubahan data.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:14px 18px; border-top:1px solid var(--border-soft);">
        <span style="font-size:12px; color:var(--text-faint);">Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${filtered.length} baris</span>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="fieldAuditState.page--; drawFieldAuditTable();">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="fieldAuditState.page++; drawFieldAuditTable();">Berikutnya ›</button>
        </div>
      </div>
    </div>
    <p style="color:var(--text-faint); font-size:12px; margin-top:12px; padding:0 2px;">Menampilkan 500 perubahan data terakhir dari semua modul (Form Tambah/Edit, Import XLSX, dan Edit Massal), terbaru di atas.</p>
  `;
}
function drawLogHistoryTable(){
  const st = logHistoryState;
  const q = st.search.trim().toLowerCase();
  const filtered = !q ? st.rows : st.rows.filter(r =>
    (r.full_name||'').toLowerCase().includes(q) ||
    (r.email||'').toLowerCase().includes(q) ||
    (r.role||'').toLowerCase().includes(q));
  const totalPages = Math.max(1, Math.ceil(filtered.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = filtered.slice((st.page-1)*st.pageSize, st.page*st.pageSize);
  const fmtWaktu = iso => new Date(iso).toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const deviceLabel = ua => {
    ua = ua || '';
    if(/Mobi|Android/i.test(ua)) return 'Mobile';
    if(/Windows/i.test(ua)) return 'Windows';
    if(/Mac OS/i.test(ua)) return 'Mac';
    if(/Linux/i.test(ua)) return 'Linux';
    return 'Lainnya';
  };
  $('#pageContent').innerHTML = `
    ${logHistoryTabBar()}
    <div class="card" style="margin-top:14px;">
      <div class="card-header">
        <span class="card-title">Riwayat Akses Login (${filtered.length})</span>
        <input class="input" style="max-width:240px;" placeholder="Cari nama / username / role…" value="${esc(st.search)}" oninput="logHistoryState.search=this.value; drawLogHistoryTable();">
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Waktu Akses</th><th>Nama</th><th>Username</th><th>Role</th><th>Perangkat</th></tr></thead>
          <tbody>
            ${pageRows.length ? pageRows.map(r => `
              <tr>
                <td>${esc(fmtWaktu(r.logged_in_at))}</td>
                <td>${esc(r.full_name)}</td>
                <td><span class="petak-tag">${esc((r.email||'').split('@')[0])}</span></td>
                <td><span class="role-pill role-${esc(r.role)}">${esc(r.role)}</span></td>
                <td>${esc(deviceLabel(r.user_agent))}</td>
              </tr>
            `).join('') : `<tr><td colspan="5" style="text-align:center; color:var(--text-faint); padding:24px;">Belum ada riwayat akses.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; padding:14px 18px; border-top:1px solid var(--border-soft);">
        <span style="font-size:12px; color:var(--text-faint);">Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${filtered.length} baris</span>
        <div style="display:flex; gap:8px;">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="logHistoryState.page--; drawLogHistoryTable();">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="logHistoryState.page++; drawLogHistoryTable();">Berikutnya ›</button>
        </div>
      </div>
    </div>
    <p style="color:var(--text-faint); font-size:12px; margin-top:12px; padding:0 2px;">Menampilkan 500 akses login terakhir dari seluruh akun, terbaru di atas.</p>
  `;
}
// Tampilan Kelola Pengguna untuk role NON-Admin (Manager, Superintendent,
// Supervisor, Staff): daftar pengguna hanya untuk dilihat, tanpa bisa
// mengubah role/zona/status, tanpa tambah/hapus akun.
// - Manager: TIDAK ADA tombol aksi sama sekali (murni lihat saja).
// - Superintendent/Supervisor/Staff: tombol "Ubah Password" hanya muncul
//   untuk baris yang sesuai dengan aturan canManagePassword() di atas.
function renderUsersRestricted(profiles){
  const role = currentProfile?.role;
  const isManager = role === 'manager';
  const scopeNote = {
    manager: 'Anda hanya dapat melihat data pengguna (tanpa tombol aksi).',
    superintendent: 'Anda dapat mengubah password akun ber-role Supervisor.',
    supervisor: 'Anda dapat mengubah password akun ber-role Staff.',
    staff: 'Anda hanya dapat mengubah password akun Anda sendiri.',
  }[role] || '';
  $('#pageContent').innerHTML = `
    <div class="card">
      <div class="card-header">
        <span class="card-title">Daftar Pengguna (${profiles.length})</span>
      </div>
      <p style="color:var(--text-faint); font-size:12px; margin:-4px 0 12px;">${scopeNote}</p>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Zona</th><th>Online</th>${isManager ? '' : '<th>Aksi</th>'}</tr></thead>
          <tbody>
            ${profiles.map(p=>`
              <tr>
                <td>${esc(p.full_name)}</td>
                <td><span class="petak-tag">${esc((p.email||'').split('@')[0])}</span></td>
                <td><span class="role-pill role-${esc(p.role)}">${esc(p.role)}</span></td>
                <td>${esc(p.zona) || '-'}</td>
                <td>
                  <span class="user-online-status" id="userOnlineStatus_${p.id}">
                    <span class="online-dot" id="onlineDot_${p.id}"></span>
                    <span id="onlineLabel_${p.id}">Offline</span>
                  </span>
                </td>
                ${isManager ? '' : `
                <td style="display:flex; gap:6px; flex-wrap:wrap;">
                  ${p.id!==currentUser.id ? `<button class="btn btn-outline btn-sm" onclick="startDMWith('${p.id}')">Pesan</button>` : ''}
                  ${canManagePassword(p) ? `<button class="btn btn-outline btn-sm" onclick="openChangePasswordModal('${p.id}', '${esc(p.full_name).replace(/'/g,"\\'")}', '${p.role}')">Ubah Password</button>` : ''}
                </td>
                `}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}
async function saveUser(id){
  const role = $('#role_'+id).value;
  const zona = $('#zona_'+id).value || null;
  const is_active = $('#active_'+id).checked;
  const { error } = await supa.from('profiles').update({ role, zona, is_active }).eq('id', id);
  if(error){ toast('Gagal memperbarui pengguna: ' + error.message, true); return; }
  toast('Data pengguna diperbarui');
}

/* ---------------------------------------------------------------------
   12b. TAMBAH & HAPUS PENGGUNA (via Edge Function admin-users)
   --------------------------------------------------------------------- */
async function invokeAdminUsers(payload){
  const { data, error } = await supa.functions.invoke('admin-users', { body: payload });
  if(error){
    let msg = error.message || 'Terjadi kesalahan';
    try{ const body = await error.context.json(); if(body?.error) msg = body.error; }catch(_e){}
    return { ok:false, message: msg };
  }
  if(data?.error) return { ok:false, message: data.error };
  return { ok:true, data };
}

function openCreateUserModal(){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">Tambah Pengguna Baru</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="createUserForm" class="form-grid">
          <div><label class="field-label">Nama Lengkap</label><input class="input" name="full_name" required></div>
          <div><label class="field-label">Username</label><input class="input" name="username" pattern="[A-Za-z0-9._-]+" title="Hanya huruf, angka, titik, garis bawah, atau tanda hubung (tanpa spasi/simbol @)" required>
            <div style="font-size:10.5px; color:var(--text-faint); margin-top:4px;">Username ini yang dipakai pengguna untuk login (tanpa email).</div>
          </div>
          <div><label class="field-label">Kata Sandi (min. 6 karakter)</label><input class="input" type="password" name="password" minlength="6" required></div>
          <div><label class="field-label">Role</label>
            <select class="input" name="role">
              ${['admin','manager','superintendent','supervisor','staff','viewer'].map(r=>`<option value="${r}" ${r==='viewer'?'selected':''}>${r}</option>`).join('')}
            </select>
          </div>
          <div><label class="field-label">Zona</label><input class="input" name="zona" placeholder="A / B / C / D"></div>
        </form>
        <div id="createUserError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Batal</button>
        <button class="btn btn-primary" id="createUserBtn" onclick="submitCreateUser()">Buat Akun</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function submitCreateUser(){
  const form = $('#createUserForm');
  if(!form.reportValidity()) return;
  const btn = $('#createUserBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
  $('#createUserError').classList.add('hidden');

  const payload = {
    action: 'create',
    full_name: form.elements.full_name.value.trim(),
    email: usernameToEmail(form.elements.username.value.trim()),
    password: form.elements.password.value,
    role: form.elements.role.value,
    zona: form.elements.zona.value.trim() || null,
  };

  const res = await invokeAdminUsers(payload);
  btn.disabled = false; btn.textContent = 'Buat Akun';

  if(!res.ok){
    $('#createUserError').textContent = 'Gagal membuat pengguna: ' + res.message;
    $('#createUserError').classList.remove('hidden');
    return;
  }
  toast('Pengguna baru berhasil dibuat');
  closeModal();
  renderUsers();
}

function confirmDeleteUser(id, name){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header"><div class="card-title">Hapus Pengguna?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Akun <b>${name}</b> akan dihapus permanen — akun tidak bisa login lagi dan tindakan ini tidak bisa dibatalkan.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" id="confirmDeleteUserBtn" onclick="doDeleteUser('${id}')">Ya, Hapus Permanen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function doDeleteUser(id){
  const btn = $('#confirmDeleteUserBtn'); if(btn){ btn.disabled = true; btn.textContent = 'Menghapus…'; }
  const res = await invokeAdminUsers({ action:'delete', id });
  $('#confirmOverlay')?.remove();
  if(!res.ok){ toast('Gagal menghapus pengguna: ' + res.message, true); return; }
  toast('Pengguna berhasil dihapus permanen');
  renderUsers();
}

/* ---------------------------------------------------------------------
   12c. UBAH PASSWORD USER (via Edge Function admin-users, action:update_password)
   --------------------------------------------------------------------- */
// Menyimpan role akun target sementara modal ubah-password terbuka, supaya
// submitChangePassword() bisa memvalidasi ulang otorisasi di sisi klien
// sebelum memanggil Edge Function (pertahanan lapis kedua di UI).
let pendingPasswordChangeTarget = null;
function openChangePasswordModal(id, name, targetRole){
  pendingPasswordChangeTarget = { id, role: targetRole };
  if(!canManagePassword(pendingPasswordChangeTarget)){
    toast('Anda tidak berwenang mengubah password akun ini', true);
    return;
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'changePwOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="card-title">Ubah Password — ${esc(name)}</div>
        <button class="btn btn-outline btn-icon" onclick="closeChangePasswordModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="changePwForm" class="form-grid pw-form">
          <div>
            <label class="field-label">Password Baru</label>
            <input class="input" type="password" name="password" id="newPwInput" minlength="6" required autocomplete="new-password" placeholder="Min. 6 karakter">
          </div>
          <div>
            <label class="field-label">Ulangi Password Baru</label>
            <input class="input" type="password" name="password_confirm" id="newPwConfirmInput" minlength="6" required autocomplete="new-password" placeholder="Min. 6 karakter">
          </div>
        </form>
        <p style="font-size:11.5px; color:var(--text-faint); margin-top:10px; line-height:1.5;">Password akan diganti langsung tanpa perlu konfirmasi dari pengguna terkait. Pastikan Anda membagikan password baru ini kepada pengguna melalui jalur yang aman.</p>
        <div id="changePwError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:12px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeChangePasswordModal()">Batal</button>
        <button class="btn btn-primary" id="changePwBtn" onclick="submitChangePassword('${id}')">Simpan Password</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => $('#newPwInput')?.focus(), 50);
}

function closeChangePasswordModal(){
  $('#changePwOverlay')?.remove();
}

async function submitChangePassword(id){
  if(!canManagePassword(pendingPasswordChangeTarget) || pendingPasswordChangeTarget?.id !== id){
    toast('Anda tidak berwenang mengubah password akun ini', true);
    closeChangePasswordModal();
    return;
  }
  const form = $('#changePwForm');
  if(!form.reportValidity()) return;
  const pw = form.elements.password.value;
  const pwConfirm = form.elements.password_confirm.value;
  const errEl = $('#changePwError');
  errEl.classList.add('hidden');

  if(pw !== pwConfirm){
    errEl.textContent = 'Password baru dan konfirmasi tidak sama.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('#changePwBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  const res = await invokeAdminUsers({ action: 'update_password', id, password: pw });
  btn.disabled = false; btn.textContent = 'Simpan Password';

  if(!res.ok){
    errEl.textContent = 'Gagal mengubah password: ' + res.message;
    errEl.classList.remove('hidden');
    return;
  }
  toast('Password pengguna berhasil diubah');
  closeChangePasswordModal();
}

/* ---------------------------------------------------------------------
   12c-2. UBAH PASSWORD SENDIRI (non-Admin, dari menu Pengaturan)
   ---------------------------------------------------------------------
   Beda dari submitChangePassword() di atas (Admin/Superintendent/Supervisor
   mengganti password akun ORANG LAIN via Edge Function admin-users): ini
   akun yang sedang login mengganti password DIRINYA SENDIRI, jadi cukup
   panggil supa.auth.updateUser() langsung (bagian dari sesi Auth yang
   sedang aktif) — tidak perlu privilese admin / Edge Function.
   --------------------------------------------------------------------- */
function openOwnChangePasswordModal(){
  $('#settingsPanel')?.classList.add('hidden');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'ownChangePwOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="card-title">Ubah Password Saya</div>
        <button class="btn btn-outline btn-icon" onclick="closeOwnChangePasswordModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="ownChangePwForm" class="form-grid pw-form">
          <div>
            <label class="field-label">Password Baru</label>
            <input class="input" type="password" name="password" id="ownNewPwInput" minlength="6" required autocomplete="new-password" placeholder="Min. 6 karakter">
          </div>
          <div>
            <label class="field-label">Ulangi Password Baru</label>
            <input class="input" type="password" name="password_confirm" id="ownNewPwConfirmInput" minlength="6" required autocomplete="new-password" placeholder="Min. 6 karakter">
          </div>
        </form>
        <div id="ownChangePwError" class="hidden" style="background:var(--accent-red-soft); color:#F0A392; padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:12px;"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeOwnChangePasswordModal()">Batal</button>
        <button class="btn btn-primary" id="ownChangePwBtn" onclick="submitOwnChangePassword()">Simpan Password</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => $('#ownNewPwInput')?.focus(), 50);
}
function closeOwnChangePasswordModal(){
  $('#ownChangePwOverlay')?.remove();
}
async function submitOwnChangePassword(){
  const form = $('#ownChangePwForm');
  if(!form.reportValidity()) return;
  const pw = form.elements.password.value;
  const pwConfirm = form.elements.password_confirm.value;
  const errEl = $('#ownChangePwError');
  errEl.classList.add('hidden');

  if(pw !== pwConfirm){
    errEl.textContent = 'Password baru dan konfirmasi tidak sama.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = $('#ownChangePwBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  const { error } = await supa.auth.updateUser({ password: pw });
  btn.disabled = false; btn.textContent = 'Simpan Password';

  if(error){
    errEl.textContent = 'Gagal mengubah password: ' + error.message;
    errEl.classList.remove('hidden');
    return;
  }
  toast('Password Anda berhasil diubah');
  closeOwnChangePasswordModal();
}

/* ---------------------------------------------------------------------
   12d. PENANDA HARI & JAM REALTIME (TOPBAR)
   ---------------------------------------------------------------------
   Mengisi chip #topbarClock (lihat index.html, di dalam .topbar) dengan
   hari + tanggal + jam berjalan, format Indonesia, update tiap detik.
   Chip ini hanya tampak setelah user login (topbar ada di dalam
   #appShell), jadi cukup dijalankan sekali saat script dimuat — begitu
   appShell ditampilkan, chip otomatis sudah berjalan.
   --------------------------------------------------------------------- */
const HARI_ID = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
const BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function initRealtimeClock(){
  const dateEl = document.getElementById('topbarClockDate');
  const timeEl = document.getElementById('topbarClockTime');
  if(!dateEl || !timeEl) return; // markup topbar belum ada di halaman ini

  function tick(){
    const d = new Date();
    dateEl.textContent = `${HARI_ID[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')} ${BULAN_ID[d.getMonth()]} ${d.getFullYear()}`;
    timeEl.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }
  tick();
  setInterval(tick, 1000);
}
initRealtimeClock();

/* ---------------------------------------------------------------------
   12e. IKON CUACA (TOPBAR)
   ---------------------------------------------------------------------
   Tampil di sebelah jam/tanggal (#topbarClock). Pakai Open-Meteo (gratis,
   tanpa API key). Lokasi diambil dari geolocation browser; kalau user
   tolak/gagal, fallback ke koordinat Bandar Lampung (basis PT Pratama
   Nusantara Sakti). Update tiap 15 menit, tidak perlu tiap detik.
   --------------------------------------------------------------------- */
const WEATHER_FALLBACK_COORD = { lat: -5.45, lon: 105.27 }; // Bandar Lampung
const WEATHER_REFRESH_MS = 15 * 60 * 1000;

const WMO_ICON = {
  clearSun: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  cloud: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 2A4 4 0 0 0 6.5 19h11Z"/></svg>',
  rain: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 14a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 2A4 4 0 0 0 6.5 14h11Z"/><path d="M8 17v3M12 17v3M16 17v3"/></svg>',
  storm: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 12a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4 2A4 4 0 0 0 6.5 12h11Z"/><path d="M13 13l-3 5h3l-2 4"/></svg>',
  fog: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9h18M3 15h18"/><path d="M6 5h6M6 19h12"/></svg>'
};

function weatherCodeToIcon(code){
  if(code === 0) return WMO_ICON.clearSun;
  if([1,2,3].includes(code)) return WMO_ICON.cloud;
  if([45,48].includes(code)) return WMO_ICON.fog;
  if([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return WMO_ICON.rain;
  if([95,96,99].includes(code)) return WMO_ICON.storm;
  return WMO_ICON.cloud;
}

async function fetchAndRenderWeather(lat, lon){
  const iconEl = document.getElementById('topbarWeatherIcon');
  const tempEl = document.getElementById('topbarWeatherTemp');
  const wrapEl = document.getElementById('topbarWeather');
  if(!iconEl || !tempEl || !wrapEl) return;
  try{
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if(!res.ok) throw new Error('weather fetch gagal');
    const data = await res.json();
    const cw = data.current_weather;
    if(!cw) throw new Error('data cuaca kosong');
    iconEl.innerHTML = weatherCodeToIcon(cw.weathercode);
    tempEl.textContent = `${Math.round(cw.temperature)}°C`;
    wrapEl.classList.remove('hidden');
  }catch(err){
    wrapEl.classList.add('hidden'); // gagal ambil cuaca -> sembunyikan badge, jam tetap jalan
  }
}

function initTopbarWeather(){
  if(!document.getElementById('topbarWeather')) return;
  function loadWithCoord(lat, lon){
    fetchAndRenderWeather(lat, lon);
    setInterval(() => fetchAndRenderWeather(lat, lon), WEATHER_REFRESH_MS);
  }
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos => loadWithCoord(pos.coords.latitude, pos.coords.longitude),
      () => loadWithCoord(WEATHER_FALLBACK_COORD.lat, WEATHER_FALLBACK_COORD.lon),
      { timeout: 6000 }
    );
  } else {
    loadWithCoord(WEATHER_FALLBACK_COORD.lat, WEATHER_FALLBACK_COORD.lon);
  }
}
initTopbarWeather();

/* =======================================================================
   MODUL: MAINTENANCE (Maintenance Pasca Harvesting)
   =======================================================================
   Berdasarkan sheet "Monitoring" pada file Maintenance_Pasca_Harvesting_2026.xlsx:
     Petak | Size RKT | Plan Month Harvest | Actual Month Harvest | Status Harvest
     | Stuble Shaving | Furrowing | Mechanical Stuble Shaving | Terra Tyne | Mounding
     | Cross Drain | Field Drain | Mid Drain | Fertilizing Single Aplication
     | Pengendalian Hama Tikus | Pengendalian Hama Penyakit Tanaman
     | Post Spraying 1 | Post Spraying 2 | Post Spraying 3 | Weeding Rayutan
     | Next Action | Ket Next Status
   Dibuat sebagai modul tersendiri (bukan lewat TABLES generik) karena bentuk
   datanya (15 kolom aktivitas perawatan pasca panen per petak) berbeda dari
   modul master petak lain (tidak ada zona/superitendent/staff/status_progress).
   Fitur: CRUD penuh, Import/Export XLSX, filter Status Harvest/Next Action/
   Ket Next Status/Plan &amp; Actual Month Harvest, serta analisa (KPI + grafik
   + rekap progress per aktivitas perawatan).
   ------------------------------------------------------------------- */
const MAINTENANCE_TABLE = 'maintenance_pasca_harvest';
const MT_STATUS_OPTIONS = ['Not yet','Progress','Done'];
const MT_ACTUAL_HARVEST_OPTIONS = [...MONTHS, 'Not Yet Harvest', 'Progress Harvest'];
const MT_NEXT_ACTION_OPTIONS = ['Ratoon','Replanting Cane'];
const MT_KET_NEXT_STATUS_OPTIONS = ['Rawat','Blanking','Replanting','Extra Planting'];

Object.assign(FIELD_META, {
  mt_plan_month_harvest: { label:'Plan Month Harvest', type:'select', options:MONTHS },
  mt_actual_month_harvest: { label:'Actual Month Harvest', type:'select', options:MT_ACTUAL_HARVEST_OPTIONS },
  mt_status_harvest: { label:'Status Harvest', type:'select', options:MT_STATUS_OPTIONS, required:true },
  mt_stuble_shaving: { label:'Stuble Shaving', type:'select', options:MT_STATUS_OPTIONS },
  mt_furrowing: { label:'Furrowing', type:'select', options:MT_STATUS_OPTIONS },
  mt_mechanical_stuble_shaving: { label:'Mechanical Stuble Shaving', type:'select', options:MT_STATUS_OPTIONS },
  mt_terra_tyne: { label:'Terra Tyne', type:'select', options:MT_STATUS_OPTIONS },
  mt_mounding: { label:'Mounding', type:'select', options:MT_STATUS_OPTIONS },
  mt_cross_drain: { label:'Cross Drain', type:'select', options:MT_STATUS_OPTIONS },
  mt_field_drain: { label:'Field Drain', type:'select', options:MT_STATUS_OPTIONS },
  mt_mid_drain: { label:'Mid Drain', type:'select', options:MT_STATUS_OPTIONS },
  mt_fertilizing_single_aplication: { label:'Fertilizing Single Aplication', type:'select', options:MT_STATUS_OPTIONS },
  mt_pengendalian_hama_tikus: { label:'Pengendalian Hama Tikus', type:'select', options:MT_STATUS_OPTIONS },
  mt_pengendalian_hama_penyakit_tanaman: { label:'Pengendalian Hama Penyakit Tanaman', type:'select', options:MT_STATUS_OPTIONS },
  mt_post_spraying_1: { label:'Post Spraying 1', type:'select', options:MT_STATUS_OPTIONS },
  mt_post_spraying_2: { label:'Post Spraying 2', type:'select', options:MT_STATUS_OPTIONS },
  mt_post_spraying_3: { label:'Post Spraying 3', type:'select', options:MT_STATUS_OPTIONS },
  mt_weeding_rayutan: { label:'Weeding Rayutan', type:'select', options:MT_STATUS_OPTIONS },
  mt_next_action: { label:'Next Action', type:'select', options:MT_NEXT_ACTION_OPTIONS },
  mt_ket_next_status: { label:'Ket Next Status', type:'select', options:MT_KET_NEXT_STATUS_OPTIONS },
});

// Urutan kolom persis seperti sheet "Monitoring" (dipakai untuk form modal,
// export, dan pemetaan header saat import).
const MAINTENANCE_COLUMNS = [
  'petak','zona','size_rkt','mt_plan_month_harvest','mt_actual_month_harvest','mt_status_harvest',
  'mt_stuble_shaving','mt_furrowing','mt_mechanical_stuble_shaving','mt_terra_tyne','mt_mounding',
  'mt_cross_drain','mt_field_drain','mt_mid_drain','mt_fertilizing_single_aplication',
  'mt_pengendalian_hama_tikus','mt_pengendalian_hama_penyakit_tanaman',
  'mt_post_spraying_1','mt_post_spraying_2','mt_post_spraying_3','mt_weeding_rayutan',
  'mt_next_action','mt_ket_next_status',
];
// Kolom ringkas yang tampil di tabel daftar (kolom lainnya tetap bisa
// dilihat/diedit lewat modal "Lihat/Edit").
const MAINTENANCE_LIST_COLUMNS = ['petak','zona','size_rkt','mt_plan_month_harvest','mt_actual_month_harvest','mt_status_harvest','mt_next_action','mt_ket_next_status'];
// 15 kolom aktivitas perawatan pasca panen — dipakai untuk rekap progress.
const MAINTENANCE_ACTIVITY_FIELDS = [
  ['mt_stuble_shaving','Stuble Shaving'],
  ['mt_furrowing','Furrowing'],
  ['mt_mechanical_stuble_shaving','Mechanical Stuble Shaving'],
  ['mt_terra_tyne','Terra Tyne'],
  ['mt_mounding','Mounding'],
  ['mt_cross_drain','Cross Drain'],
  ['mt_field_drain','Field Drain'],
  ['mt_mid_drain','Mid Drain'],
  ['mt_fertilizing_single_aplication','Fertilizing Single Aplication'],
  ['mt_pengendalian_hama_tikus','Pengendalian Hama Tikus'],
  ['mt_pengendalian_hama_penyakit_tanaman','Pengendalian Hama Penyakit Tanaman'],
  ['mt_post_spraying_1','Post Spraying 1'],
  ['mt_post_spraying_2','Post Spraying 2'],
  ['mt_post_spraying_3','Post Spraying 3'],
  ['mt_weeding_rayutan','Weeding Rayutan'],
];

// Pengelompokan aktivitas perawatan menjadi 4 grafik (nilai dalam Ha, bukan jumlah petak)
const MAINTENANCE_ACTIVITY_GROUPS = [
  { key:'mekanisasi', title:'Mekanisasi', fields:['mt_stuble_shaving','mt_furrowing','mt_mechanical_stuble_shaving','mt_terra_tyne','mt_mounding'] },
  { key:'drain', title:'Drain', fields:['mt_cross_drain','mt_mid_drain','mt_field_drain'] },
  { key:'hama', title:'Hama', fields:['mt_pengendalian_hama_penyakit_tanaman','mt_pengendalian_hama_tikus'] },
  { key:'mandatory', title:'Perawatan Mandatory', fields:['mt_fertilizing_single_aplication','mt_post_spraying_1','mt_post_spraying_2','mt_post_spraying_3','mt_weeding_rayutan'] },
];

// Blok statistik Done/Progress/Not Yet per aktivitas (gaya sama seperti kartu
// "Monitoring Persiapan Lahan" di modul RPC After Giling/Extra Planting/Blanking) —
// dipakai menggantikan grafik batang di Maintenance, supaya angka per aktivitas
// langsung kebaca tanpa perlu menaksir tinggi batang.
// panelId = id unik per kartu (dipakai buat cache baris & panel detail).
// fields = kolom status per kategori (urutan sama dengan categories), dipakai saat klik angka.
// rows = baris yang dipakai buat hitung seriesMap (filteredRows aktif), di-cache ke window
// buat dibaca toggleActivityStatDetail() tanpa re-render.
// sizeField = nama kolom luas (Ha) yang ditampilkan di tabel detail (size_rkt / pr_size_rkt_2024 dst).
function activityStatGridHTML(categories, seriesMap, fields, panelId, rows, sizeField){
  if(panelId && rows){
    window.__activityDetailRows = window.__activityDetailRows || {};
    window.__activityDetailRows[panelId] = { rows, fields, sizeField };
  }
  const clickable = !!(panelId && fields);
  return `<div style="display:flex; gap:18px; flex-wrap:wrap; justify-content:space-between;">
    ${categories.map((label, i) => {
      const done = seriesMap['Done'][i] || 0;
      const progress = seriesMap['Progress'][i] || 0;
      const notYet = seriesMap['Not Yet'][i] || 0;
      const key = clickable ? fields[i] : '';
      const clickAttr = (status) => clickable ? ` cursor:pointer; text-decoration:underline dotted;" title="Klik buat lihat daftar petak" onclick="toggleActivityStatDetail('${panelId}','${key}','${esc(label)}','${status}')"` : `"`;
      return `
      <div style="flex:1; min-width:110px; text-align:center; padding:6px 4px; border-right:${i < categories.length-1 ? '1px solid var(--border-soft)' : 'none'};">
        <div style="font-weight:700; color:var(--text-primary); font-size:13px; margin-bottom:10px; letter-spacing:.3px;">${esc(label)}</div>
        <div style="font-size:10.5px; color:var(--accent-green); text-transform:uppercase; letter-spacing:.4px;">Done</div>
        <div style="font-weight:700; color:var(--accent-green); font-size:15px; margin-bottom:8px;${clickAttr('Done')}>${fmtNum(done)}</div>
        <div style="font-size:10.5px; color:var(--accent-gold); text-transform:uppercase; letter-spacing:.4px;">Progress</div>
        <div style="font-weight:700; color:var(--accent-gold); font-size:15px; margin-bottom:8px;${clickAttr('Progress')}>${fmtNum(progress)}</div>
        <div style="font-size:10.5px; color:var(--accent-red); text-transform:uppercase; letter-spacing:.4px;">Not Yet</div>
        <div style="font-weight:700; color:var(--accent-red); font-size:15px;${clickAttr('Not Yet')}>${fmtNum(notYet)}</div>
      </div>`;
    }).join('')}
  </div>${clickable ? `<div id="${panelId}_detail"></div>` : ''}`;
}
// Klik angka Done/Progress/Not Yet di kartu Grafik Mekanisasi/Drain/Hama/Mandatory
// (Maintenance) atau Persiapan Lahan/Proses Penanaman/Pemeliharaan (PC & RPC Eks Non
// RKT) -> muncul panel daftar petak (auto-hide: klik lagi angka yg sama = nutup).
function toggleActivityStatDetail(panelId, key, label, status){
  const panel = document.getElementById(`${panelId}_detail`);
  if(!panel) return;
  const cache = (window.__activityDetailRows && window.__activityDetailRows[panelId]) || { rows:[], sizeField:null };
  const thisKey = key + '|' + status;
  if(panel.dataset.openKey === thisKey){ panel.innerHTML = ''; panel.dataset.openKey = ''; return; }
  const list = cache.rows.filter(r => {
    const v = (r[key] || '').toString().trim() || 'Not Yet';
    return v.toLowerCase() === status.toLowerCase();
  });
  panel.dataset.openKey = thisKey;
  const color = status === 'Done' ? 'var(--accent-green)' : status === 'Progress' ? 'var(--accent-gold)' : 'var(--accent-red)';
  const sizeField = cache.sizeField;
  panel.innerHTML = `
    <div class="card" style="margin-top:12px; border-left:3px solid ${color};">
      <div class="card-header">
        <span class="card-title">${esc(label)} — ${esc(status)} (${list.length} petak)</span>
        <span style="cursor:pointer; font-size:12px; color:var(--text-faint);" onclick="toggleActivityStatDetail('${panelId}','${key}','${esc(label)}','${status}')">✕ Tutup</span>
      </div>
      <div class="card-body" style="padding:0; max-height:260px; overflow:auto;">
        <table class="data-table" style="font-size:12.5px;">
          <thead><tr><th>Petak</th><th>Zona</th>${sizeField ? '<th>Luas (Ha)</th>' : ''}</tr></thead>
          <tbody>
            ${list.length ? list.map(r => `<tr><td>${esc(r.petak||'-')}</td><td>${esc(r.zona||'-')}</td>${sizeField ? `<td>${fmtNum(r[sizeField]||0)}</td>` : ''}</tr>`).join('') : `<tr><td colspan="${sizeField?3:2}" style="text-align:center; color:var(--text-faint); padding:14px;">Tidak ada petak</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`;
}

// Rekap luas (Ha) per aktivitas berdasarkan status Not yet / Progress / Done
function maintenanceActivityHaByGroup(rows, fields){
  const labelOf = key => (MAINTENANCE_ACTIVITY_FIELDS.find(f => f[0]===key) || [key,key])[1];
  const categories = fields.map(labelOf);
  const notYet = [], progress = [], done = [];
  fields.forEach(key => {
    let nY=0, pR=0, dN=0;
    rows.forEach(r => {
      const v = (r[key]||'').toString().trim().toLowerCase();
      const ha = parseFloat(r.size_rkt) || 0;
      if(v==='' || v==='not yet') nY += ha;
      else if(v==='progress') pR += ha;
      else if(v==='done') dN += ha;
    });
    notYet.push(+nY.toFixed(2)); progress.push(+pR.toFixed(2)); done.push(+dN.toFixed(2));
  });
  return { categories, seriesMap: { 'Not Yet': notYet, 'Progress': progress, 'Done': done } };
}
// Total luas (Ha) per status (Done/Progress/Not Yet) untuk seluruh aktivitas dalam satu grup
function maintenanceGroupStatusTotals(rows, fields){
  let done=0, progress=0, notYet=0;
  fields.forEach(key => {
    rows.forEach(r => {
      const v = (r[key]||'').toString().trim().toLowerCase();
      const ha = parseFloat(r.size_rkt) || 0;
      if(v==='' || v==='not yet') notYet += ha;
      else if(v==='progress') progress += ha;
      else if(v==='done') done += ha;
    });
  });
  return { 'Done': +done.toFixed(2), 'Progress': +progress.toFixed(2), 'Not Yet': +notYet.toFixed(2) };
}

state[MAINTENANCE_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:14,
  filterStatusHarvest:'', filterNextAction:'', filterKetNextStatus:'', filterPlanMonth:'', filterActualMonth:'', filterZona:'', filterFertilizing:'', filterPost1:'', filterPanelOpen:false,
};

async function ensureMaintenanceData(){
  const st = state[MAINTENANCE_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(MAINTENANCE_TABLE).select('*').order('petak', { ascending:true });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat data Maintenance: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data || []);
  st.loaded = true;
  return st.data;
}

async function renderMaintenance(){
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'Maintenance';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensureMaintenanceData();
  paintMaintenance(rows);
}

function resetMaintenanceFilters(){
  const st = state[MAINTENANCE_TABLE];
  st.filterStatusHarvest=''; st.filterNextAction=''; st.filterKetNextStatus=''; st.filterPlanMonth=''; st.filterActualMonth=''; st.filterZona=''; st.filterFertilizing=''; st.filterPost1='';
  st.page = 1;
  paintMaintenance(st.data);
}
function toggleMaintenanceFilterPanel(){
  state[MAINTENANCE_TABLE].filterPanelOpen = !state[MAINTENANCE_TABLE].filterPanelOpen;
  paintMaintenance(state[MAINTENANCE_TABLE].data);
}
function sortMaintenance(key){
  const st = state[MAINTENANCE_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintMaintenance(st.data);
}
function changeMaintenancePage(delta){
  state[MAINTENANCE_TABLE].page += delta;
  paintMaintenance(state[MAINTENANCE_TABLE].data);
}

// Badge khusus untuk "Next Action": Ratoon (hijau, lanjut rawat) vs
// Replanting Cane (merah, perlu tindakan tanam ulang) — supaya lebih
// mudah dipindai daripada badge netral biasa.
function badgeForNextAction(val){
  const v = (val||'').toString().trim().toLowerCase();
  if(v === 'ratoon') return `<span class="badge badge-done">${esc(val)}</span>`;
  if(v === 'replanting cane') return `<span class="badge badge-notyet">${esc(val)}</span>`;
  if(!v) return `<span class="badge badge-neutral">–</span>`;
  return `<span class="badge badge-neutral">${esc(val)}</span>`;
}
function renderMaintenanceCell(col, val){
  if(col === 'petak') return `<span class="petak-tag">${esc(val)}</span>`;
  if(col === 'size_rkt') return val===null||val===undefined||val==='' ? '–' : fmtNum(val);
  if(col === 'mt_status_harvest') return badgeForStatus(val);
  if(col === 'mt_next_action') return badgeForNextAction(val);
  if(col === 'mt_ket_next_status') return badgeForStatus(val);
  return esc(val) || '<span style="color:var(--text-faint)">–</span>';
}
// Persentase aktivitas perawatan yang sudah "Done" untuk satu baris/petak
// (dari 15 kolom aktivitas), dipakai untuk KPI rata-rata progress.
function maintenanceRowActivityPct(r){
  const total = MAINTENANCE_ACTIVITY_FIELDS.length;
  if(!total) return 0;
  const done = MAINTENANCE_ACTIVITY_FIELDS.filter(([k]) => (r[k]||'').toString().trim().toLowerCase()==='done').length;
  return Math.round((done/total)*100);
}

function paintMaintenance(allRows){
  const st = state[MAINTENANCE_TABLE];

  const statusHarvestOptions = uniqueValues(allRows, 'mt_status_harvest');
  const nextActionOptions = uniqueValues(allRows, 'mt_next_action');
  const ketNextOptions = uniqueValues(allRows, 'mt_ket_next_status');
  const planMonthOptions = uniqueValues(allRows, 'mt_plan_month_harvest');
  const actualMonthOptions = uniqueValues(allRows, 'mt_actual_month_harvest');
  const zonaOptions = uniqueValues(allRows, 'zona');
  const fertilizingOptions = uniqueValues(allRows, 'mt_fertilizing_single_aplication');
  const post1Options = uniqueValues(allRows, 'mt_post_spraying_1');
  const filterActive = !!(st.filterStatusHarvest || st.filterNextAction || st.filterKetNextStatus || st.filterPlanMonth || st.filterActualMonth || st.filterZona || st.filterFertilizing || st.filterPost1);
  const filterCount = [st.filterStatusHarvest, st.filterNextAction, st.filterKetNextStatus, st.filterPlanMonth, st.filterActualMonth, st.filterZona, st.filterFertilizing, st.filterPost1].filter(Boolean).length;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona ?? '').toString().trim() === st.filterZona);
  if(st.filterStatusHarvest) rows = rows.filter(r => (r.mt_status_harvest ?? '').toString().trim() === st.filterStatusHarvest);
  if(st.filterNextAction) rows = rows.filter(r => (r.mt_next_action ?? '').toString().trim() === st.filterNextAction);
  if(st.filterKetNextStatus) rows = rows.filter(r => (r.mt_ket_next_status ?? '').toString().trim() === st.filterKetNextStatus);
  if(st.filterPlanMonth) rows = rows.filter(r => (r.mt_plan_month_harvest ?? '').toString().trim() === st.filterPlanMonth);
  if(st.filterActualMonth) rows = rows.filter(r => (r.mt_actual_month_harvest ?? '').toString().trim() === st.filterActualMonth);
  if(st.filterFertilizing) rows = rows.filter(r => (r.mt_fertilizing_single_aplication ?? '').toString().trim() === st.filterFertilizing);
  if(st.filterPost1) rows = rows.filter(r => (r.mt_post_spraying_1 ?? '').toString().trim() === st.filterPost1);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => MAINTENANCE_LIST_COLUMNS.some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows; // dasar untuk KPI & grafik (ikut filter & pencarian aktif)

  const totalPetak = filteredRows.length;
  const totalLuas = filteredRows.reduce((s,r)=> s + (parseFloat(r.size_rkt)||0), 0);
  const doneHarvest = filteredRows.filter(r => (r.mt_status_harvest||'').toString().trim().toLowerCase()==='done').length;
  const pctDoneHarvest = totalPetak ? Math.round((doneHarvest/totalPetak)*100) : 0;
  const ratoonCount = filteredRows.filter(r => (r.mt_next_action||'').toString().trim().toLowerCase()==='ratoon').length;
  const replantingCount = filteredRows.filter(r => (r.mt_next_action||'').toString().trim().toLowerCase()==='replanting cane').length;
  const avgActivityPct = totalPetak ? Math.round(filteredRows.reduce((s,r)=>s+maintenanceRowActivityPct(r),0)/totalPetak) : 0;

  const statusHarvestAgg = aggregateCount(filteredRows, 'mt_status_harvest');
  const nextActionAgg = aggregateCount(filteredRows, 'mt_next_action');
  const ketNextAgg = aggregateCount(filteredRows, 'mt_ket_next_status');
  const phasingAllAgg = aggregateSumByMonthToken(filteredRows, 'mt_plan_month_harvest', 'size_rkt');
  const actualAgg = aggregateSumByMonthToken(filteredRows, 'mt_actual_month_harvest', 'size_rkt');
  const monthCompareSeries = {
    'Plan Month Harvest': PHASING_CHART_MONTHS.map(m => phasingAllAgg[m] || 0),
    'Actual Month Harvest': PHASING_CHART_MONTHS.map(m => actualAgg[m] || 0),
  };

  // Rekap luas (Ha) per aktivitas perawatan, dikelompokkan jadi 4 grafik.
  // Aturan khusus grup Mekanisasi: saat filter Next Action = Ratoon, kolom
  // Furrowing tidak relevan (disembunyikan). Saat filter = Replanting Cane,
  // Stuble Shaving & Mechanical Stuble Shaving tidak relevan (disembunyikan).
  const nextActionFilterLower = (st.filterNextAction||'').trim().toLowerCase();
  const activityGroupData = MAINTENANCE_ACTIVITY_GROUPS.map(g => {
    let fields = g.fields;
    if(g.key === 'mekanisasi'){
      if(nextActionFilterLower === 'ratoon') fields = fields.filter(f => f !== 'mt_furrowing');
      else if(nextActionFilterLower === 'replanting cane') fields = fields.filter(f => f !== 'mt_stuble_shaving' && f !== 'mt_mechanical_stuble_shaving');
    }
    return { ...g, ...maintenanceActivityHaByGroup(filteredRows, fields) };
  });

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey]??''), bv = (b[st.sortKey]??'');
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Petak', totalPetak, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Total Luas', fmtNum(totalLuas)+' Ha', filterActive ? 'size RKT · sesuai filter' : 'size RKT', 'var(--accent-blue)', 'luas')}
      ${kpiCard('Progress Harvest', pctDoneHarvest+'%', `${doneHarvest} dari ${totalPetak} petak Done`, 'var(--accent-green)', 'progress')}
      ${kpiCard('Rata-rata Progress Perawatan', avgActivityPct+'%', 'rata-rata 15 aktivitas per petak', 'var(--accent-red)', 'progress')}
    </div>

    <div class="card" style="margin-top:18px; margin-bottom:16px;">
      <div class="card-body" style="display:flex; flex-direction:column; gap:12px; padding:14px 18px;">
        <span style="font-size:12px; color:var(--text-muted);">Next Action: <b style="color:var(--accent-green);">${ratoonCount} Ratoon</b> · <b style="color:var(--accent-red);">${replantingCount} Replanting Cane</b></span>
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <span style="font-size:11.5px; color:var(--text-faint); white-space:nowrap;">Filter grafik:</span>
          <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZonaTop_mt">
            <option value="">Zona: Semua</option>
            ${zonaOptions.map(z=>`<option value="${esc(z)}" ${st.filterZona===z?'selected':''}>${esc(z)}</option>`).join('')}
          </select>
          <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatusHarvestTop_mt">
            <option value="">Status Harvest: Semua</option>
            ${statusHarvestOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatusHarvest===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterNextActionTop_mt">
            <option value="">Next Action: Semua</option>
            ${nextActionOptions.map(s=>`<option value="${esc(s)}" ${st.filterNextAction===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterFertilizingTop_mt">
            <option value="">Status Fertilizing: Semua</option>
            ${fertilizingOptions.map(s=>`<option value="${esc(s)}" ${st.filterFertilizing===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
          <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterPost1Top_mt">
            <option value="">Status Post 1: Semua</option>
            ${post1Options.map(s=>`<option value="${esc(s)}" ${st.filterPost1===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Mekanisasi (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[0].categories, activityGroupData[0].seriesMap, activityGroupData[0].fields, 'mtActivity_mekanisasi', filteredRows, 'size_rkt')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Drain (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[1].categories, activityGroupData[1].seriesMap, activityGroupData[1].fields, 'mtActivity_drain', filteredRows, 'size_rkt')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Hama (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[2].categories, activityGroupData[2].seriesMap, activityGroupData[2].fields, 'mtActivity_hama', filteredRows, 'size_rkt')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Perawatan Mandatory (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[3].categories, activityGroupData[3].seriesMap, activityGroupData[3].fields, 'mtActivity_mandatory', filteredRows, 'size_rkt')}</div>
    </div>

    <div class="card">
      <div class="table-toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" placeholder="Cari petak, next action…" id="searchInput_maintenance" value="${esc(st.search)}">
        </div>
        <button class="btn ${filterActive ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="toggleMaintenanceFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetMaintenanceFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportMaintenance()" title="Baris dengan Petak yang sudah ada akan diperbarui, yang belum ada akan ditambahkan.">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX (Tambah/Update)
          </button>
          <input type="file" id="importFileMaintenance" accept=".xlsx,.xls" class="hidden" onchange="handleImportMaintenance(this)">
          ${renderExportMenu('maintenance')}` : ''}
          ${canEditModule('maintenance') ? `<button class="btn btn-primary btn-sm" onclick="openMaintenanceModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_mt">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(s=>`<option value="${esc(s)}" ${st.filterZona===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterStatusHarvest_mt">
          <option value="">Status Harvest: Semua</option>
          ${statusHarvestOptions.map(s=>`<option value="${esc(s)}" ${st.filterStatusHarvest===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterNextAction_mt">
          <option value="">Next Action: Semua</option>
          ${nextActionOptions.map(s=>`<option value="${esc(s)}" ${st.filterNextAction===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterKetNextStatus_mt">
          <option value="">Ket Next Status: Semua</option>
          ${ketNextOptions.map(s=>`<option value="${esc(s)}" ${st.filterKetNextStatus===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterPlanMonth_mt">
          <option value="">Plan Month Harvest: Semua</option>
          ${planMonthOptions.map(s=>`<option value="${esc(s)}" ${st.filterPlanMonth===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterActualMonth_mt">
          <option value="">Actual Month Harvest: Semua</option>
          ${actualMonthOptions.map(s=>`<option value="${esc(s)}" ${st.filterActualMonth===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            ${MAINTENANCE_LIST_COLUMNS.map(c => `<th onclick="sortMaintenance('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${MAINTENANCE_LIST_COLUMNS.length+1}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map(r => `<tr>
                ${MAINTENANCE_LIST_COLUMNS.map(c => `<td>${renderMaintenanceCell(c, r[c])}</td>`).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openMaintenanceModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('maintenance') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeleteMaintenance(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changeMaintenancePage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changeMaintenancePage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  $('#searchInput_maintenance')?.addEventListener('input', debounce(function(){
    st.search = this.value; st.page = 1; paintMaintenance(state[MAINTENANCE_TABLE].data);
    setTimeout(()=>{ const inp = $('#searchInput_maintenance'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
  }, 300));
  $('#filterZona_mt')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterZonaTop_mt')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterStatusHarvestTop_mt')?.addEventListener('change', function(){ st.filterStatusHarvest = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterNextActionTop_mt')?.addEventListener('change', function(){ st.filterNextAction = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterFertilizingTop_mt')?.addEventListener('change', function(){ st.filterFertilizing = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterPost1Top_mt')?.addEventListener('change', function(){ st.filterPost1 = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterStatusHarvest_mt')?.addEventListener('change', function(){ st.filterStatusHarvest = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterNextAction_mt')?.addEventListener('change', function(){ st.filterNextAction = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterKetNextStatus_mt')?.addEventListener('change', function(){ st.filterKetNextStatus = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterPlanMonth_mt')?.addEventListener('change', function(){ st.filterPlanMonth = this.value; st.page = 1; paintMaintenance(st.data); });
  $('#filterActualMonth_mt')?.addEventListener('change', function(){ st.filterActualMonth = this.value; st.page = 1; paintMaintenance(st.data); });

}

function openMaintenanceModal(id){
  const record = id ? state[MAINTENANCE_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('maintenance');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — Maintenance</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormMaintenance" class="form-grid">
          ${MAINTENANCE_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="saveMaintenance(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function saveMaintenance(id){
  const form = $('#recordFormMaintenance');
  const payload = {};
  MAINTENANCE_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.petak){ toast('Kolom Petak wajib diisi', true); return; }
  const zonaRestrict = getUserZonaRestriction();
  if(zonaRestrict) payload.zona = zonaRestrict;
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(MAINTENANCE_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(MAINTENANCE_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: MAINTENANCE_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.petak] });
  closeModal();
  state[MAINTENANCE_TABLE].loaded = false;
  await ensureMaintenanceData();
  paintMaintenance(state[MAINTENANCE_TABLE].data);
  refreshAllCounts();
}

function confirmDeleteMaintenance(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeleteMaintenance(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeleteMaintenance(id){
  const rec = state[MAINTENANCE_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(MAINTENANCE_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: MAINTENANCE_TABLE, action:'hapus', petakList: [rec?.petak] });
  state[MAINTENANCE_TABLE].loaded = false;
  await ensureMaintenanceData();
  paintMaintenance(state[MAINTENANCE_TABLE].data);
  refreshAllCounts();
}

function triggerImportMaintenance(){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFileMaintenance').click();
}
async function handleImportMaintenance(input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const normalizeHeaderKey = s => (s ?? '').toString().trim().toLowerCase().replace(/[\s_/-]+/g, '');
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });
      const petakNormKey = normalizeHeaderKey('Petak');
      let sheetName = wb.SheetNames.find(name => {
        const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, blankrows:false })[0] || [];
        return headerRow.some(h => normalizeHeaderKey(h) === petakNormKey);
      });
      if(!sheetName) sheetName = wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:null });
      if(!json.length){ toast('Sheet kosong atau format tidak dikenali', true); return; }

      // Peta nama kolom asli (persis seperti di file) berdasarkan versi
      // ternormalisasinya, dipakai sebagai fallback saat header tidak 100% sama.
      const normToRawKey = {};
      Object.keys(json[0]).forEach(k => { normToRawKey[normalizeHeaderKey(k)] = k; });
      const zonaRestrict = getUserZonaRestriction();

      const payloadRows = json.map(row=>{
        const o = {};
        MAINTENANCE_COLUMNS.forEach(c=>{
          const label = FIELD_META[c].label;
          let v;
          if(row[c] !== undefined) v = row[c];
          else if(row[label] !== undefined) v = row[label];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)];
            v = rawKey !== undefined ? row[rawKey] : null;
          }
          if(FIELD_META[c].type === 'number' && v !== null && v !== '') v = parseFloat(v);
          if(v === '') v = null;
          o[c] = v === undefined || v === null ? null : (typeof v === 'string' ? v.trim() : v);
        });
        if(zonaRestrict) o.zona = zonaRestrict;
        return o;
      }).filter(r => r.petak);

      if(!payloadRows.length){ toast('Tidak ditemukan kolom "Petak" pada file. Pastikan header sheet sama seperti sheet Monitoring.', true); return; }

      hideImportProgress(true);
      const confirmedMaint = await showExcelImportPreview(payloadRows, MAINTENANCE_COLUMNS, { label: 'Maintenance Pasca Harvesting' });
      if(!confirmedMaint){ toast('Import dibatalkan', 'info'); return; }
      showImportProgress();

      const normPetak = v => (v ?? '').toString().trim().toUpperCase();
      const existingRows = await ensureMaintenanceData();
      const existingMap = new Map();
      existingRows.forEach(r => { const key = normPetak(r.petak); if(key) existingMap.set(key, r.id); });

      const matched = [];
      const toInsert = [];
      payloadRows.forEach(o=>{
        const id = existingMap.get(normPetak(o.petak));
        if(id) matched.push({ id, payload: { ...o, updated_by: currentUser.id } });
        else toInsert.push(o);
      });

      const updateResults = matched.length ? await Promise.all(matched.map(m => supa.from(MAINTENANCE_TABLE).update(m.payload).eq('id', m.id))) : [];
      const failedUpdate = updateResults.filter(r => r.error);
      const successUpdate = matched.length - failedUpdate.length;

      let successInsert = 0, failedInsert = 0, insertErrorMsg = '';
      if(toInsert.length){
        const insertPayloads = toInsert.map(o => ({ ...o, created_by: currentUser.id, updated_by: currentUser.id }));
        const insertResults = await Promise.all(insertPayloads.map(p => supa.from(MAINTENANCE_TABLE).insert(p)));
        insertResults.forEach(r=>{
          if(r.error){ failedInsert++; if(!insertErrorMsg) insertErrorMsg = r.error.message; }
          else successInsert++;
        });
      }

      if(successUpdate) await logNotificationGrouped(MAINTENANCE_TABLE, 'import', matched.filter((_,i)=>!updateResults[i].error).map(m=>m.payload));
      if(successInsert) await logNotificationGrouped(MAINTENANCE_TABLE, 'import', toInsert);

      let msg = '';
      if(successUpdate) msg += `${successUpdate} baris diperbarui`;
      if(successInsert) msg += (msg ? ', ' : '') + `${successInsert} baris baru ditambahkan`;
      if(failedUpdate.length) msg += (msg ? ', ' : '') + `${failedUpdate.length} gagal diperbarui`;
      if(failedInsert) msg += (msg ? ', ' : '') + `${failedInsert} gagal ditambahkan${insertErrorMsg ? ' — ' + insertErrorMsg : ''}`;
      if(!msg) msg = 'Tidak ada data yang diproses';
      hideImportProgress(true);
      toast(msg, (successUpdate + successInsert) === 0);

      state[MAINTENANCE_TABLE].loaded = false;
      await ensureMaintenanceData();
      paintMaintenance(state[MAINTENANCE_TABLE].data);
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
   12b. PC & RPC EKS NON RKT (menu baru di bawah Maintenance)
   ---------------------------------------------------------------------
   Sumber data: sheet "DBASE" pada file PC_RPC_History_2026.xlsx — 18 kolom
   per petak: Petak, Zona Plantation, Size RKT, Action Plan Current
   Crop 2026, Future 2026 (PC/RPC), Phasing 2026, lalu 10 kolom status
   tahapan (LC, Furrowing, PPS1, PPS2, Planting, FSA, POST1-3, Weeding
   Rayutan), serta Schedule & % Survey Germinasi.
   Dibuat sebagai modul tersendiri (seperti Maintenance) karena bentuk
   datanya (kolom tahapan PC/RPC eks non RKT) berbeda dari modul master
   petak lain. Fitur: CRUD penuh, Import/Export XLSX (header persis sama
   seperti sheet DBASE), serta analisa (KPI + grafik interaktif per
   kelompok tahapan, komposisi PC vs RPC, dan sebaran % Germinasi).
   ------------------------------------------------------------------- */
const PC_RPC_TABLE = 'pc_rpc_eks_non_rkt';
const PR_STATUS_OPTIONS = STATUS3; // ['Not Yet','Progress','Done']
const PR_FUTURE_OPTIONS = ['PC','RPC'];
const PR_ACTION_PLAN_OPTIONS = ['New Land','RPC Eks Non RKT','RPC CF 2025'];

Object.assign(FIELD_META, {
  pr_size_rkt_2024: { label:'Size RKT', type:'number' },
  pr_action_plan: { label:'Action Plan Current Crop 2026', type:'text', list:PR_ACTION_PLAN_OPTIONS, required:true },
  pr_future: { label:'Future 2026', type:'select', options:PR_FUTURE_OPTIONS, required:true },
  pr_phasing: { label:'Phasing 2026', type:'select', options:MONTHS },
  pr_status_lc: { label:'Status LC', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_furrowing: { label:'Status Furrowing', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_pps1: { label:'Status PPS 1', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_pps2: { label:'Status PPS 2', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_planting: { label:'Status Planting', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_fsa: { label:'Status FSA', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_post1: { label:'Status POST 1', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_post2: { label:'Status POST 2', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_post3: { label:'Status POST 3', type:'select', options:PR_STATUS_OPTIONS },
  pr_status_weeding_rayutan: { label:'Status WEEDING RAYUTAN', type:'select', options:PR_STATUS_OPTIONS },
  pr_schedule_survey_germinasi: { label:'Schedule Survey Germinasi', type:'text' },
  pr_pct_germinasi: { label:'% Germinasi', type:'text' },
});

// Urutan kolom persis seperti sheet "DBASE" (dipakai untuk form modal, export,
// dan pemetaan header saat import).
const PR_COLUMNS = [
  'petak','zona','pr_size_rkt_2024','pr_action_plan','pr_future','pr_phasing',
  'pr_status_lc','pr_status_furrowing','pr_status_pps1','pr_status_pps2','pr_status_planting','pr_status_fsa',
  'pr_status_post1','pr_status_post2','pr_status_post3','pr_status_weeding_rayutan',
  'pr_schedule_survey_germinasi','pr_pct_germinasi',
];
// Kolom ringkas yang tampil di tabel daftar (kolom lainnya tetap bisa dilihat/diedit lewat modal "Lihat/Edit").
const PR_LIST_COLUMNS = ['petak','zona','pr_size_rkt_2024','pr_future','pr_action_plan','pr_phasing','pr_pct_germinasi'];
// 10 kolom status tahapan — dipakai untuk rekap progress & grafik kelompok.
const PR_ACTIVITY_FIELDS = [
  ['pr_status_lc','Status LC'],
  ['pr_status_furrowing','Status Furrowing'],
  ['pr_status_pps1','Status PPS 1'],
  ['pr_status_pps2','Status PPS 2'],
  ['pr_status_planting','Status Planting'],
  ['pr_status_fsa','Status FSA'],
  ['pr_status_post1','Status POST 1'],
  ['pr_status_post2','Status POST 2'],
  ['pr_status_post3','Status POST 3'],
  ['pr_status_weeding_rayutan','Status WEEDING RAYUTAN'],
];
// Pengelompokan tahapan menjadi 3 grafik (nilai dalam Ha, mengikuti urutan alur kerja PC/RPC)
const PR_ACTIVITY_GROUPS = [
  { key:'persiapan', title:'Persiapan Lahan', fields:['pr_status_lc','pr_status_furrowing'] },
  { key:'penanaman', title:'Proses Penanaman', fields:['pr_status_pps1','pr_status_pps2','pr_status_planting','pr_status_fsa'] },
  { key:'pemeliharaan', title:'Pemeliharaan', fields:['pr_status_post1','pr_status_post2','pr_status_post3','pr_status_weeding_rayutan'] },
];
// Header di file Excel yang beda dari label field FIELD_META (butuh alias manual saat import/export)
const PR_HEADER_ALIASES = { zona: 'Zona Plantation' };

// Rekap luas (Ha) per tahapan berdasarkan status Not Yet / Progress / Done
function prActivityHaByGroup(rows, fields){
  const labelOf = key => (PR_ACTIVITY_FIELDS.find(f => f[0]===key) || [key,key])[1];
  const categories = fields.map(labelOf);
  const notYet = [], progress = [], done = [];
  fields.forEach(key => {
    let nY=0, pR=0, dN=0;
    rows.forEach(r => {
      const v = (r[key]||'').toString().trim().toLowerCase();
      const ha = parseFloat(r.pr_size_rkt_2024) || 0;
      if(v==='' || v==='not yet') nY += ha;
      else if(v==='progress') pR += ha;
      else if(v==='done') dN += ha;
    });
    notYet.push(+nY.toFixed(2)); progress.push(+pR.toFixed(2)); done.push(+dN.toFixed(2));
  });
  return { categories, seriesMap: { 'Not Yet': notYet, 'Progress': progress, 'Done': done } };
}
// Ambil angka % germinasi dari kolom (bisa berupa "Not Yet"/teks, angka pecahan 0-1, atau angka persen 0-100)
function prGerminasiPct(r){
  const raw = r.pr_pct_germinasi;
  if(raw === null || raw === undefined || raw === '') return null;
  const n = parseFloat(raw.toString().replace(',', '.').replace('%',''));
  if(isNaN(n)) return null;
  return n <= 1 ? +(n*100).toFixed(2) : +n.toFixed(2);
}
// Kategori sebaran % germinasi untuk grafik donut (ambang umum: >=95% Baik, 80-95% Cukup, <80% Kurang)
function prGerminasiBucket(rows){
  let baik=0, cukup=0, kurang=0, belum=0;
  rows.forEach(r=>{
    const pct = prGerminasiPct(r);
    if(pct===null) belum++;
    else if(pct>=95) baik++;
    else if(pct>=80) cukup++;
    else kurang++;
  });
  const m = {};
  if(baik) m['≥95% (Baik)'] = baik;
  if(cukup) m['80–95% (Cukup)'] = cukup;
  if(kurang) m['<80% (Kurang)'] = kurang;
  if(belum) m['Belum Germinasi'] = belum;
  return m;
}

// Warna tetap untuk grafik Sebaran % Germinasi (sesuai permintaan: Baik=hijau, Cukup=kuning, Belum Germinasi=oranye)
const PR_GERMINASI_COLORS = {
  '≥95% (Baik)': '#5FAE7D',
  '80–95% (Cukup)': '#D9A94A',
  '<80% (Kurang)': '#C1543C',
  'Belum Germinasi': '#E08D3C',
};

state[PC_RPC_TABLE] = {
  data:[], loaded:false, search:'', sortKey:'petak', sortDir:'asc', page:1, pageSize:14,
  filterZona:'', filterFuture:'', filterActionPlan:'', filterPhasing:'', filterPanelOpen:false,
};

async function ensurePcRpcData(){
  const st = state[PC_RPC_TABLE];
  if(st.loaded) return st.data;
  const zonaRestrict = getUserZonaRestriction();
  let query = supa.from(PC_RPC_TABLE).select('*').order('petak', { ascending:true });
  if(zonaRestrict) query = query.ilike('zona', zonaRestrict);
  const { data, error } = await query;
  if(error){ toast('Gagal memuat data PC & RPC Eks Non RKT: ' + error.message, true); return []; }
  st.data = zonaRestrict ? (data||[]).filter(r => rowMatchesZona(r, zonaRestrict)) : (data || []);
  st.loaded = true;
  return st.data;
}

async function renderPcRpc(){
  $('#pageEyebrow').textContent = 'MENU DATA';
  $('#pageTitle').textContent = 'PC & RPC Eks Non RKT';
  $('#pageContent').innerHTML = `<div style="display:flex; justify-content:center; padding:60px;"><div class="spinner"></div></div>`;
  const rows = await ensurePcRpcData();
  paintPcRpc(rows);
}

function resetPcRpcFilters(){
  const st = state[PC_RPC_TABLE];
  st.filterZona=''; st.filterFuture=''; st.filterActionPlan=''; st.filterPhasing='';
  st.page = 1;
  paintPcRpc(st.data);
}
function togglePcRpcFilterPanel(){
  state[PC_RPC_TABLE].filterPanelOpen = !state[PC_RPC_TABLE].filterPanelOpen;
  paintPcRpc(state[PC_RPC_TABLE].data);
}
function sortPcRpc(key){
  const st = state[PC_RPC_TABLE];
  if(st.sortKey === key) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc';
  else { st.sortKey = key; st.sortDir = 'asc'; }
  paintPcRpc(st.data);
}
function changePcRpcPage(delta){
  state[PC_RPC_TABLE].page += delta;
  paintPcRpc(state[PC_RPC_TABLE].data);
}
// Badge khusus "Future 2026": PC (biru) vs RPC (emas) — supaya lebih mudah dipindai
function badgeForFuture(val){
  const v = (val||'').toString().trim().toUpperCase();
  if(v === 'PC') return `<span class="badge" style="background:rgba(91,143,168,.16); color:var(--accent-blue);">${esc(val)}</span>`;
  if(v === 'RPC') return `<span class="badge" style="background:rgba(217,169,74,.16); color:var(--accent-gold);">${esc(val)}</span>`;
  if(!v) return `<span class="badge badge-neutral">–</span>`;
  return `<span class="badge badge-neutral">${esc(val)}</span>`;
}
function renderPcRpcCell(col, val, row){
  if(col === 'petak') return `<span class="petak-tag">${esc(val)}</span>`;
  if(col === 'pr_size_rkt_2024') return val===null||val===undefined||val==='' ? '–' : fmtNum(val);
  if(col === 'pr_future') return badgeForFuture(val);
  if(col === 'pr_pct_germinasi'){ const pct = prGerminasiPct(row); return pct===null ? (esc(val)||'–') : fmtNum(pct,2)+'%'; }
  return esc(val) || '<span style="color:var(--text-faint)">–</span>';
}
// Persentase tahapan yang sudah "Done" untuk satu baris/petak (dari 10 kolom status)
function prRowActivityPct(r){
  const total = PR_ACTIVITY_FIELDS.length;
  if(!total) return 0;
  const done = PR_ACTIVITY_FIELDS.filter(([k]) => (r[k]||'').toString().trim().toLowerCase()==='done').length;
  return Math.round((done/total)*100);
}

function paintPcRpc(allRows){
  const st = state[PC_RPC_TABLE];

  const zonaOptions = uniqueValues(allRows, 'zona');
  const futureOptions = uniqueValues(allRows, 'pr_future');
  const actionPlanOptions = uniqueValues(allRows, 'pr_action_plan');
  const phasingOptions = uniqueValues(allRows, 'pr_phasing');
  const filterActive = !!(st.filterZona || st.filterFuture || st.filterActionPlan || st.filterPhasing);
  const filterCount = [st.filterZona, st.filterFuture, st.filterActionPlan, st.filterPhasing].filter(Boolean).length;

  let rows = allRows;
  if(st.filterZona) rows = rows.filter(r => (r.zona ?? '').toString().trim() === st.filterZona);
  if(st.filterFuture) rows = rows.filter(r => (r.pr_future ?? '').toString().trim() === st.filterFuture);
  if(st.filterActionPlan) rows = rows.filter(r => (r.pr_action_plan ?? '').toString().trim() === st.filterActionPlan);
  if(st.filterPhasing) rows = rows.filter(r => (r.pr_phasing ?? '').toString().trim() === st.filterPhasing);
  if(st.search){
    const q = st.search.toLowerCase();
    rows = rows.filter(r => PR_LIST_COLUMNS.some(c => (r[c]??'').toString().toLowerCase().includes(q)));
  }
  const filteredRows = rows; // dasar untuk KPI & grafik (ikut filter & pencarian aktif)

  const totalPetak = filteredRows.length;
  const totalLuas = filteredRows.reduce((s,r)=> s + (parseFloat(r.pr_size_rkt_2024)||0), 0);
  const pcCount = filteredRows.filter(r => (r.pr_future||'').toString().trim().toUpperCase()==='PC').length;
  const rpcCount = filteredRows.filter(r => (r.pr_future||'').toString().trim().toUpperCase()==='RPC').length;
  const avgActivityPct = totalPetak ? Math.round(filteredRows.reduce((s,r)=>s+prRowActivityPct(r),0)/totalPetak) : 0;
  const germinasiVals = filteredRows.map(prGerminasiPct).filter(v=>v!==null);
  const avgGerminasi = germinasiVals.length ? +(germinasiVals.reduce((a,b)=>a+b,0)/germinasiVals.length).toFixed(1) : null;

  const futureAgg = aggregateSum(filteredRows, 'pr_future', 'pr_size_rkt_2024');
  const actionPlanAgg = aggregateCount(filteredRows, 'pr_action_plan');
  const phasingAgg = aggregateSumByMonthToken(filteredRows, 'pr_phasing', 'pr_size_rkt_2024');
  const germinasiBucketAgg = prGerminasiBucket(filteredRows);

  // Rekap luas (Ha) per tahapan, dikelompokkan jadi 4 grafik
  const activityGroupData = PR_ACTIVITY_GROUPS.map(g => ({
    ...g,
    ...prActivityHaByGroup(filteredRows, g.fields),
  }));

  rows = [...rows].sort((a,b)=>{
    const av = (a[st.sortKey]??''), bv = (b[st.sortKey]??'');
    const na = parseFloat(av), nb = parseFloat(bv);
    let cmp;
    if(!isNaN(na) && !isNaN(nb) && av!=='' && bv!=='') cmp = na-nb;
    else cmp = av.toString().localeCompare(bv.toString());
    return st.sortDir==='asc' ? cmp : -cmp;
  });
  const totalPages = Math.max(1, Math.ceil(rows.length / st.pageSize));
  st.page = Math.min(st.page, totalPages);
  const pageRows = rows.slice((st.page-1)*st.pageSize, st.page*st.pageSize);

  $('#pageContent').innerHTML = `
    <div class="kpi-grid anim-stagger">
      ${kpiCard('Total Petak', totalPetak, filterActive ? 'baris data (sesuai filter)' : 'baris data', 'var(--accent-gold)', 'petak')}
      ${kpiCard('Total Luas', fmtNum(totalLuas)+' Ha', filterActive ? 'Size RKT · sesuai filter' : 'Size RKT', 'var(--accent-blue)', 'luas')}
      ${kpiCard('Rata-rata Progress Tahapan', avgActivityPct+'%', 'rata-rata 10 tahapan per petak', 'var(--accent-green)', 'progress')}
      ${kpiCard('Rata-rata % Germinasi', avgGerminasi===null ? '–' : avgGerminasi+'%', germinasiVals.length+' petak sudah disurvei', 'var(--accent-red)', 'progress')}
    </div>

    <div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="display:flex; align-items:center; gap:16px; padding:12px 18px; flex-wrap:wrap;">
        <span style="font-size:12px; color:var(--text-muted);">Future 2026: <b style="color:var(--accent-blue);">${pcCount} PC</b> · <b style="color:var(--accent-gold);">${rpcCount} RPC</b></span>
      </div>
    </div>

    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Komposisi Luas PC vs RPC (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pr_future"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Action Plan Current Crop 2026 (Jumlah Petak)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pr_action_plan"></canvas></div></div></div>
    </div>
    <div class="chart-grid">
      <div class="card"><div class="card-header"><span class="card-title">Phasing 2026 per Bulan (Ha)</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pr_phasing"></canvas></div></div></div>
      <div class="card"><div class="card-header"><span class="card-title">Sebaran % Germinasi</span></div>
        <div class="card-body"><div class="chart-box"><canvas id="chart_pr_germinasi"></canvas></div></div></div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Persiapan Lahan (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[0].categories, activityGroupData[0].seriesMap, activityGroupData[0].fields, 'prActivity_persiapan', filteredRows, 'pr_size_rkt_2024')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Proses Penanaman (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[1].categories, activityGroupData[1].seriesMap, activityGroupData[1].fields, 'prActivity_penanaman', filteredRows, 'pr_size_rkt_2024')}</div>
    </div>
    <div class="card" style="margin-bottom:16px;">
      <div class="card-header"><span class="card-title">Grafik Pemeliharaan (Ha)</span></div>
      <div class="card-body">${activityStatGridHTML(activityGroupData[2].categories, activityGroupData[2].seriesMap, activityGroupData[2].fields, 'prActivity_pemeliharaan', filteredRows, 'pr_size_rkt_2024')}</div>
    </div>

    <div class="card">
      <div class="table-toolbar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input class="input" placeholder="Cari petak, zona, action plan…" id="searchInput_pcrpc" value="${esc(st.search)}">
        </div>
        <button class="btn ${filterActive ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="togglePcRpcFilterPanel()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M7 12h10M10 18h4"/></svg>
          Filter${filterCount ? ` (${filterCount})` : ''}
        </button>
        ${filterActive ? `<button class="btn btn-outline btn-sm" onclick="resetPcRpcFilters()" title="Hapus semua filter">✕</button>` : ''}
        <div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">
          ${isAdminRole() ? `
          <button class="btn btn-outline btn-sm" onclick="triggerImportPcRpc()" title="Baris dengan Petak yang sudah ada akan diperbarui, yang belum ada akan ditambahkan.">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"/></svg>
            Import XLSX (Tambah/Update)
          </button>
          <input type="file" id="importFilePcRpc" accept=".xlsx,.xls" class="hidden" onchange="handleImportPcRpc(this)">
          ${renderExportMenu('pcrpc')}` : ''}
          ${canEditModule('pc_rpc_eks_non_rkt') ? `<button class="btn btn-primary btn-sm" onclick="openPcRpcModal()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Tambah Data
          </button>` : ''}
        </div>
      </div>
      ${st.filterPanelOpen ? `
      <div class="filter-panel-row" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center; padding:12px 18px 14px; border-bottom:1px solid var(--border-soft);">
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterZona_pr">
          <option value="">Zona: Semua</option>
          ${zonaOptions.map(s=>`<option value="${esc(s)}" ${st.filterZona===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterFuture_pr">
          <option value="">Future 2026: Semua</option>
          ${futureOptions.map(s=>`<option value="${esc(s)}" ${st.filterFuture===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterActionPlan_pr">
          <option value="">Action Plan: Semua</option>
          ${actionPlanOptions.map(s=>`<option value="${esc(s)}" ${st.filterActionPlan===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
        <select class="input filter-select" style="padding:6px 9px; font-size:12px; min-width:150px; max-width:230px; background:var(--bg-elevated); border:1px solid var(--border-soft); color:var(--text-primary); border-radius:8px; outline:none;" id="filterPhasing_pr">
          <option value="">Phasing 2026: Semua</option>
          ${phasingOptions.map(s=>`<option value="${esc(s)}" ${st.filterPhasing===s?'selected':''}>${esc(s)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            ${PR_LIST_COLUMNS.map(c => `<th onclick="sortPcRpc('${c}')">${FIELD_META[c].label}${st.sortKey===c ? (st.sortDir==='asc'?' ▲':' ▼') : ''}</th>`).join('')}
            ${currentProfile?.role !== 'manager' ? '<th>Aksi</th>' : ''}
          </tr></thead>
          <tbody>
            ${pageRows.length===0 ? `<tr><td colspan="${PR_LIST_COLUMNS.length+1}"><div class="empty-state">Tidak ada data yang cocok.</div></td></tr>` :
              pageRows.map(r => `<tr>
                ${PR_LIST_COLUMNS.map(c => `<td>${renderPcRpcCell(c, r[c], r)}</td>`).join('')}
                <td>
                  <div style="display:flex; gap:6px;">
                    ${currentProfile?.role !== 'manager' ? `<button class="btn btn-outline btn-sm" onclick="openPcRpcModal(${r.id})">Lihat/Edit</button>` : ''}
                    ${canDeleteModule('pc_rpc_eks_non_rkt') ? `<button class="btn btn-danger btn-sm" onclick="confirmDeletePcRpc(${r.id})">Hapus</button>` : ''}
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <span>Menampilkan ${pageRows.length ? ((st.page-1)*st.pageSize+1) : 0}–${(st.page-1)*st.pageSize+pageRows.length} dari ${rows.length} baris</span>
        <div class="page-btns">
          <button class="btn btn-outline btn-sm" ${st.page<=1?'disabled':''} onclick="changePcRpcPage(-1)">‹ Sebelumnya</button>
          <button class="btn btn-outline btn-sm" ${st.page>=totalPages?'disabled':''} onclick="changePcRpcPage(1)">Berikutnya ›</button>
        </div>
      </div>
    </div>
  `;

  drawDonut('chart_pr_future', futureAgg, false);
  drawCategoryProgressBar('chart_pr_action_plan', actionPlanAgg, PR_ACTION_PLAN_OPTIONS);
  drawBar('chart_pr_phasing', Object.fromEntries(PHASING_CHART_MONTHS.map(m=>[m, +(phasingAgg[m]||0).toFixed(2)])));
  if(Object.keys(germinasiBucketAgg).length) drawDonut('chart_pr_germinasi', germinasiBucketAgg, false, PR_GERMINASI_COLORS);
  else destroyChart('chart_pr_germinasi');

  try{
    $('#searchInput_pcrpc')?.addEventListener('input', debounce(function(){
      st.search = this.value; st.page = 1; paintPcRpc(state[PC_RPC_TABLE].data);
      setTimeout(()=>{ const inp = $('#searchInput_pcrpc'); if(inp){ inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }, 0);
    }, 300));
    $('#filterZona_pr')?.addEventListener('change', function(){ st.filterZona = this.value; st.page = 1; paintPcRpc(st.data); });
    $('#filterFuture_pr')?.addEventListener('change', function(){ st.filterFuture = this.value; st.page = 1; paintPcRpc(st.data); });
    $('#filterActionPlan_pr')?.addEventListener('change', function(){ st.filterActionPlan = this.value; st.page = 1; paintPcRpc(st.data); });
    $('#filterPhasing_pr')?.addEventListener('change', function(){ st.filterPhasing = this.value; st.page = 1; paintPcRpc(st.data); });
  }catch(e){ console.error('Wiring listener PC/RPC gagal:', e); }
}

function openPcRpcModal(id){
  const record = id ? state[PC_RPC_TABLE].data.find(r=>r.id===id) : null;
  const readonly = !canEditModule('pc_rpc_eks_non_rkt');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modalOverlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <div class="card-title">${record ? 'Detail / Edit Data' : 'Tambah Data Baru'} — PC & RPC Eks Non RKT</div>
        <button class="btn btn-outline btn-icon" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <form id="recordFormPcRpc" class="form-grid">
          ${PR_COLUMNS.map(col => fieldHTML(col, record ? record[col] : '', readonly)).join('')}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeModal()">Tutup</button>
        ${!readonly ? `<button class="btn btn-primary" onclick="savePcRpc(${record ? record.id : 'null'})">Simpan Data</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function savePcRpc(id){
  const form = $('#recordFormPcRpc');
  const payload = {};
  PR_COLUMNS.forEach(col=>{
    const el = form.elements[col];
    let v = el.value;
    if(FIELD_META[col].type === 'number') v = v === '' ? null : parseFloat(v);
    else v = v === '' ? null : v;
    payload[col] = v;
  });
  if(!payload.petak){ toast('Kolom Petak wajib diisi', true); return; }
  const zonaRestrict = getUserZonaRestriction();
  if(zonaRestrict) payload.zona = zonaRestrict;
  payload.updated_by = currentUser.id;
  let res;
  if(id){
    res = await supa.from(PC_RPC_TABLE).update(payload).eq('id', id).select();
  } else {
    payload.created_by = currentUser.id;
    res = await supa.from(PC_RPC_TABLE).insert(payload).select();
  }
  if(res.error){ toast('Gagal menyimpan: ' + res.error.message, true); return; }
  toast(id ? 'Data berhasil diperbarui' : 'Data baru berhasil ditambahkan');
  await logNotification({ table: PC_RPC_TABLE, action: id ? 'edit' : 'tambah', petakList: [payload.petak], zona: payload.zona });
  closeModal();
  state[PC_RPC_TABLE].loaded = false;
  await ensurePcRpcData();
  paintPcRpc(state[PC_RPC_TABLE].data);
  refreshAllCounts();
}

function confirmDeletePcRpc(id){
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'confirmOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-header"><div class="card-title">Hapus Data?</div></div>
      <div class="modal-body"><p style="color:var(--text-muted); font-size:13.5px;">Tindakan ini tidak bisa dibatalkan. Baris data akan dihapus permanen dari database.</p></div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="document.getElementById('confirmOverlay').remove()">Batal</button>
        <button class="btn btn-danger" onclick="doDeletePcRpc(${id})">Ya, Hapus</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
async function doDeletePcRpc(id){
  const rec = state[PC_RPC_TABLE].data.find(r => r.id === id);
  const { error } = await supa.from(PC_RPC_TABLE).delete().eq('id', id);
  $('#confirmOverlay')?.remove();
  if(error){ toast('Gagal menghapus: ' + error.message, true); return; }
  toast('Data berhasil dihapus');
  await logNotification({ table: PC_RPC_TABLE, action:'hapus', petakList: [rec?.petak], zona: rec?.zona });
  state[PC_RPC_TABLE].loaded = false;
  await ensurePcRpcData();
  paintPcRpc(state[PC_RPC_TABLE].data);
  refreshAllCounts();
}

function triggerImportPcRpc(){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); return; }
  $('#importFilePcRpc').click();
}
async function handleImportPcRpc(input){
  if(!isAdminRole()){ toast('Hanya Admin yang dapat mengimpor data', true); input.value=''; return; }
  const file = input.files[0]; if(!file) return;
  showImportProgress();
  const normalizeHeaderKey = s => (s ?? '').toString().trim().toLowerCase().replace(/[\s_/-]+/g, '');
  const reader = new FileReader();
  reader.onprogress = (ev)=>{ if(ev.lengthComputable) setImportProgress((ev.loaded/ev.total)*40, 'Membaca file…'); };
  reader.onload = async (e)=>{
    try{
      setImportProgress(45, 'Menyimpan data…');
      const wb = XLSX.read(e.target.result, { type:'array' });
      const petakNormKey = normalizeHeaderKey('Petak');
      let sheetName = wb.SheetNames.find(name => {
        const headerRow = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, blankrows:false })[0] || [];
        return headerRow.some(h => normalizeHeaderKey(h) === petakNormKey);
      });
      if(!sheetName) sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'dbase') || wb.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval:null });
      if(!json.length){ toast('Sheet kosong atau format tidak dikenali', true); return; }

      // Peta nama kolom asli (persis seperti di file) berdasarkan versi
      // ternormalisasinya, dipakai sebagai fallback saat header tidak 100% sama.
      const normToRawKey = {};
      Object.keys(json[0]).forEach(k => { normToRawKey[normalizeHeaderKey(k)] = k; });
      const zonaRestrict = getUserZonaRestriction();

      const payloadRows = json.map(row=>{
        const o = {};
        PR_COLUMNS.forEach(c=>{
          const label = FIELD_META[c].label;
          const alias = PR_HEADER_ALIASES[c];
          let v;
          if(row[c] !== undefined) v = row[c];
          else if(row[label] !== undefined) v = row[label];
          else if(alias !== undefined && row[alias] !== undefined) v = row[alias];
          else {
            const rawKey = normToRawKey[normalizeHeaderKey(c)] ?? normToRawKey[normalizeHeaderKey(label)] ?? (alias ? normToRawKey[normalizeHeaderKey(alias)] : undefined);
            v = rawKey !== undefined ? row[rawKey] : null;
          }
          if(c === 'pr_schedule_survey_germinasi' && v !== null && v !== ''){
            v = (typeof v === 'number' || v instanceof Date) ? excelSerialToISODate(v) : v.toString().trim();
          } else if(c === 'pr_pct_germinasi' && v !== null && v !== ''){
            const n = parseFloat(v);
            v = !isNaN(n) ? (n <= 1 ? +(n*100).toFixed(2) : +n.toFixed(2)) : v.toString().trim();
          } else if(FIELD_META[c].type === 'number' && v !== null && v !== '') v = parseFloat(v);
          if(v === '') v = null;
          o[c] = v === undefined || v === null ? null : (typeof v === 'string' ? v.trim() : v);
        });
        if(zonaRestrict) o.zona = zonaRestrict;
        return o;
      }).filter(r => r.petak);

      if(!payloadRows.length){ toast('Tidak ditemukan kolom "Petak" pada file. Pastikan header sheet sama seperti sheet DBASE.', true); return; }

      hideImportProgress(true);
      const confirmedPR = await showExcelImportPreview(payloadRows, PR_COLUMNS, { label: 'PC / RPC History' });
      if(!confirmedPR){ toast('Import dibatalkan', 'info'); return; }
      showImportProgress();

      const normPetak = v => (v ?? '').toString().trim().toUpperCase();
      const existingRows = await ensurePcRpcData();
      const existingMap = new Map();
      existingRows.forEach(r => { const key = normPetak(r.petak); if(key) existingMap.set(key, r.id); });

      const matched = [];
      const toInsert = [];
      payloadRows.forEach(o=>{
        const id = existingMap.get(normPetak(o.petak));
        if(id) matched.push({ id, payload: { ...o, updated_by: currentUser.id } });
        else toInsert.push(o);
      });

      const updateResults = matched.length ? await Promise.all(matched.map(m => supa.from(PC_RPC_TABLE).update(m.payload).eq('id', m.id))) : [];
      const failedUpdate = updateResults.filter(r => r.error);
      const successUpdate = matched.length - failedUpdate.length;

      let successInsert = 0, failedInsert = 0, insertErrorMsg = '';
      if(toInsert.length){
        const insertPayloads = toInsert.map(o => ({ ...o, created_by: currentUser.id, updated_by: currentUser.id }));
        const insertResults = await Promise.all(insertPayloads.map(p => supa.from(PC_RPC_TABLE).insert(p)));
        insertResults.forEach(r=>{
          if(r.error){ failedInsert++; if(!insertErrorMsg) insertErrorMsg = r.error.message; }
          else successInsert++;
        });
      }

      if(successUpdate) await logNotificationGrouped(PC_RPC_TABLE, 'import', matched.filter((_,i)=>!updateResults[i].error).map(m=>m.payload));
      if(successInsert) await logNotificationGrouped(PC_RPC_TABLE, 'import', toInsert);

      let msg = '';
      if(successUpdate) msg += `${successUpdate} baris diperbarui`;
      if(successInsert) msg += (msg ? ', ' : '') + `${successInsert} baris baru ditambahkan`;
      if(failedUpdate.length) msg += (msg ? ', ' : '') + `${failedUpdate.length} gagal diperbarui`;
      if(failedInsert) msg += (msg ? ', ' : '') + `${failedInsert} gagal ditambahkan${insertErrorMsg ? ' — ' + insertErrorMsg : ''}`;
      if(!msg) msg = 'Tidak ada data yang diproses';
      hideImportProgress(true);
      toast(msg, (successUpdate + successInsert) === 0);

      state[PC_RPC_TABLE].loaded = false;
      await ensurePcRpcData();
      paintPcRpc(state[PC_RPC_TABLE].data);
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
   13. BOOTSTRAP
   --------------------------------------------------------------------- */
async function bootstrap(){
  const configured = window.SUPABASE_CONFIG.url.includes('supabase.co') && !window.SUPABASE_CONFIG.url.includes('GANTI');
  const { data:{ session } } = await supa.auth.getSession();
  $('#loadingOverlay').classList.add('hidden');
  if(!configured){
    document.body.innerHTML = `<div class="login-wrap"><div class="login-card" style="max-width:520px;">
      <div class="cane-mark"><div class="stalks"><i></i><i></i><i></i><i></i></div>
      <div class="font-display" style="font-size:18px; font-weight:700;">Konfigurasi Diperlukan</div></div>
      <p style="color:var(--text-muted); font-size:13.5px; line-height:1.6;">Aplikasi belum terhubung ke Supabase. Buka file <code style="color:var(--accent-gold)">config.js</code>, isi <code>url</code> dan <code>anonKey</code> proyek Supabase Anda, lalu muat ulang halaman ini. Jangan lupa jalankan <code>supabase_schema.sql</code> di SQL Editor Supabase terlebih dahulu.</p>
    </div></div>`;
    return;
  }
  if(session){
    await onAuthenticated(session.user);
  } else {
    $('#loginView').classList.remove('hidden');
  }
  supa.auth.onAuthStateChange((event, s)=>{
    if(event === 'SIGNED_OUT'){
      $('#appShell').classList.add('hidden');
      $('#loginView').classList.remove('hidden');
    }
  });
}
bootstrap();

// animasi pop tiap logo/icon di-klik (delegasi event, kena semua .brand-logo & svg icon termasuk yang muncul belakangan)
document.addEventListener('click', (e)=>{
  const target = e.target.closest('.brand-logo, .brand-logo-lg, svg');
  if(!target) return;
  const cls = target.tagName.toLowerCase() === 'svg' ? 'icon-clicked' : 'logo-clicked';
  target.classList.remove(cls);
  void target.getBBox ? target.getBBox() : target.offsetWidth; // reflow biar animasi bisa retrigger kalau diklik cepat
  target.classList.add(cls);
  target.addEventListener('animationend', ()=> target.classList.remove(cls), { once:true });
});

/* =====================================================================
   AUTO-LOGOUT IDLE — kalau user login tapi gak ada aktivitas (mouse/
   keyboard/tap/scroll) selama 10 menit, otomatis logout demi keamanan
   (device kepinjem/ketinggalan nyala tetep aman). Additif, gak ganggu
   flow login/logout manual yang udah ada.
   ===================================================================== */
const IDLE_LOGOUT_MS = 10 * 60 * 1000; // 10 menit
let _lastActivityAt = Date.now();
['mousemove','mousedown','keydown','scroll','touchstart','click'].forEach(evt => {
  document.addEventListener(evt, () => { _lastActivityAt = Date.now(); }, { passive:true });
});
setInterval(async () => {
  if(!currentUser) return; // belum login, gak perlu dicek
  if(Date.now() - _lastActivityAt < IDLE_LOGOUT_MS) return;
  toast('Sesi berakhir karena tidak ada aktivitas selama 10 menit. Silakan login kembali.', true);
  await handleLogout();
}, 30 * 1000); // cek tiap 30 detik, cukup responsif tanpa berat