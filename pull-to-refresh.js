/* =====================================================================
   PULL-TO-REFRESH (mobile) — tarik dari scroll paling atas buat refresh
   view yang lagi dibuka, animasi spinner gaya Google/Material (SwipeRefresh).
   Additif, tidak mengubah file lain. Aman dipasang di semua halaman karena
   cuma aktif kalau: layar mobile (<=760px) DAN window.scrollY === 0.

   v2: konten ikut "gerak" turun pas ditarik (bukan cuma indikator diem
   di atas), pakai kurva elastis (rubber-band, resistensi makin gede
   makin ditarik jauh) + rAF batching biar gak jank pas jari gerak cepat,
   plus spring bounce pas dilepas.
   ===================================================================== */

const PTR_THRESHOLD = 70;   // px tarikan buat trigger refresh
const PTR_MAX_PULL  = 110;  // batas jarak indikator turun
const PTR_MAX_CONTENT_PULL = 46; // batas konten ikut turun (lebih kecil dari indikator, biar ga lebay)
const PTR_SPRING = 'cubic-bezier(.34,1.56,.64,1)'; // sama kayak bnavPop, kesan "mantul"

let ptrStartY = 0;
let ptrPulling = false;
let ptrRefreshing = false;
let ptrEl = null;
let ptrContentEl = null;
let ptrRAF = null;
let ptrLastDy = 0;
const PTR_CIRC = 2 * Math.PI * 16;

function ptrIsMobile(){ return window.matchMedia('(max-width:760px)').matches; }

// Resistensi elastis: makin jauh ditarik, makin "berat"/lambat
// nambahnya — kesan rubber-band asli, bukan gerak lurus 1:1 jari.
function ptrElastic(dy, limit){
  return limit * (1 - Math.exp(-dy / limit));
}

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

function ptrContent(){
  if(ptrContentEl && document.body.contains(ptrContentEl)) return ptrContentEl;
  ptrContentEl = document.querySelector('.main-area');
  return ptrContentEl;
}

function ptrApplyProgress(dy){
  const el = ptrEnsureEl();
  const content = ptrContent();
  const pulled = ptrElastic(Math.max(0, dy), PTR_MAX_PULL);
  const pct = Math.max(0, Math.min(pulled / PTR_THRESHOLD, 1));

  el.style.transform = `translate(-50%, ${pulled - 44}px) rotate(${pct * 180}deg)`;
  el.style.opacity = String(Math.min(pct * 1.3, 1));
  const arc = el.querySelector('.ptr-spinner-arc');
  arc.style.strokeDashoffset = String(PTR_CIRC * (1 - pct * 0.78));
  el.classList.toggle('ptr-ready', pct >= 1);

  if(content){
    const contentPull = ptrElastic(Math.max(0, dy), PTR_MAX_CONTENT_PULL);
    content.style.transform = `translateY(${contentPull}px)`;
  }
}

function ptrSetProgress(dy){
  ptrLastDy = dy;
  if(ptrRAF) return; // udah ada frame nunggu, cukup update ptrLastDy, gak usah numpuk request
  ptrRAF = requestAnimationFrame(() => {
    ptrApplyProgress(ptrLastDy);
    ptrRAF = null;
  });
}

function ptrReset(){
  if(ptrRAF){ cancelAnimationFrame(ptrRAF); ptrRAF = null; }
  const el = ptrEnsureEl();
  const content = ptrContent();
  el.classList.remove('ptr-active');
  el.style.transition = `transform .38s ${PTR_SPRING}, opacity .25s ease`;
  el.style.transform = 'translate(-50%, -44px) rotate(0deg)';
  el.style.opacity = '0';
  el.classList.remove('ptr-ready');
  if(content){
    content.style.transition = `transform .38s ${PTR_SPRING}`;
    content.style.transform = 'translateY(0px)';
  }
  setTimeout(() => {
    if(el) el.style.transition = '';
    if(content) content.style.transition = '';
  }, 390);
}

async function ptrTriggerRefresh(){
  const el = ptrEnsureEl();
  const content = ptrContent();
  ptrRefreshing = true;
  el.classList.add('ptr-active');
  el.style.transition = `transform .22s ${PTR_SPRING}`;
  el.style.transform = 'translate(-50%, 20px)';
  el.style.opacity = '1';
  if(content){
    content.style.transition = `transform .22s ${PTR_SPRING}`;
    content.style.transform = `translateY(${PTR_MAX_CONTENT_PULL * 0.6}px)`;
  }

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
