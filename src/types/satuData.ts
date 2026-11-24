export interface OpdDirectoryItem {
  id: string;
  kode: string;
  nama: string;
  singkatan: string;
  urusan: string;
}

export interface AuthSheetConfig {
  sheetId: string;
  sheetName: string;
  gid: string;
  sheetUrl: string;
  webhookUrl: string;
}

export type AccountRole = 'super_admin' | 'opd';
export type AccountStatus = 'Aktif' | 'Nonaktif';

export interface OpdAccount {
  id: string;
  opdId: string;
  namaOpd: string;
  namaLengkap: string;
  email: string;
  username: string;
  passwordHash: string;
  driveFolderUrl: string;
  role: 'opd';
  status: AccountStatus;
  dibuatPada: string;
}

export type RegistrationRequestStatus =
  | 'Menunggu Persetujuan'
  | 'PIN Diterbitkan'
  | 'Sudah Digunakan'
  | 'Ditolak';

export interface OpdRegistrationRequestView {
  id: string;
  opdId: string;
  namaOpd: string;
  namaPemohon: string;
  jabatan: string;
  emailPemohon: string;
  nomorKontak: string;
  alasanPengajuan: string;
  status: RegistrationRequestStatus;
  pinHint: string | null;
  pinIssuedAt: string | null;
  pinExpiresAt: string | null;
  approvedBy: string | null;
  catatanAdmin: string | null;
  dibuatPada: string;
  digunakanPada: string | null;
  syncedToSheet?: boolean;
}

export interface UserSession {
  id: string;
  role: AccountRole;
  username: string;
  email: string;
  namaLengkap: string;
  opdId: string | null;
  namaOpd: string;
  driveFolderUrl?: string;
}

export type SheetIntegrationStatus = 'Menunggu Cangkok Script' | 'Aktif';

/**
 * Sheet dinamis yang didaftarkan oleh masing-masing OPD.
 * Header kolom diambil langsung dari baris 1 Google Sheet milik OPD tersebut,
 * sehingga formulir dan tabel terbentuk otomatis sesuai kedaulatan data OPD.
 */
export type MetadataFrequency =
  | 'Harian'
  | 'Mingguan'
  | 'Bulanan'
  | 'Triwulanan'
  | 'Semesteran'
  | 'Tahunan'
  | 'Ad-Hoc';

export type MetadataCoverage =
  | 'Kabupaten'
  | 'Kecamatan'
  | 'Desa/Kelurahan'
  | 'Fasilitas/Unit';

export type MetadataAccessLevel =
  | 'Terbuka (Publik)'
  | 'Terbatas (Internal OPD)'
  | 'Rahasia (PII Terproteksi)';

export type MetadataCollectionMethod =
  | 'Kompilasi Administrasi'
  | 'Survei'
  | 'Sensus'
  | 'Pendataan Lapangan'
  | 'Integrasi Sistem';

export type MetadataValidationStatus =
  | 'Belum Diverifikasi'
  | 'Perlu Revisi'
  | 'Terverifikasi Walidata';

export type MetadataVariableDataType =
  | 'Teks'
  | 'Angka'
  | 'Tanggal'
  | 'Persentase'
  | 'Kode Wilayah'
  | 'Koordinat';

export interface MetadataVariableItem {
  namaKolom: string;
  definisi: string;
  tipeData: MetadataVariableDataType;
  satuan: string;
  wajibDiisi: boolean;
}

/**
 * Metadata Statistik Sektoral (MS-Kegiatan & MS-Variabel — Standar Satu Data Indonesia / Perpres 39/2019).
 */
export interface DatasetMetadata {
  sheetId: string;
  kodeReferensi: string;
  urusanPemerintahan: string;
  produsenData: string;
  walidata: string;
  tahunData: string;
  frekuensiPemutakhiran: MetadataFrequency;
  cakupanWilayah: MetadataCoverage;
  tingkatAkses: MetadataAccessLevel;
  metodologiPengumpulan: MetadataCollectionMethod;
  satuanPengukuran: string;
  konsepDefinisi: string;
  kontakPic: string;
  statusValidasi: MetadataValidationStatus;
  catatanWalidata: string;
  variabel: MetadataVariableItem[];
  diperbaruiPada: string;
  diperbaruiOleh: string;
}

export type SheetStorageMode = 'google_sheet' | 'server_standalone';

export type SheetPartitionStrategy =
  | 'TIME_YEAR'
  | 'TIME_MONTH'
  | 'ROW_SHARD'
  | 'SINGLE';

export interface SheetPartitionManifestEntry {
  partitionKey: string;
  tabName: string;
  rowCount: number;
  cellCount: number;
  tier: 'HOT' | 'WARM' | 'ARCHIVED_BQ';
  lastIngestedAt: string;
}

export interface SheetBqPolicyConfig {
  partitionStrategy: SheetPartitionStrategy;
  maxRowsPerPartition: number;
  workbookCellBudgetPct: number;
  enableWriteAheadBatching: boolean;
  batchFlushIntervalSec: number;
  batchMaxSize: number;
  maxWritesPerMinuteQuota: number;
  retryMaxAttempts: number;
  updatedAt?: string;
}

export interface SheetBqPendingSummary {
  sheetId: string;
  judulDataset: string;
  partitionKey: string;
  pendingCount: number;
  oldestQueuedAt: string;
}

export interface SheetBqTelemetry {
  policy: SheetBqPolicyConfig;
  queueDepth: number;
  writesLastMinute: number;
  totalQueuedRows: number;
  totalFlushedBatches: number;
  totalFlushedRows: number;
  totalCoalescedRows: number;
  quotaCallsSavedPct: number;
  rateLimitHits: number;
  retriesSucceeded: number;
  pendingBySheet: SheetBqPendingSummary[];
  lastFlushAt: string | null;
  lastError: string | null;
}

export interface OpdDynamicSheet {
  id: string;
  accountId: string;
  opdId: string;
  namaOpd: string;
  emailOpd: string;
  driveFolderUrl: string;
  judulDataset: string;
  deskripsi: string;
  storageMode?: SheetStorageMode;
  partitionStrategy?: SheetPartitionStrategy;
  partitionManifest?: SheetPartitionManifestEntry[];
  sheetUrl: string;
  sheetId: string;
  sheetName: string;
  webhookUrl: string;
  headers: string[];
  availableTabs?: string[];
  status: SheetIntegrationStatus;
  didaftarkanPada: string;
  terakhirSinkron: string | null;
}

/**
 * Baris data dinamis: key adalah nama header persis dari baris 1 Google Sheet OPD.
 */
export interface DynamicSheetRow {
  _id: string;
  _rowNumber?: number;
  _partitionKey?: string;
  _updatedAt: string;
  values: Record<string, string>;
}

export type SyncSource =
  | 'webhook'
  | 'sheet_csv'
  | 'server_sovereign'
  | 'local_cache';

export type ActiveNavSection =
  | 'ringkasan'
  | 'data_masuk'
  | 'metadata'
  | 'publikasi'
  | 'akun_sheet'
  | 'keamanan'
  | 'konfigurasi'
  | 'aktivitas';

export type SecuritySeverity = 'Rendah' | 'Sedang' | 'Tinggi' | 'Kritis';

export interface SecurityEventEntry {
  id: string;
  timestamp: string;
  kategori:
    | 'Brute Force'
    | 'Login Gagal'
    | 'Injeksi Payload'
    | 'Kebocoran PII'
    | 'Inspeksi Diblokir'
    | 'Perangkap Honeypot'
    | 'Audit AI';
  tingkat: SecuritySeverity;
  aktor: string;
  target: string;
  detail: string;
  diblokir: boolean;
}

export interface ServerIntrusionAlert {
  id: string;
  timestamp: string;
  ip: string;
  path: string;
  jenisAncaman: string;
  taktikPengelabuan: string;
  tingkat: SecuritySeverity;
}

export interface DeceptionConfig {
  honeypotEndpointsAktif: boolean;
  formHoneypotAktif: boolean;
  tarpitDelayAktif: boolean;
  tantanganDinamisAktif: boolean;
  peringatanAiOtomatis: boolean;
}

export type AuditActionType =
  | 'Akun OPD'
  | 'Daftar Sheet'
  | 'Cangkok Script'
  | 'Sinkronisasi Sheet'
  | 'Metadata Dataset'
  | 'Publikasi Data'
  | 'Keamanan Siber'
  | 'Input Data OPD'
  | 'Ubah Data OPD'
  | 'Hapus Data OPD';

export interface PublishSheetConfig {
  sheetId: string;
  sheetName: string;
  sheetUrl: string;
  webhookUrl: string;
}

export type PublishStatus = 'Draft' | 'Dipublikasikan';

export interface PublishedDatasetClone {
  id: string;
  sourceSheetId: string;
  sourceOpdNama: string;
  sourceSheetName: string;
  judulPublikasi: string;
  kategori: string;
  ringkasan: string;
  targetTabName: string;
  selectedHeaders: string[];
  rows: DynamicSheetRow[];
  statusPublikasi: PublishStatus;
  dipublikasikanPada: string;
  syncedToKominfoSheet: boolean;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditActionType;
  opdNama: string;
  target: string;
  deskripsi: string;
  syncedToSheet: boolean;
}
