/* =========================================================================
   KPI COUNT-UP — animasi angka naik (0 -> nilai asli) buat SEMUA kartu KPI
   di SEMUA modul, otomatis, tanpa perlu sentuh app.js/tiap file modul.
   Cara kerja: MutationObserver mantau #pageContent, tiap kali render ulang
   (navigate/reload/filter/dsb) nyari elemen .kpi-value teks polos (bukan
   yang isinya markup lain), parse angka format id-ID (titik ribuan, koma
   desimal), lalu animasikan naik dari 0 pakai easing + delay berjenjang
   biar berasa "interaktif". Teks non-angka ("–", status, dsb) dibiarkan
   apa adanya. Hormat ke prefers-reduced-motion.
   ========================================================================= */
(function () {
  const REDUCE_MOTION = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DURATION = 900; // ms

  function parseLeadingNumber(raw) {
    const m = raw.match(/^(-?[\d.,]+)(.*)$/s);
    if (!m) return null;
    let numTok = m[1];
    const suffix = m[2];
    // Wajib ada minimal 1 digit di token (hindari nangkep string spt "..." doang)
    if (!/\d/.test(numTok)) return null;
    // Berapa digit di belakang koma (desimal id-ID) buat konsistensi format saat animasi
    const commaIdx = numTok.lastIndexOf(',');
    const decimals = commaIdx === -1 ? 0 : (numTok.length - commaIdx - 1);
    // id-ID: titik = ribuan (buang), koma = desimal (jadi titik) utk di-parse Number()
    const normalized = numTok.replace(/\./g, '').replace(',', '.');
    const value = Number(normalized);
    if (isNaN(value)) return null;
    return { value, decimals, suffix, original: raw };
  }

  function animateValue(el, target) {
    const original = el.textContent;
    const parsed = parseLeadingNumber(original.trim());
    if (!parsed) return; // bukan angka (badge/teks status/dash) -> biarin

    if (REDUCE_MOTION) return; // biarin teks asli, no animation

    const { value, decimals, suffix } = parsed;
    el.textContent = (0).toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;

    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = value * eased;
      if (t < 1) {
        el.textContent = current.toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
        requestAnimationFrame(tick);
      } else {
        el.textContent = original; // frame terakhir: balikin teks asli persis, no drift
      }
    }
    requestAnimationFrame(tick);
  }

  function processRoot(root) {
    if (!root.querySelectorAll) return;
    const nodes = root.matches && root.matches('.kpi-value')
      ? [root]
      : Array.from(root.querySelectorAll('.kpi-value'));
    nodes.forEach((el, i) => {
      // skip kalau isinya markup (badge/ikon dsb), cuma animasikan teks polos
      if (el.children.length > 0) return;
      const delay = Math.min(i, 8) * 45;
      setTimeout(() => animateValue(el), delay);
    });
  }

  function boot() {
    const target = document.getElementById('pageContent');
    if (!target) { setTimeout(boot, 300); return; }
    processRoot(target); // kalau udah ada isi pas script ini load

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          processRoot(node);
        });
      });
    });
    observer.observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
