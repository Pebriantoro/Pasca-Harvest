const { JSDOM } = require('jsdom');
const fs = require('fs');

const html = `<!DOCTYPE html><html><body>
<div id="appShell" class="hidden">
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header"></div>
  </aside>
</div>
</body></html>`;

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.toggleSidebar = function(){};

const script = fs.readFileSync(__dirname + '/bottom-nav.js', 'utf8');
window.eval(script);

function check(label, cond){
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
  if(!cond) process.exitCode = 1;
}

const doc = window.document;

// init() nunggu DOMContentLoaded kalau readyState masih 'loading' pas script
// di-eval (persis kayak kondisi asli: <script src="bottom-nav.js"> di-load
// sebelum body kelar diparse) -> tunggu event itu nembak dulu.
setTimeout(() => {
const bar = doc.getElementById('bottomNav');
const closeBtn = doc.getElementById('bnavCloseMenu');
const menuBtn = doc.getElementById('bnavMenu');

check('bottomNav dibuat', !!bar);
check('bnavCloseMenu ke-inject ke .sidebar-header', !!closeBtn);
check('bnavMenu ada di dalam bar', !!menuBtn && bar.contains(menuBtn));
check('bar awalnya nge-hide (appShell masih .hidden)', bar.classList.contains('!hidden'));

// login: appShell buka
doc.getElementById('appShell').classList.remove('hidden');

// MutationObserver jalan microtask/macrotask -> tunggu sebentar
setTimeout(() => {
  check('bar muncul (appShell udah kebuka, sidebar masih ketutup)', !bar.classList.contains('!hidden'));

  // buka sidebar
  doc.getElementById('sidebar').classList.add('open');

  setTimeout(() => {
    check('bar ke-hide pas sidebar lagi open (menu-open state)', bar.classList.contains('!hidden'));
    check('menuBtn jadi state aktif (text-green)', menuBtn.classList.contains('text-green'));
    check('icon-wrap dapet animate-bnavPop pas aktif', menuBtn.querySelector('.bn-icon-wrap').classList.contains('animate-bnavPop'));

    // tutup sidebar lagi
    doc.getElementById('sidebar').classList.remove('open');
    setTimeout(() => {
      check('bar balik muncul pas sidebar ketutup lagi', !bar.classList.contains('!hidden'));
      check('menuBtn balik ke state nonaktif (text-text-muted)', menuBtn.classList.contains('text-text-muted') && !menuBtn.classList.contains('text-green'));
      check('icon-wrap animate-bnavPop kehapus pas nonaktif', !menuBtn.querySelector('.bn-icon-wrap').classList.contains('animate-bnavPop'));

      // pastiin gak dobel render kalo init ke-panggil lagi
      window.eval(script);
      check('buildBar idempotent (gak nambah #bottomNav kedua)', doc.querySelectorAll('#bottomNav').length === 1);

      console.log('\\nSelesai.');
    }, 10);
  }, 10);
}, 10);
}, 20);
