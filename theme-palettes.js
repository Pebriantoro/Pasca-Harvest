/* =====================================================================
   THEME PALETTES — logic
   Additif -- render swatch di #paletteSwatchGrid (sudah ada di
   settingsPanel/index.html), simpan pilihan ke localStorage, terapkan
   lewat atribut [data-palette] di <html> (dibaca theme-palettes.css).
   Penerapan dini (anti-flash) sudah dipasang inline di <head> index.html.
   ===================================================================== */
(function(){
  const PALETTES = [
    { id: 'default', name: 'Estate Gold',   primary: '#D9A94A', secondary: '#5B8FA8' },
    { id: 'royal',   name: 'Royal Indigo',  primary: '#6C63FF', secondary: '#3F8EFD' },
    { id: 'sunset',  name: 'Sunset Coral',  primary: '#E8794A', secondary: '#F2B84B' },
    { id: 'rose',    name: 'Rose Violet',   primary: '#D6698A', secondary: '#8A6FD1' },
    { id: 'ocean',   name: 'Ocean Teal',    primary: '#2FA8A0', secondary: '#3C6E9E' },
    { id: 'copper',  name: 'Copper Sage',   primary: '#C97B4A', secondary: '#7C8B6F' },
    { id: 'mono',    name: 'Stone Mono',    primary: '#A8A29E', secondary: '#78716C' },
  ];
  const KEY = 'appPalette';

  function currentPalette(){
    try{ return localStorage.getItem(KEY) || 'default'; }catch(_e){ return 'default'; }
  }

  window.setAppPalette = function(id){
    const root = document.documentElement;
    if(!id || id === 'default') root.removeAttribute('data-palette');
    else root.setAttribute('data-palette', id);
    try{ localStorage.setItem(KEY, id || 'default'); }catch(_e){}
    highlightActiveSwatch();
  };

  function buildSwatches(){
    const grid = document.getElementById('paletteSwatchGrid');
    if(!grid || grid.dataset.built) return;
    grid.dataset.built = '1';
    grid.innerHTML = PALETTES.map(p => `
      <button type="button" class="palette-swatch" data-id="${p.id}" title="${p.name}"
        style="--sw-primary:${p.primary}; --sw-secondary:${p.secondary};"
        onclick="setAppPalette('${p.id}')"></button>
    `).join('');
    highlightActiveSwatch();
  }

  function highlightActiveSwatch(){
    const active = currentPalette();
    document.querySelectorAll('.palette-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.id === active);
    });
  }

  function init(){
    buildSwatches();
    // settingsPanel di-render sekali di HTML, tapi jaga-jaga kalau ada re-render lain
    document.getElementById('settingsWrap')?.addEventListener('click', buildSwatches);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
