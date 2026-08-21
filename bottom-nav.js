/* =====================================================================
   BOTTOM NAV MENGAMBANG (mode HP, gaya mirip WhatsApp)
   Menu (paling kiri, buka sidebar lama) + 3 shortcut menu tersering
   dipake user (dihitung dari localStorage, per device). File ini cuma
   nambah UI + wiring, nggak duplikasi data/logic apapun dari app.js.
   ===================================================================== */
(function(){
  var USAGE_KEY = 'bnavUsageCount_v1';
  var CUSTOM_KEY = 'bnavCustomShortcuts_v1';
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

  // Pilihan manual dari pengguna (lewat Pengaturan > Menu Ngambang).
  // null/kosong = belum diatur manual, balik ke mode otomatis (tersering dipakai).
  function loadCustom(){
    try{
      var v = JSON.parse(localStorage.getItem(CUSTOM_KEY) || 'null');
      return Array.isArray(v) && v.length ? v : null;
    }catch(e){ return null; }
  }
  function saveCustom(views){
    try{ localStorage.setItem(CUSTOM_KEY, JSON.stringify(views)); }catch(e){}
  }
  function clearCustom(){
    try{ localStorage.removeItem(CUSTOM_KEY); }catch(e){}
  }

  // Ambil daftar {view,icon,label} dari nav-item sidebar yang udah ada
  // (data-view + icon + teks) — biar ga duplikat definisi menu.
  function collectNavItems(){
    var out = {};
    document.querySelectorAll('.sidebar-nav .nav-item[data-view]').forEach(function(a){
      var view = a.getAttribute('data-view');
      var icon = a.querySelector('.nav-item-icon');
      // Nav-item yang punya count-badge (mis. "Prod Harian" + <span class="count-badge">241</span>)
      // punya 2 span sesudah ikon; span:last-child ke-nya jatuh ke count-badge,
      // bukan ke teks label. Jadi cari span teks labelnya secara spesifik.
      var label = a.querySelector('span:not(.nav-item-icon):not(.count-badge)');
      if(view && icon) out[view] = { view: view, icon: icon.textContent.trim(), label: (label ? label.textContent.trim() : view) };
    });
    return out;
  }

  function topShortcuts(){
    var navItems = collectNavItems();
    var custom = loadCustom();
    if(custom){
      var manual = custom.filter(function(v){ return navItems[v]; }).slice(0, SHORTCUT_COUNT).map(function(v){ return navItems[v]; });
      if(manual.length) return manual;
    }
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
    return '<button type="button" class="bottom-nav-item bnav-shortcut" data-view="' + item.view + '" onclick="this.blur(); navigate(\'' + item.view + '\')">' +
      '<span class="bn-icon-wrap"><span class="material-symbols-outlined">' + item.icon + '</span></span>' +
      '<span class="bn-label">' + item.label + '</span>' +
    '</button>';
  }

  // Render ulang tombol shortcut aja (Menu tetap, biar watcher/animasi
  // yang nempel ke #bnavMenu ga perlu diinisialisasi ulang).
  function renderShortcutButtons(){
    var bar = document.getElementById('bottomNav');
    if(!bar) return;
    bar.querySelectorAll('.bnav-shortcut').forEach(function(el){ el.remove(); });
    bar.insertAdjacentHTML('beforeend', topShortcuts().map(shortcutBtnHTML).join(''));
    syncActiveShortcut();
  }

  function buildBar(){
    if(document.getElementById('bottomNav')) return;
    var bar = document.createElement('div');
    bar.className = 'bottom-nav';
    bar.id = 'bottomNav';
    bar.innerHTML =
      '<button type="button" class="bottom-nav-item" id="bnavMenu" onclick="this.blur(); toggleSidebar()">' +
        '<span class="bn-icon-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg></span>' +
        '<span class="bn-label">Menu</span>' +
      '</button>';
    document.body.appendChild(bar);
    renderShortcutButtons();
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

  /* ---- Kustomisasi lewat Pengaturan --------------------------------- */
  function injectSettingsRow(){
    if(document.getElementById('bnavCustomizeBtn')) return;
    var anchor = document.getElementById('langToggle');
    if(!anchor || !anchor.parentElement) return;
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-row';
    row.id = 'bnavCustomizeBtn';
    row.title = 'Pilih menu yang tampil di bar mengambang';
    row.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>' +
      '<span class="settings-row-label">Menu Ngambang</span>' +
      '<span class="settings-row-state">' + (loadCustom() ? 'Manual' : 'Otomatis') + '</span>';
    row.onclick = openCustomizeModal;
    anchor.parentElement.insertBefore(row, anchor.nextSibling);
  }

  function refreshSettingsRowState(){
    var state = document.querySelector('#bnavCustomizeBtn .settings-row-state');
    if(state) state.textContent = loadCustom() ? 'Manual' : 'Otomatis';
  }

  function pickerRowHTML(item, checked){
    return '<label class="bnav-picker-row" style="display:flex; align-items:center; gap:10px; padding:9px 4px; cursor:pointer; font-size:13px;">' +
      '<input type="checkbox" value="' + item.view + '" ' + (checked ? 'checked' : '') + ' style="width:16px; height:16px; flex-shrink:0;">' +
      '<span class="material-symbols-outlined" style="font-size:18px; color:var(--text-muted); flex-shrink:0;">' + item.icon + '</span>' +
      '<span>' + item.label + '</span>' +
    '</label>';
  }

  function openCustomizeModal(){
    document.getElementById('bnavCustomizeOverlay')?.remove();
    document.getElementById('settingsPanel')?.classList.add('hidden'); // panel Pengaturan lama harus ketutup dulu, jangan numpuk sama modal ini
    var navItems = collectNavItems();
    var selected = loadCustom() || topShortcuts().map(function(i){ return i.view; });
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'bnavCustomizeOverlay';
    overlay.innerHTML =
      '<div class="modal-box" style="max-width:380px;">' +
        '<div class="modal-header">' +
          '<div class="card-title">Menu Ngambang</div>' +
          '<button class="btn btn-outline btn-icon" id="bnavCustomizeCloseBtn">✕</button>' +
        '</div>' +
        '<div class="modal-body">' +
          '<p style="font-size:11.5px; color:var(--text-faint); margin:-4px 0 10px;">Pilih maksimal ' + SHORTCUT_COUNT + ' menu yang mau tampil di bar mengambang. Kosongkan semua buat balik ke mode otomatis (menu tersering dipakai).</p>' +
          '<div id="bnavPickerList" style="padding-bottom:10px;">' +
            Object.keys(navItems).map(function(v){ return pickerRowHTML(navItems[v], selected.indexOf(v) !== -1); }).join('') +
          '</div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn btn-outline" id="bnavCustomizeResetBtn">Otomatis</button>' +
          '<button class="btn btn-primary" id="bnavCustomizeSaveBtn">Simpan</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var checkboxes = overlay.querySelectorAll('#bnavPickerList input[type=checkbox]');
    checkboxes.forEach(function(cb){
      cb.addEventListener('change', function(){
        var checkedCount = overlay.querySelectorAll('#bnavPickerList input[type=checkbox]:checked').length;
        checkboxes.forEach(function(other){ if(!other.checked) other.disabled = checkedCount >= SHORTCUT_COUNT; });
      });
    });

    var close = function(){ overlay.remove(); };
    overlay.querySelector('#bnavCustomizeCloseBtn').onclick = close;
    overlay.addEventListener('click', function(e){ if(e.target === overlay) close(); });
    overlay.querySelector('#bnavCustomizeResetBtn').onclick = function(){
      clearCustom();
      renderShortcutButtons();
      refreshSettingsRowState();
      close();
      if(typeof toast === 'function') toast('Menu ngambang balik ke mode otomatis');
    };
    overlay.querySelector('#bnavCustomizeSaveBtn').onclick = function(){
      var picked = Array.from(overlay.querySelectorAll('#bnavPickerList input[type=checkbox]:checked')).map(function(cb){ return cb.value; });
      if(picked.length) saveCustom(picked); else clearCustom();
      renderShortcutButtons();
      refreshSettingsRowState();
      close();
      if(typeof toast === 'function') toast('Menu ngambang disimpan');
    };
  }

  function init(){
    buildBar();
    injectCloseButton();
    injectSettingsRow();
    watchLoginState();
    watchSidebarState();
    wireUsageTracking();
    syncActiveShortcut();
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
