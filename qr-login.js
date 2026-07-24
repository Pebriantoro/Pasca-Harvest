/* =====================================================================
   QR LOGIN — login PC dengan scan QR pakai HP yang sudah login.
   ADDITIF, load PALING TERAKHIR (setelah passcode-login.js).
   ---------------------------------------------------------------------
   Cara kerja (mirip WhatsApp Web):
   1) PC (belum login) buka tab "Scan QR" -> browser bikin 1 baris sesi
      baru di tabel qr_login_sessions (status 'pending'), lalu tampilkan
      QR yang isinya ID sesi itu.
   2) Di HP yang SUDAH login, buka menu Pengaturan -> "Scan QR Login PC",
      arahkan kamera ke QR di layar PC. HP kirim ID sesi (+ JWT akun HP
      otomatis lewat header) ke Edge Function qr-login (action 'approve').
      Function bikin token magic-link SEKALI PAKAI utk akun itu (tidak
      pernah dikirim email — cuma disimpan di baris sesi), status jadi
      'approved'.
   3) PC yang sedang polling melihat status 'approved', lalu tukar token
      itu lewat Edge Function (action 'consume', sekali pakai), lalu
      login otomatis pakai supa.auth.verifyOtp().
   WAJIB jalankan qr_login_schema.sql & deploy Edge Function "qr-login"
   di project Supabase Anda dulu — lihat isi file itu utk instruksi.
   ===================================================================== */

const QR_LOGIN_POLL_MS = 2500;
const QR_LOGIN_PREFIX = 'ESTATE2QR|';
let _qrPollTimer = null;
let _qrCurrentSid = null;

/* ---------------------------------------------------------------------
   1. INJEK CSS + TAB "Scan QR" DI HALAMAN LOGIN
   --------------------------------------------------------------------- */
(function injectQrLoginStyles(){
  const css = `
    #qrLoginForm{ text-align:center; }
    #qrLoginBox{ width:190px; height:190px; margin:6px auto 14px; border-radius:14px; background:#fff;
      display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; }
    #qrLoginBox img{ width:100%; height:100%; display:block; }
    #qrLoginBox .qr-overlay{ position:absolute; inset:0; background:rgba(255,255,255,.95); display:flex;
      flex-direction:column; align-items:center; justify-content:center; gap:10px; padding:10px; text-align:center; color:#1a1a1a; font-size:12px; }
    #qrLoginStatus{ font-size:12px; color:var(--text-muted); min-height:16px; margin-bottom:6px; }
    #qrLoginHint{ font-size:11.5px; color:var(--text-faint); line-height:1.5; }
    .qr-scan-video{ width:100%; max-width:340px; border-radius:12px; background:#000; display:block; margin:0 auto; }
    .qr-scan-canvas{ display:none; }
  `;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
})();

function buildQrLoginTab(){
  if(document.getElementById('tabQrLogin')) return;
  const toggle = document.querySelector('.tab-toggle');
  const passcodeForm = document.getElementById('passcodeForm');
  if(!toggle || !passcodeForm || !passcodeForm.parentElement) return;

  const btn = document.createElement('button');
  btn.id = 'tabQrLogin';
  btn.type = 'button';
  btn.textContent = 'Scan QR';
  btn.onclick = () => setAuthTab('qr');
  toggle.appendChild(btn);

  const form = document.createElement('div');
  form.id = 'qrLoginForm';
  form.className = 'hidden';
  form.innerHTML = `
    <div id="qrLoginStatus">Arahkan kamera HP Anda (yang sudah login) ke kode ini</div>
    <div id="qrLoginBox"><img id="qrLoginImg" alt="QR Login"></div>
    <p id="qrLoginHint">Buka aplikasi ini di HP &rarr; menu Pengaturan &rarr; <b>Scan QR Login PC</b>.</p>
  `;
  passcodeForm.parentElement.insertBefore(form, passcodeForm.nextSibling);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildQrLoginTab);
else buildQrLoginTab();

/* ---------------------------------------------------------------------
   2. OVERRIDE setAuthTab() — tambah cabang tab 'qr' di atas versi
      passcode-login.js (dipanggil dulu, lalu ditambah logic QR).
   --------------------------------------------------------------------- */
const _qrPrevSetAuthTab = setAuthTab;
setAuthTab = function(tab){
  _qrPrevSetAuthTab(tab);
  $('#tabQrLogin')?.classList.toggle('active', tab === 'qr');
  $('#qrLoginForm')?.classList.toggle('hidden', tab !== 'qr');
  if(tab === 'qr') startQrLoginFlow();
  else stopQrLoginFlow();
};

/* ---------------------------------------------------------------------
   3. SISI PC — bikin sesi, tampilkan QR, polling status.
   --------------------------------------------------------------------- */
async function startQrLoginFlow(){
  stopQrLoginFlow();
  await createQrLoginSession();
}

function stopQrLoginFlow(){
  if(_qrPollTimer){ clearInterval(_qrPollTimer); _qrPollTimer = null; }
  _qrCurrentSid = null;
}

async function createQrLoginSession(){
  const statusEl = $('#qrLoginStatus');
  const box = $('#qrLoginBox');
  box?.querySelector('.qr-overlay')?.remove();
  if(statusEl) statusEl.textContent = 'Membuat kode QR…';

  const { data, error } = await supa.from('qr_login_sessions').insert({}).select('id, expires_at').single();
  if(error || !data){
    if(statusEl) statusEl.textContent = 'Gagal membuat kode QR. Pastikan koneksi internet stabil.';
    console.warn('[QR Login] gagal bikin sesi:', error?.message);
    return;
  }
  _qrCurrentSid = data.id;
  await renderQrLoginImage(QR_LOGIN_PREFIX + data.id);
  if(statusEl) statusEl.textContent = 'Arahkan kamera HP Anda (yang sudah login) ke kode ini';
  const expiresAt = new Date(data.expires_at).getTime();
  _qrPollTimer = setInterval(() => pollQrLoginSession(data.id, expiresAt), QR_LOGIN_POLL_MS);
}

function renderQrLoginImage(text){
  return new Promise((resolve) => {
    const img = $('#qrLoginImg');
    if(!img){ resolve(); return; }
    if(typeof QRCode === 'undefined'){
      console.warn('[QR Login] lib qrcode.js gagal load, pakai fallback API gambar.');
      img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=380x380&data=' + encodeURIComponent(text);
      resolve();
      return;
    }
    QRCode.toDataURL(text, { width: 380, margin: 1, color: { dark: '#1a1a1a', light: '#ffffff' } }, (err, url) => {
      if(!err) img.src = url;
      else{
        console.warn('[QR Login] QRCode.toDataURL gagal, pakai fallback API gambar:', err.message || err);
        img.src = 'https://api.qrserver.com/v1/create-qr-code/?size=380x380&data=' + encodeURIComponent(text);
      }
      resolve();
    });
  });
}

async function pollQrLoginSession(sid, expiresAt){
  if(sid !== _qrCurrentSid) return; // tab sudah pindah / sesi sudah diganti
  if(Date.now() > expiresAt){
    if(_qrPollTimer){ clearInterval(_qrPollTimer); _qrPollTimer = null; }
    showQrLoginExpired();
    return;
  }
  const { data, error } = await supa.from('qr_login_sessions').select('status, full_name').eq('id', sid).maybeSingle();
  if(error || !data) return;
  if(data.status === 'approved'){
    if(_qrPollTimer){ clearInterval(_qrPollTimer); _qrPollTimer = null; }
    const statusEl = $('#qrLoginStatus');
    if(statusEl) statusEl.textContent = `Menyelesaikan login sebagai ${data.full_name || ''}…`;
    await finishQrLogin(sid);
  }
}

async function finishQrLogin(sid){
  const statusEl = $('#qrLoginStatus');
  const { data, error } = await supa.functions.invoke('qr-login', { body: { action: 'consume', sid } });
  if(error || data?.error || !data?.token_hash){
    if(statusEl) statusEl.textContent = 'Gagal menukar kode QR. Silakan buat ulang.';
    showQrLoginExpired();
    return;
  }
  const { data: authData, error: authErr } = await supa.auth.verifyOtp({ token_hash: data.token_hash, type: 'magiclink' });
  if(authErr || !authData?.user){
    if(statusEl) statusEl.textContent = 'Gagal masuk otomatis. Silakan login manual.';
    showQrLoginExpired();
    return;
  }
  await onAuthenticated(authData.user);
}

function showQrLoginExpired(){
  const box = $('#qrLoginBox');
  if(!box || box.querySelector('.qr-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'qr-overlay';
  overlay.innerHTML = `<span>Kode QR kadaluarsa</span><button class="btn btn-outline" type="button" onclick="createQrLoginSession()">Buat Ulang</button>`;
  box.appendChild(overlay);
}

/* ---------------------------------------------------------------------
   4. SISI HP — scan kamera (dipanggil dari menu Pengaturan, wajib login).
   --------------------------------------------------------------------- */
let _qrScanStream = null;
let _qrScanRAF = null;

function openQrScanModal(){
  $('#settingsPanel')?.classList.add('hidden');
  if(document.getElementById('qrScanOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'qrScanOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="card-title">Scan QR Login PC</div>
        <button class="btn btn-outline btn-icon" onclick="closeQrScanModal()">✕</button>
      </div>
      <div class="modal-body" style="text-align:center;">
        <p style="color:var(--text-muted); font-size:12.5px; margin-bottom:12px;">
          Arahkan kamera ke kode QR yang tampil di layar PC pada halaman login.
        </p>
        <video id="qrScanVideo" class="qr-scan-video" autoplay muted playsinline></video>
        <canvas id="qrScanCanvas" class="qr-scan-canvas"></canvas>
        <div id="qrScanStatus" style="font-size:12px; color:var(--text-muted); margin-top:10px;"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  startQrScanCamera();
}

function closeQrScanModal(){
  stopQrScanCamera();
  $('#qrScanOverlay')?.remove();
}

async function startQrScanCamera(){
  const statusEl = $('#qrScanStatus');
  if(typeof jsQR === 'undefined'){ if(statusEl) statusEl.textContent = 'Gagal memuat pemindai QR.'; return; }
  try{
    _qrScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  }catch(e){
    if(statusEl) statusEl.textContent = 'Tidak bisa mengakses kamera: ' + (e.message || e);
    return;
  }
  const video = $('#qrScanVideo');
  if(!video){ stopQrScanCamera(); return; }
  video.srcObject = _qrScanStream;
  await video.play();
  scanQrFrame();
}

function stopQrScanCamera(){
  if(_qrScanRAF) cancelAnimationFrame(_qrScanRAF);
  _qrScanRAF = null;
  if(_qrScanStream){ _qrScanStream.getTracks().forEach(t => t.stop()); _qrScanStream = null; }
}

function scanQrFrame(){
  const video = $('#qrScanVideo');
  const canvas = $('#qrScanCanvas');
  if(!video || !canvas){ return; }
  if(video.readyState !== video.HAVE_ENOUGH_DATA){
    _qrScanRAF = requestAnimationFrame(scanQrFrame);
    return;
  }
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imageData.data, imageData.width, imageData.height);
  if(code?.data?.startsWith(QR_LOGIN_PREFIX)){
    const sid = code.data.slice(QR_LOGIN_PREFIX.length).trim();
    stopQrScanCamera();
    approveQrLoginSession(sid);
    return;
  }
  _qrScanRAF = requestAnimationFrame(scanQrFrame);
}

async function approveQrLoginSession(sid){
  const statusEl = $('#qrScanStatus');
  if(statusEl) statusEl.textContent = 'Menyetujui login PC…';
  const { data, error } = await supa.functions.invoke('qr-login', { body: { action: 'approve', sid } });
  if(error || data?.error){
    if(statusEl) statusEl.textContent = 'Gagal: ' + (data?.error || error?.message || 'kode QR tidak valid/kadaluarsa.');
    setTimeout(() => { if(document.getElementById('qrScanOverlay')) startQrScanCamera(); }, 1800);
    return;
  }
  if(statusEl) statusEl.textContent = `PC berhasil masuk sebagai ${data.full_name || 'Anda'}.`;
  toast('PC berhasil login lewat scan QR');
  setTimeout(closeQrScanModal, 1500);
}
