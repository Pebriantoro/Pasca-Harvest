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

  function highlightActive(){
    var menu = document.getElementById('bnavMenu');
    var bar = document.getElementById('bottomNav');
    var sidebar = document.getElementById('sidebar');
    if(!menu || !bar) return;
    var menuOpen = !!(sidebar && sidebar.classList.contains('open'));
    menu.classList.toggle('active', menuOpen);
    // Sidebar-footer (tombol Keluar dkk) ada di bawah, ketutup bar
    // mengambang ini kalau dibiarin nyala pas menu kebuka — sembunyiin
    // biar tombol di bawah sidebar bisa keklik.
    bar.classList.toggle('menu-open', menuOpen);
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

  function init(){
    buildBar();
    injectCloseButton();
    watchLoginState();
    window.addEventListener('resize', function(){ highlightActive(); });

    // Bungkus toggleSidebar() punya app.js supaya tombol Menu ikut
    // ke-update, tanpa ubah file aslinya.
    var origToggle = window.toggleSidebar;
    if(typeof origToggle === 'function' && !origToggle.__bnavWrapped){
      var wrappedToggle = function(){
        var r = origToggle();
        highlightActive();
        return r;
      };
      wrappedToggle.__bnavWrapped = true;
      window.toggleSidebar = wrappedToggle;
    }
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
