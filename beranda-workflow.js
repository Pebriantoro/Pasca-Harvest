/* =====================================================================
   BERANDA WORKFLOW HERO — logic carousel. Additif, load SETELAH beranda.js
   (lihat index.html) supaya bisa membungkus ulang renderBeranda() & navigate()
   yang sudah didefinisikan di sana, tanpa mengubah file itu langsung.

   Strategi performa (biar smooth, terutama di HP):
   1. TEKNIK PING-PONG 2-LAYER — hanya 2 elemen <img> yang pernah ada di DOM
      (bukan 8 ditumpuk), jadi browser cuma composite 2 gambar per saat,
      bukan 8. Yang gantian cuma `src` + kelas aktifnya.
   2. PRELOAD & DECODE DI MUKA — begitu Beranda dibuka, seluruh 8 gambar
      langsung di-preload via `new Image()` + `.decode()` di background
      (idle time), jadi pas giliran tampil sudah ada di cache browser &
      sudah didekode — tidak ada jeda/flicker saat transisi.
   3. RESPONSIVE SRCSET — tiap gambar punya 2 resolusi (desktop ~1400px,
      mobile ~800px, WebP terkompres), otomatis milih yang pas via
      window.matchMedia, supaya HP tidak perlu unduh gambar desktop yang
      lebih besar (hemat data & waktu decode).
   4. TRANSISI CUMA OPACITY — tidak ada animasi width/height/top/left yang
      memicu reflow; opacity + will-change supaya digambar di GPU layer.
   5. AUTO-PAUSE — interval berhenti kalau tab disembunyikan
      (document.hidden) atau saat pindah dari halaman Beranda, supaya
      tidak buang CPU/baterai di background.
   ===================================================================== */

const WF_SLIDES = [
  {
    step: 'Tahap 1 / 8', title: 'Persiapan Lahan',
    desc: 'Lahan dibersihkan dari sisa tanaman & gulma memakai alat berat (bulldozer/traktor besar) yang meratakan tanah dan menumbangkan vegetasi liar, sebelum diolah lebih lanjut.',
    img: 'assets/workflow/persiapan-lahan.webp', imgM: 'assets/workflow/persiapan-lahan-m.webp',
  },
  {
    step: 'Tahap 2 / 8', title: 'Pembajakan (Plowing)',
    desc: 'Traktor besar menarik bajak piringan (disc plow) untuk membalikkan tanah, memecah bongkahan keras, dan meningkatkan aerasi tanah.',
    img: 'assets/workflow/bajak.webp', imgM: 'assets/workflow/bajak-m.webp',
  },
  {
    step: 'Tahap 3 / 8', title: 'Pembuatan Alur (Furrowing)',
    desc: 'Tanah yang sudah dibajak dibuatkan alur tanam. Traktor menarik ridger yang membentuk gundukan & parit lurus rapi, tempat peletakan bibit tebu nantinya.',
    img: 'assets/workflow/furrowing.webp', imgM: 'assets/workflow/furrowing-m.webp',
  },
  {
    step: 'Tahap 4 / 8', title: 'Penanaman (Planting)',
    desc: 'Pekerja meletakkan potongan batang tebu (bibit/stek) secara manual ke dalam alur yang sudah dibuat, lalu bibit ditimbun tipis dengan tanah.',
    img: 'assets/workflow/planting.webp', imgM: 'assets/workflow/planting-m.webp',
  },
  {
    step: 'Tahap 5 / 8', title: 'Penyemprotan Gulma (Post Spraying)',
    desc: 'Herbisida post-emergence disemprot pakai boom sprayer yang ditarik traktor, mengendalikan gulma tanpa merusak bibit tebu yang belum muncul.',
    img: 'assets/workflow/post-spray.webp', imgM: 'assets/workflow/post-spray-m.webp',
  },
  {
    step: 'Tahap 6 / 8', title: 'Pemupukan (Fertilizing)',
    desc: 'Saat tanaman sudah setinggi lutut, traktor menarik alat penebar pupuk (fertilizer spreader) yang menjatuhkan pupuk granular di samping barisan tanaman (side-dressing).',
    img: 'assets/workflow/fertilizing.webp', imgM: 'assets/workflow/fertilizing-m.webp',
  },
  {
    step: 'Tahap 7 / 8', title: 'Tebang Bibit (Seed Cutting)',
    desc: 'Area tebu berkualitas tinggi ditebang manual pakai parang untuk dijadikan bibit siklus berikutnya — dipilih yang masih hijau, belum terlalu tua.',
    img: 'assets/workflow/tebang-bibit.webp', imgM: 'assets/workflow/tebang-bibit-m.webp',
  },
  {
    step: 'Tahap 8 / 8', title: 'Panen Raya (Tebang Giling)',
    desc: 'Mesin Sugarcane Harvester memanen tebu yang sudah tua & kering secara otomatis, mencacah batang dan mentransfernya ke truk gandeng menuju pabrik gula.',
    img: 'assets/workflow/tebang-giling.webp', imgM: 'assets/workflow/tebang-giling-m.webp',
  },
];

const WF_INTERVAL_MS = 4500;
let wfTimer = null;
let wfIndex = 0;
let wfActiveLayer = 'A'; // layer yang sedang tampil ('A' atau 'B')
const wfPreloaded = new Set();

function wfIsMobile(){ return window.matchMedia('(max-width:760px)').matches; }
function wfImgFor(slide){ return wfIsMobile() ? slide.imgM : slide.img; }

// Preload + decode di background (idle time), tidak menghalangi render awal.
function wfPreloadAll(){
  const run = () => {
    WF_SLIDES.forEach(s => {
      [s.img, s.imgM].forEach(src => {
        if(wfPreloaded.has(src)) return;
        wfPreloaded.add(src);
        const im = new Image();
        im.decoding = 'async';
        im.src = src;
        if(im.decode) im.decode().catch(()=>{});
      });
    });
  };
  if('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 300);
}

function wfRenderSlideHTML(idOrLetter){
  return `
    <div class="wf-slide" id="wfSlide${idOrLetter}" onclick="wfOpenModalFromSlide(this)">
      <div class="wf-slide-media">
        <img id="wfImg${idOrLetter}" alt="" decoding="async" fetchpriority="${idOrLetter==='A' ? 'high':'low'}">
      </div>
      <div class="wf-slide-text">
        <div class="wf-slide-step" id="wfStep${idOrLetter}"></div>
        <div class="wf-slide-title" id="wfTitle${idOrLetter}"></div>
        <div class="wf-slide-desc" id="wfDesc${idOrLetter}"></div>
      </div>
    </div>`;
}

function wfHeroHTML(){
  if(wfIsMobile()) return wfPeekHeroHTML();
  return `
    <div class="wf-hero" id="wfHero">
      ${wfRenderSlideHTML('A')}
      ${wfRenderSlideHTML('B')}
      <div class="wf-dots" id="wfDots">
        ${WF_SLIDES.map((_,i)=>`<button aria-label="Slide ${i+1}" onclick="wfGoTo(${i})"></button>`).join('')}
      </div>
    </div>`;
}

/* ---- Peek-card carousel (mobile/Android) — kartu tengah penuh, kartu
   kiri/kanan ngintip sebagian, swipe pakai scroll-snap native. ---- */
function wfPeekHeroHTML(){
  const last = WF_SLIDES[WF_SLIDES.length - 1];
  const first = WF_SLIDES[0];
  return `
    <div class="wf-hero wf-hero-mobile" id="wfHero">
      <div class="wf-peek-track" id="wfPeekTrack">
        <div class="wf-peek-card wf-peek-clone wf-peek-clone-start" aria-hidden="true" tabindex="-1">
          <div class="wf-peek-media"><img src="${last.imgM}" alt="" decoding="async" loading="lazy"></div>
          <div class="wf-peek-body">
            <div class="wf-peek-step">${last.step}</div>
            <div class="wf-peek-title">${last.title}</div>
            <div class="wf-peek-desc">${last.desc}</div>
          </div>
        </div>
        ${WF_SLIDES.map((s,i) => `
          <div class="wf-peek-card wf-peek-real" data-idx="${i}" onclick="wfOpenModal(${i})">
            <div class="wf-peek-media">
              <img src="${s.imgM}" alt="${s.title}" decoding="async" loading="${i===0?'eager':'lazy'}" fetchpriority="${i===0?'high':'low'}">
            </div>
            <div class="wf-peek-body">
              <div class="wf-peek-step">${s.step}</div>
              <div class="wf-peek-title">${s.title}</div>
              <div class="wf-peek-desc">${s.desc}</div>
            </div>
          </div>`).join('')}
        <div class="wf-peek-card wf-peek-clone wf-peek-clone-end" aria-hidden="true" tabindex="-1">
          <div class="wf-peek-media"><img src="${first.imgM}" alt="" decoding="async" loading="lazy"></div>
          <div class="wf-peek-body">
            <div class="wf-peek-step">${first.step}</div>
            <div class="wf-peek-title">${first.title}</div>
            <div class="wf-peek-desc">${first.desc}</div>
          </div>
        </div>
      </div>
      <div class="wf-dots" id="wfDots">
        ${WF_SLIDES.map((_,i)=>`<button aria-label="Slide ${i+1}" onclick="wfGoTo(${i})"></button>`).join('')}
      </div>
    </div>`;
}

let wfPeekObserver = null;
let wfPeekScrollTimer = null;

function wfInitPeekCarousel(){
  const track = document.getElementById('wfPeekTrack');
  if(!track) return;
  const cards = Array.from(track.querySelectorAll('.wf-peek-card.wf-peek-real'));

  // Posisikan awal: kartu pertama (index 0) di tengah, tanpa animasi,
  // supaya kartu terakhir (clone) langsung ngintip di sisi kiri sejak awal.
  cards[0]?.scrollIntoView({ behavior:'auto', inline:'center', block:'nearest' });

  if(wfPeekObserver) wfPeekObserver.disconnect();
  wfPeekObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      entry.target.classList.toggle('wf-peek-active', entry.intersectionRatio > 0.6);
      if(entry.intersectionRatio > 0.6 && entry.target.dataset.idx !== undefined){
        wfIndex = Number(entry.target.dataset.idx);
        wfUpdateDots(wfIndex);
      }
    });
  }, { root: track, threshold: [0, 0.6, 1] });
  cards.forEach(c => wfPeekObserver.observe(c));
  const cloneStart = track.querySelector('.wf-peek-clone-start');
  const cloneEnd = track.querySelector('.wf-peek-clone-end');
  if(cloneStart) wfPeekObserver.observe(cloneStart);
  if(cloneEnd) wfPeekObserver.observe(cloneEnd);

  // Loop tak berujung: kalau swipe nyampe kartu clone (ujung kiri/kanan),
  // begitu scroll berhenti, lompat instan (tanpa animasi) ke kartu asli
  // yang sepadan — jadi kerasa muter terus tanpa "mentok".
  track.addEventListener('scroll', () => {
    clearTimeout(wfPeekScrollTimer);
    wfPeekScrollTimer = setTimeout(wfPeekSnapIfClone, 120);
  }, { passive:true });

  wfIndex = 0;
  wfUpdateDots(0);
  wfPreloadAll();
  wfStopTimer(); wfStartTimer();

  track.addEventListener('touchstart', wfStopTimer, { passive:true });
  track.addEventListener('touchend', () => { wfStopTimer(); wfStartTimer(); }, { passive:true });
}

function wfPeekSnapIfClone(){
  const track = document.getElementById('wfPeekTrack');
  if(!track) return;
  const cloneStart = track.querySelector('.wf-peek-clone-start');
  const cloneEnd = track.querySelector('.wf-peek-clone-end');
  const reals = track.querySelectorAll('.wf-peek-card.wf-peek-real');
  if(cloneStart && cloneStart.classList.contains('wf-peek-active')){
    reals[reals.length - 1].scrollIntoView({ behavior:'auto', inline:'center', block:'nearest' });
    wfIndex = WF_SLIDES.length - 1; wfUpdateDots(wfIndex);
  } else if(cloneEnd && cloneEnd.classList.contains('wf-peek-active')){
    reals[0].scrollIntoView({ behavior:'auto', inline:'center', block:'nearest' });
    wfIndex = 0; wfUpdateDots(0);
  }
}

function wfPeekGoTo(idx){
  const track = document.getElementById('wfPeekTrack');
  const card = track && track.querySelectorAll('.wf-peek-card.wf-peek-real')[idx];
  if(card) card.scrollIntoView({ behavior:'smooth', inline:'center', block:'nearest' });
}

function wfFillLayer(letter, idx){
  const s = WF_SLIDES[idx];
  const img = document.getElementById('wfImg'+letter);
  if(!img) return;
  img.src = wfImgFor(s);
  img.alt = s.title;
  const slideEl = document.getElementById('wfSlide'+letter);
  if(slideEl) slideEl.dataset.idx = idx;
  const stepEl = document.getElementById('wfStep'+letter);
  const titleEl = document.getElementById('wfTitle'+letter);
  const descEl = document.getElementById('wfDesc'+letter);
  if(stepEl) stepEl.textContent = s.step;
  if(titleEl) titleEl.textContent = s.title;
  if(descEl) descEl.textContent = s.desc;
}

function wfUpdateDots(idx){
  const dots = document.querySelectorAll('#wfDots button');
  dots.forEach((d,i) => d.classList.toggle('wf-active', i === idx));
}

function wfAdvance(){
  const nextIdx = (wfIndex + 1) % WF_SLIDES.length;
  if(document.getElementById('wfPeekTrack')){ wfPeekGoTo(nextIdx); return; }
  const showLetter = wfActiveLayer === 'A' ? 'B' : 'A';
  const hideLetter = wfActiveLayer;
  wfFillLayer(showLetter, nextIdx);
  const showEl = document.getElementById('wfSlide'+showLetter);
  const hideEl = document.getElementById('wfSlide'+hideLetter);
  if(showEl) showEl.classList.add('wf-active');
  if(hideEl) hideEl.classList.remove('wf-active');
  wfActiveLayer = showLetter;
  wfIndex = nextIdx;
  wfUpdateDots(wfIndex);
}

function wfGoTo(idx){
  if(idx === wfIndex) return;
  if(document.getElementById('wfPeekTrack')){ wfPeekGoTo(idx); wfStopTimer(); wfStartTimer(); return; }
  const showLetter = wfActiveLayer === 'A' ? 'B' : 'A';
  const hideLetter = wfActiveLayer;
  wfFillLayer(showLetter, idx);
  const showEl = document.getElementById('wfSlide'+showLetter);
  const hideEl = document.getElementById('wfSlide'+hideLetter);
  if(showEl) showEl.classList.add('wf-active');
  if(hideEl) hideEl.classList.remove('wf-active');
  wfActiveLayer = showLetter;
  wfIndex = idx;
  wfUpdateDots(wfIndex);
  wfStopTimer(); wfStartTimer(); // reset jadwal biar tidak langsung ganti lagi
}

function wfStartTimer(){
  if(wfTimer) return;
  if(document.hidden) return;
  wfTimer = setInterval(wfAdvance, WF_INTERVAL_MS);
}
function wfStopTimer(){
  if(wfTimer){ clearInterval(wfTimer); wfTimer = null; }
}

function wfInitHero(){
  if(document.getElementById('wfPeekTrack')){ wfInitPeekCarousel(); return; }
  wfIndex = 0; wfActiveLayer = 'A';
  wfFillLayer('A', 0);
  document.getElementById('wfSlideA')?.classList.add('wf-active');
  document.getElementById('wfSlideB')?.classList.remove('wf-active');
  wfUpdateDots(0);
  wfPreloadAll();
  wfStopTimer(); wfStartTimer();

  const hero = document.getElementById('wfHero');
  if(hero){
    hero.addEventListener('mouseenter', wfStopTimer);
    hero.addEventListener('mouseleave', wfStartTimer);
  }
}

document.addEventListener('visibilitychange', () => {
  if(document.hidden) wfStopTimer();
  else if(currentView === 'beranda') wfStartTimer();
});

// Matikan interval saat pindah dari Beranda ke menu lain, biar tidak jalan
// terus di background (buang-buang CPU/baterai HP).
const _wfPrevNavigate = navigate;
navigate = async function(view){
  if(view !== 'beranda') wfStopTimer();
  return _wfPrevNavigate(view);
};

/* ===================== MODAL DETAIL (klik kartu) ===================== */
function wfEnsureModal(){
  if(document.getElementById('wfModal')) return;
  const div = document.createElement('div');
  div.id = 'wfModal';
  div.className = 'wf-modal';
  div.setAttribute('role','dialog');
  div.setAttribute('aria-modal','true');
  div.innerHTML = `
    <div class="wf-modal-backdrop" onclick="wfCloseModal()"></div>
    <div class="wf-modal-card">
      <button type="button" class="wf-modal-close" onclick="wfCloseModal()" aria-label="Tutup">&times;</button>
      <div class="wf-modal-media"><img id="wfModalImg" alt=""></div>
      <div class="wf-modal-body">
        <div class="wf-modal-step" id="wfModalStep"></div>
        <div class="wf-modal-title" id="wfModalTitle"></div>
        <div class="wf-modal-desc" id="wfModalDesc"></div>
      </div>
    </div>`;
  document.body.appendChild(div);
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') wfCloseModal();
  });
}

function wfOpenModal(idx){
  const s = WF_SLIDES[idx];
  if(!s) return;
  wfEnsureModal();
  wfStopTimer();
  document.getElementById('wfModalImg').src = wfIsMobile() ? s.imgM : s.img;
  document.getElementById('wfModalImg').alt = s.title;
  document.getElementById('wfModalStep').textContent = s.step;
  document.getElementById('wfModalTitle').textContent = s.title;
  document.getElementById('wfModalDesc').textContent = s.desc;
  document.getElementById('wfModal').classList.add('wf-modal-open');
  document.body.classList.add('wf-modal-noscroll');
}

function wfOpenModalFromSlide(el){
  const idx = Number(el.dataset.idx || 0);
  wfOpenModal(idx);
}

function wfCloseModal(){
  const modal = document.getElementById('wfModal');
  if(modal) modal.classList.remove('wf-modal-open');
  document.body.classList.remove('wf-modal-noscroll');
  if(currentView === 'beranda') wfStartTimer();
}
