/* =====================================================================
   CHART COLOR CUSTOMIZER (additif, load paling terakhir)
   Nempelin toolbar kecil di bagian ATAS tiap kartu grafik: pilih "isi
   grafik apa yang mau diubah" (label/seri) + color picker "warna apa".
   Kerja otomatis buat SEMUA grafik Chart.js di app ini -- gak perlu
   ubah satu-satu fungsi drawDonut/drawBar/dst -- dengan cara nge-patch
   konstruktor global `Chart` sekali di sini (satu titik reuse, bukan
   17+ titik). Skip: ring status kecil (`ring_*`) & grafik TV Mode
   (`tvChart*`) biar gak numpuk toolbar di tempat yang gak muat/gak
   perlu diedit.

   Toolbar (kemampuan UBAH warna) cuma muncul buat role admin
   (isAdminRole(), reuse dari app.js). Warna hasil pilihan admin tetap
   kebaca semua orang (disimpan localStorage per canvasId+label, di-
   bake ke config SEBELUM chart dibuat -- lihat ccPrepareConfig).

   CATATAN PENTING soal repaint: ganti warna lewat chart.update() ada
   kalanya gak langsung kegambar ulang di canvas sampai ada interaksi
   mouse (bug render Chart.js/Animator versi ini). Makanya tiap ganti
   warna, chart LAMA di-destroy() lalu dibikin instance BARU dari
   config yang sama (udah kemutasi warnanya) -- dijamin full repaint,
   gak nunggu hover.
   ===================================================================== */
(function(){
  if(typeof window.Chart === 'undefined' || window.Chart.__ccPatched) return;

  const CC_STORE_KEY = 'chartColorOverrides';
  const CC_SKIP_PREFIX = ['ring_', 'tvChart'];
  const ccDefaultsByCanvas = {}; // canvasId -> { label: warna asli (sebelum override) }

  /* ---------------------------------------------------------------
     0. STORAGE
     --------------------------------------------------------------- */
  function ccGetStore(){
    try { return JSON.parse(localStorage.getItem(CC_STORE_KEY) || '{}'); } catch(_e){ return {}; }
  }
  function ccSetStore(store){
    try { localStorage.setItem(CC_STORE_KEY, JSON.stringify(store)); } catch(_e){}
  }
  function ccSaveOverride(canvasId, label, hex){
    const store = ccGetStore();
    store[canvasId] = store[canvasId] || {};
    store[canvasId][label] = hex;
    ccSetStore(store);
  }
  function ccClearOverride(canvasId, label){
    const store = ccGetStore();
    if(store[canvasId]) { delete store[canvasId][label]; if(!Object.keys(store[canvasId]).length) delete store[canvasId]; }
    ccSetStore(store);
  }

  /* ---------------------------------------------------------------
     1. AKSES -- toolbar cuma buat admin (reuse isAdminRole() app.js)
     --------------------------------------------------------------- */
  function ccIsAdmin(){
    try {
      if(typeof isAdminRole === 'function') return !!isAdminRole();
      if(typeof currentProfile !== 'undefined' && currentProfile) return currentProfile.role === 'admin';
    } catch(_e){}
    return false;
  }

  /* ---------------------------------------------------------------
     2. WARNA -> HEX (buat isi <input type="color">, yang cuma nerima
     #rrggbb). Dataset warna di app ini kadang berupa token CSS var
     yang udah di-resolve (biasanya udah hex), tapi jaga-jaga kalau
     rgba/nama warna, pakai canvas 1x1 supaya browser sendiri yang
     nge-parse -- bukan nulis ulang parser warna dari nol.
     --------------------------------------------------------------- */
  let ccColorCanvas = null;
  function ccToHex(cssColor){
    if(!cssColor) return '#888888';
    if(/^#[0-9a-fA-F]{6}$/.test(cssColor)) return cssColor;
    if(!ccColorCanvas) ccColorCanvas = document.createElement('canvas').getContext('2d');
    ccColorCanvas.fillStyle = '#000000';
    ccColorCanvas.fillStyle = cssColor;
    ccColorCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b] = ccColorCanvas.getImageData(0, 0, 1, 1).data;
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function ccEsc(str){
    return typeof escapeHtml === 'function' ? escapeHtml(str) :
      String(str == null ? '' : str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ---------------------------------------------------------------
     3. ENTRIES -- daftar "isi grafik" yang bisa dipilih warnanya.
     Terima objek apapun yang punya `.data.datasets` (chart instance
     ATAU config mentah sebelum instance dibuat -- makanya generik).
     - 1 dataset & backgroundColor berupa array (donut/pie/bar/hbar
       per-label) -> 1 entry per label (per potongan/batang).
     - beberapa dataset (grouped/stacked bar, line multi, progress
       bar bertumpuk) -> 1 entry per dataset (per seri/status).
     --------------------------------------------------------------- */
  function ccGetEntries(source){
    const datasets = (source.data && source.data.datasets) || [];
    if(!datasets.length) return [];

    if(datasets.length === 1 && Array.isArray(datasets[0].backgroundColor)){
      const labels = source.data.labels || [];
      const bg = datasets[0].backgroundColor;
      return labels.map((l, i) => ({
        label: String(l ?? ('Item ' + (i + 1))),
        getColor: () => bg[i],
        setColor: (hex) => { bg[i] = hex; },
      })).filter(e => e.label !== '');
    }

    return datasets.map((d, i) => ({
      label: d.label || ('Seri ' + (i + 1)),
      getColor: () => Array.isArray(d.backgroundColor) ? d.backgroundColor[0] : (d.backgroundColor || d.borderColor),
      setColor: (hex) => {
        if(Array.isArray(d.backgroundColor)) d.backgroundColor = d.backgroundColor.map(() => hex);
        else if(d.backgroundColor !== undefined) d.backgroundColor = hex;
        if(d.borderColor !== undefined) d.borderColor = hex;
      },
    }));
  }

  /* ---------------------------------------------------------------
     4. BAKE OVERRIDE TERSIMPAN KE CONFIG -- dipanggil SEBELUM chart
     dibuat, jadi paint pertama udah langsung bener (gak perlu update()
     sama sekali buat kasus load ulang / ganti tema / ganti filter).
     --------------------------------------------------------------- */
  function ccPrepareConfig(config, canvasId){
    const entries = ccGetEntries({ data: config.data });
    const defaults = {};
    entries.forEach(e => { defaults[e.label] = e.getColor(); });
    ccDefaultsByCanvas[canvasId] = defaults;
    const stored = ccGetStore()[canvasId];
    if(stored) entries.forEach(e => { if(stored[e.label]) e.setColor(stored[e.label]); });
  }

  /* ---------------------------------------------------------------
     5. TOOLBAR -- ditaruh di baris paling atas .card-body (di atas
     .chart-box), jadi keliatan "di bagian atas" kartu grafiknya.
     Cuma dipasang kalau ccIsAdmin() true (dicek sebelum manggil ini).
     --------------------------------------------------------------- */
  function ccAttachToolbar(canvas, chartInstance, canvasId, config){
    let chart = chartInstance;
    const entries = ccGetEntries(chart);
    if(!entries.length) return;
    const container = canvas.closest('.card-body');
    if(!container) return;

    let wrap = container.querySelector(':scope > .cc-widget');
    if(!wrap){
      wrap = document.createElement('div');
      wrap.className = 'cc-widget';
      wrap.innerHTML = `
        <button type="button" class="cc-toggle-btn" title="Kustomisasi warna grafik">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
        </button>
        <div class="cc-toolbar">
          <span class="cc-toolbar-label">Warna</span>
          <select class="cc-select"></select>
          <input type="color" class="cc-color" title="Pilih warna">
          <button type="button" class="cc-reset" title="Kembalikan ke warna default">↺</button>
        </div>
      `;
      container.insertBefore(wrap, container.firstChild);
      wrap.querySelector('.cc-toggle-btn').addEventListener('click', () => {
        wrap.querySelector('.cc-toolbar').classList.toggle('cc-open');
      });
    }

    const bar = wrap.querySelector('.cc-toolbar');
    const select = bar.querySelector('.cc-select');
    const colorInput = bar.querySelector('.cc-color');
    const resetBtn = bar.querySelector('.cc-reset');
    const prevSelected = select.value;
    select.innerHTML = entries.map(e => `<option value="${ccEsc(e.label)}">${ccEsc(e.label)}</option>`).join('');
    if(entries.some(e => e.label === prevSelected)) select.value = prevSelected;

    function findEntry(){ const es = ccGetEntries(chart); return es.find(e => e.label === select.value) || es[0]; }
    function syncColorInput(){ const e = findEntry(); if(e) colorInput.value = ccToHex(e.getColor()); }
    syncColorInput();

    // Destroy + bikin instance baru dari config yang sama (udah kemutasi
    // warnanya) -- dijamin full repaint, gak nunggu hover buat kegambar.
    function repaint(){
      chart.destroy();
      chart = new OrigChart(canvas, config);
      if(typeof chartInstances !== 'undefined') chartInstances[canvasId] = chart;
    }

    select.onchange = syncColorInput;
    colorInput.oninput = () => {
      const entry = findEntry();
      if(!entry) return;
      entry.setColor(colorInput.value);
      repaint();
      ccSaveOverride(canvasId, entry.label, colorInput.value);
    };
    resetBtn.onclick = () => {
      const entry = findEntry();
      const original = (ccDefaultsByCanvas[canvasId] || {})[entry.label];
      if(original == null) return;
      entry.setColor(original);
      repaint();
      ccClearOverride(canvasId, entry.label);
      syncColorInput();
    };
  }

  /* ---------------------------------------------------------------
     6. PATCH KONSTRUKTOR GLOBAL -- satu titik reuse buat semua
     draw*() yang udah ada (app.js & tv-mode.js), tanpa ubah fungsi2
     itu satu-satu. Semua static member (Chart.register, Chart.defaults,
     dst) tetap jalan lewat prototype chain ke Chart asli.
     --------------------------------------------------------------- */
  const OrigChart = window.Chart;
  function PatchedChart(ctx, config){
    const canvasId = ctx && ctx.id;
    const eligible = !!canvasId && !CC_SKIP_PREFIX.some(p => canvasId.indexOf(p) === 0);
    if(eligible){
      try { ccPrepareConfig(config, canvasId); } catch(e){ console.error('chart-color-customizer:', e); }
    }
    const inst = new OrigChart(ctx, config);
    if(eligible && ccIsAdmin()){
      try { ccAttachToolbar(ctx, inst, canvasId, config); } catch(e){ console.error('chart-color-customizer:', e); }
    }
    return inst;
  }
  Object.setPrototypeOf(PatchedChart, OrigChart);
  PatchedChart.__ccPatched = true;
  window.Chart = PatchedChart;
})();
