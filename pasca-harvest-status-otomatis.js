/* =====================================================================
   PASCA HARVEST — OTOMATISASI STATUS PENGECEKAN (DINONAKTIFKAN)
   Sebelumnya file ini memaksa status_pengecekan_pasca_hvt jadi auto-compute
   dari 3 kategori kondisi lapangan (juringan/tunggul/gulma) dan mengunci
   field-nya jadi disabled. Itu keliru: kolom "kondisi lapangan terisi"
   bukan berarti "sudah diverifikasi/dicek" — akibatnya dashboard "Status
   Pengecekan Pasca HVT" nampilin 100% SUDAH padahal ada petak yang
   sebenernya belum dicek (32 dari 106 petak Done, per laporan 11 Juli 2026).
   Dikembalikan ke perilaku manual bawaan: field status_pengecekan_pasca_hvt
   diisi manual oleh staff (dropdown SUDAH/BELUM di app.js), tidak auto-compute
   dan tidak dikunci. File ini sengaja dikosongkan (bukan dihapus dari
   index.html) supaya gampang di-restore kalau logic verifikasi otomatis
   yang benar mau dipasang lagi nanti.
   ===================================================================== */
