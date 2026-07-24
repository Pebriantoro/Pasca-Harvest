/* =====================================================================
   PUSH NOTIFICATIONS (WEB PUSH) — Notifikasi tetap masuk walau aplikasi
   tertutup / HP terkunci, bukan cuma saat tab sedang dibuka.
   Di-load SETELAH app.js & estate2-addons.js (butuh supa, currentUser,
   currentProfile, toast, $). Sepenuhnya ADDITIF, tidak mengubah app.js.

   Cara kerja singkat:
   1. User nyalakan toggle "Notifikasi Push" di menu Pengaturan.
   2. Browser minta izin notifikasi -> service worker subscribe ke push
      service (FCM/Mozilla/dst) pakai VAPID public key di bawah.
   3. Subscription (endpoint + kunci enkripsi) disimpan ke tabel
      `push_subscriptions` di Supabase (lihat push_schema.sql).
   4. Saat ada kejadian (notifikasi admin, approval, reminder), kode di
      file lain (app.js/approval-workflow.js/pasca-harvest-reminder-notif.js)
      memanggil window.sendPushTrigger({...}) -> memanggil Supabase Edge
      Function `send-push` (lihat supabase/functions/send-push/index.ts)
      -> Edge Function itu yang benar-benar mengirim push ke semua
      subscriber yang cocok, pakai VAPID private key (disimpan aman di
      Supabase secrets, TIDAK PERNAH ada di kode frontend ini).
   ===================================================================== */

// Public key aman untuk ditaruh di frontend (memang didesain publik).
// GANTI dengan milik Anda sendiri (lihat README_PUSH.md cara generate),
// lalu daftarkan private key-nya sebagai Supabase secret, JANGAN pernah
// taruh private key di file ini / di repo publik.
const PUSH_VAPID_PUBLIC_KEY = 'BGdIF93Cux7nQACrlA9T-sHs3D_CfqXQEi3RmXMSWw3WwbnOysXPGsJtqjtFXqwPqUhWIYgZd3EIoOAUT17Qx8c';

function pushIsSupported(){
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String){
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for(let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

async function getCurrentPushSubscription(){
  if(!pushIsSupported()) return null;
  try{
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  }catch(e){ return null; }
}

/* ---------------------------------------------------------------------
   UI toggle di menu Pengaturan (mengikuti pola notifSoundToggle)
   --------------------------------------------------------------------- */
async function refreshPushToggleUI(){
  const row = $('#pushNotifToggle');
  const sw = $('#pushNotifSwitch');
  const label = $('#pushNotifStateLabel');
  if(!row || !sw) return;

  if(!pushIsSupported()){
    row.style.opacity = '0.5';
    row.title = 'Browser ini tidak mendukung notifikasi push';
    if(label) label.textContent = 'Tak Didukung';
    return;
  }
  const sub = await getCurrentPushSubscription();
  const active = !!sub && Notification.permission === 'granted';
  sw.setAttribute('aria-checked', active ? 'true' : 'false');
  sw.classList.toggle('on', active);
  if(label){ label.textContent = active ? 'Aktif' : 'Nonaktif'; label.classList.remove('hidden'); }
}

async function togglePushNotifications(){
  if(!pushIsSupported()){
    toast('Browser ini tidak mendukung notifikasi push', true);
    return;
  }
  const existing = await getCurrentPushSubscription();
  if(existing){
    await disablePushNotifications();
  } else {
    await enablePushNotifications();
  }
  await refreshPushToggleUI();
}

/* ---------------------------------------------------------------------
   Aktifkan: minta izin -> subscribe -> simpan ke Supabase
   --------------------------------------------------------------------- */
async function enablePushNotifications(){
  if(!currentUser){ toast('Silakan login terlebih dahulu', true); return false; }
  try{
    let permission = Notification.permission;
    if(permission === 'default') permission = await Notification.requestPermission();
    if(permission !== 'granted'){
      toast('Izin notifikasi ditolak. Aktifkan lewat pengaturan browser jika berubah pikiran.', true);
      return false;
    }

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if(!sub){
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUSH_VAPID_PUBLIC_KEY),
      });
    }
    const json = sub.toJSON();
    const { error } = await supa.from('push_subscriptions').upsert({
      user_id: currentUser.id,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'endpoint' });
    if(error) throw error;

    toast('Notifikasi push diaktifkan');
    return true;
  }catch(e){
    console.error('Gagal mengaktifkan push:', e);
    toast('Gagal mengaktifkan notifikasi push', true);
    return false;
  }
}

/* ---------------------------------------------------------------------
   Nonaktifkan: unsubscribe browser + hapus baris di Supabase
   --------------------------------------------------------------------- */
async function disablePushNotifications(){
  try{
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if(sub){
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await supa.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    toast('Notifikasi push dinonaktifkan');
    return true;
  }catch(e){
    console.error('Gagal menonaktifkan push:', e);
    return false;
  }
}

/* ---------------------------------------------------------------------
   Dipanggil dari file lain (app.js/approval-workflow.js/reminder) tiap
   ada kejadian yang perlu di-push. Fire-and-forget: tidak pernah
   melempar error yang mengganggu alur utama (simpan data dsb tetap
   sukses walau pengiriman push gagal/timeout).
   Payload:
   {
     roles?: string[],        // target berdasar role, mis. ['manager','superintendent']
     zona?: string,           // opsional, filter tambahan berdasar zona
     full_names?: string[],   // opsional, target berdasar nama (dipakai utk notif staff)
     exclude_user_id?: string,// jangan kirim ke diri sendiri (biasanya currentUser.id)
     title: string,
     body: string,
     url?: string              // dibuka saat notifikasi diklik, default './index.html'
   }
   --------------------------------------------------------------------- */
async function sendPushTrigger(payload){
  try{
    if(!supa?.functions?.invoke) return;
    await supa.functions.invoke('send-push', { body: payload });
  }catch(e){
    // Sengaja hanya log, tidak toast/throw — push notification itu
    // "nice to have", jangan sampai bikin fitur utama (simpan data dll)
    // ikut terganggu kalau layanan push sedang bermasalah.
    console.warn('sendPushTrigger gagal (diabaikan):', e.message || e);
  }
}
window.sendPushTrigger = sendPushTrigger;

/* ---------------------------------------------------------------------
   Buka halaman yang relevan saat notifikasi diklik (dikirim balik dari
   service worker lewat postMessage, lihat sw.js).
   --------------------------------------------------------------------- */
navigator.serviceWorker?.addEventListener('message', (event) => {
  if(event.data?.type === 'push-notification-click' && event.data.url){
    // App ini single-page, jadi cukup pastikan window fokus; navigasi
    // dalam-app (kalau perlu) bisa ditambah di sini sesuai kebutuhan.
  }
});

// Sinkronkan tampilan toggle begitu Pengaturan dibuka & setelah login,
// mengikuti pola override yang sama dipakai file addon lain di repo ini.
const _prevToggleSettingsPanelForPush = typeof toggleSettingsPanel === 'function' ? toggleSettingsPanel : null;
if(_prevToggleSettingsPanelForPush){
  toggleSettingsPanel = function(){
    _prevToggleSettingsPanelForPush();
    refreshPushToggleUI();
  };
}
const _prevOnAuthenticatedForPush = onAuthenticated;
onAuthenticated = async function(user){
  await _prevOnAuthenticatedForPush(user);
  refreshPushToggleUI();
};
