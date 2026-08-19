/* m3-ripple.js — efek ripple ala Material 3 (state layer on press).
   Murni tambahan visual, event delegation, TIDAK ubah logic app.js manapun. */
(function(){
  var SELECTOR = '.btn, .nav-item, .bottom-nav-item, .pill-btn, .btn-icon';
  var css = document.createElement('style');
  css.textContent =
    '.m3-ripple{position:absolute;border-radius:50%;transform:scale(0);' +
    'background:currentColor;opacity:.22;pointer-events:none;' +
    'animation:m3RippleAnim 500ms cubic-bezier(.2,0,0,1);}' +
    '@keyframes m3RippleAnim{to{transform:scale(2.6);opacity:0;}}';
  document.head.appendChild(css);

  document.addEventListener('pointerdown', function(e){
    var el = e.target.closest(SELECTOR);
    if (!el) return;
    var style = getComputedStyle(el);
    if (style.position === 'static') el.style.position = 'relative';
    if (style.overflow !== 'hidden') el.style.overflow = 'hidden';

    var rect = el.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    var span = document.createElement('span');
    span.className = 'm3-ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - rect.left - size / 2) + 'px';
    span.style.top = (e.clientY - rect.top - size / 2) + 'px';
    el.appendChild(span);
    span.addEventListener('animationend', function(){ span.remove(); });
  }, { passive: true });
})();
