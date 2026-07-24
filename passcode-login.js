/* =====================================================================
   PASSCODE LOGIN (4 DIGIT) — ADDITIF, load PALING TERAKHIR.
   ---------------------------------------------------------------------
   Passcode adalah "kunci cepat" 4 digit yang disimpan TERENKRIPSI hanya
   di perangkat/browser ini (localStorage), bukan di server. Cara kerja:
     1) Saat user membuat passcode, kata sandi akun aslinya dienkripsi
        (AES-GCM) memakai kunci yang diturunkan dari passcode (PBKDF2),
        lalu blob terenkripsi itu disimpan lokal.
     2) Saat login pakai passcode, blob didekripsi pakai passcode yang
        diketik -> kalau cocok, hasil dekripsi adalah password asli ->
        dipakai untuk supa.auth.signInWithPassword() seperti biasa.
   Kalau passcode yang diketik salah, proses dekripsi GAGAL (AES-GCM
   auth tag tidak valid) sehingga otomatis ditolak, tanpa perlu
   menyimpan passcode itu sendiri di mana pun.
   Passcode ini KHUSUS PERANGKAT INI — beda browser/device perlu dibuat
   ulang (login sekali pakai password, lalu buat passcode lagi).
   ===================================================================== */

const PASSCODE_VAULT_KEY = 'pns_passcode_vault_v1';
const PASSCODE_PBKDF2_ITERATIONS = 150000;

/* ---- Util base64 <-> ArrayBuffer ---- */
function _pcBufToB64(buf){
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function _pcB64ToBuf(b64){
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

/* ---- Vault (localStorage) ---- */
function _pcGetVault(){
  try{ return JSON.parse(localStorage.getItem(PASSCODE_VAULT_KEY) || '{}'); }
  catch{ return {}; }
}
function _pcSetVault(vault){
  localStorage.setItem(PASSCODE_VAULT_KEY, JSON.stringify(vault));
}
function _pcVaultKeyFor(username){
  return (username || '').trim().toLowerCase();
}
function hasLocalPasscode(username){
  return !!_pcGetVault()[_pcVaultKeyFor(username)];
}
function removePasscodeForAccount(username){
  const vault = _pcGetVault();
  delete vault[_pcVaultKeyFor(username)];
  _pcSetVault(vault);
}

/* ---- Enkripsi / dekripsi password akun dengan passcode ---- */
async function _pcDeriveKey(passcode, saltBuf){
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt: saltBuf, iterations: PASSCODE_PBKDF2_ITERATIONS, hash:'SHA-256' },
    baseKey,
    { name:'AES-GCM', length:256 },
    false,
    ['encrypt','decrypt']
  );
}
async function savePasscodeForAccount(username, email, password, passcode){
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _pcDeriveKey(passcode, salt);
  const enc = new TextEncoder();
  const cipherBuf = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, key, enc.encode(password));
  const vault = _pcGetVault();
  vault[_pcVaultKeyFor(username)] = {
    email,
    salt: _pcBufToB64(salt),
    iv: _pcBufToB64(iv),
    cipher: _pcBufToB64(cipherBuf)
  };
  _pcSetVault(vault);
}
// Mengembalikan { email, password } kalau passcode benar, atau null kalau salah/tidak ada.
async function _pcDecryptPassword(username, passcode){
  const entry = _pcGetVault()[_pcVaultKeyFor(username)];
  if(!entry) return null;
  try{
    const salt = _pcB64ToBuf(entry.salt);
    const iv = _pcB64ToBuf(entry.iv);
    const key = await _pcDeriveKey(passcode, salt);
    const plainBuf = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, key, _pcB64ToBuf(entry.cipher));
    const password = new TextDecoder().decode(plainBuf);
    return { email: entry.email, password };
  }catch{
    return null; // passcode salah -> auth tag GCM gagal
  }
}

/* ---------------------------------------------------------------------
   1. OVERRIDE setAuthTab() — app.js versi asli cuma tahu 2 tab
      (login/register). Di sini diganti jadi 2 tab: login/passcode
      (fitur Daftar/register sudah dihapus dari halaman login).
   --------------------------------------------------------------------- */
setAuthTab = function(tab){
  $('#tabLogin').classList.toggle('active', tab==='login');
  $('#tabPasscode').classList.toggle('active', tab==='passcode');
  $('#loginForm').classList.toggle('hidden', tab!=='login');
  $('#passcodeForm').classList.toggle('hidden', tab!=='passcode');
  if(tab==='passcode'){
    setTimeout(() => $('#passcodeUsername')?.focus(), 50);
    refreshPasscodeStage();
  }
};

/* ---------------------------------------------------------------------
   2. RENDER 4 KOTAK PIN — dipakai ulang untuk 3 baris pin di form.
   --------------------------------------------------------------------- */
function renderPinRow(containerId, { onComplete } = {}){
  const row = document.getElementById(containerId);
  if(!row || row.dataset.built) return row;
  row.dataset.built = '1';
  for(let i=0;i<4;i++){
    const box = document.createElement('input');
    box.type = 'tel';
    box.inputMode = 'numeric';
    box.maxLength = 1;
    box.className = 'pin-input-box';
    box.autocomplete = 'off';
    box.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/[^0-9]/g,'').slice(0,1);
      if(e.target.value && i < 3) row.children[i+1].focus();
      const val = pinRowValue(containerId);
      if(val.length === 4 && onComplete) onComplete(val);
    });
    box.addEventListener('keydown', (e) => {
      if(e.key === 'Backspace' && !e.target.value && i > 0) row.children[i-1].focus();
    });
    row.appendChild(box);
  }
  return row;
}
function pinRowValue(containerId){
  const row = document.getElementById(containerId);
  if(!row) return '';
  return Array.from(row.children).map(el => el.value).join('');
}
function clearPinRow(containerId){
  const row = document.getElementById(containerId);
  if(!row) return;
  Array.from(row.children).forEach(el => el.value = '');
  row.children[0]?.focus();
}

/* ---------------------------------------------------------------------
   3. STAGE SWITCHING DI LOGIN — cek localStorage begitu username diketik:
      sudah ada passcode -> tampil kotak PIN; belum -> tawarkan buat baru.
   --------------------------------------------------------------------- */
function refreshPasscodeStage(){
  renderPinRow('passcodePinRow', { onComplete: () => handlePasscodeFormSubmit() });
  renderPinRow('passcodeNewPinRow');
  renderPinRow('passcodeConfirmPinRow');

  const username = $('#passcodeUsername')?.value.trim();
  const known = $('#passcodeStageKnown');
  const fresh = $('#passcodeStageNew');
  const hint = $('#passcodeHint');
  if(!username){
    known.classList.add('hidden'); fresh.classList.add('hidden');
    hint.classList.remove('hidden');
    return;
  }
  hint.classList.add('hidden');
  if(hasLocalPasscode(username)){
    known.classList.remove('hidden'); fresh.classList.add('hidden');
  } else {
    known.classList.add('hidden'); fresh.classList.remove('hidden');
  }
}
document.addEventListener('input', (e) => {
  if(e.target?.id === 'passcodeUsername') refreshPasscodeStage();
});

function resetPasscodeForAccount(){
  const username = $('#passcodeUsername')?.value.trim();
  if(!username) return;
  removePasscodeForAccount(username);
  toast('Passcode di perangkat ini dihapus. Silakan buat passcode baru.');
  clearPinRow('passcodeNewPinRow'); clearPinRow('passcodeConfirmPinRow');
  refreshPasscodeStage();
}

/* ---------------------------------------------------------------------
   4. SUBMIT FORM PASSCODE — dua alur tergantung stage aktif.
   --------------------------------------------------------------------- */
async function handlePasscodeFormSubmit(e){
  e?.preventDefault?.();
  const username = $('#passcodeUsername')?.value.trim();
  if(!username){ toast('Ketik username terlebih dahulu', true); return false; }

  if(hasLocalPasscode(username)) await submitPasscodeLogin(username);
  else await submitCreatePasscode(username);
  return false;
}

async function submitPasscodeLogin(username){
  const pin = pinRowValue('passcodePinRow');
  const errEl = $('#passcodeError');
  errEl.classList.add('hidden');
  if(pin.length !== 4){ errEl.textContent = 'Masukkan 4 digit passcode.'; errEl.classList.remove('hidden'); return; }

  const btn = $('#passcodeLoginBtn'); btn.disabled = true; btn.textContent = 'Memproses…';
  const decrypted = await _pcDecryptPassword(username, pin);
  if(!decrypted){
    btn.disabled = false; btn.textContent = 'Masuk dengan Passcode';
    errEl.textContent = 'Passcode salah.';
    errEl.classList.remove('hidden');
    clearPinRow('passcodePinRow');
    return;
  }
  const { data, error } = await supa.auth.signInWithPassword({ email: decrypted.email, password: decrypted.password });
  btn.disabled = false; btn.textContent = 'Masuk dengan Passcode';
  if(error){
    // Password akun sudah berubah sejak passcode dibuat -> vault lokal usang.
    errEl.textContent = 'Gagal masuk: sesi passcode tidak valid lagi (kata sandi akun mungkin sudah berubah). Silakan masuk dengan kata sandi lalu buat passcode baru.';
    errEl.classList.remove('hidden');
    removePasscodeForAccount(username);
    return;
  }
  await onAuthenticated(data.user);
}

async function submitCreatePasscode(username){
  const password = $('#passcodeVerifyPassword')?.value;
  const pin = pinRowValue('passcodeNewPinRow');
  const pinConfirm = pinRowValue('passcodeConfirmPinRow');
  const errEl = $('#passcodeNewError');
  errEl.classList.add('hidden');

  if(!password){ errEl.textContent = 'Masukkan kata sandi akun Anda.'; errEl.classList.remove('hidden'); return; }
  if(pin.length !== 4){ errEl.textContent = 'Passcode harus 4 digit.'; errEl.classList.remove('hidden'); return; }
  if(pin !== pinConfirm){ errEl.textContent = 'Passcode dan ulangi passcode tidak sama.'; errEl.classList.remove('hidden'); clearPinRow('passcodeConfirmPinRow'); return; }

  const btn = $('#passcodeCreateBtn'); btn.disabled = true; btn.textContent = 'Memverifikasi…';
  const email = usernameToEmail(username);
  const { data, error } = await supa.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Verifikasi & Buat Passcode';
  if(error){
    errEl.textContent = 'Gagal verifikasi: username atau kata sandi salah.';
    errEl.classList.remove('hidden');
    return;
  }
  await savePasscodeForAccount(username, email, password, pin);
  toast('Passcode berhasil dibuat untuk perangkat ini');
  await onAuthenticated(data.user);
}

/* ---------------------------------------------------------------------
   5. UBAH PASSCODE DARI MENU PENGATURAN (dashboard, sudah login).
      Tetap minta kata sandi akun sekali (kita tidak pernah menyimpan
      password asli di memori setelah login), lalu simpan ulang vault.
   --------------------------------------------------------------------- */
function openChangePasscodeModal(){
  $('#settingsPanel')?.classList.add('hidden');
  const username = (currentProfile?.email || '').split('@')[0] || '';
  const already = hasLocalPasscode(username);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay'; overlay.id = 'changePasscodeOverlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <div class="card-title">${already ? 'Ubah Passcode' : 'Buat Passcode'}</div>
        <button class="btn btn-outline btn-icon" onclick="closeChangePasscodeModal()">✕</button>
      </div>
      <div class="modal-body">
        <p style="color:var(--text-muted); font-size:12.5px; margin-bottom:14px;">
          Passcode dipakai untuk login cepat di perangkat/browser ini saja. Masukkan kata sandi akun Anda untuk konfirmasi.
        </p>
        <div style="margin-bottom:16px;">
          <label class="field-label">Kata Sandi Akun</label>
          <input class="input" type="password" id="cpVerifyPassword" placeholder="••••••••" autocomplete="current-password">
        </div>
        <label class="field-label" style="display:block; text-align:center;">${already ? 'Passcode Baru' : 'Buat Passcode'} (4 digit)</label>
        <div class="pin-input-row" id="cpNewPinRow"></div>
        <label class="field-label" style="display:block; text-align:center; margin-top:14px;">Ulangi Passcode</label>
        <div class="pin-input-row" id="cpConfirmPinRow"></div>
        <div id="cpError" class="hidden" style="background:var(--accent-red-soft); color:var(--accent-red-text); padding:9px 12px; border-radius:8px; font-size:12.5px; margin-top:14px;"></div>
        ${already ? `<p style="text-align:center; margin-top:12px;"><a href="javascript:void(0)" onclick="removeOwnPasscodeFromSettings()" style="font-size:11.5px; color:var(--accent-red-text);">Hapus passcode di perangkat ini</a></p>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" onclick="closeChangePasscodeModal()">Batal</button>
        <button class="btn btn-primary" id="cpSaveBtn" onclick="submitChangePasscode()">Simpan Passcode</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  renderPinRow('cpNewPinRow');
  renderPinRow('cpConfirmPinRow');
  setTimeout(() => $('#cpVerifyPassword')?.focus(), 50);
}
function closeChangePasscodeModal(){
  $('#changePasscodeOverlay')?.remove();
}
async function submitChangePasscode(){
  const username = (currentProfile?.email || '').split('@')[0] || '';
  const password = $('#cpVerifyPassword')?.value;
  const pin = pinRowValue('cpNewPinRow');
  const pinConfirm = pinRowValue('cpConfirmPinRow');
  const errEl = $('#cpError');
  errEl.classList.add('hidden');

  if(!password){ errEl.textContent = 'Masukkan kata sandi akun Anda.'; errEl.classList.remove('hidden'); return; }
  if(pin.length !== 4){ errEl.textContent = 'Passcode harus 4 digit.'; errEl.classList.remove('hidden'); return; }
  if(pin !== pinConfirm){ errEl.textContent = 'Passcode dan ulangi passcode tidak sama.'; errEl.classList.remove('hidden'); return; }

  const btn = $('#cpSaveBtn'); btn.disabled = true; btn.textContent = 'Menyimpan…';
  const email = currentProfile?.email || usernameToEmail(username);
  const { error } = await supa.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = 'Simpan Passcode';
  if(error){
    errEl.textContent = 'Kata sandi salah.';
    errEl.classList.remove('hidden');
    return;
  }
  await savePasscodeForAccount(username, email, password, pin);
  toast('Passcode berhasil disimpan untuk perangkat ini');
  closeChangePasscodeModal();
}
function removeOwnPasscodeFromSettings(){
  const username = (currentProfile?.email || '').split('@')[0] || '';
  removePasscodeForAccount(username);
  toast('Passcode di perangkat ini dihapus');
  closeChangePasscodeModal();
}
