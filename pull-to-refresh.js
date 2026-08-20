/* =====================================================================
   PULL-TO-REFRESH (mobile) — tarik dari scroll paling atas buat refresh
   view yang lagi dibuka, animasi spinner gaya Google/Material (SwipeRefresh).
   Additif, tidak mengubah file lain. Aman dipasang di semua halaman karena
   cuma aktif kalau: layar mobile (<=760px) DAN window.scrollY === 0.
   ===================================================================== */

const PTR_THRESHOLD = 70;   // px tarikan buat trigger refresh
const PTR_MAX_PULL  = 110;  // batas jarak indikator turun

let ptrStartY = 0;
let ptrPulling = false;
let ptrRefreshing = false;
let ptrEl = null;
const PTR_CIRC = 2 * Math.PI * 16;

function ptrIsMobile(){ return window.matchMedia('(max-width:760px)').matches; }

function ptrEnsureEl(){
  if(ptrEl) return ptrEl;
  const wrap = document.createElement('div');
  wrap.id = 'ptrIndicator';
  wrap.className = 'ptr-indicator';
  wrap.innerHTML = `
    <svg viewBox="0 0 40 40" class="ptr-spinner">
      <circle class="ptr-spinner-track" cx="20" cy="20" r="16"></circle>
      <circle class="ptr-spinner-arc" cx="20" cy="20" r="16"
        style="stroke-dasharray:${PTR_CIRC};stroke-dashoffset:${PTR_CIRC};"></circle>
    </svg>`;
  document.body.appendChild(wrap);
  ptrEl = wrap;
  return wrap;
}

function ptrSetProgress(dist){
  const el = ptrEnsureEl();
  const pct = Math.max(0, Math.min(dist / PTR_THRESHOLD, 1));
  const translate = Math.min(dist * 0.55, PTR_MAX_PULL);
  el.style.transform = `translate(-50%, ${translate - 44}px) rotate(${pct * 180}deg)`;
  el.style.opacity = String(Math.min(pct * 1.3, 1));
  const arc = el.querySelector('.ptr-spinner-arc');
  arc.style.strokeDashoffset = String(PTR_CIRC * (1 - pct * 0.78));
  el.classList.toggle('ptr-ready', pct >= 1);
}

function ptrReset(){
  const el = ptrEnsureEl();
  el.classList.remove('ptr-active');
  el.style.transition = 'transform .25s ease, opacity .25s ease';
  el.style.transform = 'translate(-50%, -44px) rotate(0deg)';
  el.style.opacity = '0';
  el.classList.remove('ptr-ready');
  setTimeout(() => { if(el) el.style.transition = ''; }, 260);
}

async function ptrTriggerRefresh(){
  const el = ptrEnsureEl();
  ptrRefreshing = true;
  el.classList.add('ptr-active');
  el.style.transition = 'transform .2s ease';
  el.style.transform = 'translate(-50%, 20px)';
  el.style.opacity = '1';

  const startedAt = Date.now();
  try{
    if(typeof navigate === 'function' && typeof currentView !== 'undefined' && currentView){
      await navigate(currentView);
    } else {
      await new Promise(r => setTimeout(r, 500));
    }
  } catch(err){
    console.error('Pull-to-refresh gagal:', err);
  }
  const elapsed = Date.now() - startedAt;
  if(elapsed < 550) await new Promise(r => setTimeout(r, 550 - elapsed));

  ptrRefreshing = false;
  ptrReset();
}

document.addEventListener('touchstart', (e) => {
  if(!ptrIsMobile() || ptrRefreshing) return;
  if(window.scrollY > 0) return;
  const target = e.target.closest('.wf-peek-track, .chat-messages, .stat-drawer-body, .modal-body');
  if(target) return; // jangan bentrok sama scroll area lain yang punya scroll sendiri
  ptrStartY = e.touches[0].clientY;
  ptrPulling = true;
}, { passive:true });

document.addEventListener('touchmove', (e) => {
  if(!ptrPulling || ptrRefreshing) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if(window.scrollY > 0 || dy <= 0){
    ptrPulling = false;
    ptrSetProgress(0);
    return;
  }
  ptrSetProgress(dy);
}, { passive:true });

document.addEventListener('touchend', () => {
  if(!ptrPulling || ptrRefreshing){ return; }
  ptrPulling = false;
  const el = ptrEnsureEl();
  if(el.classList.contains('ptr-ready')) ptrTriggerRefresh();
  else ptrReset();
}, { passive:true });
