# IDE workbench dan Canvas

IDE memakai panel datar, activity bar, title bar dengan pencarian perintah, tab Code/Preview/Canvas/Design, tab file, breadcrumb, editor Monaco, panel bawah dan status bar. Identitas tetap PiwuApp, bukan salinan logo atau branding VS Code. Terminal menyesuaikan kolom/baris mengikuti ukuran panel dengan FitAddon.

## Canvas responsif

Buka project → **Canvas**, atau ikon canvas pada activity bar. Frame awal: Desktop 1280×800, Tablet 768×1024, Ponsel 390×844. Semua frame menampilkan **kode project yang sama** pada ukuran viewport berbeda; bukan halaman/aplikasi berbeda, video rekaman, atau editor node.

- **Tambah frame:** pilih jenis dan tambah, maksimal 6 frame agar beban browser terkendali.
- **Pindah frame:** geser judul frame; snapping 8 px. Judul dapat difokuskan lalu digeser dengan panah (8 px), Shift+panah (40 px).
- **Jelajahi:** geser latar atau gunakan mode tangan. Gulir menggeser canvas; Ctrl/⌘+gulir melakukan zoom dengan titik kursor sebagai pusat.
- **Zoom:** toolbar −/+, 12–150%; tombol sesuaikan semua. Pada area canvas yang fokus, F menyesuaikan tampilan dan +/− mengubah zoom. Tahan Space ketika area canvas aktif untuk menggeser.
- **Navigator:** pilih frame untuk memusatkan tampilan.
- **Properti:** nama, lebar 320–1920 px, tinggi 320–1600 px, duplikasi, hapus, serta tautan ke Code/Design. Nilai ukuran diterapkan saat Enter/keluar dari input; nilai di luar batas tidak diterapkan.
- **Interaksi:** hanya frame terpilih yang interaktif. Frame lain memakai `inert` sehingga tidak memerangkap fokus keyboard. Matikan interaksi untuk kembali mengelola layout. Scroll saat berinteraksi masuk ke aplikasi di dalam frame.
- **Susun ulang:** susun frame secara horizontal. Undo/redo menyimpan hingga 30 perubahan layout selama sesi canvas terbuka; terpisah dari riwayat perubahan kode.
- **Error:** kompilasi/runtime ditampilkan pada frame yang sesuai. Reload tidak menyembunyikan error kode permanen. Semua preview tetap memakai iframe `sandbox="allow-scripts"` tanpa `allow-same-origin`.

## Penyimpanan dan batas

Layout disimpan segera setelah perubahan di localStorage per scope akun/demo + ID project (`piwu-canvas-v1`). File, kode, dan versi project tidak diubah oleh pemindahan/resize frame. Layout **belum disinkronkan ke cloud**; tidak ikut ekspor ZIP. Kamera dan undo history tidak dipertahankan setelah panel ditutup. Viewer boleh mengatur tata letak lokal, tetapi tidak mendapat izin menulis kode cloud.

Layout tersimpan divalidasi (format/versi/jumlah/ukuran/koordinat/nama). Layout rusak menampilkan peringatan dan tidak otomatis ditimpa sebelum tindakan pengguna. Kegagalan localStorage/quota ditampilkan tanpa klaim tersimpan. Layout browser tidak dienkripsi; jangan memasukkan informasi rahasia dalam nama frame.

Setiap frame menjalankan instance preview sendiri, sehingga state aplikasi di frame A tidak otomatis sama dengan frame B. Perubahan kode menyegarkan preview dan dapat mereset state aplikasi. Membuka Design menggunakan jenis perangkat frame, bukan memindahkan state iframe atau membuat salinan kode.

## Shortcut workbench

| Shortcut       | Fungsi                    |
| -------------- | ------------------------- |
| Ctrl/⌘+K       | Cari perintah/file        |
| Ctrl/⌘+P       | Buka file                 |
| Ctrl/⌘+B       | Buka/tutup explorer       |
| Ctrl/⌘+J       | Buka/tutup panel terminal |
| Ctrl/⌘+Shift+F | Pencarian global          |
| Ctrl/⌘+.       | Mode fokus                |

Di layar kecil, explorer dan asisten menjadi drawer yang dapat dibuka melalui toolbar. Tidak ada perubahan terhadap autentikasi, provider, billing atau RPC cloud untuk fitur ini.
