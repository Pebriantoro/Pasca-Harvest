/* =====================================================================
   MENU TRANSITIONS — logic
   Additif -- tidak mengubah navigate()/render function yang sudah ada.
   Cuma: (1) bungkus window.navigate biar ada progress bar + animasi
   masuk konten tiap ganti menu, (2) MutationObserver di #pageContent
   buat animasi stagger tiap kali kontennya diganti (termasuk saat
   skeleton -> data asli), (3) efek ripple pas klik tombol/menu.
   ===================================================================== */
(function(){
  let reducedMotion = false;
  try { reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch(_e){}

  /* ---------- Top loading bar ---------- */
  let loaderEl = null;
  function ensureLoader(){
    if (loaderEl) return loaderEl;
    loaderEl = document.createElement('div');
    loaderEl.id = 'mtTopLoader';
    document.body.appendChild(loaderEl);
    return loaderEl;
  }
  let loaderTimer = null;
  function loaderStart(){
    if (reducedMotion) return;
    const el = ensureLoader();
    clearTimeout(loaderTimer);
    el.classList.remove('mt-done');
    el.style.width = '0%';
    // trigger reflow biar transisi width jalan dari 0
    void el.offsetWidth;
    el.classList.add('mt-active');
    requestAnimationFrame(() => { el.style.width = '78%'; });
  }
  function loaderFinish(){
    if (reducedMotion || !loaderEl) return;
    loaderEl.classList.add('mt-done');
    clearTimeout(loaderTimer);
    loaderTimer = setTimeout(() => {
      loaderEl.classList.remove('mt-active', 'mt-done');
      loaderEl.style.width = '0%';
    }, 450);
  }

  /* ---------- Stagger entrance untuk konten baru ---------- */
  function animateNewContent(container){
    if (reducedMotion || !container) return;
    container.classList.remove('mt-fade-in');
    void container.offsetWidth; // restart animasi
    container.classList.add('mt-fade-in');

    const items = container.querySelectorAll('.kpi-card, .card, .chart-box, .chart-box-sm, .empty-state');
    items.forEach((el, i) => {
      el.classList.add('mt-item-in');
      el.style.animationDelay = Math.min(i * 40, 420) + 'ms';
      el.addEventListener('animationend', function onEnd(){
        el.classList.remove('mt-item-in');
        el.style.animationDelay = '';
        el.removeEventListener('animationend', onEnd);
      });
    });
  }

  function initObserver(){
    const pageContent = document.getElementById('pageContent');
    if (!pageContent) { setTimeout(initObserver, 300); return; }
    const mo = new MutationObserver((mutations) => {
      const changed = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
      if (!changed) return;
      requestAnimationFrame(() => animateNewContent(pageContent));
    });
    mo.observe(pageContent, { childList: true });
  }

  /* ---------- Bungkus navigate() biar ada progress bar ---------- */
  function wrapNavigate(){
    if (typeof window.navigate !== 'function' || window.navigate.__mtWrapped) { 
      if (typeof window.navigate !== 'function') setTimeout(wrapNavigate, 300);
      return;
    }
    const originalNavigate = window.navigate;
    const wrapped = async function(view){
      loaderStart();
      try{
        return await originalNavigate.apply(this, arguments);
      } finally {
        loaderFinish();
      }
    };
    wrapped.__mtWrapped = true;
    window.navigate = wrapped;
  }

  /* ---------- Ripple effect di tombol & menu sidebar ---------- */
  function bindRipple(){
    document.addEventListener('click', function(e){
      if (reducedMotion) return;
      const target = e.target.closest('.btn, .nav-item, .btn-icon');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.6;
      const ripple = document.createElement('span');
      ripple.className = 'mt-ripple';
      ripple.style.width = ripple.style.height = size + 'px';
      ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
      ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
      target.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove(), { once:true });
    }, true);
  }

  function init(){
    wrapNavigate();
    initObserver();
    bindRipple();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
