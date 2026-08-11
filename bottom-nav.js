/* =====================================================================
   BOTTOM NAV MENGAMBANG (mode HP, gaya mirip WhatsApp)
   1 tombol: Menu (buka sidebar lama). Langsung/Chat Tim dicabut, udah
   bisa diakses lewat menu sidebar biasa.
   File ini cuma nambah UI + wiring, nggak duplikasi data/logic apapun
   dari app.js.
   ===================================================================== */
(function(){
  function buildBar(){
    if(document.getElementById('bottomNav')) return;
    var bar = document.createElement('div');
    bar.className = 'bottom-nav';
    bar.id = 'bottomNav';
    bar.innerHTML =
      '<button type="button" class="bottom-nav-item" id="bnavMenu" onclick="toggleSidebar()">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></span>' +
        '<span class="bn-label">Menu</span>' +
      '</button>';
    document.body.appendChild(bar);
  }

  function injectCloseButton(){
    var header = document.querySelector('.sidebar-header');
    if(!header || document.getElementById('bnavCloseMenu')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'bnavCloseMenu';
    btn.className = 'bnav-close-menu';
    btn.setAttribute('aria-label', 'Tutup menu');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btn.onclick = function(){ toggleSidebar(); };
    header.appendChild(btn);
  }

  // Bottom-nav cuma tampil kalau udah login (appShell nggak "hidden").
  function watchLoginState(){
    var bar = document.getElementById('bottomNav');
    var shell = document.getElementById('appShell');
    if(!bar || !shell) return;
    var sync = function(){ bar.classList.toggle('is-hidden', shell.classList.contains('hidden')); };
    sync();
    new MutationObserver(sync).observe(shell, { attributes:true, attributeFilter:['class'] });
  }

  // Pantau langsung class "open" di elemen sidebar (bukan wrap fungsi
  // toggleSidebar) — soalnya navigate() juga bisa nutup sidebar dengan
  // classList.remove('open') langsung, gak lewat toggleSidebar(). Kalau
  // cuma wrap toggleSidebar, jalur itu kelewat & bar nyangkut ke-hide.
  function watchSidebarState(){
    var sidebar = document.getElementById('sidebar');
    var bar = document.getElementById('bottomNav');
    var menu = document.getElementById('bnavMenu');
    if(!sidebar || !bar) return;
    var sync = function(){
      var open = sidebar.classList.contains('open');
      bar.classList.toggle('menu-open', open);
      if(menu) menu.classList.toggle('active', open);
    };
    sync();
    new MutationObserver(sync).observe(sidebar, { attributes:true, attributeFilter:['class'] });
  }

  function init(){
    buildBar();
    injectCloseButton();
    watchLoginState();
    watchSidebarState();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
