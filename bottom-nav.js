/* =====================================================================
   BOTTOM NAV MENGAMBANG (mode HP, gaya mirip WhatsApp)
   Menu (paling kiri, buka sidebar lama) + 3 shortcut menu tersering
   dipake user (dihitung dari localStorage, per device). File ini cuma
   nambah UI + wiring, nggak duplikasi data/logic apapun dari app.js.
   ===================================================================== */
(function(){
  var USAGE_KEY = 'bnavUsageCount_v1';
  var SHORTCUT_COUNT = 3;
  var FALLBACK_VIEWS = ['dashboard', 'rkh', 'pra_spa'];

  function loadUsage(){
    try{ return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); }
    catch(e){ return {}; }
  }
  function bumpUsage(view){
    if(!view || view === 'beranda') return; // beranda udah default landing, ga perlu shortcut sendiri
    var data = loadUsage();
    data[view] = (data[view] || 0) + 1;
    try{ localStorage.setItem(USAGE_KEY, JSON.stringify(data)); }catch(e){}
  }

  // Ambil daftar {view,icon,label} dari nav-item sidebar yang udah ada
  // (data-view + icon + teks) — biar ga duplikat definisi menu.
  function collectNavItems(){
    var out = {};
    document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(function(a){
      var view = a.getAttribute('data-view');
      var icon = a.querySelector('.nav-item-icon');
      var label = a.querySelector('span:last-child');
      if(view && icon) out[view] = { view: view, icon: icon.textContent.trim(), label: (label ? label.textContent.trim() : view) };
    });
    return out;
  }

  function topShortcuts(){
    var navItems = collectNavItems();
    var usage = loadUsage();
    var ranked = Object.keys(usage)
      .filter(function(v){ return navItems[v]; })
      .sort(function(a,b){ return usage[b] - usage[a]; });
    var picked = ranked.slice(0, SHORTCUT_COUNT);
    if(picked.length < SHORTCUT_COUNT){
      FALLBACK_VIEWS.forEach(function(v){
        if(picked.length < SHORTCUT_COUNT && navItems[v] && picked.indexOf(v) === -1) picked.push(v);
      });
    }
    return picked.map(function(v){ return navItems[v]; }).filter(Boolean);
  }

  function shortcutBtnHTML(item){
    return '<button type="button" class="bottom-nav-item bnav-shortcut" data-view="' + item.view + '" onclick="navigate(\'' + item.view + '\')">' +
      '<span class="bn-icon-wrap"><span class="material-symbols-outlined">' + item.icon + '</span></span>' +
      '<span class="bn-label">' + item.label + '</span>' +
    '</button>';
  }

  function buildBar(){
    if(document.getElementById('bottomNav')) return;
    var bar = document.createElement('div');
    bar.className = 'bottom-nav';
    bar.id = 'bottomNav';
    bar.innerHTML =
      '<button type="button" class="bottom-nav-item" id="bnavMenu" onclick="toggleSidebar()">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></span>' +
        '<span class="bn-label">Menu</span>' +
      '</button>' +
      topShortcuts().map(shortcutBtnHTML).join('');
    document.body.appendChild(bar);
  }

  // Highlight shortcut yang lagi aktif sesuai currentView.
  function syncActiveShortcut(){
    var bar = document.getElementById('bottomNav');
    if(!bar) return;
    bar.querySelectorAll('.bnav-shortcut').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-view') === currentView);
    });
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

  // Hitung pemakaian & sinkron shortcut aktif tiap kali navigate() dipanggil.
  // Wrap dipasang belakangan (setelah beranda-workflow.js juga wrap
  // navigate), jadi tetap additive, ga override wrapper lain.
  function wireUsageTracking(){
    if(typeof navigate !== 'function' || navigate.__bnavWrapped) return;
    var prevNavigate = navigate;
    navigate = async function(view){
      var result = await prevNavigate(view);
      bumpUsage(view);
      syncActiveShortcut();
      return result;
    };
    navigate.__bnavWrapped = true;
  }

  function init(){
    buildBar();
    injectCloseButton();
    watchLoginState();
    watchSidebarState();
    wireUsageTracking();
    syncActiveShortcut();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
