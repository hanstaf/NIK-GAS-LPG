# NIK GAS LPG - UD. CHARLES

Aplikasi web statis untuk mengelola daftar NIK, draft, dan catatan penjualan.

## Struktur dan koneksi

- `index.html`, `styles.css`, dan `app.js` membentuk aplikasi web statis.
- `supabase-config.js` berisi Project URL dan **publishable key** yang memang boleh dipakai di browser. Jangan pernah menaruh `secret` atau `service_role` key, database password, atau kredensial lain di file frontend.
- Supabase Auth menangani login. Pendaftaran publik harus tetap dimatikan; buat akun dari dashboard Supabase.
- `supabase/schema.sql` membuat tabel dan kebijakan Row Level Security (RLS). Jalankan sekali pada proyek baru.
- `supabase/sales_notes_order.sql` menambahkan urutan catatan penjualan dengan aman ke tabel yang sudah dibuat, termasuk proyek yang sudah menjalankan versi awal `schema.sql`.
- `supabase/realtime.sql` menambahkan tabel ke publikasi Realtime agar perubahan dapat diterima perangkat lain.

RLS membatasi data pada pemilik yang sedang login. Dengan akun bersama, semua perangkat yang login menggunakan akun Supabase yang sama dapat mengakses data tersebut.
Untuk proyek yang sudah memiliki tabel, jalankan `sales_notes_order.sql`, lalu `realtime.sql` di SQL Editor.

## Penyimpanan data

Daftar NIK (utama/draft) dan catatan penjualan disinkronkan dengan Supabase. Aplikasi juga menyimpan cache lokal di browser. Jika data lokal ditemukan saat login, aplikasi meminta konfirmasi sebelum menggabungkannya ke Supabase; NIK duplikat mengikuti data yang sudah ada di Supabase.

Draft Sampah, preferensi tampilan, penanda perpindahan draft, dan foto profil masih tersimpan hanya di browser masing-masing. Ekspor JSON tetap dapat digunakan sebagai backup. File data dan backup pelanggan tidak boleh dimasukkan ke repositori.

## Menjalankan dan menerbitkan

Aplikasi tidak memerlukan langkah build. Sajikan folder lewat server HTTP lokal atau GitHub Pages; koneksi Supabase membutuhkan internet dan memuat pustaka `supabase-js` dari jsDelivr.

Jangan terbitkan untuk penggunaan data nyata sebelum menguji login, pemuatan/penyimpanan, RLS, sinkronisasi antarperangkat, impor, ekspor, dan pemulihan backup. GitHub Pages adalah hosting frontend, bukan pengaman akses; repo privat tidak otomatis menjadikan halaman terbitan privat.
