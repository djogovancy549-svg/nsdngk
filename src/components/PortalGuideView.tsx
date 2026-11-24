import { useState } from 'react';
import {
  Award,
  BookOpen,
  Building2,
  CheckCircle2,
  Cpu,
  FileSpreadsheet,
  FolderTree,
  Layers,
  Lock,
  LogIn,
  ShieldCheck,
  UserPlus,
  Zap,
} from 'lucide-react';
import { RegencyWhiteLabelConfig } from '../services/regencyConfigService';

interface PortalGuideViewProps {
  regencyConfig: RegencyWhiteLabelConfig;
  onGoToLogin: () => void;
  onGoToRegister: () => void;
}

type GuideTab = 'keunggulan' | 'opd' | 'superadmin' | 'wilayah';

export function PortalGuideView({
  regencyConfig,
  onGoToLogin,
  onGoToRegister,
}: PortalGuideViewProps) {
  const [activeTab, setActiveTab] = useState<GuideTab>('keunggulan');

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-3xl">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700">
            <BookOpen className="w-3.5 h-3.5" />
            Panduan Resmi · Dapat Dibaca Tanpa Login
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Panduan Operasional {regencyConfig.namaPortal}
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed">
            Petunjuk lengkap langkah demi langkah untuk{' '}
            <strong className="font-semibold text-slate-800">
              Operator Dinas / User OPD
            </strong>
            ,{' '}
            <strong className="font-semibold text-slate-800">
              Super Admin Walidata ({regencyConfig.namaWalidata})
            </strong>
            , serta standar pembagian Google Sheet per Kecamatan &amp;
            Desa/Kelurahan agar data sektoral tetap cepat, rapi, dan berdaulat
            hingga 20 tahun ke depan.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onGoToLogin}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 whitespace-nowrap"
          >
            <LogIn className="w-3.5 h-3.5" />
            Masuk Portal
          </button>
          <button
            type="button"
            onClick={onGoToRegister}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Daftar Akun OPD
          </button>
        </div>
      </div>

      {/* Role Switcher Tabs */}
      <div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-1.5 bg-slate-200/70 rounded-lg"
        role="tablist"
        aria-label="Kategori panduan"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'keunggulan'}
          onClick={() => setActiveTab('keunggulan')}
          className={`flex items-center justify-center gap-2 h-10 px-3 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'keunggulan'
              ? 'bg-teal-700 text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Award className="w-4 h-4 shrink-0" />
          Keunggulan Sistem
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'opd'}
          onClick={() => setActiveTab('opd')}
          className={`flex items-center justify-center gap-2 h-10 px-3 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'opd'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
          Panduan User / OPD
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'superadmin'}
          onClick={() => setActiveTab('superadmin')}
          className={`flex items-center justify-center gap-2 h-10 px-3 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'superadmin'
              ? 'bg-[#0B1B2B] text-white shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0" />
          Panduan Super Admin
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'wilayah'}
          onClick={() => setActiveTab('wilayah')}
          className={`flex items-center justify-center gap-2 h-10 px-3 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'wilayah'
              ? 'bg-white text-slate-900 shadow-xs'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderTree className="w-4 h-4 text-teal-700 shrink-0" />
          Standar Sheet 20 Tahun
        </button>
      </div>

      {/* TAB 0: KEUNGGULAN SISTEM (FOKUS KEUNGGULAN INTERNAL & KEDAULATAN DAERAH) */}
      {activeTab === 'keunggulan' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                icon: ShieldCheck,
                title: 'Kedaulatan Data Penuh di Kabupaten & OPD',
                desc: 'Seluruh berkas dan tabel mentah tetap tersimpan di Google Drive & Google Sheet milik masing-masing OPD. Walidata hanya membaca secara read-only dan mengkloning data terpilih untuk publikasi.',
              },
              {
                icon: FileSpreadsheet,
                title: 'Form, Tabel & Grafik Terbentuk Otomatis',
                desc: 'Cukup susun atau ubah nama kolom di Header Baris 1 Google Sheet OPD—formulir input, validasi tipe data, tabel, dan grafik interaktif (Bar, Donat, Garis + Cross-Filter) langsung menyesuaikan tanpa ubah kode.',
              },
              {
                icon: Zap,
                title: 'Performa Cepat dengan Smart Cache Server',
                desc: 'Dilengkapi Proxy Backend dengan Smart Cache 45 detik dan penggabungan permintaan serentak (deduplication), sehingga pembacaan data berulang berlangsung dalam hitungan milidetik dan hemat kuota Google.',
              },
              {
                icon: Lock,
                title: 'Keamanan Siber Berlapis & Audit AI',
                desc: 'Menggabungkan WAF 10 lapis, sesi HttpOnly HMAC-SHA256, Email Allowlist Super Admin, Kunci Rahasia Webhook (API_SECRET) anti-SSRF, perangkap Honeypot, serta deteksi anomali berbasis AI.',
              },
              {
                icon: FolderTree,
                title: 'Siap 20 Tahun dengan Partisi Wilayah',
                desc: 'Mendukung pembagian sheet per OPD, Kecamatan, Desa/Kelurahan, dan periode tahun sehingga setiap file tetap ringan, terisolasi dari kesalahan lintas unit, dan sangat hemat anggaran infrastruktur daerah.',
              },
              {
                icon: Cpu,
                title: 'White-Label & Siap Naik Kelas ke BigQuery',
                desc: 'Identitas daerah (Nama Kabupaten, Portal, Walidata, Kecamatan, tautan Portal Publik) dapat diatur langsung dari dashboard, serta sudah memiliki konektor resmi Google BigQuery (region Jakarta) untuk analitik skala besar.',
              },
            ].map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.title}
                  className="bg-white border border-slate-200 rounded-lg p-5 space-y-3"
                >
                  <div className="w-9 h-9 rounded-md bg-[#0B1B2B] text-teal-400 flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {card.title}
                  </h2>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="bg-[#0B1B2B] text-slate-100 rounded-lg p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
            <div className="lg:col-span-8 space-y-1.5">
              <p className="text-xs font-medium text-teal-300">
                Arsitektur Pragmatis, Hemat Anggaran &amp; Berkelanjutan
              </p>
              <h3 className="text-base font-semibold text-white">
                Dirancang Khusus untuk Kemudahan Input OPD dan Ketahanan Jangka
                Panjang Daerah
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sistem ini memfokuskan diri sebagai pusat pengumpulan, validasi,
                dan analitik data sektoral internal OPD yang adaptif, sementara
                publikasi terbuka masyarakat dapat tetap berjalan pada portal
                publik terpisah milik daerah.
              </p>
            </div>
            <div className="lg:col-span-4 flex flex-wrap lg:justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveTab('opd')}
                className="h-9 px-3.5 text-xs font-semibold text-slate-950 bg-teal-400 rounded-md hover:bg-teal-300"
              >
                Lihat Panduan OPD
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('superadmin')}
                className="h-9 px-3.5 text-xs font-medium text-white bg-white/10 border border-white/20 rounded-md hover:bg-white/20"
              >
                Lihat Panduan Admin
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1: PANDUAN USER / OPD */}
      {activeTab === 'opd' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            {[
              {
                step: '01',
                title: 'Siapkan Folder Google Drive & Google Sheet Milik OPD',
                points: [
                  'Buat 1 folder resmi di Google Drive milik Dinas/OPD (misal: "Satu Data - Dinas Kesehatan").',
                  'Di dalamnya, buat Google Spreadsheet dan tuliskan nama kolom pada Baris 1 (Header), contoh: Kecamatan, Desa/Kelurahan, Nama Fasilitas, Tahun, Jumlah.',
                  'File asli 100% tetap milik dan berada di Google Drive OPD Anda (kedaulatan data penuh).',
                ],
              },
              {
                step: '02',
                title: 'Ajukan Permohonan & Buka Pendaftaran dengan PIN Sekali Pakai',
                points: [
                  'Buka tab "Daftar Akun Dinas" → "1. Ajukan Permohonan", pilih Dinas/OPD, isi nama PIC, email resmi dinas, dan nomor WhatsApp/kontak.',
                  'Super Admin Walidata akan meninjau permohonan dan memberikan PIN Sekali Pakai (berlaku 24 jam untuk 1x pakai). Masukkan email & PIN pada tab "2. Punya PIN Sekali Pakai" untuk membuka formulir pendaftaran Folder Drive, username, dan kata sandi.',
                  'Saat masuk kembali, pilih peran "User / OPD" lalu masukkan email terdaftar dan kata sandinya.',
                ],
              },
              {
                step: '03',
                title: 'Ajukan URL Google Sheet & Tunggu Aktivasi Code.gs',
                points: [
                  'Setelah masuk ke Ruang Kerja OPD, klik "Daftarkan Google Sheet" lalu tempel tautan Google Sheet milik dinas Anda beserta nama tab (misal: Sheet1 atau nama Kecamatan/Desa).',
                  'Super Admin Walidata akan mencangkokkan skrip dinamis Code.gs pada sheet tersebut lalu mengaktifkan Hak Akses Web.',
                ],
              },
              {
                step: '04',
                title: 'Input, Edit, Hapus Data & Pantau Grafik Otomatis',
                points: [
                  'Begitu aktif, klik kartu tab sheet (berwarna variatif agar mudah dibedakan) lalu tekan "+ Input Data". Formulir input terbentuk otomatis persis mengikuti Header Baris 1 Google Sheet Anda.',
                  'Setiap data yang disimpan otomatis disanitasi dari skrip berbahaya (XSS/Formula Injection) dan langsung masuk ke Google Sheet asli milik OPD melalui Proxy Server yang aman.',
                  'Aktifkan PIN Keamanan Hapus OPD agar tidak ada baris atau tab yang terhapus tanpa sengaja.',
                ],
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-lg p-5 space-y-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-semibold text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded">
                    Langkah {item.step}
                  </span>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h2>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-600 leading-relaxed pl-1">
                  {item.points.map((pt, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <aside className="lg:col-span-4 space-y-4">
            <div className="bg-[#0B1B2B] text-slate-100 rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-teal-300">
                <FileSpreadsheet className="w-4 h-4" />
                Tips Header Otomatis OPD
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Sistem otomatis mengenali jenis kolom dari nama Header Baris 1
                Google Sheet Anda:
              </p>
              <div className="space-y-2 text-xs border-t border-white/10 pt-3">
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-teal-300">Tanggal / Tgl</span>
                  <span className="text-slate-300">Pemilih Tanggal</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-teal-300">
                    Jumlah / Total / Tahun
                  </span>
                  <span className="text-slate-300">Input Angka</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-teal-300">Kecamatan</span>
                  <span className="text-slate-300">Saran Kecamatan</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-teal-300">Jenis Kelamin</span>
                  <span className="text-slate-300">Pilihan L / P</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="font-mono text-teal-300">Alamat / Ket</span>
                  <span className="text-slate-300">Teks Panjang</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
              <h3 className="text-xs font-semibold text-slate-900">
                Kedaulatan Data OPD Terjamin
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Super Admin Walidata hanya dapat membaca data OPD secara{' '}
                <strong>Read-Only</strong> dan tidak dapat mengubah struktur
                atau menghapus baris pada Google Sheet asli milik dinas Anda.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* TAB 2: PANDUAN SUPER ADMIN (WALIDATA) */}
      {activeTab === 'superadmin' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-8 space-y-4">
            {[
              {
                step: '01',
                title: 'Akses Ketat Super Admin (Email Allowlist & Sesi HttpOnly)',
                points: [
                  'Pilih peran "Super Admin" pada formulir masuk dan gunakan alamat email resmi yang terdaftar di Daftar Email Resmi Super Admin.',
                  'Email di luar daftar resmi akan ditolak otomatis oleh server (HTTP 403) dan dicatat sebagai insiden keamanan.',
                  'Untuk menambah atau mencabut email Super Admin lain, buka menu "Akun & Cangkok Sheet" → bagian "Daftar Email Resmi Super Admin".',
                ],
              },
              {
                step: '02',
                title: 'Pencangkokan Skrip Code.gs & Penguncian API_SECRET',
                points: [
                  'Buka menu "Skrip Code.gs & Auth" → salin Kunci Rahasia Webhook (API_SECRET) milik server kabupaten Anda.',
                  'Buka Google Sheet yang diajukan OPD → Extensions → Apps Script → tempel template Code.gs Dinamis → isi const API_SECRET = \'...\'; → Deploy Web App (Anyone) → salin URL /exec.',
                  'Tempel URL /exec pada menu "Akun & Cangkok Sheet" lalu klik "Aktifkan Hak Akses Web". Dengan API_SECRET, pihak luar tidak bisa menembak URL /exec secara langsung.',
                ],
              },
              {
                step: '03',
                title: 'Konsolidasi Data Masuk, Grafik Interaktif & Publikasi',
                points: [
                  'Menu "Data Masuk (Read-Only)" menampilkan seluruh data lintas OPD lengkap dengan Grafik Batang, Donat, dan Garis yang mendukung klik filter silang (cross-filtering) serta ekspor CSV.',
                  'Menu "Cloning & Publikasi" memungkinkan Walidata memilih kolom yang aman (menyaring kolom PII seperti NIK/No. HP sesuai UU PDP) untuk dikirim ke Sheet Publikasi Kominfo atau portal publik terpisah.',
                ],
              },
              {
                step: '04',
                title: 'White-Label Kabupaten, Smart Cache, Keamanan AI & BigQuery',
                points: [
                  'Menu "Skrip Code.gs & Auth" menyediakan pengaturan Identitas Kabupaten (Nama Daerah, Portal, Walidata, Daftar Kecamatan, URL Portal Publik) sehingga aplikasi siap digunakan di kabupaten mana pun tanpa ubah kode.',
                  'Pantau Smart Cache Server (45 detik), WAF 10 lapis, Honeypot pengelabuan peretas, dan Audit Keamanan AI di menu "Keamanan Siber & AI".',
                  'Jika volume data suatu saat sangat besar, aktifkan konektor Google BigQuery (opsional, region Jakarta asia-southeast2) langsung dari menu konfigurasi.',
                ],
              },
            ].map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 rounded-lg p-5 space-y-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs font-semibold text-white bg-[#0B1B2B] px-2 py-0.5 rounded">
                    Langkah {item.step}
                  </span>
                  <h2 className="text-sm font-semibold text-slate-900">
                    {item.title}
                  </h2>
                </div>
                <ul className="space-y-1.5 text-xs text-slate-600 leading-relaxed pl-1">
                  {item.points.map((pt, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 shrink-0 mt-0.5" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <aside className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <ShieldCheck className="w-4 h-4 text-teal-700" />
                Ringkasan Lapisan Keamanan Aktif
              </div>
              <ul className="space-y-2 text-xs text-slate-600">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Cookie sesi HttpOnly bertanda tangan HMAC-SHA256</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>WAF 10 lapis (anti SQLi, XSS, SSRF, Log4Shell, Auto-Ban)</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Proxy Backend + Kunci API_SECRET tersembunyi</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Honeypot pengelabuan peretas &amp; Audit AI real-time</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Anti klik-kanan &amp; blokir pintasan inspeksi browser</span>
                </li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {/* TAB 3: STANDAR SHEET 20 TAHUN (SHARDING PER WILAYAH) */}
      {activeTab === 'wilayah' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-teal-700 text-white flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Strategi Pembagian Wilayah (Horizontal Sharding) untuk 20 Tahun
                </h2>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed max-w-3xl">
                  Satu file Google Spreadsheet mendukung hingga{' '}
                  <strong>10 juta sel</strong>. Dengan membagi workbook atau
                  tab sheet per <strong>OPD</strong>,{' '}
                  <strong>Kecamatan</strong>, dan{' '}
                  <strong>Desa/Kelurahan</strong> (serta per periode tahun),
                  ukuran setiap sheet tetap ringan (ratusan–ribuan baris)
                  sehingga performa sangat cepat dan aman dari kesalahan lintas
                  wilayah hingga 20 tahun ke depan.
                </p>
              </div>
            </div>

            {/* Struktur Folder & Penamaan */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
                <p className="text-xs font-semibold text-slate-900">
                  1. Tingkat Folder Drive (Per OPD)
                </p>
                <p className="font-mono text-[11px] text-teal-700">
                  /SatuData_{regencyConfig.namaKabupaten.replace(/\s+/g, '_')}/Dinas_Kesehatan/
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Setiap dinas menyimpan seluruh file dalam folder resminya
                  sendiri agar hak akses dan arsip jelas.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
                <p className="text-xs font-semibold text-slate-900">
                  2. Tingkat Workbook (Per Kecamatan / Tahun)
                </p>
                <p className="font-mono text-[11px] text-teal-700">
                  Dinkes_Kec_Aesesa_2026
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Membagi file per Kecamatan atau per Tahun menjaga ukuran file
                  tetap kecil &amp; mempercepat sinkronisasi.
                </p>
              </div>

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-1.5">
                <p className="text-xs font-semibold text-slate-900">
                  3. Tingkat Tab Sheet (Per Desa / Kelurahan)
                </p>
                <p className="font-mono text-[11px] text-teal-700">
                  Desa_Aeramo | Kel_Danga | Desa_Marapokot
                </p>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Satu workbook cukup dicangkok 1 skrip Code.gs, lalu seluruh
                  tab Desa/Kelurahan di dalamnya otomatis terdeteksi di portal.
                </p>
              </div>
            </div>
          </div>

          {/* Contoh Tabel Standar Header Baris 1 */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-900">
                Rekomendasi Standar Kolom Header Baris 1 (Konsisten Lintas Tahun)
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Gunakan nama kolom wajib di bawah ini di awal setiap sheet agar
                grafik Bar/Donut/Line dan penggabungan ke BigQuery di masa depan
                berjalan otomatis tanpa pembersihan ulang.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
                    <th className="py-2.5 px-5 font-semibold">Nama Kolom Header</th>
                    <th className="py-2.5 px-4 font-semibold">Fungsi</th>
                    <th className="py-2.5 px-4 font-semibold">Contoh Isi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Tahun
                    </td>
                    <td className="py-2.5 px-4">
                      Otomatis dipakai sumbu waktu Grafik Garis (tren 20 tahun)
                    </td>
                    <td className="py-2.5 px-4 font-mono">2026</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Kecamatan
                    </td>
                    <td className="py-2.5 px-4">
                      Otomatis menampilkan saran daftar kecamatan daerah
                    </td>
                    <td className="py-2.5 px-4">
                      {regencyConfig.daftarKecamatan[0] || 'Aesesa'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Desa/Kelurahan
                    </td>
                    <td className="py-2.5 px-4">
                      Memudahkan filter silang &amp; proporsi Grafik Donat/Batang
                    </td>
                    <td className="py-2.5 px-4">Kelurahan Danga</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Kategori / Indikator
                    </td>
                    <td className="py-2.5 px-4">
                      Pengelompokan data sektoral masing-masing OPD
                    </td>
                    <td className="py-2.5 px-4">Posyandu Aktif</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Jumlah / Nilai
                    </td>
                    <td className="py-2.5 px-4">
                      Angka statistik untuk agregasi &amp; analitik lintas dinas
                    </td>
                    <td className="py-2.5 px-4 font-mono">14</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-5 font-mono font-semibold text-teal-700">
                      Tanggal Update
                    </td>
                    <td className="py-2.5 px-4">
                      Otomatis menjadi input kalender &amp; jejak pembaruan
                    </td>
                    <td className="py-2.5 px-4 font-mono">2026-11-20</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
