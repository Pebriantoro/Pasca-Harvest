/* ===================== SIDEBAR COLLAPSE (icon rail mode) =====================
   Menambahkan tombol kecil di tepi kanan sidebar untuk collapse/expand.
   Saat collapse: sidebar menyempit jadi rel ikon (ikon jadi lebih besar),
   label teks hilang dengan animasi fade + shrink, dan main-area ikut geser.
   State disimpan di localStorage supaya tetap collapse setelah reload.
------------------------------------------------------------------------- */
(function(){
  const STORAGE_KEY = 'sidebarCollapsed';

  function isDesktop(){ return window.innerWidth > 880; }

  function setTooltips(sidebar){
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      if(item.hasAttribute('title')) return;
      const label = item.querySelector('span:not(.count-badge)');
      if(label && label.textContent.trim()) item.setAttribute('title', label.textContent.trim());
    });
  }

  function applyState(sidebar, toggleBtn, collapsed){
    sidebar.classList.toggle('collapsed', collapsed);
    toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    toggleBtn.setAttribute('aria-label', collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar');
    toggleBtn.title = collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar';
  }

  function init(){
    const sidebar = document.getElementById('sidebar');
    const header = sidebar && sidebar.querySelector('.sidebar-header');
    if(!sidebar || !header) return;
    if(document.getElementById('sidebarCollapseToggle')) return; // sudah terpasang

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'sidebarCollapseToggle';
    btn.className = 'sidebar-collapse-toggle';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 6-6 6 6 6"/></svg>';
    header.style.position = header.style.position || 'relative';
    header.appendChild(btn);

    let collapsed = false;
    try { collapsed = localStorage.getItem(STORAGE_KEY) === '1' && isDesktop(); } catch(e){}
    applyState(sidebar, btn, collapsed);
    setTooltips(sidebar);
    if(collapsed) setTimeout(() => window.dispatchEvent(new Event('resize')), 300);

    btn.addEventListener('click', () => {
      collapsed = !sidebar.classList.contains('collapsed');
      applyState(sidebar, btn, collapsed);
      try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch(e){}
      // Setelah animasi lebar kelar, paksa Chart.js (dan lib lain yang dengar
      // window resize) baca ulang ukuran container -> grafik gak nyangkut kosong.
      setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    });

    // Kalau layar mengecil ke mode mobile, jangan biarkan sidebar "collapsed"
    // menabrak perilaku off-canvas hamburger yang sudah ada.
    window.addEventListener('resize', () => {
      if(!isDesktop() && sidebar.classList.contains('collapsed')){
        sidebar.classList.remove('collapsed');
      } else if(isDesktop()){
        let want = false;
        try { want = localStorage.getItem(STORAGE_KEY) === '1'; } catch(e){}
        if(want && !sidebar.classList.contains('collapsed')){
          applyState(sidebar, btn, true);
        }
      }
    });

    // Nav item baru bisa muncul belakangan (render dinamis) -> pastikan tooltip terpasang.
    const observer = new MutationObserver(() => setTooltips(sidebar));
    observer.observe(sidebar, { childList:true, subtree:true });
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // Jaga-jaga kalau #sidebar baru dirender setelah login (app-shell awalnya hidden).
  window.addEventListener('load', init);
})();
