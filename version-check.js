/* =====================================================================
   VERSION CHECK — deteksi otomatis kalau ada update baru ke-deploy,
   tanpa nyuruh user hapus history manual. Cara kerja:
   1. index.html sekarang load semua file lokal pakai query ?v=<versi>
      (lihat index.html) -> browser OTOMATIS ambil file baru begitu
      versi di config.js di-bump, gak perlu clear cache manual lagi.
   2. Tab yang UDAH terbuka lama (staff gak refresh-refresh) tetap perlu
      tahu ada versi baru -> addon ini polling config.js tiap 5 menit,
      cache:'no-store', banding APP_VERSION lama vs baru. Beda -> banner
      muncul di atas, staff tinggal klik "Muat Ulang".

   CATATAN RILIS: tiap kali deploy fitur baru, WAJIB naikkan angka versi
   di 2 tempat: config.js (window.APP_VERSION) dan query "?v=..." di
   semua <script>/<link> lokal pada index.html.
   ===================================================================== */
(function(){
  const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 menit
  const loadedVersion = window.APP_VERSION;

  function showUpdateBanner(newVersion){
    if(document.getElementById('versionUpdateBanner')) return;
    const bar = document.createElement('div');
    bar.id = 'versionUpdateBanner';
    bar.style.cssText = 'position:fixed; top:0; left:0; right:0; z-index:99999; background:linear-gradient(90deg,#D9A94A,#C9985E); color:#1B1405; font-size:13px; font-weight:600; padding:10px 16px; display:flex; align-items:center; justify-content:center; gap:14px; box-shadow:0 2px 10px rgba(0,0,0,.25);';
    bar.innerHTML = `
      <span>🔄 Update baru tersedia${newVersion ? ' (v'+newVersion+')' : ''} — muat ulang untuk pakai versi terbaru.</span>
      <button type="button" style="background:#1B1405; color:#F5D98A; border:none; padding:6px 14px; border-radius:6px; font-weight:700; cursor:pointer;" onclick="location.reload()">Muat Ulang</button>
    `;
    document.body.prepend(bar);
  }

  // manual=true -> dipanggil dari tombol "Cek Update" di Pengaturan,
  // kasih feedback juga kalau ternyata sudah versi terbaru / gagal cek.
  async function checkForUpdate(manual){
    try{
      const res = await fetch('config.js?_=' + Date.now(), { cache: 'no-store' });
      const text = await res.text();
      const m = text.match(/APP_VERSION\s*=\s*'([^']+)'/);
      if(m && m[1] && m[1] !== loadedVersion){
        showUpdateBanner(m[1]);
      } else if(manual && typeof toast === 'function'){
        toast('Sudah versi terbaru (v' + loadedVersion + ')');
      }
    }catch(e){
      if(manual && typeof toast === 'function') toast('Gagal cek update, coba lagi', true);
    }
  }

  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  // cek juga tiap kali tab kembali aktif (staff buka tab lama lagi)
  document.addEventListener('visibilitychange', () => { if(!document.hidden) checkForUpdate(); });

  window.checkForUpdate = checkForUpdate;
})();
