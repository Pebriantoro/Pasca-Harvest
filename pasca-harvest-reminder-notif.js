/* =====================================================================
   PASCA HARVEST — REMINDER NOTIFIKASI PENGECEKAN
   Additif, load PALING TERAKHIR. Tidak ubah app.js/dll, tidak butuh
   tabel/kolom baru di database — dihitung di sisi klien dari data yang
   sudah ada (pasca_harvest + kondisi_bulanan), lalu ditumpangkan ke bel
   notifikasi yang sudah ada di topbar.

   CATATAN PENTING: ini BUKAN push notification server (butuh backend
   VAPID/subscription yang belum ada di project ini). Yang jalan di sini:
   1) Badge + panel di bel notifikasi topbar (real-time selama app dibuka),
   2) Notifikasi native browser (Notification API) kalau izin diberikan —
      cuma muncul selama tab/PWA terbuka (browser di-minimize masih jalan,
      tapi kalau app di-close total / device mati, tidak ada yang kirim).
   Kalau butuh notif device beneran walau app tertutup, itu perlu backend
   terpisah (Supabase Edge Function + Web Push) — di luar lingkup file ini.

   Target akun: staff, supervisor, superintendent (sesuai scope zona/nama
   masing-masing akun, otomatis dari ensureData()).

   Dua kondisi petak yang dianggap "perlu dicek":
   1. Pasca Harvest sudah status_progress = Done, tapi
      status_pengecekan_pasca_hvt belum SUDAH.
   2. Petak sudah Done tebang N bulan lalu (dihitung dari bulan_tebang vs
      bulan berjalan), tapi baris Kondisi Bulanan untuk bulan ke-1..N pada
      petak itu belum lengkap terisi (status_bulan kosong/tidak ada).
   ===================================================================== */

const REMINDER_ROLES = ['staff', 'supervisor', 'superintendent'];
let reminderCache = [];
let reminderCacheLoaded = false;
let reminderPollTimer = null;
let reminderNotifiedKeys = new Set();

function reminderIsEligibleRole(){
  return REMINDER_ROLES.includes(currentProfile?.role);
}

// 1) Bel notifikasi topbar defaultnya cuma untuk manager/superintendent/supervisor
//    (lihat canSeeNotifications() di app.js) — buka juga untuk staff.
const _prevCanSeeNotifications = canSeeNotifications;
canSeeNotifications = function () {
  return _prevCanSeeNotifications() || reminderIsEligibleRole();
};

async function computePascaHarvestReminders(){
  if(!reminderIsEligibleRole()) return [];
  const rows = await ensureData('pasca_harvest');
  const kondisiRows = await ensureData('kondisi_bulanan');
  const doneRows = rows.filter(r => (r.status_progress || '').toString().trim().toLowerCase() === 'done');

  // Bulan (1..12, relatif sejak tebang) yang sudah punya catatan Kondisi
  // Bulanan terisi (status_bulan tidak kosong), per petak.
  const filledBulanByPetak = {};
  kondisiRows.forEach(r => {
    const petak = (r.petak || '').toString().trim();
    if(!petak || !(r.status_bulan || '').toString().trim()) return;
    (filledBulanByPetak[petak] = filledBulanByPetak[petak] || new Set()).add(String(r.bulan));
  });

  const nowMonthIdx = new Date().getMonth(); // 0=JAN..11=DEC, cocok index array MONTHS
  const out = [];
  doneRows.forEach(r => {
    const petak = (r.petak || '').toString().trim();
    if(!petak) return;
    const alasan = [];

    if((r.status_pengecekan_pasca_hvt || '').toString().trim().toUpperCase() !== 'SUDAH'){
      alasan.push('Status Pengecekan Pasca HVT masih BELUM');
    }

    const tebangCode = normalizeMonthToken(r.bulan_tebang);
    const tebangIdx = tebangCode ? MONTHS.indexOf(tebangCode) : -1;
    if(tebangIdx !== -1){
      let monthsSince = nowMonthIdx - tebangIdx;
      if(monthsSince < 0) monthsSince += 12; // jaga-jaga kalau lintas tahun
      monthsSince = Math.min(monthsSince, 12);
      const filled = filledBulanByPetak[petak] || new Set();
      const missing = [];
      for(let n = 1; n <= monthsSince; n++){ if(!filled.has(String(n))) missing.push(n); }
      if(missing.length) alasan.push(`Kondisi Bulanan belum dicek: Bulan ${missing.join(', ')}`);
    }

    if(alasan.length) out.push({ petak, zona: r.zona, staff: r.staff, alasan });
  });
  return out;
}

function reminderKey(item){ return item.petak + '::' + item.alasan.join('|'); }

async function loadPascaHarvestReminders(){
  if(!reminderIsEligibleRole()) return;
  const items = await computePascaHarvestReminders();
  const isFirstLoad = !reminderCacheLoaded;
  reminderCache = items;
  reminderCacheLoaded = true;
  renderNotifBadge();
  if(!$('#notifPanel')?.classList.contains('hidden')) renderNotifPanel();

  // Notifikasi native browser, khusus item BARU (petak/alasan yang belum
  // pernah ditembak sebelumnya di sesi ini) — muat pertama tidak menembak
  // semua item lama sekaligus, biar tidak spam pas baru login.
  if(window.Notification && Notification.permission === 'granted'){
    items.forEach(item => {
      const key = reminderKey(item);
      if(reminderNotifiedKeys.has(key)) return;
      reminderNotifiedKeys.add(key);
      if(isFirstLoad) return;
      new Notification('Petak perlu pengecekan', { body: `${item.petak}: ${item.alasan.join(' · ')}`, icon: './logo.png' });
      if(window.sendPushTrigger){
        sendPushTrigger({
          roles: ['manager', 'superintendent', 'supervisor'],
          zona: item.zona || undefined,
          exclude_user_id: currentUser?.id,
          title: 'Petak Perlu Pengecekan',
          body: `${item.petak}: ${item.alasan.join(' · ')}`,
          tag: 'reminder-' + item.petak,
        });
      }
    });
  } else {
    items.forEach(item => reminderNotifiedKeys.add(reminderKey(item)));
  }
}

function requestReminderPermission(){
  if(window.Notification && Notification.permission === 'default') Notification.requestPermission();
}
document.addEventListener('click', () => { if(reminderIsEligibleRole()) requestReminderPermission(); }, { once: true });

// 2) Sisipkan ke siklus polling notifikasi yang sudah ada.
const _prevInitNotifications = initNotifications;
initNotifications = function () {
  _prevInitNotifications();
  if(!reminderIsEligibleRole()) return;
  reminderCacheLoaded = false;
  loadPascaHarvestReminders();
  if(reminderPollTimer) clearInterval(reminderPollTimer);
  reminderPollTimer = setInterval(loadPascaHarvestReminders, 60000); // cek tiap 1 menit
};
const _prevTeardownNotifications = teardownNotifications;
teardownNotifications = function () {
  _prevTeardownNotifications();
  if(reminderPollTimer){ clearInterval(reminderPollTimer); reminderPollTimer = null; }
  reminderCache = []; reminderCacheLoaded = false; reminderNotifiedKeys = new Set();
};

// 3) Gabungkan angka badge: notifikasi admin (dari DB) + reminder pengecekan (lokal).
renderNotifBadge = function () {
  const badge = $('#notifBadge');
  if(!badge) return;
  const unreadAdmin = notifCache.filter(n => !notifReadIds.has(n.id)).length;
  const unreadReminder = reminderIsEligibleRole() ? reminderCache.length : 0;
  const unread = unreadAdmin + unreadReminder;
  badge.textContent = unread > 9 ? '9+' : String(unread);
  badge.classList.toggle('hidden', unread === 0);
};

// 4) Tampilkan daftar reminder di atas panel notifikasi biasa. Klik satu
//    baris -> lompat ke menu Pasca Harvest & auto-cari petak itu (dipakai
//    juga oleh peta-gis.js untuk tombol "Buka Detail").
const _prevRenderNotifPanel = renderNotifPanel;
renderNotifPanel = function () {
  _prevRenderNotifPanel();
  const panel = $('#notifPanel');
  if(!panel || !reminderIsEligibleRole() || !reminderCache.length) return;
  const reminderHtml = `
    <div class="notif-panel-header"><span>Perlu Dicek (${reminderCache.length} petak)</span></div>
    <div class="notif-list">
      ${reminderCache.map(item => `
        <div class="notif-item unread" style="cursor:pointer;" onclick="petaOpenDetail('pasca_harvest','pasca_harvest','${item.petak.replace(/'/g, "\\'")}')">
          <span class="notif-icon">⏰</span>
          <div class="notif-body">
            <div class="notif-msg"><b>${esc(item.petak)}</b> — ${esc(item.alasan.join(' · '))}</div>
            <div class="notif-meta">${esc(item.zona ? 'Zona ' + item.zona : '')}${item.staff ? ' · ' + esc(item.staff) : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  panel.innerHTML = reminderHtml + panel.innerHTML;
};
