// =====================================================================
// EDGE FUNCTION: send-push
// =====================================================================
// Deploy: supabase functions deploy send-push
// Secrets yang wajib di-set sebelum deploy (JANGAN taruh di kode/frontend):
//   supabase secrets set PUSH_VAPID_PUBLIC_KEY=...
//   supabase secrets set PUSH_VAPID_PRIVATE_KEY=...
//   supabase secrets set PUSH_VAPID_SUBJECT=mailto:admin@domainanda.com
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia di
// environment Edge Function, tidak perlu di-set manual.
//
// Body request (dipanggil dari client lewat supa.functions.invoke):
// {
//   roles?: string[],        // filter profiles.role, mis. ['manager','superintendent']
//   zona?: string,           // filter tambahan profiles.zona (case-insensitive)
//   full_names?: string[],   // alternatif target: berdasar profiles.full_name
//   exclude_user_id?: string,
//   title: string,
//   body: string,
//   url?: string
// }
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('PUSH_VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('PUSH_VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('PUSH_VAPID_SUBJECT') || 'mailto:admin@example.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if(req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try{
    const payload = await req.json();
    const { roles, zona, full_names, exclude_user_id, title, body, url, tag } = payload || {};

    if(!title || !body){
      return new Response(JSON.stringify({ error: 'title dan body wajib diisi' }), { status: 400, headers: corsHeaders });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Cari user target berdasar role/zona/full_names.
    let profilesQuery = admin.from('profiles').select('id, full_name, role, zona');
    const { data: allProfiles, error: profilesErr } = await profilesQuery;
    if(profilesErr) throw profilesErr;

    let targets = allProfiles || [];
    if(Array.isArray(roles) && roles.length){
      targets = targets.filter((p) => roles.includes(p.role));
    }
    if(zona){
      const z = zona.toString().trim().toLowerCase();
      targets = targets.filter((p) => (p.zona || '').toString().trim().toLowerCase() === z);
    }
    if(Array.isArray(full_names) && full_names.length){
      const names = full_names.map((n) => (n || '').toString().trim().toLowerCase());
      targets = allProfiles.filter((p) => names.includes((p.full_name || '').toString().trim().toLowerCase()));
    }
    if(exclude_user_id){
      targets = targets.filter((p) => p.id !== exclude_user_id);
    }

    if(!targets.length){
      return new Response(JSON.stringify({ sent: 0, failed: 0, removed: 0, note: 'tidak ada target cocok' }), { headers: corsHeaders });
    }

    // 2) Ambil subscription push milik user-user target.
    const targetIds = targets.map((t) => t.id);
    const { data: subs, error: subsErr } = await admin
      .from('push_subscriptions')
      .select('id, user_id, endpoint, p256dh, auth')
      .in('user_id', targetIds);
    if(subsErr) throw subsErr;

    if(!subs || !subs.length){
      return new Response(JSON.stringify({ sent: 0, failed: 0, removed: 0, note: 'target belum subscribe push' }), { headers: corsHeaders });
    }

    // 3) Kirim ke tiap subscription. Yang statusnya 404/410 (subscription
    //    sudah tidak valid lagi, mis. user uninstall/clear data) dihapus
    //    otomatis dari database supaya tidak terus dicoba tiap kali.
    const notifPayload = JSON.stringify({ title, body, url: url || './index.html', tag });
    let sent = 0, failed = 0;
    const staleIds: string[] = [];

    await Promise.all(subs.map(async (s) => {
      try{
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          notifPayload
        );
        sent++;
      }catch(err){
        failed++;
        const status = err?.statusCode;
        if(status === 404 || status === 410) staleIds.push(s.id);
        else console.error('push gagal ke', s.endpoint, err?.message || err);
      }
    }));

    if(staleIds.length){
      await admin.from('push_subscriptions').delete().in('id', staleIds);
    }

    return new Response(JSON.stringify({ sent, failed, removed: staleIds.length }), { headers: corsHeaders });
  }catch(e){
    console.error('send-push error:', e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: corsHeaders });
  }
});
