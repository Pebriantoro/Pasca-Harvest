/* page-title-icon.js — ikon di topbar (samping judul halaman) ikutan ikon
   menu aktif di sidebar. Additif, gak ubah navigate() asli, cuma nebeng
   lewat wrapper kayak task-calendar.js. */
(function(){
  function syncPageTitleIcon(view){
    const iconEl = document.getElementById('pageTitleIcon');
    if(!iconEl) return;
    const navItem = document.querySelector('.nav-item[data-view="' + view + '"]');
    const srcIcon = navItem ? navItem.querySelector('.nav-item-icon') : null;
    if(srcIcon && srcIcon.textContent.trim()){
      iconEl.textContent = srcIcon.textContent.trim();
      iconEl.style.display = 'inline-flex';
    } else {
      iconEl.style.display = 'none';
    }
  }

  const _prevNavigate = navigate;
  navigate = async function(view){
    const result = await _prevNavigate(view);
    syncPageTitleIcon(view);
    return result;
  };

  // Set ikon awal begitu halaman pertama kali dimuat (tanpa nunggu klik menu).
  window.addEventListener('load', () => setTimeout(() => syncPageTitleIcon(currentView), 300));
})();
