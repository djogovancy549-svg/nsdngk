import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  Trash2,
} from 'lucide-react';
import {
  exportDynamicRowsToCsv,
  extractGoogleSheetId,
  inferInputTypeFromHeader,
} from '../services/dynamicSheetService';
import {
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
  UserSession,
} from '../types/satuData';
import { HeroBannerSlider } from './HeroBannerSlider';
import { RunningSummaryTicker } from './RunningSummaryTicker';

interface OpdPortalWorkspaceProps {
  session: UserSession;
  accounts: OpdAccount[];
  ownSheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  syncingSheetId: string | null;
  notice: string | null;
  onDismissNotice: () => void;
  onRegisterSheet: (input: {
    judulDataset: string;
    deskripsi: string;
    sheetUrl: string;
    sheetName: string;
    manualHeaders: string[];
  }) => Promise<void>;
  onDeleteSheet: (sheet: OpdDynamicSheet) => void;
  onSyncSheet: (sheet: OpdDynamicSheet) => Promise<void>;
  onSubmitDynamicRow: (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow,
    isEdit: boolean
  ) => Promise<void>;
  onDeleteDynamicRow: (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow
  ) => Promise<void>;
  onLogout: () => void;
}

export function OpdPortalWorkspace({
  session,
  accounts,
  ownSheets,
  rowsBySheet,
  syncingSheetId,
  notice,
  onDismissNotice,
  onRegisterSheet,
  onDeleteSheet,
  onSyncSheet,
  onSubmitDynamicRow,
  onDeleteDynamicRow,
  onLogout,
}: OpdPortalWorkspaceProps) {
  const activeSheets = useMemo(
    () => ownSheets.filter((s) => s.status === 'Aktif'),
    [ownSheets]
  );

  const [activeTab, setActiveTab] = useState<'sheets' | 'form'>(() =>
    activeSheets.length > 0 ? 'form' : 'sheets'
  );
  const [selectedSheetId, setSelectedSheetId] = useState<string>(
    () => activeSheets[0]?.id ?? ''
  );

  // Sheet registration form state
  const [judulDataset, setJudulDataset] = useState('');
  const [deskripsi, setDeskripsi] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [manualHeadersText, setManualHeadersText] = useState('');
  const [regSheetBusy, setRegSheetBusy] = useState(false);
  const [regSheetError, setRegSheetError] = useState<string | null>(null);

  // Dynamic row form state
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingRowNumber, setEditingRowNumber] = useState<number | undefined>(
    undefined
  );
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [submittingRow, setSubmittingRow] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(
    null
  );

  const currentSheet =
    activeSheets.find((s) => s.id === selectedSheetId) ??
    activeSheets[0] ??
    null;

  const currentRows = currentSheet ? rowsBySheet[currentSheet.id] ?? [] : [];

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return currentRows;
    return currentRows.filter((row) =>
      Object.values(row.values).some((val) =>
        String(val).toLowerCase().includes(q)
      )
    );
  }, [currentRows, searchQuery]);

  const handleRegisterSheetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegSheetError(null);

    if (!judulDataset.trim() || !sheetUrl.trim()) {
      setRegSheetError('Judul dataset dan URL Google Sheet wajib diisi.');
      return;
    }

    const extractedId = extractGoogleSheetId(sheetUrl.trim());
    if (!extractedId) {
      setRegSheetError(
        'Format URL Google Sheet tidak valid. Contoh: https://docs.google.com/spreadsheets/d/ID_SHEET/edit'
      );
      return;
    }

    const manualHeaders = manualHeadersText
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    setRegSheetBusy(true);
    try {
      await onRegisterSheet({
        judulDataset: judulDataset.trim(),
        deskripsi: deskripsi.trim(),
        sheetUrl: sheetUrl.trim(),
        sheetName: sheetName.trim() || 'Sheet1',
        manualHeaders,
      });
      setJudulDataset('');
      setDeskripsi('');
      setSheetUrl('');
      setSheetName('Sheet1');
      setManualHeadersText('');
    } finally {
      setRegSheetBusy(false);
    }
  };

  const resetDynamicForm = () => {
    setEditingRowId(null);
    setEditingRowNumber(undefined);
    setFormValues({});
  };

  const handleStartEditRow = (row: DynamicSheetRow) => {
    setEditingRowId(row._id);
    setEditingRowNumber(row._rowNumber);
    setFormValues({ ...row.values });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDynamicFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSheet) return;

    const normalizedValues: Record<string, string> = {};
    currentSheet.headers.forEach((h) => {
      normalizedValues[h] = (formValues[h] ?? '').trim();
    });

    const row: DynamicSheetRow = {
      _id: editingRowId ?? `${currentSheet.id}-${Date.now().toString(36)}`,
      _rowNumber: editingRowNumber,
      _updatedAt: new Date().toISOString().slice(0, 10),
      values: normalizedValues,
    };

    setSubmittingRow(true);
    try {
      await onSubmitDynamicRow(currentSheet, row, Boolean(editingRowId));
      resetDynamicForm();
    } finally {
      setSubmittingRow(false);
    }
  };

  const openSheetWorkspace = (sheet: OpdDynamicSheet) => {
    setSelectedSheetId(sheet.id);
    resetDynamicForm();
    setActiveTab('form');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <RunningSummaryTicker
        accounts={accounts}
        sheets={ownSheets}
        rowsBySheet={rowsBySheet}
        scopedOpdName={session.namaOpd}
      />

      {/* Top Bar locked to this OPD */}
      <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-[#0B1B2B] text-white flex items-center justify-center shrink-0">
            <Shield className="w-4 h-4 text-teal-400" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-slate-900 truncate">
              {session.namaOpd}
            </span>
            <span className="block text-xs text-slate-500 truncate">
              {session.namaLengkap} · {session.email}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <div
            className="hidden sm:inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="tablist"
            aria-label="Menu Portal OPD"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sheets'}
              onClick={() => setActiveTab('sheets')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                activeTab === 'sheets'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Drive &amp; Sheet OPD ({ownSheets.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'form'}
              onClick={() => setActiveTab('form')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                activeTab === 'form'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Form &amp; Tabel Dinamis ({activeSheets.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Keluar
          </button>
        </div>
      </header>

      {/* Mobile Tab Bar */}
      <div className="sm:hidden bg-white border-b border-slate-200 px-4 py-2 flex gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('sheets')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
            activeTab === 'sheets'
              ? 'bg-[#0B1B2B] text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          Drive &amp; Sheet ({ownSheets.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('form')}
          className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
            activeTab === 'form'
              ? 'bg-[#0B1B2B] text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          Form &amp; Tabel ({activeSheets.length})
        </button>
      </div>

      <main className="flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <HeroBannerSlider compact />

        {notice && (
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border border-slate-300 rounded-md text-xs text-slate-700">
            <span>{notice}</span>
            <button
              type="button"
              onClick={onDismissNotice}
              className="text-slate-500 hover:text-slate-900 font-medium shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {/* TAB 1: PENDAFTARAN GOOGLE SHEET & DRIVE OPD */}
        {activeTab === 'sheets' && (
          <div className="space-y-6">
            {/* OPD Drive Info Strip */}
            <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 min-w-0">
                <p className="text-xs text-slate-500">
                  Kedaulatan Data · {session.namaOpd} · {session.email}
                </p>
                <h1 className="text-lg font-semibold text-slate-900">
                  Folder Google Drive &amp; Registrasi Sheet OPD
                </h1>
                <p className="text-xs text-slate-600">
                  Daftarkan tautan Google Sheet yang Anda buat di Google Drive
                  OPD. Super Admin akan mencangkokkan skrip{' '}
                  <code className="font-mono text-slate-800">doPost (Code.gs)</code>{' '}
                  agar form &amp; tabel otomatis terbuka sesuai header baris 1
                  sheet Anda.
                </p>
              </div>
              {session.driveFolderUrl && (
                <a
                  href={session.driveFolderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Buka Folder Drive OPD
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Form Ajukan Sheet Baru */}
              <form
                onSubmit={handleRegisterSheetSubmit}
                className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
              >
                <div className="pb-3 border-b border-slate-200">
                  <h2 className="text-base font-semibold text-slate-900">
                    Daftarkan URL Google Sheet Baru
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Pastikan baris 1 pada Google Sheet sudah berisi nama kolom
                    (header) data sektoral Anda.
                  </p>
                </div>

                {regSheetError && (
                  <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                    {regSheetError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="sheet-judul"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Judul Dataset / Laporan Sektoral
                  </label>
                  <input
                    id="sheet-judul"
                    type="text"
                    value={judulDataset}
                    onChange={(e) => setJudulDataset(e.target.value)}
                    placeholder="Contoh: Data Fasilitas Kesehatan & Nakes 2026"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="sheet-url"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Link URL Google Sheet OPD
                  </label>
                  <input
                    id="sheet-url"
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="sheet-tab"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      Nama Tab Sheet
                    </label>
                    <input
                      id="sheet-tab"
                      type="text"
                      value={sheetName}
                      onChange={(e) => setSheetName(e.target.value)}
                      placeholder="Sheet1"
                      className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sheet-desc"
                      className="block text-xs font-medium text-slate-700 mb-1.5"
                    >
                      Keterangan Singkat
                    </label>
                    <input
                      id="sheet-desc"
                      type="text"
                      value={deskripsi}
                      onChange={(e) => setDeskripsi(e.target.value)}
                      placeholder="Bidang / periode data"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="sheet-headers"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Header Kolom Baris 1 (Opsional — dipisah koma)
                  </label>
                  <input
                    id="sheet-headers"
                    type="text"
                    value={manualHeadersText}
                    onChange={(e) => setManualHeadersText(e.target.value)}
                    placeholder="Contoh: Kecamatan, Nama Puskesmas, Jumlah Dokter, Tahun"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Kosongkan jika Sheet dibagikan publik; sistem akan otomatis
                    membaca header dari baris 1 Google Sheet Anda.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={regSheetBusy}
                  className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  {regSheetBusy
                    ? 'Mendaftarkan Sheet...'
                    : 'Ajukan URL Sheet ke Super Admin'}
                </button>
              </form>

              {/* List Registered Sheets of this OPD */}
              <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-base font-semibold text-slate-900">
                    Google Sheet Terdaftar Milik {session.namaOpd}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Hak akses Form &amp; Tabel otomatis terbuka setelah Super Admin
                    mencangkokkan skrip <code className="font-mono">Code.gs</code>.
                  </p>
                </div>

                {ownSheets.length === 0 ? (
                  <div className="py-12 px-6 text-center">
                    <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-900">
                      Belum ada Google Sheet yang didaftarkan
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Daftarkan URL Google Sheet pertama milik dinas Anda
                      melalui formulir di samping.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {ownSheets.map((s) => {
                      const isActive = s.status === 'Aktif';
                      const isSyncing = syncingSheetId === s.id;
                      const rowCount = rowsBySheet[s.id]?.length ?? 0;

                      return (
                        <div key={s.id} className="p-5 space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                {isActive ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Aktif — Hak Akses Web Terbuka
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                    <Clock className="w-3.5 h-3.5" />
                                    Menunggu Cangkok Script oleh Super Admin
                                  </span>
                                )}
                                <span className="text-slate-300">·</span>
                                <span className="font-mono text-slate-500">
                                  Tab: {s.sheetName}
                                </span>
                                <span className="text-slate-300">·</span>
                                <span className="font-mono tabular-nums text-slate-500">
                                  {rowCount} baris
                                </span>
                              </div>
                              <h3 className="text-sm font-semibold text-slate-900">
                                {s.judulDataset}
                              </h3>
                              {s.deskripsi && (
                                <p className="text-xs text-slate-500">
                                  {s.deskripsi}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {isActive && (
                                <button
                                  type="button"
                                  onClick={() => openSheetWorkspace(s)}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap"
                                >
                                  Buka Form &amp; Tabel
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isSyncing}
                                onClick={() => onSyncSheet(s)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                              >
                                <RefreshCw
                                  className={`w-3 h-3 ${
                                    isSyncing ? 'animate-spin' : ''
                                  }`}
                                />
                                Deteksi Header
                              </button>
                              <a
                                href={s.sheetUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                              >
                                Sheet
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <button
                                type="button"
                                onClick={() => onDeleteSheet(s)}
                                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md"
                                aria-label={`Hapus ${s.judulDataset}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="text-xs text-slate-600">
                            <span className="text-slate-400">
                              Header terdeteksi ({s.headers.length} kolom):{' '}
                            </span>
                            {s.headers.length > 0 ? (
                              <span className="font-mono text-[11px] text-slate-700">
                                {s.headers.join(' · ')}
                              </span>
                            ) : (
                              <span className="italic text-slate-400">
                                Belum terbaca — klik Deteksi Header atau tunggu
                                pencangkokan script.
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FORMULIR & TABEL DINAMIS BERDASARKAN HEADER SHEET OPD */}
        {activeTab === 'form' && (
          <div className="space-y-6">
            {activeSheets.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
                <Lock className="w-8 h-8 text-slate-400 mx-auto" />
                <h2 className="text-base font-semibold text-slate-900">
                  Belum Ada Sheet dengan Hak Akses Web Aktif
                </h2>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Daftarkan URL Google Sheet OPD Anda terlebih dahulu, lalu
                  tunggu Super Admin mencangkokkan skrip{' '}
                  <code className="font-mono">doPost (Code.gs)</code> dan
                  mengaktifkan hak akses web untuk dinas Anda.
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('sheets')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800"
                >
                  Ke Pendaftaran Sheet OPD
                </button>
              </div>
            ) : currentSheet ? (
              <>
                {/* Dataset Selector Bar */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-w-0">
                    <label
                      htmlFor="active-sheet-picker"
                      className="text-xs font-medium text-slate-500 whitespace-nowrap"
                    >
                      Pilih Sheet Aktif:
                    </label>
                    <select
                      id="active-sheet-picker"
                      value={currentSheet.id}
                      onChange={(e) => {
                        setSelectedSheetId(e.target.value);
                        resetDynamicForm();
                      }}
                      className="h-9 px-3 text-sm font-medium bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
                    >
                      {activeSheets.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.judulDataset} ({s.headers.length} kolom)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={syncingSheetId === currentSheet.id}
                      onClick={() => onSyncSheet(currentSheet)}
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${
                          syncingSheetId === currentSheet.id
                            ? 'animate-spin'
                            : ''
                        }`}
                      />
                      Sinkron Header &amp; Data
                    </button>
                    <a
                      href={currentSheet.sheetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Buka Google Sheet
                    </a>
                  </div>
                </div>

                {/* Auto-Generated Dynamic Form from Row 1 Headers */}
                <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200">
                    <p className="text-xs text-slate-500">
                      Formulir Dinamis Otomatis · {currentSheet.headers.length}{' '}
                      kolom header dari baris 1 Sheet{' '}
                      <span className="font-mono">{currentSheet.sheetName}</span>
                    </p>
                    <h2 className="text-lg font-semibold text-slate-900 mt-0.5">
                      {editingRowId
                        ? `Ubah Baris Data — ${currentSheet.judulDataset}`
                        : `Input Data — ${currentSheet.judulDataset}`}
                    </h2>
                  </div>

                  {currentSheet.headers.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-500">
                      Header baris 1 pada Google Sheet belum terdeteksi. Klik{' '}
                      <strong>Sinkron Header &amp; Data</strong> di atas setelah
                      mengisi judul kolom pada baris 1 Google Sheet Anda.
                    </div>
                  ) : (
                    <form
                      onSubmit={handleDynamicFormSubmit}
                      className="p-6 space-y-5"
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {currentSheet.headers.map((header) => {
                          const inputType = inferInputTypeFromHeader(header);
                          return (
                            <div key={header}>
                              <label
                                htmlFor={`dyn-${header}`}
                                className="block text-xs font-medium text-slate-700 mb-1.5"
                              >
                                {header}
                              </label>
                              <input
                                id={`dyn-${header}`}
                                type={inputType}
                                step={inputType === 'number' ? 'any' : undefined}
                                value={formValues[header] ?? ''}
                                onChange={(e) =>
                                  setFormValues((prev) => ({
                                    ...prev,
                                    [header]: e.target.value,
                                  }))
                                }
                                placeholder={`Masukkan ${header}`}
                                className={`w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900 ${
                                  inputType === 'number'
                                    ? 'font-mono tabular-nums'
                                    : ''
                                }`}
                                required
                              />
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
                        {editingRowId && (
                          <button
                            type="button"
                            onClick={resetDynamicForm}
                            className="px-4 h-10 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            Batal Ubah
                          </button>
                        )}
                        <button
                          type="submit"
                          disabled={submittingRow}
                          className="inline-flex items-center gap-2 px-5 h-10 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          {submittingRow
                            ? 'Mengirim ke Google Sheet...'
                            : editingRowId
                            ? 'Simpan Perubahan Baris'
                            : 'Kirim ke Google Sheet'}
                        </button>
                      </div>
                    </form>
                  )}
                </section>

                {/* Auto-Generated Dynamic Table */}
                <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                  <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Cari di seluruh kolom..."
                        className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono tabular-nums text-slate-500">
                        {filteredRows.length} baris
                      </span>
                      <button
                        type="button"
                        disabled={filteredRows.length === 0}
                        onClick={() =>
                          exportDynamicRowsToCsv(
                            currentSheet.headers,
                            filteredRows,
                            `${currentSheet.opdId}-${currentSheet.sheetName}.csv`
                          )
                        }
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Unduh CSV
                      </button>
                    </div>
                  </div>

                  {filteredRows.length === 0 ? (
                    <div className="py-12 px-6 text-center">
                      <p className="text-sm font-medium text-slate-900">
                        Belum ada baris data tersimpan
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Isi formulir dinamis di atas atau klik Sinkron Header
                        &amp; Data untuk menarik isi Google Sheet Anda.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                            <th className="py-2.5 px-4 w-12 font-mono">#</th>
                            {currentSheet.headers.map((header) => (
                              <th
                                key={header}
                                className="py-2.5 px-3 whitespace-nowrap"
                              >
                                {header}
                              </th>
                            ))}
                            <th className="py-2.5 px-4 text-right whitespace-nowrap">
                              Aksi
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredRows.map((row, idx) => {
                            const isConfirming = confirmDeleteRowId === row._id;
                            return (
                              <tr
                                key={row._id}
                                className="hover:bg-slate-50/70"
                              >
                                <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-400">
                                  {idx + 1}
                                </td>
                                {currentSheet.headers.map((header) => {
                                  const isNum =
                                    inferInputTypeFromHeader(header) ===
                                    'number';
                                  return (
                                    <td
                                      key={header}
                                      className={`py-3 px-3 text-slate-800 whitespace-nowrap ${
                                        isNum ? 'font-mono tabular-nums' : ''
                                      }`}
                                    >
                                      {row.values[header] || '—'}
                                    </td>
                                  );
                                })}
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  {isConfirming ? (
                                    <div className="inline-flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          await onDeleteDynamicRow(
                                            currentSheet,
                                            row
                                          );
                                          setConfirmDeleteRowId(null);
                                        }}
                                        className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700"
                                      >
                                        Hapus
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteRowId(null)
                                        }
                                        className="px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded"
                                      >
                                        Batal
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleStartEditRow(row)}
                                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md"
                                        aria-label="Ubah baris"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setConfirmDeleteRowId(row._id)
                                        }
                                        className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-md"
                                        aria-label="Hapus baris"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
