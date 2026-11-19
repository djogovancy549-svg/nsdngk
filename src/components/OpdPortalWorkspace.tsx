import React, { useMemo, useState } from 'react';
import {
  AlignLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  Hash,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Shield,
  Trash2,
  Type,
  User,
  X,
} from 'lucide-react';
import {
  clearOpdDeletePin,
  hasOpdDeletePin,
  saveOpdDeletePin,
  verifyOpdDeletePin,
} from '../services/authSheetService';
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
  onAddWorkbookTab: (
    baseSheet: OpdDynamicSheet,
    tabName: string
  ) => Promise<OpdDynamicSheet | null>;
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
  onAddWorkbookTab,
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
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [submittingRow, setSubmittingRow] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(
    null
  );
  const [newTabName, setNewTabName] = useState('');
  const [loadingNewTab, setLoadingNewTab] = useState(false);

  // Per-OPD Security PIN for delete protection
  const opdPinKey = session.opdId || session.id;
  const [pinEnabled, setPinEnabled] = useState<boolean>(() =>
    hasOpdDeletePin(opdPinKey)
  );
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinOldInput, setPinOldInput] = useState('');
  const [pinNewInput, setPinNewInput] = useState('');
  const [pinConfirmInput, setPinConfirmInput] = useState('');
  const [pinSetupError, setPinSetupError] = useState<string | null>(null);
  const [pinSetupSuccess, setPinSetupSuccess] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  // Unified PIN-protected delete modal state
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'sheet'; sheet: OpdDynamicSheet; label: string }
    | { kind: 'row'; sheet: OpdDynamicSheet; row: DynamicSheetRow; label: string }
    | null
  >(null);
  const [deletePinInput, setDeletePinInput] = useState('');
  const [deletePinError, setDeletePinError] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  const currentSheet =
    activeSheets.find((s) => s.id === selectedSheetId) ??
    activeSheets[0] ??
    null;

  const sameWorkbookSheets = useMemo(() => {
    if (!currentSheet) return [];
    return activeSheets.filter((s) => s.sheetId === currentSheet.sheetId);
  }, [activeSheets, currentSheet]);

  const unopenedDiscoveredTabs = useMemo(() => {
    if (!currentSheet?.availableTabs) return [];
    const opened = new Set(
      sameWorkbookSheets.map((s) => s.sheetName.trim().toLowerCase())
    );
    return currentSheet.availableTabs.filter(
      (t) => t.trim() && !opened.has(t.trim().toLowerCase())
    );
  }, [currentSheet, sameWorkbookSheets]);

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
    setFormModalOpen(true);
  };

  const openNewRowModal = (sheet?: OpdDynamicSheet) => {
    if (sheet) {
      setSelectedSheetId(sheet.id);
    }
    resetDynamicForm();
    setFormModalOpen(true);
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
      setFormModalOpen(false);
    } finally {
      setSubmittingRow(false);
    }
  };

  const openSheetWorkspace = (sheet: OpdDynamicSheet) => {
    setSelectedSheetId(sheet.id);
    resetDynamicForm();
    setActiveTab('form');
  };

  const handleLoadWorkbookTab = async (tabNameToLoad: string) => {
    if (!currentSheet || !tabNameToLoad.trim()) return;
    setLoadingNewTab(true);
    try {
      const opened = await onAddWorkbookTab(currentSheet, tabNameToLoad.trim());
      if (opened) {
        setSelectedSheetId(opened.id);
        resetDynamicForm();
        setNewTabName('');
      }
    } finally {
      setLoadingNewTab(false);
    }
  };

  const openPinSettingsModal = () => {
    setPinOldInput('');
    setPinNewInput('');
    setPinConfirmInput('');
    setPinSetupError(null);
    setPinSetupSuccess(null);
    setPinModalOpen(true);
  };

  const handleSavePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPinSetupError(null);
    setPinSetupSuccess(null);

    if (pinEnabled) {
      const validOld = await verifyOpdDeletePin(opdPinKey, pinOldInput);
      if (!validOld) {
        setPinSetupError('PIN lama tidak sesuai.');
        return;
      }
    }

    if (!/^\d{4,6}$/.test(pinNewInput.trim())) {
      setPinSetupError('PIN baru harus terdiri dari 4 sampai 6 digit angka.');
      return;
    }

    if (pinNewInput.trim() !== pinConfirmInput.trim()) {
      setPinSetupError('Konfirmasi PIN baru tidak cocok.');
      return;
    }

    setPinBusy(true);
    try {
      await saveOpdDeletePin(opdPinKey, pinNewInput.trim());
      setPinEnabled(true);
      setPinOldInput('');
      setPinNewInput('');
      setPinConfirmInput('');
      setPinSetupSuccess(
        'PIN Keamanan Hapus berhasil disimpan. Setiap penghapusan tab, sheet, atau baris kini dilindungi PIN.'
      );
    } finally {
      setPinBusy(false);
    }
  };

  const handleDisablePin = async () => {
    setPinSetupError(null);
    setPinSetupSuccess(null);
    const validOld = await verifyOpdDeletePin(opdPinKey, pinOldInput);
    if (!validOld) {
      setPinSetupError(
        'Masukkan PIN saat ini dengan benar untuk menonaktifkan proteksi PIN.'
      );
      return;
    }
    clearOpdDeletePin(opdPinKey);
    setPinEnabled(false);
    setPinOldInput('');
    setPinNewInput('');
    setPinConfirmInput('');
    setPinSetupSuccess('Proteksi PIN Hapus telah dinonaktifkan.');
  };

  const requestProtectedSheetDelete = (sheet: OpdDynamicSheet) => {
    setDeletePinInput('');
    setDeletePinError(null);
    setPendingDelete({
      kind: 'sheet',
      sheet,
      label: `Tab "${sheet.sheetName}" (${sheet.judulDataset})`,
    });
  };

  const requestProtectedRowDelete = (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow,
    rowIndex: number
  ) => {
    setDeletePinInput('');
    setDeletePinError(null);
    setPendingDelete({
      kind: 'row',
      sheet,
      row,
      label: `Baris #${rowIndex + 1} pada Tab "${sheet.sheetName}"`,
    });
  };

  const handleConfirmProtectedDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingDelete) return;
    setDeletePinError(null);

    if (pinEnabled) {
      if (!deletePinInput.trim()) {
        setDeletePinError('Masukkan PIN Hapus OPD terlebih dahulu.');
        return;
      }
      const ok = await verifyOpdDeletePin(opdPinKey, deletePinInput.trim());
      if (!ok) {
        setDeletePinError('PIN salah. Penghapusan dibatalkan demi keamanan data.');
        return;
      }
    }

    setDeletingBusy(true);
    try {
      if (pendingDelete.kind === 'sheet') {
        const target = pendingDelete.sheet;
        if (currentSheet?.id === target.id) {
          const fallback = activeSheets.find((s) => s.id !== target.id);
          setSelectedSheetId(fallback?.id ?? '');
          resetDynamicForm();
        }
        onDeleteSheet(target);
      } else {
        await onDeleteDynamicRow(pendingDelete.sheet, pendingDelete.row);
        setConfirmDeleteRowId(null);
      }
      setPendingDelete(null);
      setDeletePinInput('');
    } finally {
      setDeletingBusy(false);
    }
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
            onClick={openPinSettingsModal}
            className={`inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
              pinEnabled
                ? 'text-teal-800 bg-teal-50 border-teal-200 hover:bg-teal-100'
                : 'text-slate-700 bg-white border-slate-300 hover:bg-slate-50'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span className="hidden md:inline">
              {pinEnabled ? 'PIN Hapus Aktif' : 'Atur PIN Hapus'}
            </span>
          </button>

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
                                onClick={() => requestProtectedSheetDelete(s)}
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
                {/* Sheet Icon Grid + Workbook Controls */}
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium text-teal-700">
                          Tampilan Ikon Sheet · {sameWorkbookSheets.length} tab
                          aktif
                        </p>
                        <h2 className="text-base font-semibold text-slate-900 truncate">
                          {currentSheet.judulDataset.split(' — ')[0]}
                        </h2>
                      </div>
                      {activeSheets.length > sameWorkbookSheets.length && (
                        <select
                          aria-label="Pilih workbook aktif"
                          value={currentSheet.id}
                          onChange={(e) => {
                            setSelectedSheetId(e.target.value);
                            resetDynamicForm();
                          }}
                          className="h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-800 focus:outline-none focus:border-slate-900"
                        >
                          {activeSheets.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.judulDataset} [{s.sheetName}]
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleLoadWorkbookTab(newTabName);
                        }}
                        className="flex items-center gap-1.5"
                      >
                        <input
                          type="text"
                          value={newTabName}
                          onChange={(e) => setNewTabName(e.target.value)}
                          placeholder="Nama tab (mis. Sheet2)"
                          className="h-9 w-44 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                        />
                        <button
                          type="submit"
                          disabled={loadingNewTab || !newTabName.trim()}
                          className="inline-flex items-center gap-1 h-9 px-3 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {loadingNewTab ? 'Memuat...' : 'Muat Tab'}
                        </button>
                      </form>

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
                        Sinkron
                      </button>

                      <a
                        href={currentSheet.sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Sheet
                      </a>
                    </div>
                  </div>

                  {/* Icon Cards for Sheets in This Workbook */}
                  <div className="p-5 bg-slate-50/60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3.5">
                    {sameWorkbookSheets.map((tabSheet) => {
                      const isCurrent = tabSheet.id === currentSheet.id;
                      const tabRowCount = rowsBySheet[tabSheet.id]?.length ?? 0;

                      return (
                        <div
                          key={tabSheet.id}
                          onClick={() => {
                            setSelectedSheetId(tabSheet.id);
                            resetDynamicForm();
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedSheetId(tabSheet.id);
                              resetDynamicForm();
                            }
                          }}
                          className={`group relative rounded-xl border p-4 flex flex-col justify-between gap-3 cursor-pointer transition-all ${
                            isCurrent
                              ? 'bg-[#0B1B2B] text-white border-[#0B1B2B] shadow-md'
                              : 'bg-white text-slate-900 border-slate-200 hover:border-teal-600/50 hover:shadow-xs'
                          }`}
                        >
                          {/* Top Row: Sheet Icon + Protected Delete */}
                          <div className="flex items-start justify-between gap-2">
                            <div
                              className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${
                                isCurrent
                                  ? 'bg-teal-500/20 text-teal-300'
                                  : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              <FileSpreadsheet className="w-6 h-6" />
                            </div>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                requestProtectedSheetDelete(tabSheet);
                              }}
                              title={`Hapus tab ${tabSheet.sheetName}${
                                pinEnabled ? ' (Dilindungi PIN)' : ''
                              }`}
                              aria-label={`Hapus tab ${tabSheet.sheetName}`}
                              className={`p-1 rounded-md transition-colors ${
                                isCurrent
                                  ? 'text-slate-400 hover:text-red-300 hover:bg-white/10'
                                  : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Middle: Tab Name & Counts */}
                          <div className="min-w-0">
                            <p
                              className={`text-sm font-semibold truncate ${
                                isCurrent ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {tabSheet.sheetName}
                            </p>
                            <p
                              className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                                isCurrent ? 'text-slate-300' : 'text-slate-500'
                              }`}
                            >
                              {tabSheet.headers.length} kolom · {tabRowCount}{' '}
                              baris
                            </p>
                          </div>

                          {/* Footer: Open Modal Form Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openNewRowModal(tabSheet);
                            }}
                            className={`w-full inline-flex items-center justify-center gap-1.5 h-8 text-xs font-medium rounded-md transition-colors ${
                              isCurrent
                                ? 'bg-teal-600 text-white hover:bg-teal-500'
                                : 'bg-slate-100 text-slate-800 hover:bg-[#0B1B2B] hover:text-white'
                            }`}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Input Data
                          </button>
                        </div>
                      );
                    })}

                    {unopenedDiscoveredTabs.map((tabName) => (
                      <button
                        key={tabName}
                        type="button"
                        disabled={loadingNewTab}
                        onClick={() => handleLoadWorkbookTab(tabName)}
                        className="rounded-xl border border-dashed border-teal-500/70 bg-teal-50/50 hover:bg-teal-50 p-4 flex flex-col items-center justify-center text-center gap-2 transition-colors min-h-[148px]"
                      >
                        <div className="w-10 h-10 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center">
                          <Plus className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-xs font-semibold font-mono text-teal-900">
                            {tabName}
                          </p>
                          <p className="text-[11px] text-teal-700 mt-0.5">
                            Klik untuk muat tab
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>

                {/* Auto-Generated Dynamic Table */}
                <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0">
                      <div className="relative flex-1 max-w-sm">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={`Cari data pada ${currentSheet.sheetName}...`}
                          className="w-full h-9 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                        />
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        Tab: <strong className="text-slate-800">{currentSheet.sheetName}</strong> ·{' '}
                        {filteredRows.length} baris
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openNewRowModal(currentSheet)}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Input Data Baru
                      </button>
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
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5" />
                        CSV
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
                                          pinEnabled
                                            ? requestProtectedRowDelete(
                                                currentSheet,
                                                row,
                                                idx
                                              )
                                            : setConfirmDeleteRowId(row._id)
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

      {/* Modal 0: Formulir Input / Ubah Data Dinamis (Profesional) */}
      {formModalOpen && currentSheet && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dynamic-form-modal-title"
        >
          <div className="w-full max-w-3xl max-h-[90vh] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            {/* Architectural Modal Header */}
            <div className="bg-[#0B1B2B] text-white px-6 py-5 flex items-start justify-between gap-4 shrink-0">
              <div className="flex items-start gap-3.5 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-teal-500/20 text-teal-300 flex items-center justify-center shrink-0 mt-0.5">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-teal-300 font-medium">
                    <span>Formulir Dinamis Otomatis</span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono text-slate-300">
                      Tab: {currentSheet.sheetName}
                    </span>
                    <span className="text-slate-500">·</span>
                    <span className="font-mono tabular-nums text-slate-300">
                      {currentSheet.headers.length} kolom
                    </span>
                  </div>
                  <h2
                    id="dynamic-form-modal-title"
                    className="text-lg font-semibold tracking-tight text-white truncate"
                  >
                    {editingRowId
                      ? `Ubah Baris Data — ${currentSheet.judulDataset}`
                      : `Input Data Baru — ${currentSheet.judulDataset}`}
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setFormModalOpen(false);
                  resetDynamicForm();
                }}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-md shrink-0"
                aria-label="Tutup formulir"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Completion Strip */}
            {currentSheet.headers.length > 0 && (() => {
              const filledCount = currentSheet.headers.filter(
                (h) => (formValues[h] ?? '').trim().length > 0
              ).length;
              const pct = Math.round(
                (filledCount / currentSheet.headers.length) * 100
              );
              return (
                <div className="px-6 py-2.5 bg-slate-900/95 border-t border-white/10 flex items-center justify-between gap-4 shrink-0">
                  <span className="text-[11px] text-slate-300">
                    Kelengkapan isian kolom otomatis
                  </span>
                  <div className="flex items-center gap-3 w-48 sm:w-64">
                    <div className="h-1.5 flex-1 bg-white/15 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-teal-400 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono tabular-nums font-semibold text-teal-300 shrink-0">
                      {filledCount}/{currentSheet.headers.length} ({pct}%)
                    </span>
                  </div>
                </div>
              );
            })()}

            {currentSheet.headers.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-900">
                  Header baris 1 belum terdeteksi
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Isi judul kolom pada baris 1 tab{' '}
                  <strong className="font-mono">{currentSheet.sheetName}</strong>{' '}
                  di Google Sheet Anda, lalu klik tombol <strong>Sinkron</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => setFormModalOpen(false)}
                  className="h-9 px-4 text-xs font-medium text-white bg-[#0B1B2B] rounded-md"
                >
                  Tutup
                </button>
              </div>
            ) : (
              <form
                onSubmit={handleDynamicFormSubmit}
                className="flex flex-col flex-1 min-h-0"
              >
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/70">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {currentSheet.headers.map((header, idx) => {
                      const lower = header.toLowerCase();
                      const baseType = inferInputTypeFromHeader(header);
                      const isPhone =
                        lower.includes('hp') ||
                        lower.includes('telp') ||
                        lower.includes('wa') ||
                        lower.includes('kontak');
                      const isEmail =
                        lower.includes('email') || lower.includes('surel');
                      const isAddress =
                        lower.includes('alamat') ||
                        lower.includes('kecamatan') ||
                        lower.includes('desa') ||
                        lower.includes('lokasi');
                      const isPerson =
                        lower.includes('nama') ||
                        lower.includes('kepala') ||
                        lower.includes('petugas');
                      const isLongText =
                        lower.includes('keterangan') ||
                        lower.includes('catatan') ||
                        lower.includes('deskripsi') ||
                        lower.includes('uraian');

                      const resolvedType = isEmail
                        ? 'email'
                        : isPhone
                        ? 'tel'
                        : baseType;

                      const FieldIcon =
                        resolvedType === 'date'
                          ? Calendar
                          : resolvedType === 'number'
                          ? Hash
                          : isPhone
                          ? Phone
                          : isEmail
                          ? Mail
                          : isAddress
                          ? MapPin
                          : isPerson
                          ? User
                          : isLongText
                          ? AlignLeft
                          : Type;

                      const val = formValues[header] ?? '';
                      const isFilled = val.trim().length > 0;
                      const fieldIndex = String(idx + 1).padStart(2, '0');

                      return (
                        <div
                          key={header}
                          className={`bg-white border rounded-xl p-4 transition-all ${
                            isLongText ? 'sm:col-span-2' : ''
                          } ${
                            isFilled
                              ? 'border-teal-600/45 shadow-2xs'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <label
                              htmlFor={`modal-dyn-${header}`}
                              className="flex items-center gap-2 text-xs font-semibold text-slate-800"
                            >
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-slate-100 font-mono text-[10px] font-semibold text-slate-500">
                                {fieldIndex}
                              </span>
                              <span>{header}</span>
                            </label>
                            {isFilled && (
                              <Check className="w-3.5 h-3.5 text-teal-600 shrink-0" />
                            )}
                          </div>

                          {isLongText ? (
                            <textarea
                              id={`modal-dyn-${header}`}
                              rows={3}
                              value={val}
                              onChange={(e) =>
                                setFormValues((prev) => ({
                                  ...prev,
                                  [header]: e.target.value,
                                }))
                              }
                              placeholder={`Tuliskan ${header}...`}
                              className="w-full px-3 py-2 text-sm text-slate-900 bg-slate-50/70 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-600/15 transition-all"
                              required
                            />
                          ) : (
                            <div className="relative">
                              <FieldIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                id={`modal-dyn-${header}`}
                                type={resolvedType}
                                step={
                                  resolvedType === 'number' ? 'any' : undefined
                                }
                                value={val}
                                onChange={(e) =>
                                  setFormValues((prev) => ({
                                    ...prev,
                                    [header]: e.target.value,
                                  }))
                                }
                                placeholder={`Masukkan ${header}`}
                                className={`w-full h-10 pl-9 pr-3 text-sm text-slate-900 bg-slate-50/70 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-600/15 transition-all ${
                                  resolvedType === 'number' || isPhone
                                    ? 'font-mono tabular-nums'
                                    : ''
                                }`}
                                required
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="px-6 py-4 bg-white border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                  <p className="text-xs text-slate-500">
                    Tersimpan langsung ke tab{' '}
                    <span className="font-mono text-slate-800">
                      {currentSheet.sheetName}
                    </span>{' '}
                    milik {session.namaOpd}.
                  </p>
                  <div className="flex items-center justify-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={resetDynamicForm}
                      className="inline-flex items-center gap-1.5 px-3.5 h-10 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Bersihkan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFormModalOpen(false);
                        resetDynamicForm();
                      }}
                      className="px-3.5 h-10 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                      Batal
                    </button>
                    <button
                      type="submit"
                      disabled={submittingRow}
                      className="inline-flex items-center gap-2 px-5 h-10 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 transition-colors"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {submittingRow
                        ? 'Mengirim...'
                        : editingRowId
                        ? 'Simpan Perubahan'
                        : 'Kirim ke Google Sheet'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Modal 1: Pengaturan PIN Keamanan Hapus Milik OPD */}
      {pinModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pin-settings-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 bg-[#0B1B2B] text-white flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <KeyRound className="w-4 h-4 text-teal-400 shrink-0" />
                <div>
                  <h3
                    id="pin-settings-title"
                    className="text-sm font-semibold"
                  >
                    PIN Keamanan Hapus — {session.namaOpd}
                  </h3>
                  <p className="text-[11px] text-slate-300">
                    Mencegah penghapusan tab, sheet, atau baris secara tidak
                    sengaja.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPinModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
                aria-label="Tutup pengaturan PIN"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePinSubmit} className="p-5 space-y-4">
              {pinSetupError && (
                <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {pinSetupError}
                </div>
              )}
              {pinSetupSuccess && (
                <div className="p-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                  {pinSetupSuccess}
                </div>
              )}

              {pinEnabled && (
                <div>
                  <label
                    htmlFor="pin-old"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    PIN Saat Ini
                  </label>
                  <input
                    id="pin-old"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinOldInput}
                    onChange={(e) =>
                      setPinOldInput(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="Masukkan PIN lama"
                    className="w-full h-10 px-3 text-sm font-mono tracking-widest bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="pin-new"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    {pinEnabled ? 'PIN Baru (4–6 angka)' : 'Buat PIN (4–6 angka)'}
                  </label>
                  <input
                    id="pin-new"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinNewInput}
                    onChange={(e) =>
                      setPinNewInput(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="••••••"
                    className="w-full h-10 px-3 text-sm font-mono tracking-widest bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="pin-confirm"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Ulangi PIN Baru
                  </label>
                  <input
                    id="pin-confirm"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pinConfirmInput}
                    onChange={(e) =>
                      setPinConfirmInput(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="••••••"
                    className="w-full h-10 px-3 text-sm font-mono tracking-widest bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
                {pinEnabled ? (
                  <button
                    type="button"
                    onClick={handleDisablePin}
                    className="text-xs font-medium text-red-700 hover:text-red-900"
                  >
                    Nonaktifkan PIN
                  </button>
                ) : (
                  <span className="text-[11px] text-slate-500">
                    PIN dienkripsi SHA-256 khusus {session.namaOpd}.
                  </span>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPinModalOpen(false)}
                    className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                  >
                    Tutup
                  </button>
                  <button
                    type="submit"
                    disabled={pinBusy}
                    className="h-9 px-4 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60"
                  >
                    {pinBusy
                      ? 'Menyimpan...'
                      : pinEnabled
                      ? 'Perbarui PIN'
                      : 'Aktifkan PIN'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Verifikasi PIN sebelum Menghapus Tab / Sheet / Baris */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-del-title"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-red-600 shrink-0" />
                <h3
                  id="confirm-del-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  {pinEnabled
                    ? 'Verifikasi PIN Keamanan Hapus'
                    : 'Konfirmasi Penghapusan'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded"
                aria-label="Batal hapus"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={handleConfirmProtectedDelete}
              className="p-5 space-y-4"
            >
              <p className="text-xs text-slate-600 leading-relaxed">
                Anda akan menghapus{' '}
                <strong className="text-slate-900">{pendingDelete.label}</strong>
                .{' '}
                {pendingDelete.kind === 'sheet'
                  ? 'File asli di Google Sheet tetap aman, namun daftar tab ini akan dihapus dari portal.'
                  : 'Baris data ini akan dihapus dari daftar dan Google Sheet.'}
              </p>

              {deletePinError && (
                <div className="p-2.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                  {deletePinError}
                </div>
              )}

              {pinEnabled ? (
                <div>
                  <label
                    htmlFor="verify-del-pin"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Masukkan PIN Hapus {session.namaOpd}
                  </label>
                  <input
                    id="verify-del-pin"
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    autoFocus
                    value={deletePinInput}
                    onChange={(e) => {
                      setDeletePinInput(e.target.value.replace(/\D/g, ''));
                      setDeletePinError(null);
                    }}
                    placeholder="Masukkan 4–6 digit PIN"
                    className="w-full h-10 px-3 text-sm font-mono tracking-widest bg-white border border-slate-300 rounded-md focus:outline-none focus:border-red-600"
                    required
                  />
                </div>
              ) : (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md flex items-center justify-between gap-3">
                  <span className="text-[11px] text-slate-600">
                    PIN Hapus belum diaktifkan untuk {session.namaOpd}.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDelete(null);
                      openPinSettingsModal();
                    }}
                    className="text-xs font-medium text-teal-700 hover:text-teal-900 whitespace-nowrap"
                  >
                    Atur PIN Sekarang
                  </button>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={deletingBusy}
                  className="h-9 px-4 text-xs font-semibold text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-60"
                >
                  {deletingBusy
                    ? 'Menghapus...'
                    : pinEnabled
                    ? 'Verifikasi PIN & Hapus'
                    : 'Ya, Hapus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
