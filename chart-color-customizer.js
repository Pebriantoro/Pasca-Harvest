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

   Simpan pilihan warna ke localStorage (per canvasId + label), jadi
   nempel lagi otomatis tiap grafik itu digambar ulang (ganti tema,
   ganti filter, reload halaman).
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
     1. WARNA -> HEX (buat isi <input type="color">, yang cuma nerima
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
     2. ENTRIES -- daftar "isi grafik" yang bisa dipilih warnanya.
     Generik buat semua tipe grafik di app ini:
     - 1 dataset & backgroundColor berupa array (donut/pie/bar/hbar
       per-label) -> 1 entry per label (per potongan/batang).
     - beberapa dataset (grouped/stacked bar, line multi, progress
       bar bertumpuk) -> 1 entry per dataset (per seri/status).
     --------------------------------------------------------------- */
  function ccGetEntries(chart){
    const datasets = (chart.data && chart.data.datasets) || [];
    if(!datasets.length) return [];

    if(datasets.length === 1 && Array.isArray(datasets[0].backgroundColor)){
      const labels = chart.data.labels || [];
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
     3. TOOLBAR -- ditaruh di baris paling atas .card-body (di atas
     .chart-box), jadi keliatan "di bagian atas" kartu grafiknya.
     --------------------------------------------------------------- */
  function ccAttachToolbar(canvas, chart, canvasId){
    const entries = ccGetEntries(chart);
    if(!entries.length) return;
    const container = canvas.closest('.card-body');
    if(!container) return;

    let bar = container.querySelector(':scope > .cc-toolbar');
    if(!bar){
      bar = document.createElement('div');
      bar.className = 'cc-toolbar';
      bar.innerHTML = `
        <span class="cc-toolbar-label">Warna</span>
        <select class="cc-select"></select>
        <input type="color" class="cc-color" title="Pilih warna">
        <button type="button" class="cc-reset" title="Kembalikan ke warna default">↺</button>
      `;
      container.insertBefore(bar, container.firstChild);
    }

    const select = bar.querySelector('.cc-select');
    const colorInput = bar.querySelector('.cc-color');
    const resetBtn = bar.querySelector('.cc-reset');
    const prevSelected = select.value;
    select.innerHTML = entries.map(e => `<option value="${ccEsc(e.label)}">${ccEsc(e.label)}</option>`).join('');
    if(entries.some(e => e.label === prevSelected)) select.value = prevSelected;

    function findEntry(){ return entries.find(e => e.label === select.value) || entries[0]; }
    function syncColorInput(){ colorInput.value = ccToHex(findEntry().getColor()); }
    syncColorInput();

    select.onchange = syncColorInput;
    colorInput.oninput = () => {
      const entry = findEntry();
      entry.setColor(colorInput.value);
      chart.clear(); chart.update('none');
      ccSaveOverride(canvasId, entry.label, colorInput.value);
    };
    resetBtn.onclick = () => {
      const entry = findEntry();
      const original = (ccDefaultsByCanvas[canvasId] || {})[entry.label];
      if(original == null) return;
      entry.setColor(original);
      chart.clear(); chart.update('none');
      ccClearOverride(canvasId, entry.label);
      syncColorInput();
    };
  }

  function ccApplyStoredOverrides(chart, canvasId){
    const stored = ccGetStore()[canvasId];
    if(!stored) return;
    let changed = false;
    ccGetEntries(chart).forEach(e => {
      if(stored[e.label] && stored[e.label] !== e.getColor()){ e.setColor(stored[e.label]); changed = true; }
    });
    if(changed){ chart.clear(); chart.update('none'); }
  }

  /* ---------------------------------------------------------------
     4. PATCH KONSTRUKTOR GLOBAL -- satu titik reuse buat semua
     draw*() yang udah ada (app.js & tv-mode.js), tanpa ubah fungsi2
     itu satu-satu. Semua static member (Chart.register, Chart.defaults,
     dst) tetap jalan lewat prototype chain ke Chart asli.
     --------------------------------------------------------------- */
  const OrigChart = window.Chart;
  function PatchedChart(ctx, config){
    const inst = new OrigChart(ctx, config);
    try {
      const canvasId = ctx && ctx.id;
      if(canvasId && !CC_SKIP_PREFIX.some(p => canvasId.indexOf(p) === 0)){
        const defaults = {};
        ccGetEntries(inst).forEach(e => { defaults[e.label] = e.getColor(); });
        ccDefaultsByCanvas[canvasId] = defaults;
        ccApplyStoredOverrides(inst, canvasId);
        ccAttachToolbar(ctx, inst, canvasId);
      }
    } catch(e){ console.error('chart-color-customizer:', e); }
    return inst;
  }
  Object.setPrototypeOf(PatchedChart, OrigChart);
  PatchedChart.__ccPatched = true;
  window.Chart = PatchedChart;
})();
