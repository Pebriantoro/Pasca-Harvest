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
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>' +
        '<span>Langsung</span>' +
        '<span class="bottom-nav-badge hidden" id="bnavDMBadge">0</span>' +
      '</button>' +
      '<button type="button" class="bottom-nav-item" id="bnavChat" onclick="navigate(\'chat\')">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>' +
        '<span>Chat Tim</span>' +
        '<span class="bottom-nav-badge hidden" id="bnavChatBadge">0</span>' +
      '</button>' +
      '<button type="button" class="bottom-nav-item" id="bnavMenu" onclick="toggleSidebar()">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>' +
        '<span>Menu</span>' +
      '</button>';
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
  function highlightActive(view){
    if(view !== undefined) lastView = view;
    var dm = document.getElementById('bnavDM');
    var chat = document.getElementById('bnavChat');
    var menu = document.getElementById('bnavMenu');
    var sidebar = document.getElementById('sidebar');
    if(!dm || !chat || !menu) return;
    dm.classList.toggle('active', lastView === 'dm');
    chat.classList.toggle('active', lastView === 'chat');
    menu.classList.toggle('active', !!(sidebar && sidebar.classList.contains('open')));
  }

  function init(){
    buildBar();
    mirrorBadge('dmUnreadBadge', 'bnavDMBadge');
    mirrorBadge('chatUnreadBadge', 'bnavChatBadge');

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
