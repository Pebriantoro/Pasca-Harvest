/* =====================================================================
   PERBAIKAN BADGE JUMLAH DI SIDEBAR — Pasca Harvest, RPC After Giling,
   Extra Planting, Blanking, Ratoon (modul di TABLES).
   Sebelumnya badge cuma dibatasi Zona (query count langsung ke Supabase),
   jadi utk akun Staff/Supervisor angkanya = total 1 zona, BUKAN jumlah
   petak yang jadi tanggung jawab akun itu sendiri (staff/supervisor
   ybs) — beda dengan isi tabelnya sendiri yang sudah benar (pakai
   ensureData(), yang membatasi zona + nama staff/supervisor).
   Addon ini menyamakan badge dengan ensureData() supaya SELALU sama
   persis dengan jumlah baris yang tampil saat menu dibuka.
   Additif, load PALING TERAKHIR (tidak mengubah app.js).
   ===================================================================== */
const _prevRefreshAllCounts = refreshAllCounts;
refreshAllCounts = async function(){
  await _prevRefreshAllCounts();
  // Timpa ulang khusus badge modul yang ada di TABLES (Pasca Harvest, RPC
  // After Giling, Extra Planting, Blanking, Ratoon, Kondisi Bulanan) pakai
  // ensureData() supaya konsisten dgn pembatasan staff/supervisor per akun.
  for(const t of Object.keys(TABLES)){
    const el = $('#countBadge_' + t);
    if(!el) continue;
    const rows = await ensureData(t);
    el.textContent = rows.length ?? '0';
  }
};
