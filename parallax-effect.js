/* =====================================================================
   EFEK PARALLAX (semua menu)
   Additif -- tidak mengubah render/template yang sudah ada, cuma nge-scan
   #pageContent tiap ada scroll/render ulang lalu nempelin transform.

   - Kartu (.card, .kpi-card): geser vertikal sedikit ngikutin posisinya
     di layar saat di-scroll (di atas layar geser satu arah, di bawah
     geser arah sebaliknya) -> efek berlapis/depth khas parallax.
   - Hero banner Beranda (gambar carousel wf-slide-media): gambarnya
     digedein sedikit lalu digeser lebih lambat dari scroll -> parallax
     gambar klasik.
   - Otomatis mati kalau prefers-reduced-motion, dan di layar kecil (HP)
     supaya tidak ganggu scroll & tetap ringan.
   - Tidak pakai IntersectionObserver/MutationObserver yang berat --
     recompute cuma jalan pas scroll/resize, dibatasi 1x per frame lewat
     requestAnimationFrame, jadi aman dipasang di semua halaman.
   ===================================================================== */
(function(){
  const PFX_SELECTOR = '.card:not(.card-hoverable), .kpi-card';
  const PFX_STRENGTH = 16; // px, offset maksimum depth parallax kartu
  const PFX_HERO_FACTOR = 0.12; // seberapa lambat gambar hero geser vs scroll

  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_e){}
  if(reducedMotion) return;

  function isSmallScreen(){ return window.innerWidth < 720; }

  let ticking = false;

  function pfxTick(){
    ticking = false;

    if(isSmallScreen()){
      document.querySelectorAll('.pfx-touched').forEach(el => { el.style.transform = ''; el.classList.remove('pfx-touched'); });
      return;
    }

    const vh = window.innerHeight || document.documentElement.clientHeight;

    document.querySelectorAll(PFX_SELECTOR).forEach(el => {
      const rect = el.getBoundingClientRect();
      if(rect.bottom < -200 || rect.top > vh + 200) return; // jauh di luar layar, tidak perlu dihitung
      const center = rect.top + rect.height / 2;
      const ratio = Math.max(-0.6, Math.min(0.6, (center - vh / 2) / vh));
      el.style.transform = `translateY(${(ratio * PFX_STRENGTH).toFixed(1)}px)`;
      el.classList.add('pfx-touched');
    });

    document.querySelectorAll('.wf-slide-media img').forEach(img => {
      const rect = img.parentElement.getBoundingClientRect();
      img.style.transform = `scale(1.12) translateY(${(rect.top * PFX_HERO_FACTOR).toFixed(1)}px)`;
    });
  }

  function pfxRequestTick(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(pfxTick);
  }

  window.addEventListener('scroll', pfxRequestTick, { passive: true });
  window.addEventListener('resize', pfxRequestTick);

  // Ganti menu / render ulang tabel bisa mengubah tinggi & posisi kartu --
  // pantau lewat MutationObserver supaya offset tetap sinkron, dibatasi
  // lewat requestAnimationFrame yang sama (jadi tidak nge-spam hitungan).
  const target = document.getElementById('pageContent') || document.body;
  new MutationObserver(pfxRequestTick).observe(target, { childList: true, subtree: true });

  pfxRequestTick();
})();
