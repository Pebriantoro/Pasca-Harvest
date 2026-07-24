/* =====================================================================
   MAINTENANCE ON TIME — NOTIFIKASI H-10 (AKAN OVERDUE)
   Additif, load PALING TERAKHIR (sesudah maintenance-on-time.js &
   pasca-harvest-reminder-notif.js). Tidak ubah app.js/dll, tidak butuh
   tabel/kolom baru di database — dihitung di sisi klien dari data
   Maintenance On Time yang sudah ada (state.mot / ensureMotData()).

   ATURAN: aktivitas perawatan (Replanting/Tebang Bibit/Ratoon) yang
   statusnya masih "Due" DAN tepat H-10 dari tanggal jatuh tempo
   (motActivityStatus().daysDiff === 10) -> ditembak sebagai notifikasi:
   1) Badge + panel bel notifikasi topbar (real-time selama app dibuka),
   2) Push notification (lewat sendPushTrigger, kalau sudah diaktifkan di
      menu Pengaturan) ke akun role Supervisor & Superintendent, DIFILTER
      sesuai zona petak masing-masing.

   CATATAN PENTING (sama seperti pasca-harvest-reminder-notif.js): ini
   BUKAN cron job server, dihitung di sisi klien tiap sesi yang lagi
   terbuka. Supaya semua petak/zona ke-cover, pastikan minimal satu akun
   Manager/Superintendent/Supervisor/Admin login & app-nya terbuka
   (device tidak perlu di-lock, tab boleh minimized).
   ===================================================================== */

const MOT_H10_ELIGIBLE_ROLES = ['manager', 'superintendent', 'supervisor', 'admin'];
let motH10Cache = [];
let motH10CacheLoaded = false;
let motH10PollTimer = null;
let motH10NotifiedKeys = new Set();

function motH10IsEligibleRole(){
  return MOT_H10_ELIGIBLE_ROLES.includes(currentProfile?.role);
}

// Buka bel notifikasi juga untuk role di atas (kalau kebetulan belum
// kebuka lewat canSeeNotifications() bawaan / reminder pasca harvest).
const _prevCanSeeNotificationsMotH10 = canSeeNotifications;
canSeeNotifications = function () {
  return _prevCanSeeNotificationsMotH10() || motH10IsEligibleRole();
};

async function computeMotH10Alerts(){
  if(!motH10IsEligibleRole()) return [];
  await ensureMotData();
  const st = state.mot;
  const todayISO = motTodayISO();
  const sections = [
    { rows: st.replanting,  schedule: MOT_SCHEDULE_REPLANTING,   kategori:'Replanting' },
    { rows: st.tebangBibit, schedule: MOT_SCHEDULE_TEBANG_BIBIT, kategori:'Tebang Bibit' },
    { rows: st.ratoon,      schedule: MOT_SCHEDULE_RATOON,       kategori:'Ratoon' },
  ];
  const out = [];
  sections.forEach(sec => {
    sec.rows.forEach(row => {
      sec.schedule.forEach(def => {
        const status = motActivityStatus(row.fields, def, todayISO);
        if(status.state === 'due' && status.daysDiff === 10){
          out.push({ petak: row.petak, zona: row.zona, kategori: sec.kategori, aktivitas: def.label, due: status.due });
        }
      });
    });
  });
  return out;
}

function motH10Key(item){ return item.kategori + '::' + item.petak + '::' + item.aktivitas + '::' + item.due; }

async function loadMotH10Alerts(){
  if(!motH10IsEligibleRole()) return;
  const items = await computeMotH10Alerts();
  const isFirstLoad = !motH10CacheLoaded;
  motH10Cache = items;
  motH10CacheLoaded = true;
  renderNotifBadge();
  if(!$('#notifPanel')?.classList.contains('hidden')) renderNotifPanel();

  // Push/notifikasi native browser cuma buat item BARU (petak/aktivitas/
  // tanggal jatuh tempo yang belum pernah ditembak sebelumnya di sesi
  // ini) — muat pertama tidak menembak semua item lama sekaligus.
  items.forEach(item => {
    const key = motH10Key(item);
    if(motH10NotifiedKeys.has(key)) return;
    motH10NotifiedKeys.add(key);
    if(isFirstLoad) return;

    if(window.Notification && Notification.permission === 'granted'){
      new Notification('Maintenance Akan Overdue (H-10)', {
        body: `${item.petak} (${item.kategori}) — ${item.aktivitas}, jatuh tempo ${fmtDateID(item.due)}`,
        icon: './logo.png',
      });
    }
    if(window.sendPushTrigger){
      sendPushTrigger({
        roles: ['supervisor', 'superintendent'],
        zona: item.zona || undefined,
        exclude_user_id: currentUser?.id,
        title: 'Maintenance Akan Overdue (H-10)',
        body: `${item.petak} (${item.kategori}) — ${item.aktivitas} jatuh tempo ${fmtDateID(item.due)}`,
        tag: 'mot-h10-' + item.petak + '-' + item.aktivitas,
      });
    }
  });
}

// Sisipkan ke siklus polling notifikasi yang sudah ada (chaining sama
// pola dengan pasca-harvest-reminder-notif.js).
const _prevInitNotificationsMotH10 = initNotifications;
initNotifications = function () {
  _prevInitNotificationsMotH10();
  if(!motH10IsEligibleRole()) return;
  motH10CacheLoaded = false;
  loadMotH10Alerts();
  if(motH10PollTimer) clearInterval(motH10PollTimer);
  motH10PollTimer = setInterval(loadMotH10Alerts, 60000); // cek tiap 1 menit
};
const _prevTeardownNotificationsMotH10 = teardownNotifications;
teardownNotifications = function () {
  _prevTeardownNotificationsMotH10();
  if(motH10PollTimer){ clearInterval(motH10PollTimer); motH10PollTimer = null; }
  motH10Cache = []; motH10CacheLoaded = false; motH10NotifiedKeys = new Set();
};

// Gabungkan angka badge + sisipkan daftar di panel notifikasi (nempel di
// atas panel notifikasi biasa/reminder pasca harvest). Klik satu baris
// -> lompat ke menu Maintenance On Time.
const _prevRenderNotifBadgeMotH10 = renderNotifBadge;
renderNotifBadge = function () {
  _prevRenderNotifBadgeMotH10();
  const badge = $('#notifBadge');
  if(!badge || !motH10IsEligibleRole() || !motH10Cache.length) return;
  const current = parseInt(badge.textContent, 10) || 0;
  const total = current + motH10Cache.length;
  badge.textContent = total > 9 ? '9+' : String(total);
  badge.classList.remove('hidden');
};
const _prevRenderNotifPanelMotH10 = renderNotifPanel;
renderNotifPanel = function () {
  _prevRenderNotifPanelMotH10();
  const panel = $('#notifPanel');
  if(!panel || !motH10IsEligibleRole() || !motH10Cache.length) return;
  const html = `
    <div class="notif-panel-header"><span>Akan Overdue H-10 (${motH10Cache.length} aktivitas)</span></div>
    <div class="notif-list">
      ${motH10Cache.map(item => `
        <div class="notif-item unread" style="cursor:pointer;" onclick="navigate('maintenance_on_time')">
          <span class="notif-icon">⏳</span>
          <div class="notif-body">
            <div class="notif-msg"><b>${esc(item.petak)}</b> (${esc(item.kategori)}) — ${esc(item.aktivitas)}, jatuh tempo ${esc(fmtDateID(item.due))}</div>
            <div class="notif-meta">${item.zona ? 'Zona ' + esc(item.zona) : ''}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
  panel.innerHTML = html + panel.innerHTML;
};
