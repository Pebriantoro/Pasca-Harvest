/* =====================================================================
   BOTTOM NAV MENGAMBANG (mode HP, gaya mirip WhatsApp)
   1 tombol: Menu (buka sidebar lama). Langsung/Chat Tim dicabut, udah
   bisa diakses lewat menu sidebar biasa.
   File ini cuma nambah UI + wiring, nggak duplikasi data/logic apapun
   dari app.js.

   MIGRASI TAILWIND (lihat bottom-nav.css untuk sisa yang belum pindah):
   Semua class yang murni milik komponen ini sendiri (bar, item, icon-wrap,
   label, tombol tutup) sekarang Tailwind utility langsung di sini.
   Animasi custom "bnavPop" didaftarkan di tailwind.config (index.html).
   Yang TIDAK dipindah: override ke .sidebar/.content-pad/.sidebar-header/
   .menu-toggle/.sidebar-backdrop — itu shared class dgn banyak lapis
   definisi lain di styles.css, jadi ditunda sampe migrasi shared class
   itu sendiri (biar dibereskan sekali jalan, bukan dicicil dari sini).
   ===================================================================== */
(function(){
  var BAR_BASE =
    'hidden max-[880px]:flex fixed left-1/2 -translate-x-1/2 ' +
    'bottom-[calc(14px+env(safe-area-inset-bottom,0px))] z-[45] gap-0.5 p-1.5 ' +
    'rounded-full bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] ' +
    'border border-border-soft ' +
    'shadow-[var(--shadow-md),0_0_0_1px_rgba(217,169,74,.28),0_0_14px_rgba(217,169,74,.22)]';

  var ITEM_BASE =
    'group flex flex-col items-center justify-center gap-px ' +
    'w-16 h-14 max-[420px]:w-[57px] max-[420px]:h-[54px] ' +
    'rounded-full bg-transparent cursor-pointer font-body ' +
    'text-[9.5px] max-[420px]:text-[9px] font-semibold relative ' +
    'transition-colors duration-200 [-webkit-tap-highlight-color:transparent]';

  var ICON_WRAP_BASE =
    'bn-icon-wrap flex items-center justify-center w-[26px] h-[26px] rounded-full ' +
    'transition-all duration-300 group-active:scale-95';

  var LABEL_BASE = 'bn-label transition-all duration-300';

  function buildBar(){
    if(document.getElementById('bottomNav')) return;
    var bar = document.createElement('div');
    bar.className = BAR_BASE;
    bar.id = 'bottomNav';
    bar.innerHTML =
      '<button type="button" class="' + ITEM_BASE + ' text-text-muted" id="bnavMenu" onclick="toggleSidebar()">' +
        '<span class="' + ICON_WRAP_BASE + '"><svg class="w-[19px] h-[19px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></span>' +
        '<span class="' + LABEL_BASE + '">Menu</span>' +
      '</button>';
    document.body.appendChild(bar);
  }

  function setItemActive(active){
    var btn = document.getElementById('bnavMenu');
    var wrap = btn && btn.querySelector('.bn-icon-wrap');
    var label = btn && btn.querySelector('.bn-label');
    if(!btn) return;

    btn.classList.toggle('text-green', active);
    btn.classList.toggle('text-text-muted', !active);

    if(wrap){
      wrap.classList.toggle('bg-green', active);
      wrap.classList.toggle('text-white', active);
      wrap.classList.toggle('animate-bnavPop', active);
      wrap.classList.toggle(
        'shadow-[0_6px_14px_-2px_rgba(0,0,0,.35),0_0_0_4px_color-mix(in_srgb,var(--bg-card)_92%,transparent)]',
        active
      );
      // translateY(-13px) scale(1.14) pas aktif, balik normal pas nggak
      wrap.classList.toggle('translate-y-[-13px]', active);
      wrap.classList.toggle('scale-[1.14]', active);
    }
    if(label) label.classList.toggle('-translate-y-1', active);
  }

  function injectCloseButton(){
    var header = document.querySelector('.sidebar-header');
    if(!header || document.getElementById('bnavCloseMenu')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'bnavCloseMenu';
    btn.className =
      'absolute top-1/2 right-3.5 -translate-y-1/2 w-9 h-9 flex items-center justify-center ' +
      'rounded-full border border-border-soft bg-bg-card-hover text-text-primary cursor-pointer ' +
      '[-webkit-tap-highlight-color:transparent]';
    btn.setAttribute('aria-label', 'Tutup menu');
    btn.innerHTML = '<svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    btn.onclick = function(){ toggleSidebar(); };
    header.appendChild(btn);
  }

  // Bar mesti di-hide kalau SALAH SATU true: belum login, ATAU sidebar
  // lagi kebuka. Dua sumber (login state, sidebar state) independen tapi
  // sama-sama ngontrol 1 class '!hidden' -> gabung lewat state bersama,
  // jangan masing-masing toggle sendiri (nanti yang sync belakangan
  // nimpa punya yang duluan).
  var loggedIn = false;
  var sidebarOpen = false;
  function updateBarVisibility(){
    var bar = document.getElementById('bottomNav');
    if(!bar) return;
    bar.classList.toggle('!hidden', !loggedIn || sidebarOpen);
  }

  // Bottom-nav cuma tampil kalau udah login (appShell nggak "hidden").
  function watchLoginState(){
    var shell = document.getElementById('appShell');
    if(!shell) return;
    var sync = function(){
      loggedIn = !shell.classList.contains('hidden');
      updateBarVisibility();
    };
    sync();
    new MutationObserver(sync).observe(shell, { attributes:true, attributeFilter:['class'] });
  }

  // Pantau langsung class "open" di elemen sidebar (bukan wrap fungsi
  // toggleSidebar) — soalnya navigate() juga bisa nutup sidebar dengan
  // classList.remove('open') langsung, gak lewat toggleSidebar(). Kalau
  // cuma wrap toggleSidebar, jalur itu kelewat & bar nyangkut ke-hide.
  function watchSidebarState(){
    var sidebar = document.getElementById('sidebar');
    if(!sidebar) return;
    var sync = function(){
      sidebarOpen = sidebar.classList.contains('open');
      updateBarVisibility();
      setItemActive(sidebarOpen);
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
