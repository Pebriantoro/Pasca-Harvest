// =====================================================================
// EDGE FUNCTION: qr-login
// =====================================================================
// Deploy: supabase functions deploy qr-login
// Wajib jalankan qr_login_schema.sql (SQL Editor) sebelum pakai fitur ini.
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia di
// environment Edge Function, tidak perlu di-set manual.
//
// Body request (dipanggil dari client lewat supa.functions.invoke('qr-login', { body })):
//   { action: 'approve', sid: string }  -> dipanggil dari HP, HARUS sudah login
//                                          (JWT akun HP terkirim otomatis lewat
//                                          header Authorization oleh supabase-js).
//   { action: 'consume', sid: string }  -> dipanggil dari PC (anon), sekali pakai.
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, sid } = await req.json();
    if (!sid) return json({ error: 'sid wajib diisi' }, 400);

    if (action === 'approve') return await handleApprove(req, sid);
    if (action === 'consume') return await handleConsume(sid);
    return json({ error: 'action tidak dikenal' }, 400);
  } catch (e) {
    console.error('qr-login error:', e);
    return json({ error: e.message || String(e) }, 500);
  }
});

// Dipanggil dari HP: user yang sudah login menyetujui sesi QR milik PC,
// lalu kita buatkan token magic-link SEKALI PAKAI untuk akun itu (tidak
// pernah dikirim lewat email — cukup disimpan di baris sesi).
async function handleApprove(req: Request, sid: string) {
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Harus login di HP untuk menyetujui QR' }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json({ error: 'Sesi HP tidak valid, silakan login ulang' }, 401);
  const user = userData.user;

  const { data: session, error: sessionErr } = await admin
    .from('qr_login_sessions')
    .select('id, status, expires_at')
    .eq('id', sid)
    .maybeSingle();
  if (sessionErr || !session) return json({ error: 'Kode QR tidak ditemukan' }, 404);
  if (new Date(session.expires_at).getTime() < Date.now()) return json({ error: 'Kode QR sudah kadaluarsa' }, 410);
  if (session.status !== 'pending') return json({ error: 'Kode QR sudah dipakai' }, 409);

  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const fullName = profile?.full_name || user.email || 'Pengguna';

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email!,
  });
  if (linkErr || !linkData) return json({ error: 'Gagal membuat token sesi: ' + (linkErr?.message || '') }, 500);
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) return json({ error: 'Gagal membuat token sesi' }, 500);

  const { error: updateErr } = await admin
    .from('qr_login_sessions')
    .update({ status: 'approved', user_id: user.id, email: user.email, full_name: fullName, token_hash: tokenHash })
    .eq('id', sid)
    .eq('status', 'pending');
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ ok: true, full_name: fullName });
}

// Dipanggil dari PC: tukar sesi 'approved' jadi token login, SEKALI PAKAI
// (langsung ditandai 'consumed' sebelum token dikembalikan, supaya token
// yang sama tidak bisa dipakai dua kali walau request-nya diulang).
async function handleConsume(sid: string) {
  const { data: session, error } = await admin
    .from('qr_login_sessions')
    .select('id, status, email, token_hash, expires_at')
    .eq('id', sid)
    .maybeSingle();
  if (error || !session) return json({ error: 'Sesi tidak ditemukan' }, 404);
  if (session.status !== 'approved') return json({ error: 'Sesi belum disetujui dari HP' }, 409);
  if (new Date(session.expires_at).getTime() < Date.now()) return json({ error: 'Sesi kadaluarsa' }, 410);

  const { error: updErr } = await admin
    .from('qr_login_sessions')
    .update({ status: 'consumed' })
    .eq('id', sid)
    .eq('status', 'approved');
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ ok: true, email: session.email, token_hash: session.token_hash });
}
