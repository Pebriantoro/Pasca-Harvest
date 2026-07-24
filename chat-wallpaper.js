/* =====================================================================
   WALLPAPER CHAT — ganti background Chat Tim & Pesan Langsung.
   ADDITIF, load SETELAH app.js & chat-polish.js.
   ---------------------------------------------------------------------
   Pilihan tersimpan LOKAL per perangkat/browser (localStorage), berlaku
   utk kedua ruang chat (Chat Tim & Pesan Langsung) sekaligus, karena ini
   preferensi tampilan personal, bukan data server.
   ===================================================================== */

const CHAT_WALLPAPER_KEY = 'chat_wallpaper_v1';

/* ---- Util: bikin data-URI SVG pattern jadi CSS url() ---- */
function _cwSvgUrl(svg){
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/* ---- Daftar preset wallpaper (banyak pilihan, semua digambar sendiri
        lewat CSS/SVG — tidak ada aset gambar eksternal). ---- */
const CHAT_WALLPAPERS = [
  { id:'default', label:'Bawaan (Tema Aplikasi)', preview:{ background:'var(--bg-card)' }, style:null },
  { id:'gold', label:'Gold Malam', preview:{ background:'linear-gradient(135deg,#3a3226,#201b14)' },
    style:{ backgroundImage:'linear-gradient(135deg,#3a3226,#201b14)' } },
  { id:'forest', label:'Hutan Sawit', preview:{ background:'linear-gradient(135deg,#1c3324,#0e1a13)' },
    style:{ backgroundImage:'linear-gradient(135deg,#1c3324,#0e1a13)' } },
  { id:'midnight', label:'Midnight Blue', preview:{ background:'linear-gradient(150deg,#16203a,#0a0f1c)' },
    style:{ backgroundImage:'linear-gradient(150deg,#16203a,#0a0f1c)' } },
  { id:'sunset', label:'Senja Kebun', preview:{ background:'linear-gradient(135deg,#3d2416,#1c120c)' },
    style:{ backgroundImage:'linear-gradient(135deg,#3d2416,#1c120c)' } },
  { id:'plum', label:'Plum Elegan', preview:{ background:'linear-gradient(135deg,#2e1c33,#150c19)' },
    style:{ backgroundImage:'linear-gradient(135deg,#2e1c33,#150c19)' } },
  { id:'dotgrid', label:'Dot Grid', preview:{ background:'#1c1c1c', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><circle cx='2' cy='2' r='1.3' fill='rgba(255,255,255,.35)'/></svg>") },
    style:{ backgroundColor:'#1c1c1c', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='2' cy='2' r='1.3' fill='rgba(255,255,255,.14)'/></svg>"), backgroundSize:'22px 22px' } },
  { id:'diagonal', label:'Garis Diagonal', preview:{ background:'#1e2420', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><path d='M0 16L16 0' stroke='rgba(255,255,255,.3)' stroke-width='2'/></svg>") },
    style:{ backgroundColor:'#1e2420', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><path d='M0 34L34 0' stroke='rgba(255,255,255,.07)' stroke-width='2'/></svg>"), backgroundSize:'34px 34px' } },
  { id:'leaf', label:'Motif Daun Sawit', preview:{ background:'#132018', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M6 32C6 20 14 12 26 12C19 18 15 25 13 34Z' fill='none' stroke='rgba(160,210,150,.5)' stroke-width='2'/></svg>") },
    style:{ backgroundColor:'#132018', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='110' height='110'><g fill='none' stroke='rgba(160,210,150,.16)' stroke-width='2'><path d='M18 88C18 58 38 34 68 34C52 50 42 68 36 98Z'/><circle cx='90' cy='24' r='9'/></g></svg>"), backgroundSize:'110px 110px' } },
  { id:'paper', label:'Tekstur Kertas', preview:{ background:'#20221f' },
    style:{ backgroundColor:'#20221f', backgroundImage:_cwSvgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='n'><feTurbulence baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='.05'/></svg>"), backgroundSize:'90px 90px' } },
];

function _cwGetSetting(){
  try{ return JSON.parse(localStorage.getItem(CHAT_WALLPAPER_KEY) || 'null'); }
  catch{ return null; }
}
function _cwSetSetting(val){
  localStorage.setItem(CHAT_WALLPAPER_KEY, JSON.stringify(val));
}

/* ---------------------------------------------------------------------
   1. TERAPKAN wallpaper ke satu elemen (#chatMessages / #dmMessages)
   --------------------------------------------------------------------- */
function applyChatWallpaperTo(el){
  if(!el) return;
  el.style.backgroundColor = '';
  el.style.backgroundImage = '';
  el.style.backgroundSize = '';
  el.style.backgroundRepeat = '';
  el.style.backgroundPosition = '';

  const setting = _cwGetSetting();
  if(!setting || setting.type === 'default') return;

  if(setting.type === 'custom' && setting.dataUrl){
    el.style.backgroundImage = `url("${setting.dataUrl}")`;
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    return;
  }
  if(setting.type === 'preset'){
    const wp = CHAT_WALLPAPERS.find(w => w.id === setting.id);
    if(!wp || !wp.style) return;
    Object.assign(el.style, wp.style);
  }
}
function applyChatWallpaperEverywhere(){
  applyChatWallpaperTo(document.getElementById('chatMessages'));
  applyChatWallpaperTo(document.getElementById('dmMessages'));
}

/* Terapkan ulang tiap kali halaman Chat Tim / DM digambar ulang. */
const _cwPrevRenderChat = typeof renderChat === 'function' ? renderChat : null;
if(_cwPrevRenderChat){
  renderChat = async function(...args){
    const r = await _cwPrevRenderChat.apply(this, args);
    injectChatWallpaperButton('chatOnlineWrap');
    applyChatWallpaperTo(document.getElementById('chatMessages'));
    return r;
  };
}
const _cwPrevOpenDMConversation = typeof openDMConversation === 'function' ? openDMConversation : null;
if(_cwPrevOpenDMConversation){
  openDMConversation = function(...args){
    const r = _cwPrevOpenDMConversation.apply(this, args);
    injectChatWallpaperButton('dmHeaderActions');
    applyChatWallpaperTo(document.getElementById('dmMessages'));
    return r;
  };
}

/* ---------------------------------------------------------------------
   2. TOMBOL "Wallpaper" di header Chat Tim & DM
   --------------------------------------------------------------------- */
function injectChatWallpaperButton(anchorId){
  // Chat Tim: taruh tombol di sebelah tombol Online (card-header).
  if(anchorId === 'chatOnlineWrap'){
    const header = document.getElementById('chatOnlineWrap')?.parentElement;
    if(header && !document.getElementById('chatWallpaperBtn')){
      const btn = document.createElement('button');
      btn.id = 'chatWallpaperBtn';
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-sm';
      btn.title = 'Ganti wallpaper chat';
      btn.style.marginLeft = '8px';
      btn.innerHTML = '🎨 Wallpaper';
      btn.onclick = () => openChatWallpaperModal();
      header.insertBefore(btn, document.getElementById('chatOnlineWrap'));
    }
    return;
  }
  // DM: tombol kecil di header percakapan (nama lawan bicara).
  if(anchorId === 'dmHeaderActions'){
    const header = document.querySelector('#dmConversation .dm-conversation-header');
    if(header && !document.getElementById('dmWallpaperBtn')){
      const btn = document.createElement('button');
      btn.id = 'dmWallpaperBtn';
      btn.type = 'button';
      btn.className = 'btn btn-outline btn-icon';
      btn.title = 'Ganti wallpaper chat';
      btn.style.marginLeft = 'auto';
      btn.innerHTML = '🎨';
      btn.onclick = () => openChatWallpaperModal();
      header.appendChild(btn);
    }
  }
}

/* ---------------------------------------------------------------------
   3. MODAL PEMILIH WALLPAPER
   --------------------------------------------------------------------- */
(function injectChatWallpaperStyles(){
  const css = `
    .cw-grid{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:4px; }
    .cw-swatch{ position:relative; height:64px; border-radius:10px; cursor:pointer; border:2px solid transparent;
      background-size:22px 22px; overflow:hidden; display:flex; align-items:flex-end; justify-content:center; }
    .cw-swatch.active{ border-color:var(--accent-gold,#D9A94A); }
    .cw-swatch span{ font-size:10px; color:#fff; background:rgba(0,0,0,.45); width:100%; text-align:center; padding:3px 2px; }
    .cw-upload-row{ margin-top:14px; display:flex; align-items:center; gap:10px; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

function openChatWallpaperModal(){
  if(document.getElementById('chatWallpaperOverlay')) return;
  const current = _cwGetSetting();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'chatWallpaperOverlay';
  overlay.onclick = (e) => { if(e.target === overlay) closeChatWallpaperModal(); };
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:460px;">
      <div class="modal-header">
        <div class="card-title">Wallpaper Chat</div>
        <button class="btn btn-outline btn-icon" onclick="closeChatWallpaperModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-muted); font-size:12.5px; margin-bottom:4px;">
          Pilihan tersimpan di perangkat ini saja, berlaku utk Chat Tim &amp; Pesan Langsung.
        </p>
        <div class="cw-grid" id="cwGrid">
          ${CHAT_WALLPAPERS.map(w => `
            <div class="cw-swatch ${(!current||current.type==='default') && w.id==='default' ? 'active':''} ${current?.type==='preset' && current.id===w.id ? 'active':''}"
                 style="background:${w.preview.background};${w.preview.backgroundImage?`background-image:${w.preview.backgroundImage};`:''}"
                 onclick="selectChatWallpaper('${w.id}')">
              <span>${w.label}</span>
            </div>
          `).join('')}
        </div>
        <div class="cw-upload-row">
          <label class="btn btn-outline btn-sm" style="cursor:pointer;">
            Unggah Gambar Sendiri
            <input type="file" accept="image/*" style="display:none;" onchange="uploadChatWallpaper(event)">
          </label>
          ${current?.type==='custom' ? '<span style="font-size:11.5px; color:var(--text-faint);">Sedang dipakai: gambar unggahan</span>' : ''}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}
function closeChatWallpaperModal(){
  document.getElementById('chatWallpaperOverlay')?.remove();
}

function selectChatWallpaper(id){
  _cwSetSetting(id === 'default' ? { type:'default' } : { type:'preset', id });
  applyChatWallpaperEverywhere();
  closeChatWallpaperModal();
  toast('Wallpaper chat diganti');
}

function uploadChatWallpaper(e){
  const file = e.target.files?.[0];
  if(!file) return;
  if(file.size > 3 * 1024 * 1024){
    toast('Ukuran gambar maksimal 3MB', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    _cwSetSetting({ type:'custom', dataUrl: reader.result });
    applyChatWallpaperEverywhere();
    closeChatWallpaperModal();
    toast('Wallpaper chat diganti');
  };
  reader.readAsDataURL(file);
}

/* Terapkan begitu skrip ini dimuat, kalau kebetulan halaman Chat/DM
   sudah lebih dulu terbuka sebelum skrip ini sempat jalan. */
applyChatWallpaperEverywhere();
