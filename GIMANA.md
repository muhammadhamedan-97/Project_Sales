# PETUNJUK AKTIFKAN UPDATE (untuk yang tidak paham teknis)

Kenapa ini perlu? Kode baru (tombol Hapus, auto-hapus foto, perbaikan) SUDAH
di-pull ke VPS, TAPI server masih menjalankan versi LAMA. Perlu di-RESTART
agar versi baru aktif. Ikuti 2 langkah di bawah.

Cara akses server: buka aplikasi terminal di HP/laptop, ketik perintah di bawah,
lalu masukkan password root saat diminta (ketik manual, jangan bagikan ke siapa pun).

=======================================================================
LANGKAH 1 — Masuk ke server
=======================================================================
Ketik (lalu Enter, masukkan password saat ditanya):

  ssh root@103.247.11.184

=======================================================================
LANGKAH 2 — Cari folder project, tarik kode terbaru, dan restart
=======================================================================
Salin dan tempel KETIGA baris ini sekaligus, lalu Enter (masukkan password
kalau diminta):

  cd $(find /root /var/www /home -maxdepth 4 -type d -name 'project_sales' 2>/dev/null | head -1)
  cd $(find /root /var/www /home -maxdepth 4 -name 'server.js' -type f 2>/dev/null | xargs -r dirname | head -1)
  pwd

Perintah di atas akan menampilkan lokasi folder project. Contoh hasil:
  /var/www/scor   atau   /root/project_sales

LALU jalankan perintah berikut DI DALAM folder itu (ganti <FOLDER> dengan
hasil di atas):

  cd <FOLDER>
  git pull
  pm2 restart all
  sudo systemctl reload nginx

Catatan: kalau muncul error "git" atau "pm2", tidak apa-apa lanjut cara lain:
- Restart tanpa pm2 (pilih salah satu yang ada):
    systemctl restart crm
    systemctl restart scor
    systemctl restart node
    supervisorctl restart all

=======================================================================
LANGKAH 3 — Verifikasi (opsional tapi disarankan)
=======================================================================
Setelah selesai, kirim ke asisten: "sudah di-restart".
Asisten akan cek otomatis dari luar apakah sudah aktif.

ATAU kamu cek sendiri: buka https://scor.my.id
- Dashboard & Riwayat: sekarang ada ikon tong sampah (Hapus) di paling kanan.
- Misi Harian: ada tombol "Hapus" di tiap item.
Kalau sudah ada, berarti update berhasil.
=======================================================================
