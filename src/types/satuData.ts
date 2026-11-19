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
export interface OpdDynamicSheet {
  id: string;
  accountId: string;
  opdId: string;
  namaOpd: string;
  emailOpd: string;
  driveFolderUrl: string;
  judulDataset: string;
  deskripsi: string;
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
  _updatedAt: string;
  values: Record<string, string>;
}

export type SyncSource = 'webhook' | 'sheet_csv' | 'local_cache';

export type ActiveNavSection =
  | 'ringkasan'
  | 'data_masuk'
  | 'akun_sheet'
  | 'konfigurasi'
  | 'aktivitas';

export type AuditActionType =
  | 'Akun OPD'
  | 'Daftar Sheet'
  | 'Cangkok Script'
  | 'Sinkronisasi Sheet'
  | 'Input Data OPD'
  | 'Ubah Data OPD'
  | 'Hapus Data OPD';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  action: AuditActionType;
  opdNama: string;
  target: string;
  deskripsi: string;
  syncedToSheet: boolean;
}
