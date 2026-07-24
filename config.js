// =====================================================================
// KONFIGURASI SUPABASE
// =====================================================================
// 1. Buat project baru di https://supabase.com (gratis)
// 2. Buka Project Settings -> API
// 3. Salin "Project URL" dan "anon public key" ke bawah ini
// 4. Jalankan file supabase_schema.sql di SQL Editor Supabase Anda
// =====================================================================

window.SUPABASE_CONFIG = {
  url: 'https://hklhyryrpuunboqfkrzj.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrbGh5cnlycHV1bmJvcWZrcnpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxMTY4MzIsImV4cCI6MjA5ODY5MjgzMn0.PHe91fgnpD4pFjSdADGncMzHqJikw5voA_mHLmVuE74',
};

// Nama aplikasi (tampil di header & judul tab browser)
window.APP_NAME = 'Sistem Informasi Terpadu Estate 2';

// Versi aplikasi & changelog (tampil di footer halaman login)
window.APP_VERSION = '1.3.9';
window.APP_CHANGELOG = [
  { version: '1.3.9', date: '23 Jul 2026', notes: [
    'Pasca Harvest: kolom Estimasi TCH 2026 (H) sekarang ikut ke-update saat admin import Excel — sebelumnya diabaikan total. Kolom Q–U (pengecekan staff) tetap tidak disentuh.',
  ] },
  { version: '1.3.8', date: '23 Jul 2026', notes: [
    'Pasca Harvest: keterangan kolom di form & pesan import diperjelas — data master yang diisi admin (petak s/d staff) sekarang benar tertulis kolom B–P (H = Estimasi TCH 2026 dilewati, diisi terpisah), kolom pengecekan staff Q–T, dan kolom U (Kategori Pasca Harvest) otomatis. Perilaku importnya sendiri tidak berubah — sejak sebelumnya import admin memang sudah tidak pernah menimpa kolom pengecekan milik staff.',
  ] },
  { version: '1.3.7', date: '22 Jul 2026', notes: [
    'Ringkasan Justifikasi: klik angka Luas (Ha) atau Jumlah Petak di tiap baris sekarang buka modal daftar petak lengkap (Petak/Zona/Size/Varietas/Staff/Bulan Tebang/TCH) yang termasuk kategori justifikasi tersebut.',
  ] },
  { version: '1.3.6', date: '22 Jul 2026', notes: [
    'Justifikasi TCH Under 70: tabel baru "Ringkasan Justifikasi" — kelompokkan petak berdasarkan teks keterangan yang sama, tampilkan total Luas (Ha) & Jumlah Petak per kategori, lengkap baris Grand Total.',
  ] },
  { version: '1.3.5', date: '22 Jul 2026', notes: [
    'Justifikasi TCH Under 70: KPI "Sudah/Belum Ada Keterangan" sekarang nampilin jumlah hektar terkait, gak cuma jumlah petak.',
  ] },
  { version: '1.3.4', date: '22 Jul 2026', notes: [
    'Justifikasi TCH Under 70: kolom Keterangan diganti jadi tombol "Lihat" — buka modal detail petak lengkap (Petak/Zona/Size/Varietas/Staff/Bulan Tebang/TCH) plus kotak keterangan yang bisa diedit & disimpan langsung di modal, gak ada lagi teks kepotong di tabel.',
  ] },
  { version: '1.3.3', date: '22 Jul 2026', notes: [
    'Justifikasi TCH Under 70: kolom Keterangan dilebarin & kotak inputnya kini ikut ngisi penuh kolom (sebelumnya sempit meski kolom udah lebar), plus tooltip muncul pas hover kalau teksnya masih panjang.',
  ] },
  { version: '1.3.2', date: '22 Jul 2026', notes: [
    'Polish tampilan tabel & grafik di seluruh modul: tabel jadi satu panel rapi (sudut membulat, garis bawah header aksen gold, hover baris kasih garis aksen kiri), grafik (donut/bar) sudut lebih membulat + tooltip di-restyle senada tema kartu (bukan kotak hitam default) + font grafik disamakan sama font aplikasi. Kepadatan data tidak berubah.',
  ] },
  { version: '1.3.1', date: '22 Jul 2026', notes: [
    'Menu Pengaturan: tombol baru "Cek Update" — staff bisa cek manual kapan saja apakah aplikasi yang dipakai sudah versi terbaru, tanpa nunggu banner otomatis atau reload paksa.',
  ] },
  { version: '1.3.0', date: '20 Jul 2026', notes: [
    'Menu baru "Beranda" di paling atas sidebar: feed aktivitas gaya Facebook yang menggabungkan input Rencana Kerja Harian, Pengecekan Pra SPA & QC By Proses dari Staff, terbaru di atas, bisa difilter per menu.',
  ] },
  { version: '1.2.3', date: '20 Jul 2026', notes: [
    'Perbaikan tampilan HP: panel Notifikasi, Pengaturan & Pengguna Online sering kepotong (tidak full) karena kejebak di dalam kotak sidebar yang sedang animasi geser. Sekarang panel-panel itu dipindah otomatis ke luar sidebar saat dibuka di HP, jadi selalu tampil penuh di tengah layar.',
  ] },
  { version: '1.2.2', date: '20 Jul 2026', notes: [
    'Upload foto profil kini ada langkah "Atur Tata Letak" — geser posisi & zoom sebelum foto disimpan jadi avatar.',
  ] },
  { version: '1.2.1', date: '20 Jul 2026', notes: [
    'Foto profil/avatar (header, chat, pesan langsung) diubah dari bulat jadi kotak (rounded-square).',
  ] },
  { version: '1.2.0', date: '20 Jul 2026', notes: [
    'Pengaturan bahasa baru: toggle Indonesia/English di menu Pengaturan (ikon gerigi, pojok kanan atas). Terjemahan otomatis di sisi browser, pilihan tersimpan per perangkat.',
  ] },
  { version: '1.1.1', date: '20 Jul 2026', notes: [
    'Service Worker (PWA/home-screen) diubah dari cache-first jadi network-first khusus file app (html/js/css) — staff/spv/superintendent yang pin aplikasi di home screen HP kini langsung dapat update terbaru begitu online, tanpa nyangkut di versi lama.',
  ] },
  { version: '1.1.0', date: '20 Jul 2026', notes: [
    'Menu baru "QC By Proses": input Staff per parameter (skala 1-3) untuk 8 kegiatan (Furrowing, Planting, Blanking, Fertilizing Single Aplication, Post Spraying 1-3, Weeding Rayutan), verifikasi Supervisor → approve Superintendent, cegah input duplikat petak+kegiatan, filter Tanggal/Petak/Kegiatan/Staff/Supervisor/Superintendent, summary all-zona utk Admin/Manager, Export JPEG dgn pilihan rentang tanggal.',
    'Menu baru "Data Posisi Unit": input jenis unit (SK-75/WT/Dozer/SK-130), kode unit, petak, keterangan; verifikasi 1 tahap oleh Supervisor; summary utk Superintendent/Admin/Manager; modul baru di Peta GIS dgn warna per jenis unit; tombol Export JPEG.',
    'Tombol "Hapus" ditambahkan di menu QC By Proses & Pengecekan Pra SPA (akun Staff, khusus data belum diverifikasi/ditolak), lengkap RLS delete policy Supabase.',
    'Form Kondisi Bulanan: kode wilayah petak (PNS/KDS) kini dropdown terkunci, nomor petak tetap bisa diketik/pilih.',
    'Validasi format kode petak (harus PNS/KDS + 6 digit) di RKH, Pengecekan Pra SPA & QC By Proses, dengan peringatan inline.',
    'Auto-fill Supervisor sesuai akun Staff yang login, di form Pengecekan Pra SPA & QC By Proses.',
    'Export JPEG di Rencana Kerja Harian, Pengecekan Pra SPA & QC By Proses kini bisa pilih rentang tanggal sebelum export.',
    'Rapikan tampilan: grafik "Tren Harian HK Hadir vs Tidak Hadir" jadi grafik batang dgn label tanggal DD-MMM, tabel ringkasan (RKH/Pra SPA/QC By Proses/Analisa 12 Bulan) dirapikan rata tengah/kanan & kolom Baik/Cukup/Kurang diberi warna, tombol aksi Kelola Pengguna dirapikan agar tidak tumpang tindih.',
    'Fitur "Daftar" (pendaftaran akun mandiri) dihapus dari halaman login — akun kini hanya dibuat lewat menu Kelola Pengguna oleh Admin.',
  ] },
  { version: '1.0.0', date: '13 Jul 2026', notes: ['Rilis awal Sistem Informasi Terpadu Estate 2', 'Login liquid glass + tema gold', 'Modul pasca panen, approval workflow, peta GIS'] }
];
