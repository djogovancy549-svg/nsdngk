import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, RefreshCw, X } from 'lucide-react';
import { AktivitasView } from './components/AktivitasView';
import { AkunOpdView } from './components/AkunOpdView';
import { AuthGateView } from './components/AuthGateView';
import { KeamananSiberView } from './components/KeamananSiberView';
import { KonfigurasiView } from './components/KonfigurasiView';
import { OpdPortalWorkspace } from './components/OpdPortalWorkspace';
import { PublikasiKominfoView } from './components/PublikasiKominfoView';
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
  appendSecurityEvent,
  clearSecurityEvents,
  inspectAndSanitizeValues,
  loadSecurityEvents,
} from './services/cyberSecurityService';
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
  deleteCloneOnKominfoSheet,
  loadPublishedClones,
  pushCloneToKominfoSheet,
  savePublishedClones,
  updateCloneStatusOnKominfoSheet,
} from './services/publishSheetService';
import {
  AccountStatus,
  ActiveNavSection,
  AuditActionType,
  AuditLogEntry,
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
  PublishStatus,
  PublishedDatasetClone,
  SecurityEventEntry,
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
  const [publishedClones, setPublishedClones] = useState<
    PublishedDatasetClone[]
  >(() => loadPublishedClones());
  const [securityEvents, setSecurityEvents] = useState<SecurityEventEntry[]>(
    () => loadSecurityEvents()
  );
  const [notice, setNotice] = useState<string | null>(null);
  const lastInspectLogRef = useRef<number>(0);

  // Proteksi anti klik-kanan & pintasan inspeksi (DevTools / View Source)
  useEffect(() => {
    const logBlockedInspect = (detail: string) => {
      const now = Date.now();
      if (now - lastInspectLogRef.current < 15000) return;
      lastInspectLogRef.current = now;
      appendSecurityEvent({
        kategori: 'Inspeksi Diblokir',
        tingkat: 'Rendah',
        aktor: session?.username || 'Pengunjung',
        target: 'Antarmuka Portal',
        detail,
        diblokir: true,
      });
      setSecurityEvents(loadSecurityEvents());
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      logBlockedInspect(
        'Upaya klik kanan (context menu) diblokir oleh proteksi keamanan portal.'
      );
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const isF12 = e.key === 'F12';
      const isCtrlShiftInspect =
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        (key === 'i' || key === 'j' || key === 'c');
      const isViewSource = (e.ctrlKey || e.metaKey) && key === 'u';
      const isMacOptionInspect =
        e.metaKey && e.altKey && (key === 'i' || key === 'j' || key === 'c' || key === 'u');

      if (isF12 || isCtrlShiftInspect || isViewSource || isMacOptionInspect) {
        e.preventDefault();
        e.stopPropagation();
        logBlockedInspect(
          `Pintasan inspeksi (${e.key.toUpperCase()}) diblokir oleh proteksi keamanan portal.`
        );
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [session?.username]);

  const pendingGraftCount = useMemo(
    () => sheets.filter((s) => s.status === 'Menunggu Cangkok Script').length,
    [sheets]
  );
  const publishedActiveCount = useMemo(
    () =>
      publishedClones.filter((c) => c.statusPublikasi === 'Dipublikasikan')
        .length,
    [publishedClones]
  );
  const securityBlockedCount = useMemo(
    () => securityEvents.filter((e) => e.diblokir).length,
    [securityEvents]
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
  const syncDiscoveredWorkbookTabs = useCallback(
    async (
      baseSheet: OpdDynamicSheet,
      availableTabs: string[] | undefined,
      currentSheetsSnapshot: OpdDynamicSheet[]
    ): Promise<number> => {
      if (!availableTabs || availableTabs.length === 0 || !baseSheet.sheetId) {
        return 0;
      }

      const existingNames = new Set(
        currentSheetsSnapshot
          .filter(
            (s) =>
              s.sheetId === baseSheet.sheetId && s.opdId === baseSheet.opdId
          )
          .map((s) => s.sheetName.trim().toLowerCase())
      );

      const missingTabs = availableTabs.filter(
        (t) => t.trim() && !existingNames.has(t.trim().toLowerCase())
      );
      if (missingTabs.length === 0) return 0;

      const baseTitle = baseSheet.judulDataset.split(' — ')[0].trim();
      const addedSheets: OpdDynamicSheet[] = [];
      const addedRows: Record<string, DynamicSheetRow[]> = {};

      for (const tabName of missingTabs) {
        const draftTab: OpdDynamicSheet = {
          id: `sheet-${Date.now().toString(36)}-${Math.random()
            .toString(36)
            .slice(2, 6)}`,
          accountId: baseSheet.accountId,
          opdId: baseSheet.opdId,
          namaOpd: baseSheet.namaOpd,
          emailOpd: baseSheet.emailOpd,
          driveFolderUrl: baseSheet.driveFolderUrl,
          judulDataset: `${baseTitle} — ${tabName}`,
          deskripsi: baseSheet.deskripsi,
          sheetUrl: baseSheet.sheetUrl,
          sheetId: baseSheet.sheetId,
          sheetName: tabName,
          webhookUrl: baseSheet.webhookUrl,
          headers: [],
          availableTabs,
          status: baseSheet.status,
          didaftarkanPada: new Date().toISOString().slice(0, 10),
          terakhirSinkron: null,
        };

        const tabSynced = await fetchDynamicSheetData(draftTab);
        draftTab.headers = tabSynced.headers;
        draftTab.terakhirSinkron = tabSynced.syncedAt;
        addedSheets.push(draftTab);
        addedRows[draftTab.id] = tabSynced.rows;
      }

      if (addedSheets.length > 0) {
        setSheets((prev) => {
          const next = [...prev, ...addedSheets];
          saveRegisteredSheets(next);
          return next;
        });
        setRowsBySheet((prev) => ({
          ...prev,
          ...addedRows,
        }));
      }

      return addedSheets.length;
    },
    []
  );

  const handleSyncSheet = useCallback(
    async (sheet: OpdDynamicSheet) => {
      setSyncingSheetId(sheet.id);
      try {
        const res = await fetchDynamicSheetData(sheet);
        const resolvedHeaders =
          res.headers.length > 0 ? res.headers : sheet.headers;

        let latestSnapshot: OpdDynamicSheet[] = [];
        setSheets((prev) => {
          const next = prev.map((item) => {
            if (item.id === sheet.id) {
              return {
                ...item,
                headers: resolvedHeaders,
                availableTabs: res.availableTabs ?? item.availableTabs,
                terakhirSinkron: res.syncedAt,
              };
            }
            if (
              res.availableTabs &&
              item.sheetId === sheet.sheetId &&
              item.opdId === sheet.opdId
            ) {
              return {
                ...item,
                availableTabs: res.availableTabs,
              };
            }
            return item;
          });
          latestSnapshot = next;
          saveRegisteredSheets(next);
          return next;
        });

        setRowsBySheet((prev) => ({
          ...prev,
          [sheet.id]: res.rows,
        }));

        const discoveredCount = await syncDiscoveredWorkbookTabs(
          {
            ...sheet,
            headers: resolvedHeaders,
            availableTabs: res.availableTabs ?? sheet.availableTabs,
          },
          res.availableTabs,
          latestSnapshot.length > 0 ? latestSnapshot : sheets
        );

        const finalMessage =
          discoveredCount > 0
            ? `${res.message} Terdeteksi ${discoveredCount} tab sheet baru dalam workbook yang sama dan formulirnya langsung diaktifkan.`
            : res.message;

        appendAuditLog(
          'Sinkronisasi Sheet',
          sheet.namaOpd,
          `${sheet.judulDataset} (${sheet.sheetName})`,
          finalMessage,
          res.source !== 'local_cache'
        );
        setNotice(finalMessage);
      } finally {
        setSyncingSheetId(null);
      }
    },
    [appendAuditLog, sheets, syncDiscoveredWorkbookTabs]
  );

  const handleAddWorkbookTab = useCallback(
    async (
      baseSheet: OpdDynamicSheet,
      rawTabName: string
    ): Promise<OpdDynamicSheet | null> => {
      const tabName = rawTabName.trim();
      if (!tabName) return null;

      const existing = sheets.find(
        (s) =>
          s.sheetId === baseSheet.sheetId &&
          s.opdId === baseSheet.opdId &&
          s.sheetName.trim().toLowerCase() === tabName.toLowerCase()
      );
      if (existing) {
        await handleSyncSheet(existing);
        return existing;
      }

      const baseTitle = baseSheet.judulDataset.split(' — ')[0].trim();
      const newTabSheet: OpdDynamicSheet = {
        id: `sheet-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        accountId: baseSheet.accountId,
        opdId: baseSheet.opdId,
        namaOpd: baseSheet.namaOpd,
        emailOpd: baseSheet.emailOpd,
        driveFolderUrl: baseSheet.driveFolderUrl,
        judulDataset: `${baseTitle} — ${tabName}`,
        deskripsi: baseSheet.deskripsi,
        sheetUrl: baseSheet.sheetUrl,
        sheetId: baseSheet.sheetId,
        sheetName: tabName,
        webhookUrl: baseSheet.webhookUrl,
        headers: [],
        availableTabs: Array.from(
          new Set([...(baseSheet.availableTabs ?? [baseSheet.sheetName]), tabName])
        ),
        status: baseSheet.status,
        didaftarkanPada: new Date().toISOString().slice(0, 10),
        terakhirSinkron: null,
      };

      setSyncingSheetId(newTabSheet.id);
      try {
        const synced = await fetchDynamicSheetData(newTabSheet);
        newTabSheet.headers = synced.headers;
        newTabSheet.availableTabs = synced.availableTabs ?? newTabSheet.availableTabs;
        newTabSheet.terakhirSinkron = synced.syncedAt;

        setSheets((prev) => {
          const next = [...prev, newTabSheet];
          saveRegisteredSheets(next);
          return next;
        });

        setRowsBySheet((prev) => ({
          ...prev,
          [newTabSheet.id]: synced.rows,
        }));

        appendAuditLog(
          'Daftar Sheet',
          newTabSheet.namaOpd,
          `${newTabSheet.judulDataset} (${tabName})`,
          `Membuka tab "${tabName}" dari workbook terdaftar (${newTabSheet.headers.length} header kolom terbaca).`,
          synced.source !== 'local_cache'
        );

        setNotice(
          newTabSheet.headers.length > 0
            ? `Tab "${tabName}" berhasil dimuat dengan ${newTabSheet.headers.length} kolom header. Formulir & tabel otomatis terbentuk.`
            : `Tab "${tabName}" ditambahkan, namun header baris 1 belum terbaca. Pastikan nama tab persis sama dengan di Google Sheet dan baris 1 sudah berisi nama kolom.`
        );

        return newTabSheet;
      } finally {
        setSyncingSheetId(null);
      }
    },
    [appendAuditLog, handleSyncSheet, sheets]
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
    const resolvedTabName = input.sheetName || 'Sheet1';
    const existingActiveWorkbook = sheets.find(
      (s) =>
        s.sheetId === sheetId &&
        (s.accountId === session.id || s.opdId === (session.opdId ?? session.id)) &&
        s.status === 'Aktif' &&
        Boolean(s.webhookUrl)
    );

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
      sheetName: resolvedTabName,
      webhookUrl: existingActiveWorkbook?.webhookUrl ?? '',
      headers: input.manualHeaders,
      availableTabs: existingActiveWorkbook?.availableTabs,
      status: existingActiveWorkbook ? 'Aktif' : 'Menunggu Cangkok Script',
      didaftarkanPada: new Date().toISOString().slice(0, 10),
      terakhirSinkron: null,
    };

    // Deteksi header otomatis (via Webhook warisan workbook aktif atau Google Sheet publik)
    const detected = await fetchDynamicSheetData(newSheet);
    if (detected.headers.length > 0) {
      newSheet.headers = detected.headers;
      newSheet.terakhirSinkron = detected.syncedAt;
    }
    if (detected.availableTabs) {
      newSheet.availableTabs = detected.availableTabs;
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
      `${newSheet.judulDataset} (${resolvedTabName})`,
      existingActiveWorkbook
        ? `Tab "${resolvedTabName}" pada workbook terdaftar langsung AKTIF (${newSheet.headers.length} header terdeteksi) menggunakan Webhook Code.gs yang sudah terpasang.`
        : `Mengajukan URL Sheet (${newSheet.headers.length} header terdeteksi). Menunggu pencangkokan Code.gs oleh Super Admin.`,
      detected.source !== 'local_cache'
    );

    setNotice(
      existingActiveWorkbook
        ? `Tab "${resolvedTabName}" pada workbook yang sudah terdaftar langsung AKTIF (${newSheet.headers.length} kolom header terdeteksi). Formulir & tabel siap digunakan.`
        : `URL Google Sheet "${newSheet.judulDataset}" berhasil didaftarkan (${newSheet.headers.length} header terdeteksi). Menunggu Super Admin mencangkokkan Code.gs.`
    );
  };

  const handleDeleteOpdSheet = (sheet: OpdDynamicSheet) => {
    setSheets((prev) => {
      const next = prev
        .filter((s) => s.id !== sheet.id)
        .map((s) =>
          s.sheetId === sheet.sheetId && s.availableTabs
            ? {
                ...s,
                availableTabs: s.availableTabs.filter(
                  (t) =>
                    t.trim().toLowerCase() !==
                    sheet.sheetName.trim().toLowerCase()
                ),
              }
            : s
        );
      saveRegisteredSheets(next);
      return next;
    });
    setRowsBySheet((prev) => {
      const next = { ...prev };
      delete next[sheet.id];
      return next;
    });
    setNotice(
      `Tab "${sheet.sheetName}" (${sheet.judulDataset}) berhasil dihapus dari daftar.`
    );
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
      availableTabs: synced.availableTabs ?? updatedBase.availableTabs,
      terakhirSinkron: synced.syncedAt,
    };

    let latestSnapshot: OpdDynamicSheet[] = [];
    setSheets((prev) => {
      const next = prev.map((s) => (s.id === finalSheet.id ? finalSheet : s));
      latestSnapshot = next;
      saveRegisteredSheets(next);
      return next;
    });

    if (synced.rows.length > 0) {
      setRowsBySheet((prev) => ({
        ...prev,
        [finalSheet.id]: synced.rows,
      }));
    }

    const discoveredCount = await syncDiscoveredWorkbookTabs(
      finalSheet,
      synced.availableTabs,
      latestSnapshot.length > 0 ? latestSnapshot : sheets
    );

    appendAuditLog(
      'Cangkok Script',
      finalSheet.namaOpd,
      finalSheet.judulDataset,
      `Hak akses web OPD diaktifkan (${finalSheet.headers.length} header kolom${
        discoveredCount > 0 ? `, +${discoveredCount} tab tambahan otomatis terbaca` : ''
      }).`,
      synced.source === 'webhook'
    );

    setNotice(
      `Hak akses web untuk "${finalSheet.judulDataset}" (${finalSheet.namaOpd}) telah AKTIF dengan ${finalSheet.headers.length} kolom header dinamis${
        discoveredCount > 0 ? ` serta ${discoveredCount} tab sheet tambahan yang otomatis terbaca` : ''
      }.`
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

  const handleAdminRegisterSheetForOpd = async (input: {
    accountId: string;
    opdId: string;
    namaOpd: string;
    emailOpd: string;
    driveFolderUrl: string;
    judulDataset: string;
    deskripsi: string;
    sheetUrl: string;
    sheetName: string;
    webhookUrl: string;
  }) => {
    const sheetId = extractGoogleSheetId(input.sheetUrl.trim());
    const resolvedTabName = input.sheetName.trim() || 'Sheet1';
    const cleanWebhook = input.webhookUrl.trim();

    const existingActiveWorkbook = sheets.find(
      (s) =>
        s.sheetId === sheetId &&
        s.opdId === input.opdId &&
        s.status === 'Aktif' &&
        Boolean(s.webhookUrl)
    );

    const effectiveWebhook =
      cleanWebhook || existingActiveWorkbook?.webhookUrl || '';
    const isNowActive = Boolean(
      effectiveWebhook && effectiveWebhook.startsWith('https://script.google.com/')
    );

    const newSheet: OpdDynamicSheet = {
      id: `sheet-${Date.now().toString(36)}`,
      accountId: input.accountId,
      opdId: input.opdId,
      namaOpd: input.namaOpd,
      emailOpd: input.emailOpd,
      driveFolderUrl: input.driveFolderUrl,
      judulDataset: input.judulDataset.trim(),
      deskripsi: input.deskripsi.trim(),
      sheetUrl: input.sheetUrl.trim(),
      sheetId,
      sheetName: resolvedTabName,
      webhookUrl: effectiveWebhook,
      headers: [],
      availableTabs: existingActiveWorkbook?.availableTabs,
      status: isNowActive ? 'Aktif' : 'Menunggu Cangkok Script',
      didaftarkanPada: new Date().toISOString().slice(0, 10),
      terakhirSinkron: null,
    };

    const synced = await fetchDynamicSheetData(newSheet);
    if (synced.headers.length > 0) {
      newSheet.headers = synced.headers;
      newSheet.terakhirSinkron = synced.syncedAt;
    }
    if (synced.availableTabs) {
      newSheet.availableTabs = synced.availableTabs;
    }

    let latestSnapshot: OpdDynamicSheet[] = [];
    setSheets((prev) => {
      const next = [newSheet, ...prev];
      latestSnapshot = next;
      saveRegisteredSheets(next);
      return next;
    });

    if (synced.rows.length > 0) {
      setRowsBySheet((prev) => ({
        ...prev,
        [newSheet.id]: synced.rows,
      }));
    }

    const discoveredCount = isNowActive
      ? await syncDiscoveredWorkbookTabs(
          newSheet,
          synced.availableTabs,
          latestSnapshot.length > 0 ? latestSnapshot : sheets
        )
      : 0;

    appendAuditLog(
      isNowActive ? 'Cangkok Script' : 'Daftar Sheet',
      newSheet.namaOpd,
      `${newSheet.judulDataset} (${resolvedTabName})`,
      isNowActive
        ? `Super Admin mendaftarkan & mengaktifkan Sheet untuk ${newSheet.namaOpd} (${newSheet.headers.length} header kolom${
            discoveredCount > 0 ? `, +${discoveredCount} tab tambahan` : ''
          }).`
        : `Super Admin mendaftarkan Sheet untuk ${newSheet.namaOpd} (${newSheet.headers.length} header terdeteksi).`,
      synced.source !== 'local_cache'
    );

    setNotice(
      isNowActive
        ? `Sheet "${newSheet.judulDataset}" untuk ${newSheet.namaOpd} berhasil didaftarkan dan AKTIF (${newSheet.headers.length} kolom header${
            discoveredCount > 0 ? `, +${discoveredCount} tab tambahan terbaca` : ''
          }).`
        : `Sheet "${newSheet.judulDataset}" untuk ${newSheet.namaOpd} berhasil didaftarkan. Tempel URL Webhook /exec untuk mengaktifkan hak akses web OPD.`
    );
  };

  // Dynamic Row CRUD (Executed ONLY by the owning OPD, with real-time XSS/Formula-Injection guard)
  const handleSubmitDynamicRow = async (
    sheet: OpdDynamicSheet,
    row: DynamicSheetRow,
    isEdit: boolean
  ) => {
    const scan = inspectAndSanitizeValues(
      row.values,
      session?.username || sheet.namaOpd,
      `${sheet.judulDataset} (${sheet.sheetName})`
    );
    if (scan.threatsDetected.length > 0) {
      setSecurityEvents(loadSecurityEvents());
    }

    const safeRow: DynamicSheetRow = {
      ...row,
      values: scan.sanitizedValues,
    };

    const mutation = await sendDynamicRowMutation(
      sheet,
      isEdit ? 'update' : 'create',
      safeRow
    );

    const savedRow: DynamicSheetRow = {
      ...safeRow,
      _rowNumber: mutation.rowNumber ?? safeRow._rowNumber,
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
        onAddWorkbookTab={handleAddWorkbookTab}
        onDeleteSheet={handleDeleteOpdSheet}
        onSyncSheet={handleSyncSheet}
        onSubmitDynamicRow={handleSubmitDynamicRow}
        onDeleteDynamicRow={handleDeleteDynamicRow}
        onLogout={handleLogout}
      />
    );
  }

  // 3. Masuk sebagai Super Admin Walidata -> Cangkok Script, Terima Data Read-Only & Cloning Publikasi Kominfo
  const handleCreatePublishedClone = async (
    draft: Omit<
      PublishedDatasetClone,
      'id' | 'dipublikasikanPada' | 'syncedToKominfoSheet'
    >
  ) => {
    const newClone: PublishedDatasetClone = {
      ...draft,
      id: `pub-${Date.now().toString(36)}`,
      dipublikasikanPada: new Date().toISOString().slice(0, 10),
      syncedToKominfoSheet: false,
    };

    const syncRes = await pushCloneToKominfoSheet(newClone);
    const savedClone: PublishedDatasetClone = {
      ...newClone,
      syncedToKominfoSheet: syncRes.syncedToSheet,
    };

    setPublishedClones((prev) => {
      const next = [savedClone, ...prev];
      savePublishedClones(next);
      return next;
    });

    appendAuditLog(
      'Publikasi Data',
      'Dinas Kominfo (Super Admin)',
      savedClone.judulPublikasi,
      `Cloning ${savedClone.rows.length} baris & ${savedClone.selectedHeaders.length} kolom dari ${savedClone.sourceOpdNama} ke tab ${savedClone.targetTabName}.`,
      syncRes.syncedToSheet
    );
    setNotice(syncRes.message);
  };

  const handleToggleCloneStatus = async (
    clone: PublishedDatasetClone,
    statusPublikasi: PublishStatus
  ) => {
    const res = await updateCloneStatusOnKominfoSheet(clone, statusPublikasi);
    setPublishedClones((prev) => {
      const next = prev.map((c) =>
        c.id === clone.id
          ? {
              ...c,
              statusPublikasi,
              syncedToKominfoSheet: res.syncedToSheet || c.syncedToKominfoSheet,
            }
          : c
      );
      savePublishedClones(next);
      return next;
    });
    appendAuditLog(
      'Publikasi Data',
      'Dinas Kominfo (Super Admin)',
      clone.judulPublikasi,
      `Status publikasi diubah menjadi ${statusPublikasi}.`,
      res.syncedToSheet
    );
    setNotice(res.message);
  };

  const handleResyncClone = async (clone: PublishedDatasetClone) => {
    const res = await pushCloneToKominfoSheet(clone);
    setPublishedClones((prev) => {
      const next = prev.map((c) =>
        c.id === clone.id
          ? { ...c, syncedToKominfoSheet: res.syncedToSheet }
          : c
      );
      savePublishedClones(next);
      return next;
    });
    setNotice(res.message);
  };

  const handleDeleteClone = async (clone: PublishedDatasetClone) => {
    const res = await deleteCloneOnKominfoSheet(clone);
    setPublishedClones((prev) => {
      const next = prev.filter((c) => c.id !== clone.id);
      savePublishedClones(next);
      return next;
    });
    appendAuditLog(
      'Publikasi Data',
      'Dinas Kominfo (Super Admin)',
      clone.judulPublikasi,
      `Menghapus dataset clone publikasi (${clone.targetTabName}).`,
      res.syncedToSheet
    );
    setNotice(res.message);
  };

  const breadcrumbTrail = (() => {
    if (activeSection === 'ringkasan') {
      return ['Super Admin', 'Ringkasan Eksekutif'];
    }
    if (activeSection === 'data_masuk') {
      return ['Super Admin', 'Data Masuk OPD (Read-Only)'];
    }
    if (activeSection === 'publikasi') {
      return ['Super Admin', 'Cloning & Publikasi Kominfo'];
    }
    if (activeSection === 'akun_sheet') {
      return ['Super Admin', 'Akun & Cangkok Sheet OPD'];
    }
    if (activeSection === 'keamanan') {
      return ['Super Admin', 'Keamanan Siber & AI Deteksi Peretasan'];
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
        publishedCount={publishedActiveCount}
        securityAlertsCount={securityBlockedCount}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        onSelectSection={(sec) => {
          if (sec === 'keamanan') setSecurityEvents(loadSecurityEvents());
          setActiveSection(sec);
        }}
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

          {activeSection === 'publikasi' && (
            <PublikasiKominfoView
              sheets={sheets}
              rowsBySheet={rowsBySheet}
              clones={publishedClones}
              onCreateClone={handleCreatePublishedClone}
              onToggleCloneStatus={handleToggleCloneStatus}
              onResyncClone={handleResyncClone}
              onDeleteClone={handleDeleteClone}
            />
          )}

          {activeSection === 'akun_sheet' && (
            <AkunOpdView
              accounts={accounts}
              sheets={sheets}
              syncingAccounts={syncingAccounts}
              onSyncAccounts={handleSyncAccounts}
              onRegisterAccount={handleRegisterAccount}
              onRegisterSheetForOpd={handleAdminRegisterSheetForOpd}
              onToggleStatus={handleToggleAccountStatus}
              onDeleteAccount={handleDeleteAccount}
              onActivateSheetWebhook={handleActivateSheetWebhook}
              onRevokeSheetAccess={handleRevokeSheetAccess}
            />
          )}

          {activeSection === 'keamanan' && (
            <KeamananSiberView
              accounts={accounts}
              sheets={sheets}
              clones={publishedClones}
              securityEvents={securityEvents}
              onRefreshEvents={() => setSecurityEvents(loadSecurityEvents())}
              onClearEvents={() => {
                clearSecurityEvents();
                setSecurityEvents([]);
              }}
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
