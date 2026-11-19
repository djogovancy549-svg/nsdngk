import { useCallback, useMemo, useState } from 'react';
import { Menu, RefreshCw, X } from 'lucide-react';
import { AktivitasView } from './components/AktivitasView';
import { AkunOpdView } from './components/AkunOpdView';
import { AuthGateView } from './components/AuthGateView';
import { KonfigurasiView } from './components/KonfigurasiView';
import { OpdPortalWorkspace } from './components/OpdPortalWorkspace';
import { RingkasanView } from './components/RingkasanView';
import { RunningSummaryTicker } from './components/RunningSummaryTicker';
import { Sidebar } from './components/Sidebar';
import { SuperAdminDataMasukView } from './components/SuperAdminDataMasukView';
import {
  authenticateUser,
  deleteOpdAccount,
  fetchAccountsFromSheet,
  loadLocalAccounts,
  loadSavedSession,
  registerOpdAccount,
  saveSession,
  updateOpdAccountStatus,
} from './services/authSheetService';
import {
  extractGoogleSheetId,
  fetchDynamicSheetData,
  loadAllDynamicRows,
  saveLocalDynamicRows,
  loadRegisteredSheets,
  saveRegisteredSheets,
  sendDynamicRowMutation,
} from './services/dynamicSheetService';
import {
  AccountStatus,
  ActiveNavSection,
  AuditActionType,
  AuditLogEntry,
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
  UserSession,
} from './types/satuData';

const AUDIT_STORAGE_KEY = 'satu_data_nagekeo_audit_v3';

function loadInitialAuditLogs(): AuditLogEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as AuditLogEntry[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export default function App() {
  const [session, setSession] = useState<UserSession | null>(() =>
    loadSavedSession()
  );
  const [accounts, setAccounts] = useState<OpdAccount[]>(() =>
    loadLocalAccounts()
  );
  const [sheets, setSheets] = useState<OpdDynamicSheet[]>(() =>
    loadRegisteredSheets()
  );
  const [rowsBySheet, setRowsBySheet] = useState<
    Record<string, DynamicSheetRow[]>
  >(() => loadAllDynamicRows(loadRegisteredSheets()));

  const [activeSection, setActiveSection] =
    useState<ActiveNavSection>('ringkasan');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const [syncingSheetId, setSyncingSheetId] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() =>
    loadInitialAuditLogs()
  );
  const [notice, setNotice] = useState<string | null>(null);

  const pendingGraftCount = useMemo(
    () => sheets.filter((s) => s.status === 'Menunggu Cangkok Script').length,
    [sheets]
  );

  const appendAuditLog = useCallback(
    (
      action: AuditActionType,
      opdNama: string,
      target: string,
      deskripsi: string,
      syncedToSheet: boolean
    ) => {
      const entry: AuditLogEntry = {
        id: `log-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        action,
        opdNama,
        target,
        deskripsi,
        syncedToSheet,
      };
      setAuditLogs((prev) => {
        const next = [entry, ...prev].slice(0, 150);
        try {
          localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Abaikan
        }
        return next;
      });
    },
    []
  );

  const handleClearAuditLogs = () => {
    setAuditLogs([]);
    try {
      localStorage.removeItem(AUDIT_STORAGE_KEY);
    } catch {
      // Abaikan
    }
  };

  // Auth Handlers
  const handleLogin = async (identifier: string, password: string) => {
    const result = await authenticateUser(identifier, password, accounts);
    if (result.ok && result.session) {
      setSession(result.session);
      saveSession(result.session);
      setNotice(null);
      setActiveSection('ringkasan');
      return { ok: true };
    }
    return { ok: false, message: result.message };
  };

  const handleLogout = () => {
    setSession(null);
    saveSession(null);
    setNotice(null);
  };

  const handleRegisterAccount = async (input: {
    opdId: string;
    namaOpd: string;
    namaLengkap: string;
    email: string;
    username: string;
    password: string;
    driveFolderUrl: string;
  }) => {
    const result = await registerOpdAccount(input, accounts);
    if (result.ok && result.account) {
      setAccounts((prev) => [result.account!, ...prev]);
      appendAuditLog(
        'Akun OPD',
        result.account.namaOpd,
        `@${result.account.username}`,
        `Pendaftaran akun ${result.account.namaLengkap} (${result.account.email})`,
        result.syncedToSheet
      );
    }
    return { ok: result.ok, message: result.message };
  };

  const handleSyncAccounts = async () => {
    setSyncingAccounts(true);
    try {
      const res = await fetchAccountsFromSheet();
      setAccounts(res.accounts);
      setNotice(res.message);
    } finally {
      setSyncingAccounts(false);
    }
  };

  const handleToggleAccountStatus = async (
    account: OpdAccount,
    status: AccountStatus
  ) => {
    const res = await updateOpdAccountStatus(account, status, accounts);
    setAccounts(res.accounts);
    appendAuditLog(
      'Akun OPD',
      account.namaOpd,
      `@${account.username}`,
      `Status akun diubah menjadi ${status}`,
      res.syncedToSheet
    );
    setNotice(res.message);
  };

  const handleDeleteAccount = async (account: OpdAccount) => {
    const res = await deleteOpdAccount(account, accounts);
    setAccounts(res.accounts);
    appendAuditLog(
      'Akun OPD',
      account.namaOpd,
      `@${account.username}`,
      `Menghapus akun ${account.namaLengkap}`,
      res.syncedToSheet
    );
    setNotice(res.message);
  };

  // Dynamic Sheet Registration (OPD) & Grafting (Super Admin)
  const handleSyncSheet = useCallback(
    async (sheet: OpdDynamicSheet) => {
      setSyncingSheetId(sheet.id);
      try {
        const res = await fetchDynamicSheetData(sheet);
        const resolvedHeaders =
          res.headers.length > 0 ? res.headers : sheet.headers;

        setSheets((prev) => {
          const next = prev.map((item) =>
            item.id === sheet.id
              ? {
                  ...item,
                  headers: resolvedHeaders,
                  terakhirSinkron: res.syncedAt,
                }
              : item
          );
          saveRegisteredSheets(next);
          return next;
        });

        setRowsBySheet((prev) => ({
          ...prev,
          [sheet.id]: res.rows,
        }));

        appendAuditLog(
          'Sinkronisasi Sheet',
          sheet.namaOpd,
          sheet.judulDataset,
          res.message,
          res.source !== 'local_cache'
        );
        setNotice(res.message);
      } finally {
        setSyncingSheetId(null);
      }
    },
    [appendAuditLog]
  );

  const handleSyncAllSheets = useCallback(async () => {
    if (sheets.length === 0) {
      setNotice('Belum ada Google Sheet OPD yang terdaftar untuk disinkronkan.');
      return;
    }
    setSyncingAll(true);
    try {
      for (const s of sheets) {
        await handleSyncSheet(s);
      }
      setNotice(
        `Sinkronisasi selesai untuk seluruh ${sheets.length} Google Sheet OPD.`
      );
    } finally {
      setSyncingAll(false);
    }
  }, [sheets, handleSyncSheet]);

  const handleRegisterOpdSheet = async (input: {
    judulDataset: string;
    deskripsi: string;
    sheetUrl: string;
    sheetName: string;
    manualHeaders: string[];
  }) => {
    if (!session || session.role !== 'opd') return;

    const sheetId = extractGoogleSheetId(input.sheetUrl);
    const newSheet: OpdDynamicSheet = {
      id: `sheet-${Date.now().toString(36)}`,
      accountId: session.id,
      opdId: session.opdId ?? session.id,
      namaOpd: session.namaOpd,
      emailOpd: session.email,
      driveFolderUrl: session.driveFolderUrl ?? '',
      judulDataset: input.judulDataset,
      deskripsi: input.deskripsi,
      sheetUrl: input.sheetUrl,
      sheetId,
      sheetName: input.sheetName || 'Sheet1',
      webhookUrl: '',
      headers: input.manualHeaders,
      status: 'Menunggu Cangkok Script',
      didaftarkanPada: new Date().toISOString().slice(0, 10),
      terakhirSinkron: null,
    };

    // Coba deteksi header otomatis dari Google Sheet publik (jika sudah dibagikan)
    const detected = await fetchDynamicSheetData(newSheet);
    if (detected.headers.length > 0) {
      newSheet.headers = detected.headers;
      newSheet.terakhirSinkron = detected.syncedAt;
    }

    setSheets((prev) => {
      const next = [newSheet, ...prev];
      saveRegisteredSheets(next);
      return next;
    });

    if (detected.rows.length > 0) {
      setRowsBySheet((prev) => ({
        ...prev,
        [newSheet.id]: detected.rows,
      }));
    }

    appendAuditLog(
      'Daftar Sheet',
      session.namaOpd,
      newSheet.judulDataset,
      `Mengajukan URL Sheet (${newSheet.headers.length} header terdeteksi). Menunggu pencangkokan Code.gs oleh Super Admin.`,
      detected.source !== 'local_cache'
    );

    setNotice(
      `URL Google Sheet "${newSheet.judulDataset}" berhasil didaftarkan (${newSheet.headers.length} header terdeteksi). Menunggu Super Admin mencangkokkan Code.gs.`
    );
  };

  const handleDeleteOpdSheet = (sheet: OpdDynamicSheet) => {
    setSheets((prev) => {
      const next = prev.filter((s) => s.id !== sheet.id);
      saveRegisteredSheets(next);
      return next;
    });
    setNotice(`Pendaftaran Sheet "${sheet.judulDataset}" dihapus.`);
  };

  const handleActivateSheetWebhook = async (
    sheet: OpdDynamicSheet,
    webhookUrl: string,
    manualHeaders?: string[]
  ) => {
    const updatedBase: OpdDynamicSheet = {
      ...sheet,
      webhookUrl: webhookUrl.trim(),
      headers:
        manualHeaders && manualHeaders.length > 0
          ? manualHeaders
          : sheet.headers,
      status: 'Aktif',
    };

    const synced = await fetchDynamicSheetData(updatedBase);
    const finalSheet: OpdDynamicSheet = {
      ...updatedBase,
      headers:
        synced.headers.length > 0 ? synced.headers : updatedBase.headers,
      terakhirSinkron: synced.syncedAt,
    };

    setSheets((prev) => {
      const next = prev.map((s) => (s.id === finalSheet.id ? finalSheet : s));
      saveRegisteredSheets(next);
      return next;
    });

    if (synced.rows.length > 0) {
      setRowsBySheet((prev) => ({
        ...prev,
        [finalSheet.id]: synced.rows,
      }));
    }

    appendAuditLog(
      'Cangkok Script',
      finalSheet.namaOpd,
      finalSheet.judulDataset,
      `Hak akses web OPD diaktifkan (${finalSheet.headers.length} header kolom).`,
      synced.source === 'webhook'
    );

    setNotice(
      `Hak akses web untuk "${finalSheet.judulDataset}" (${finalSheet.namaOpd}) telah AKTIF dengan ${finalSheet.headers.length} kolom header dinamis.`
    );
  };

  const handleRevokeSheetAccess = (sheet: OpdDynamicSheet) => {
    setSheets((prev) => {
      const next = prev.map((s) =>
        s.id === sheet.id
          ? { ...s, status: 'Menunggu Cangkok Script' as const }
          : s
      );
      saveRegisteredSheets(next);
      return next;
    });
    setNotice(`Hak akses web untuk "${sheet.judulDataset}" dinonaktifkan.`);
  };

  // Dynamic Row CRUD (Executed ONLY by the owning OPD)
  const handleSubmitDynamicRow = async (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow,
    isEdit: boolean
  ) => {
    const mutation = await sendDynamicRowMutation(
      sheet,
      isEdit ? 'update' : 'create',
      row
    );

    const savedRow: DynamicSheetRow = {
      ...row,
      _rowNumber: mutation.rowNumber ?? row._rowNumber,
    };

    setRowsBySheet((prev) => {
      const current = prev[sheet.id] ?? [];
      const next = isEdit
        ? current.map((r) => (r._id === savedRow._id ? savedRow : r))
        : [savedRow, ...current];
      saveLocalDynamicRows(sheet.id, next);
      return { ...prev, [sheet.id]: next };
    });

    appendAuditLog(
      isEdit ? 'Ubah Data OPD' : 'Input Data OPD',
      sheet.namaOpd,
      sheet.judulDataset,
      isEdit ? 'Memperbarui baris data dinamis' : 'Menambahkan baris data baru',
      mutation.syncedToSheet
    );

    setNotice(mutation.message);
  };

  const handleDeleteDynamicRow = async (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow
  ) => {
    const mutation = await sendDynamicRowMutation(sheet, 'delete', row);

    setRowsBySheet((prev) => {
      const current = prev[sheet.id] ?? [];
      const next = current.filter((r) => r._id !== row._id);
      saveLocalDynamicRows(sheet.id, next);
      return { ...prev, [sheet.id]: next };
    });

    appendAuditLog(
      'Hapus Data OPD',
      sheet.namaOpd,
      sheet.judulDataset,
      'Menghapus baris data dinamis',
      mutation.syncedToSheet
    );

    setNotice(mutation.message);
  };

  // 1. Belum masuk -> Gerbang Masuk & Daftar Akun + Drive OPD
  if (!session) {
    return (
      <AuthGateView
        accounts={accounts}
        sheets={sheets}
        rowsBySheet={rowsBySheet}
        onLogin={handleLogin}
        onRegister={handleRegisterAccount}
      />
    );
  }

  // 2. Masuk sebagai OPD -> Portal Kedaulatan Data (Daftar Sheet + Form/Tabel Dinamis milik OPD sendiri)
  if (session.role === 'opd') {
    const ownSheets = sheets.filter(
      (s) => s.accountId === session.id || s.opdId === session.opdId
    );
    return (
      <OpdPortalWorkspace
        session={session}
        accounts={accounts}
        ownSheets={ownSheets}
        rowsBySheet={rowsBySheet}
        syncingSheetId={syncingSheetId}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        onRegisterSheet={handleRegisterOpdSheet}
        onDeleteSheet={handleDeleteOpdSheet}
        onSyncSheet={handleSyncSheet}
        onSubmitDynamicRow={handleSubmitDynamicRow}
        onDeleteDynamicRow={handleDeleteDynamicRow}
        onLogout={handleLogout}
      />
    );
  }

  // 3. Masuk sebagai Super Admin Walidata -> Cangkok Script & Terima Data Read-Only
  const breadcrumbTrail = (() => {
    if (activeSection === 'ringkasan') {
      return ['Super Admin', 'Ringkasan Eksekutif'];
    }
    if (activeSection === 'data_masuk') {
      return ['Super Admin', 'Data Masuk OPD (Read-Only)'];
    }
    if (activeSection === 'akun_sheet') {
      return ['Super Admin', 'Akun & Cangkok Sheet OPD'];
    }
    if (activeSection === 'aktivitas') {
      return ['Super Admin', 'Riwayat Aktivitas'];
    }
    return ['Super Admin', 'Skrip Code.gs & Sheet Akun'];
  })();

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeSection={activeSection}
        sheets={sheets}
        rowsBySheet={rowsBySheet}
        pendingGraftCount={pendingGraftCount}
        accountsCount={accounts.length}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onSelectSection={setActiveSection}
        onLogout={handleLogout}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <RunningSummaryTicker
          accounts={accounts}
          sheets={sheets}
          rowsBySheet={rowsBySheet}
        />

        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900 rounded-md"
              aria-label="Buka menu navigasi"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-2 text-sm min-w-0"
            >
              {breadcrumbTrail.map((crumb, idx) => {
                const isLast = idx === breadcrumbTrail.length - 1;
                return (
                  <span
                    key={crumb}
                    className="flex items-center gap-2 min-w-0"
                  >
                    {idx > 0 && (
                      <span
                        className="text-slate-300 select-none"
                        aria-hidden="true"
                      >
                        /
                      </span>
                    )}
                    <span
                      className={`truncate ${
                        isLast
                          ? 'font-semibold text-slate-900'
                          : 'text-slate-500 hidden sm:inline'
                      }`}
                    >
                      {crumb}
                    </span>
                  </span>
                );
              })}
            </nav>
          </div>

          <button
            type="button"
            onClick={handleSyncAllSheets}
            disabled={syncingAll}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncingAll ? 'animate-spin' : ''}`}
            />
            {syncingAll ? 'Menyinkronkan...' : 'Tarik Semua Data OPD'}
          </button>
        </header>

        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {notice && (
            <div className="mb-6 flex items-center justify-between gap-3 px-4 py-3 bg-white border border-slate-300 rounded-md text-xs text-slate-700">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded shrink-0"
                aria-label="Tutup pemberitahuan"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {activeSection === 'ringkasan' && (
            <RingkasanView
              accounts={accounts}
              sheets={sheets}
              rowsBySheet={rowsBySheet}
              onGoToDataMasuk={() => setActiveSection('data_masuk')}
              onGoToAkunSheet={() => setActiveSection('akun_sheet')}
            />
          )}

          {activeSection === 'data_masuk' && (
            <SuperAdminDataMasukView
              sheets={sheets}
              rowsBySheet={rowsBySheet}
              syncingSheetId={syncingSheetId}
              onSyncSheet={handleSyncSheet}
              onGoToAkunSheet={() => setActiveSection('akun_sheet')}
            />
          )}

          {activeSection === 'akun_sheet' && (
            <AkunOpdView
              accounts={accounts}
              sheets={sheets}
              syncingAccounts={syncingAccounts}
              onSyncAccounts={handleSyncAccounts}
              onRegisterAccount={handleRegisterAccount}
              onToggleStatus={handleToggleAccountStatus}
              onDeleteAccount={handleDeleteAccount}
              onActivateSheetWebhook={handleActivateSheetWebhook}
              onRevokeSheetAccess={handleRevokeSheetAccess}
            />
          )}

          {activeSection === 'konfigurasi' && <KonfigurasiView />}

          {activeSection === 'aktivitas' && (
            <AktivitasView
              logs={auditLogs}
              onClearLogs={handleClearAuditLogs}
            />
          )}
        </main>
      </div>
    </div>
  );
}
