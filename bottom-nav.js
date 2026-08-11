/* =====================================================================
   BOTTOM NAV MENGAMBANG (mode HP, gaya mirip WhatsApp)
   3 tombol: Langsung (dm), Chat Tim (chat), Menu (buka sidebar lama).
   File ini cuma nambah UI + wiring, nggak duplikasi data/logic apapun
   dari app.js — badge unread & daftar menu tetap satu sumber (sidebar).
   ===================================================================== */
(function(){
  function buildBar(){
    if(document.getElementById('bottomNav')) return;
    var bar = document.createElement('div');
    bar.className = 'bottom-nav';
    bar.id = 'bottomNav';
    bar.innerHTML =
      '<button type="button" class="bottom-nav-item" id="bnavDM" onclick="navigate(\'dm\')">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg></span>' +
        '<span class="bn-label">Langsung</span>' +
        '<span class="bottom-nav-badge hidden" id="bnavDMBadge">0</span>' +
      '</button>' +
      '<button type="button" class="bottom-nav-item" id="bnavChat" onclick="navigate(\'chat\')">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></span>' +
        '<span class="bn-label">Chat Tim</span>' +
        '<span class="bottom-nav-badge hidden" id="bnavChatBadge">0</span>' +
      '</button>' +
      '<button type="button" class="bottom-nav-item" id="bnavMenu" onclick="toggleSidebar()">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></span>' +
        '<span class="bn-label">Menu</span>' +
      '</button>' +
      '<span class="bn-indicator" id="bnavIndicator"></span>';
    document.body.appendChild(bar);
  }

  // Cerminkan badge unread dari badge asli di sidebar (satu sumber angka,
  // nggak ada hitungan dobel).
  function mirrorBadge(sourceId, targetId){
    var src = document.getElementById(sourceId);
    var tgt = document.getElementById(targetId);
    if(!src || !tgt) return;
    var sync = function(){
      tgt.textContent = src.textContent;
      tgt.classList.toggle('hidden', src.classList.contains('hidden'));
    };
    sync();
    new MutationObserver(sync).observe(src, { childList:true, characterData:true, subtree:true, attributes:true, attributeFilter:['class'] });
  }

  var lastView = null;
  function slideIndicatorTo(el){
    var ind = document.getElementById('bnavIndicator');
    var bar = document.getElementById('bottomNav');
    if(!ind || !bar) return;
    if(!el){ ind.classList.remove('show'); return; }
    var barRect = bar.getBoundingClientRect();
    var elRect = el.getBoundingClientRect();
    var centerX = (elRect.left - barRect.left) + elRect.width / 2;
    ind.style.transform = 'translateX(' + centerX + 'px)';
    ind.classList.add('show');
  }
  function highlightActive(view){
    if(view !== undefined) lastView = view;
    var dm = document.getElementById('bnavDM');
    var chat = document.getElementById('bnavChat');
    var menu = document.getElementById('bnavMenu');
    var sidebar = document.getElementById('sidebar');
    if(!dm || !chat || !menu) return;
    var menuOpen = !!(sidebar && sidebar.classList.contains('open'));
    dm.classList.toggle('active', !menuOpen && lastView === 'dm');
    chat.classList.toggle('active', !menuOpen && lastView === 'chat');
    menu.classList.toggle('active', menuOpen);
    var activeEl = bar_activeElement();
    slideIndicatorTo(activeEl);
    function bar_activeElement(){
      if(menuOpen) return menu;
      if(lastView === 'dm') return dm;
      if(lastView === 'chat') return chat;
      return null;
    }
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
    mirrorBadge('dmUnreadBadge', 'bnavDMBadge');
    mirrorBadge('chatUnreadBadge', 'bnavChatBadge');
    window.addEventListener('resize', function(){ highlightActive(); });

    // Bungkus navigate() & toggleSidebar() punya app.js supaya tab aktif
    // ikut ke-update, tanpa ubah file aslinya.
    var origNavigate = window.navigate;
    if(typeof origNavigate === 'function' && !origNavigate.__bnavWrapped){
      var wrappedNavigate = function(view){
        var r = origNavigate(view);
        highlightActive(view);
        return r;
      };
      wrappedNavigate.__bnavWrapped = true;
      window.navigate = wrappedNavigate;
    }
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
