import React, { useEffect, useState } from 'react';
import {
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Wrench,
  Zap,
} from 'lucide-react';
import {
  APPS_SCRIPT_AUTH_TEMPLATE,
  APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE,
  isPlaceholderEndpoint,
} from '../config/opdSheets';
import {
  getActiveAuthSheetConfig,
  saveCustomAuthSheetConfig,
  testAuthSheetConnection,
} from '../services/authSheetService';
import { extractGoogleSheetId } from '../services/dynamicSheetService';
import {
  clearSheetProxyCache,
  fetchSheetProxyStats,
  RegencyWhiteLabelConfig,
  rotateAppsScriptSecret,
  SheetProxyStats,
  updateRegencyConfig,
} from '../services/regencyConfigService';
import {
  BigQueryConfigStatus,
  BigQueryQueryResult,
  executeBigQueryReadOnlySql,
  fetchBigQueryStatus,
  pushOpdSheetToBigQuery,
} from '../services/bigQueryService';
import {
  CloudflareWafStatusResponse,
  evaluateSheetCapacity,
  fetchCloudflareWafStatus,
  rotateCloudflareOriginSecret,
  syncPublicHarvestCatalog,
  updateCloudflareWafConfig,
} from '../services/cloudflareWafService';
import {
  DatasetMetadata,
  DynamicSheetRow,
  OpdDynamicSheet,
} from '../types/satuData';

interface KonfigurasiViewProps {
  currentSuperAdminEmail: string;
  regencyConfig: RegencyWhiteLabelConfig;
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  metadataBySheet: Record<string, DatasetMetadata>;
  onRegencyConfigUpdated: (next: RegencyWhiteLabelConfig) => void;
}

export function KonfigurasiView({
  currentSuperAdminEmail,
  regencyConfig,
  sheets,
  rowsBySheet,
  metadataBySheet,
  onRegencyConfigUpdated,
}: KonfigurasiViewProps) {
  // White-Label Multi-Kabupaten state
  const [namaKabupaten, setNamaKabupaten] = useState(
    regencyConfig.namaKabupaten
  );
  const [namaPortal, setNamaPortal] = useState(regencyConfig.namaPortal);
  const [namaWalidata, setNamaWalidata] = useState(regencyConfig.namaWalidata);
  const [domainResmi, setDomainResmi] = useState(regencyConfig.domainResmi);
  const [urlPortalPublik, setUrlPortalPublik] = useState(
    regencyConfig.urlPortalPublik
  );
  const [kecamatanText, setKecamatanText] = useState(
    regencyConfig.daftarKecamatan.join(', ')
  );
  const [savingRegency, setSavingRegency] = useState(false);
  const [regencyFeedback, setRegencyFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Proxy Cache & Secret state
  const [proxyStats, setProxyStats] = useState<SheetProxyStats | null>(null);
  const [loadingProxy, setLoadingProxy] = useState(false);
  const [proxyMessage, setProxyMessage] = useState<string | null>(null);

  // Cloudflare WAF & Edge Security state
  const [cfWaf, setCfWaf] = useState<CloudflareWafStatusResponse | null>(null);
  const [cfLoading, setCfLoading] = useState(false);
  const [cfStrictOrigin, setCfStrictOrigin] = useState(false);
  const [cfBlockThreatScore, setCfBlockThreatScore] = useState(true);
  const [cfThreatThreshold, setCfThreatThreshold] = useState(35);
  const [cfTurnstileEnabled, setCfTurnstileEnabled] = useState(false);
  const [cfTurnstileSiteKey, setCfTurnstileSiteKey] = useState('');
  const [cfTurnstileSecretInput, setCfTurnstileSecretInput] = useState('');
  const [cfSaving, setCfSaving] = useState(false);
  const [cfFeedback, setCfFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // CKAN / DCAT-AP Harvesting state
  const [catalogSyncing, setCatalogSyncing] = useState(false);
  const [catalogMessage, setCatalogMessage] = useState<string | null>(null);

  // BigQuery Data Warehouse state
  const [bqStatus, setBqStatus] = useState<BigQueryConfigStatus | null>(null);
  const [bqLoading, setBqLoading] = useState(false);
  const [bqSelectedSheetId, setBqSelectedSheetId] = useState<string>(
    sheets[0]?.id ?? ''
  );
  const [bqSyncing, setBqSyncing] = useState(false);
  const [bqBatchSyncing, setBqBatchSyncing] = useState(false);
  const [bqFeedback, setBqFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [bqSql, setBqSql] = useState('');
  const [bqQuerying, setBqQuerying] = useState(false);
  const [bqQueryResult, setBqQueryResult] =
    useState<BigQueryQueryResult | null>(null);

  const loadCfWafStatus = async () => {
    setCfLoading(true);
    try {
      const res = await fetchCloudflareWafStatus(currentSuperAdminEmail);
      if (res) {
        setCfWaf(res);
        setCfStrictOrigin(res.config.strictOriginLock);
        setCfBlockThreatScore(res.config.blockHighThreatScore);
        setCfThreatThreshold(res.config.threatScoreThreshold);
        setCfTurnstileEnabled(res.config.turnstileEnabled);
        setCfTurnstileSiteKey(res.config.turnstileSiteKey);
      }
    } finally {
      setCfLoading(false);
    }
  };

  const loadBqStatus = async () => {
    setBqLoading(true);
    try {
      const status = await fetchBigQueryStatus(currentSuperAdminEmail);
      setBqStatus(status);
      if (status?.tables?.length && !bqSql.trim()) {
        const first = status.tables[0].tableId;
        setBqSql(
          `SELECT * FROM \`${status.config.projectId}.${status.config.datasetId}.${first}\` LIMIT 20`
        );
      }
    } finally {
      setBqLoading(false);
    }
  };

  const loadProxyStats = async () => {
    setLoadingProxy(true);
    try {
      const stats = await fetchSheetProxyStats(currentSuperAdminEmail);
      setProxyStats(stats);
    } finally {
      setLoadingProxy(false);
    }
  };

  useEffect(() => {
    loadProxyStats();
    loadBqStatus();
    loadCfWafStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSuperAdminEmail]);

  const handleSaveCloudflareWaf = async (e: React.FormEvent) => {
    e.preventDefault();
    setCfFeedback(null);
    setCfSaving(true);
    try {
      const res = await updateCloudflareWafConfig(currentSuperAdminEmail, {
        strictOriginLock: cfStrictOrigin,
        blockHighThreatScore: cfBlockThreatScore,
        threatScoreThreshold: cfThreatThreshold,
        turnstileEnabled: cfTurnstileEnabled,
        turnstileSiteKey: cfTurnstileSiteKey,
        turnstileSecretKey: cfTurnstileSecretInput.trim() || undefined,
      });
      setCfFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
      if (res.ok) {
        setCfTurnstileSecretInput('');
        await loadCfWafStatus();
      }
    } finally {
      setCfSaving(false);
    }
  };

  const handleRotateOriginSecret = async () => {
    setCfFeedback(null);
    const res = await rotateCloudflareOriginSecret(currentSuperAdminEmail);
    setCfFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
    if (res.ok) {
      await loadCfWafStatus();
    }
  };

  const handleSyncCatalogFeed = async () => {
    setCatalogMessage(null);
    setCatalogSyncing(true);
    try {
      const res = await syncPublicHarvestCatalog(
        currentSuperAdminEmail,
        sheets,
        rowsBySheet,
        metadataBySheet
      );
      setCatalogMessage(res.message);
    } finally {
      setCatalogSyncing(false);
    }
  };

  const handleBatchSyncBigQuery = async () => {
    if (sheets.length === 0) return;
    setBqFeedback(null);
    setBqBatchSyncing(true);
    try {
      let okCount = 0;
      let totalRows = 0;
      for (const sheet of sheets) {
        const rows = rowsBySheet[sheet.id] ?? [];
        const res = await pushOpdSheetToBigQuery(
          currentSuperAdminEmail,
          sheet,
          rows
        );
        if (res.ok) {
          okCount++;
          totalRows += rows.length;
        }
      }
      setBqFeedback({
        type: okCount > 0 ? 'success' : 'error',
        text:
          okCount > 0
            ? `Arsip batch selesai: ${okCount}/${sheets.length} sheet (${totalRows.toLocaleString('id-ID')} baris) berhasil disinkronkan ke Google BigQuery.`
            : 'Gagal menyinkronkan sheet ke BigQuery. Periksa konfigurasi proyek dan kredensial service account.',
      });
      await loadBqStatus();
    } finally {
      setBqBatchSyncing(false);
    }
  };

  const handleSyncSheetToBigQuery = async () => {
    const targetSheet =
      sheets.find((s) => s.id === bqSelectedSheetId) ?? sheets[0];
    if (!targetSheet) {
      setBqFeedback({
        type: 'error',
        text: 'Belum ada Google Sheet OPD terdaftar untuk disinkronkan ke BigQuery.',
      });
      return;
    }
    setBqFeedback(null);
    setBqSyncing(true);
    try {
      const rows = rowsBySheet[targetSheet.id] ?? [];
      const res = await pushOpdSheetToBigQuery(
        currentSuperAdminEmail,
        targetSheet,
        rows
      );
      setBqFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
      if (res.ok) {
        if (res.fullTableName) {
          setBqSql(`SELECT * FROM ${res.fullTableName} LIMIT 25`);
        }
        await loadBqStatus();
      }
    } finally {
      setBqSyncing(false);
    }
  };

  const handleRunBqSql = async (e: React.FormEvent) => {
    e.preventDefault();
    setBqQuerying(true);
    setBqQueryResult(null);
    try {
      const res = await executeBigQueryReadOnlySql(
        currentSuperAdminEmail,
        bqSql
      );
      setBqQueryResult(res);
    } finally {
      setBqQuerying(false);
    }
  };

  const handleSaveRegency = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegencyFeedback(null);
    setSavingRegency(true);
    try {
      const daftarKecamatan = kecamatanText
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const res = await updateRegencyConfig(currentSuperAdminEmail, {
        namaKabupaten,
        namaPortal,
        namaWalidata,
        domainResmi,
        urlPortalPublik,
        daftarKecamatan,
      });
      onRegencyConfigUpdated(res.config);
      setRegencyFeedback({
        type: res.ok ? 'success' : 'error',
        text: res.message,
      });
    } finally {
      setSavingRegency(false);
    }
  };

  const handleClearProxyCache = async () => {
    setProxyMessage(null);
    const res = await clearSheetProxyCache(currentSuperAdminEmail);
    setProxyMessage(res.message);
    await loadProxyStats();
  };

  const handleRotateSecret = async () => {
    setProxyMessage(null);
    const res = await rotateAppsScriptSecret(currentSuperAdminEmail);
    setProxyMessage(res.message);
    await loadProxyStats();
  };

  const initialCfg = getActiveAuthSheetConfig();
  const [sheetUrl, setSheetUrl] = useState(
    isPlaceholderEndpoint(initialCfg.sheetUrl) ? '' : initialCfg.sheetUrl
  );
  const [sheetName, setSheetName] = useState(initialCfg.sheetName || 'Akun_OPD');
  const [webhookUrl, setWebhookUrl] = useState(
    isPlaceholderEndpoint(initialCfg.webhookUrl) ? '' : initialCfg.webhookUrl
  );
  const [savedCfg, setSavedCfg] = useState(initialCfg);

  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptTab, setScriptTab] = useState<'akun' | 'dynamic'>('akun');

  const isConfigured =
    !isPlaceholderEndpoint(savedCfg.sheetUrl) &&
    !isPlaceholderEndpoint(savedCfg.webhookUrl);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      // Abaikan
    }
  };

  const handleSaveAuthSheet = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setPingResult(null);

    if (!sheetUrl.trim() || !webhookUrl.trim()) {
      setSaveMessage({
        type: 'error',
        text: 'URL Google Sheet Akun dan URL Webhook Web App (/exec) wajib diisi.',
      });
      return;
    }

    if (!extractGoogleSheetId(sheetUrl.trim())) {
      setSaveMessage({
        type: 'error',
        text: 'URL Google Sheet tidak valid. Contoh: https://docs.google.com/spreadsheets/d/ID_SHEET/edit',
      });
      return;
    }

    if (!webhookUrl.trim().startsWith('https://script.google.com/')) {
      setSaveMessage({
        type: 'error',
        text: 'URL Webhook harus berupa URL Google Apps Script Web App (https://script.google.com/macros/s/.../exec).',
      });
      return;
    }

    const updated = saveCustomAuthSheetConfig({
      sheetUrl,
      sheetName,
      webhookUrl,
    });
    setSavedCfg(updated);
    setSaveMessage({
      type: 'success',
      text: 'Konfigurasi Google Sheet Akun OPD berhasil disimpan. Seluruh pendaftaran dan sinkronisasi akun kini terhubung ke Sheet Super Admin Anda.',
    });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setPingResult(null);
    try {
      const targetCfg =
        sheetUrl.trim() && webhookUrl.trim()
          ? {
              ...savedCfg,
              sheetUrl: sheetUrl.trim(),
              sheetName: sheetName.trim() || 'Akun_OPD',
              webhookUrl: webhookUrl.trim(),
            }
          : savedCfg;
      const result = await testAuthSheetConnection(targetCfg);
      setPingResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Konfigurasi Kabupaten, Proxy Keamanan &amp; Skrip Code.gs
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          Sesuaikan identitas daerah (siap pakai lintas kabupaten dengan
          kedaulatan data penuh), kelola kunci rahasia Proxy Google Drive/Sheet
          &amp; akselerator cache server, serta atur Google Sheet Akun OPD.
        </p>
      </div>

      {/* SECTION A: IDENTITAS KABUPATEN (WHITE-LABEL MULTI-KABUPATEN) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#0B1B2B] text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Identitas Kabupaten &amp; Kedaulatan Instansi (White-Label)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Ubah nama kabupaten, nama portal, walidata, daftar kecamatan,
                dan tautan portal publik terpisah tanpa mengubah kode aplikasi.
              </p>
            </div>
          </div>
          {urlPortalPublik && (
            <a
              href={urlPortalPublik}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-200 rounded-md hover:bg-teal-100 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka Portal Publik
            </a>
          )}
        </div>

        <form onSubmit={handleSaveRegency} className="p-6 space-y-4">
          {regencyFeedback && (
            <div
              className={`p-3 text-xs rounded-md border ${
                regencyFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {regencyFeedback.text}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="cfg-kab"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Nama Kabupaten / Kota
              </label>
              <input
                id="cfg-kab"
                type="text"
                value={namaKabupaten}
                onChange={(e) => setNamaKabupaten(e.target.value)}
                placeholder="Kabupaten Nagekeo"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
            <div>
              <label
                htmlFor="cfg-portal"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Nama Aplikasi Portal
              </label>
              <input
                id="cfg-portal"
                type="text"
                value={namaPortal}
                onChange={(e) => setNamaPortal(e.target.value)}
                placeholder="Satu Data Nagekeo"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
            <div>
              <label
                htmlFor="cfg-walidata"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Instansi Walidata
              </label>
              <input
                id="cfg-walidata"
                type="text"
                value={namaWalidata}
                onChange={(e) => setNamaWalidata(e.target.value)}
                placeholder="Diskominfo Kabupaten Nagekeo"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="cfg-domain"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Domain Resmi Daerah
              </label>
              <input
                id="cfg-domain"
                type="text"
                value={domainResmi}
                onChange={(e) => setDomainResmi(e.target.value)}
                placeholder="nagekeokab.go.id"
                className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
            <div>
              <label
                htmlFor="cfg-public-url"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                URL Portal Publik Terpisah (Untuk Masyarakat Umum)
              </label>
              <input
                id="cfg-public-url"
                type="url"
                value={urlPortalPublik}
                onChange={(e) => setUrlPortalPublik(e.target.value)}
                placeholder="https://data.kabupatenanda.go.id (opsional)"
                className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="cfg-kecamatan"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Daftar Kecamatan (pisahkan dengan koma — otomatis jadi saran input
              OPD)
            </label>
            <input
              id="cfg-kecamatan"
              type="text"
              value={kecamatanText}
              onChange={(e) => setKecamatanText(e.target.value)}
              placeholder="Aesesa, Boawae, Mauponggo, Nangaroro..."
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingRegency}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60"
            >
              <Save className="w-3.5 h-3.5" />
              {savingRegency
                ? 'Menyimpan...'
                : 'Simpan Identitas Kabupaten'}
            </button>
          </div>
        </form>
      </section>

      {/* SECTION B: KEAMANAN PROXY GOOGLE SHEET (API_SECRET) & AKSELERATOR CACHE SERVER */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-md bg-teal-700 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Proxy Aman Google Drive/Sheet, Kunci API_SECRET &amp; Smart Cache
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Menutup celah akses langsung URL Apps Script, menyisipkan kunci
                rahasia dari server, mencegah SSRF, dan mempercepat pembacaan
                sheet hingga puluhan kali lipat dengan cache otomatis 45 detik.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={loadProxyStats}
              disabled={loadingProxy}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${loadingProxy ? 'animate-spin' : ''}`}
              />
              Segarkan
            </button>
            <button
              type="button"
              onClick={handleClearProxyCache}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Bersihkan Cache
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {proxyMessage && (
            <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md">
              {proxyMessage}
            </div>
          )}

          {/* KPI Performa Cache & Proteksi */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Rasio Cache Hit
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-teal-700">
                {proxyStats ? `${proxyStats.hitRatePct}%` : '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {proxyStats
                  ? `${proxyStats.cacheHits} hit / ${proxyStats.cacheMisses} miss`
                  : 'Menunggu sinkronisasi'}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Kecepatan Cache vs Sheet
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                {proxyStats ? `${proxyStats.avgCacheMs} ms` : '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Google Sheet: {proxyStats ? `${proxyStats.avgUpstreamMs} ms` : '—'}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Sheet Aktif di Cache
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                {proxyStats ? proxyStats.cachedEntries : 0}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                TTL {proxyStats?.cacheTtlSec ?? 45} dtk · Auto-refresh saat input
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Sesi &amp; Anti-SSRF
              </p>
              <p className="mt-1 text-sm font-semibold text-emerald-700 inline-flex items-center gap-1">
                <ShieldCheck className="w-4 h-4" />
                HttpOnly HMAC
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {proxyStats?.blockedSsrf ?? 0} URL ilegal diblokir
              </p>
            </div>
          </div>

          {/* Kunci Rahasia Webhook (API_SECRET) */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                <KeyRound className="w-4 h-4 text-teal-700" />
                Kunci Rahasia Webhook Server (API_SECRET untuk Code.gs)
              </div>
              <div className="flex items-center gap-2">
                {proxyStats?.appsScriptSecret && (
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(proxyStats.appsScriptSecret, 'api-secret')
                    }
                    className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium text-white bg-[#0B1B2B] rounded hover:bg-slate-800"
                  >
                    {copiedId === 'api-secret' ? (
                      <>
                        <Check className="w-3 h-3" />
                        Tersalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Salin Kunci
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleRotateSecret}
                  className="inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100"
                >
                  <RefreshCw className="w-3 h-3" />
                  Rotasi Kunci
                </button>
              </div>
            </div>
            <div className="px-3 py-2 bg-white border border-slate-200 rounded font-mono text-xs text-slate-800 break-all">
              {proxyStats?.appsScriptSecret || 'Memuat kunci rahasia server...'}
            </div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Tempel kunci di atas ke baris{' '}
              <code className="font-mono bg-slate-200/70 px-1 rounded">
                const API_SECRET = &apos;...&apos;;
              </code>{' '}
              pada <code className="font-mono">Code.gs</code> milik OPD agar URL{' '}
              <code className="font-mono">/exec</code> tidak bisa diakses
              langsung oleh pihak luar—hanya server resmi kabupaten Anda yang
              otomatis menyisipkan kunci ini secara rahasia.
            </p>
          </div>
        </div>
      </section>

      {/* SECTION B2: CLOUDFLARE WAF, ORIGIN LOCK & ANTI-BOT TURNSTILE */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-md bg-orange-600 text-white flex items-center justify-center shrink-0 mt-0.5">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {cfWaf?.edgeTelemetry.behindCloudflare ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Trafik Terdeteksi Lewat Cloudflare Edge (CF-Ray:{' '}
                    {cfWaf.edgeTelemetry.cfRay})
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    WAF Aplikasi Aktif · Menunggu Proxy DNS Cloudflare untuk
                    Domain Produksi
                  </span>
                )}
              </div>
              <h2 className="text-base font-semibold text-slate-900 mt-0.5">
                Cloudflare WAF, Origin Lock Anti-Bypass &amp; Turnstile
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={loadCfWafStatus}
            disabled={cfLoading}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${cfLoading ? 'animate-spin' : ''}`}
            />
            Cek Header Edge
          </button>
        </div>

        <div className="p-6 space-y-5">
          {cfFeedback && (
            <div
              className={`p-3 text-xs rounded-md border ${
                cfFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {cfFeedback.text}
            </div>
          )}

          {/* Live Edge Telemetry Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Real Client IP (CF-Connecting-IP)
              </p>
              <p className="mt-1 text-sm font-semibold font-mono text-slate-900 truncate">
                {cfWaf?.edgeTelemetry.clientIp || '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Negara: {cfWaf?.edgeTelemetry.cfCountry || 'Lokal/Langsung'}
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Permintaan Diperiksa WAF
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                {(cfWaf?.metrics.inspected ?? 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Headers CSP &amp; HSTS aktif
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Blokir SQLi / XSS / Scanner
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-red-700">
                {(cfWaf?.metrics.wafBlocks ?? 0).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Auto-ban aktif 60 menit
              </p>
            </div>
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md">
              <p className="text-[11px] font-medium text-slate-500">
                Bypass &amp; Threat Score Diblokir
              </p>
              <p className="mt-1 text-xl font-semibold font-mono tabular-nums text-amber-700">
                {(
                  (cfWaf?.metrics.blockedOriginBypass ?? 0) +
                  (cfWaf?.metrics.blockedThreatScore ?? 0)
                ).toLocaleString('id-ID')}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Skor ancaman maks: {cfThreatThreshold}
              </p>
            </div>
          </div>

          {/* Settings Form */}
          <form onSubmit={handleSaveCloudflareWaf} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="flex items-start gap-3 p-3.5 border border-slate-200 rounded-md bg-slate-50/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfBlockThreatScore}
                  onChange={(e) => setCfBlockThreatScore(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-teal-700"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 block">
                    Blokir Otomatis Cloudflare Threat Score Tinggi
                  </span>
                  <span className="text-slate-600">
                    Menolak trafik berisiko tinggi (botnet/spam/tor) berdasarkan
                    header <code className="font-mono">CF-Threat-Score</code>.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3.5 border border-slate-200 rounded-md bg-slate-50/60 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfStrictOrigin}
                  onChange={(e) => setCfStrictOrigin(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-teal-700"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900 block">
                    Kunci Origin Ketat (Strict Cloudflare Origin Lock)
                  </span>
                  <span className="text-slate-600">
                    Hanya aktifkan jika DNS domain sudah berstatus{' '}
                    <strong>Proxied (Awan Oranye)</strong> di Cloudflare agar
                    IP server asli tidak bisa ditembak langsung.
                  </span>
                </div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <label
                  htmlFor="cf-threat-threshold"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Ambang Blokir CF-Threat-Score (5–100)
                </label>
                <input
                  id="cf-threat-threshold"
                  type="number"
                  min={5}
                  max={100}
                  value={cfThreatThreshold}
                  onChange={(e) =>
                    setCfThreatThreshold(Number(e.target.value || 35))
                  }
                  className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="cf-turnstile-site"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Cloudflare Turnstile Site Key (Opsional)
                </label>
                <input
                  id="cf-turnstile-site"
                  type="text"
                  value={cfTurnstileSiteKey}
                  onChange={(e) => setCfTurnstileSiteKey(e.target.value)}
                  placeholder="0x4AAAAAAA..."
                  className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="cf-turnstile-secret"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Turnstile Secret Key{' '}
                  {cfWaf?.config.hasTurnstileSecret ? '(Tersimpan)' : ''}
                </label>
                <input
                  id="cf-turnstile-secret"
                  type="password"
                  value={cfTurnstileSecretInput}
                  onChange={(e) => setCfTurnstileSecretInput(e.target.value)}
                  placeholder={
                    cfWaf?.config.hasTurnstileSecret
                      ? 'Biarkan kosong jika tidak diganti'
                      : '0x4AAAAAAA... (disimpan di server)'
                  }
                  className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={cfTurnstileEnabled}
                  onChange={(e) => setCfTurnstileEnabled(e.target.checked)}
                  className="w-4 h-4 accent-teal-700"
                />
                Aktifkan widget Anti-Bot Cloudflare Turnstile pada Login Super
                Admin
              </label>

              <button
                type="submit"
                disabled={cfSaving}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60"
              >
                <Save className="w-3.5 h-3.5" />
                {cfSaving ? 'Menyimpan WAF...' : 'Simpan Konfigurasi WAF'}
              </button>
            </div>
          </form>

          {/* Origin Secret + Ready-to-Paste Cloudflare WAF Rules */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-3 border-t border-slate-200">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Lock className="w-3.5 h-3.5 text-teal-700" />
                  Header Rahasia Origin ({cfWaf?.config.originVerifyHeaderName || 'X-CF-Origin-Verify'})
                </span>
                <div className="flex items-center gap-1.5">
                  {cfWaf?.config.originVerifySecret && (
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          cfWaf.config.originVerifySecret,
                          'cf-origin-secret'
                        )
                      }
                      className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-white bg-[#0B1B2B] rounded hover:bg-slate-800"
                    >
                      {copiedId === 'cf-origin-secret' ? (
                        <>
                          <Check className="w-3 h-3" />
                          Tersalin
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Salin
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRotateOriginSecret}
                    className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Rotasi
                  </button>
                </div>
              </div>
              <div className="px-2.5 py-1.5 bg-white border border-slate-200 rounded font-mono text-[11px] text-slate-800 break-all">
                {cfWaf?.config.originVerifySecret || 'Memuat...'}
              </div>
              <p className="text-[11px] text-slate-600">
                Di Cloudflare Dashboard → Rules → Transform Rules → Modify
                Request Header, tambahkan header{' '}
                <code className="font-mono">X-CF-Origin-Verify</code> dengan
                nilai di atas sebelum mengaktifkan Strict Origin Lock.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-900">
                  Ekspresi Custom Rule Siap Pakai (Cloudflare Security → WAF)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      `(http.request.uri.path contains "/api/auth/superadmin" and cf.threat_score gt 10) or (http.request.uri.path in {"/.env" "/wp-admin" "/wp-login.php" "/phpmyadmin"})`,
                      'cf-waf-expr'
                    )
                  }
                  className="inline-flex items-center gap-1 h-7 px-2 text-[11px] font-medium text-white bg-teal-700 rounded hover:bg-teal-800"
                >
                  {copiedId === 'cf-waf-expr' ? (
                    <>
                      <Check className="w-3 h-3" />
                      Tersalin
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Salin Rule
                    </>
                  )}
                </button>
              </div>
              <pre className="p-2.5 bg-slate-900 text-teal-300 rounded font-mono text-[11px] overflow-x-auto whitespace-pre-wrap">
                {`(http.request.uri.path contains "/api/auth/superadmin" and cf.threat_score gt 10) or (http.request.uri.path in {"/.env" "/wp-admin" "/wp-login.php" "/phpmyadmin"})`}
              </pre>
              <p className="text-[11px] text-slate-600">
                Atur aksi <strong>Managed Challenge</strong> pada rule di atas
                di Cloudflare Dashboard untuk menyaring bot sebelum mencapai
                server Node.js Anda.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SECTION B3: NODE INTEROPERABILITAS NASIONAL (CKAN API v3 & W3C DCAT-AP) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-md bg-[#0B1B2B] text-teal-400 flex items-center justify-center shrink-0 mt-0.5">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Node Interoperabilitas Satu Data Indonesia (CKAN API &amp;
                DCAT.json)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Menutup celah integrasi dengan portal publik atau harvester
                nasional. Hanya dataset dengan status metadata{' '}
                <strong>Terverifikasi Walidata</strong> dan tingkat akses{' '}
                <strong>Terbuka (Publik)</strong> yang diekspos (zero PII).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSyncCatalogFeed}
            disabled={catalogSyncing}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${catalogSyncing ? 'animate-spin' : ''}`}
            />
            {catalogSyncing
              ? 'Menyinkronkan Feed...'
              : 'Sinkronkan Feed Publik Terverifikasi'}
          </button>
        </div>

        <div className="p-6 space-y-4">
          {catalogMessage && (
            <div className="p-3 text-xs bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md">
              {catalogMessage}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {[
              {
                id: 'ep-dcat',
                label: 'W3C DCAT / JSON-SDI Feed',
                path: '/api/public/dcat.json',
              },
              {
                id: 'ep-ckan-list',
                label: 'CKAN Action API (package_list)',
                path: '/api/public/ckan/package_list',
              },
              {
                id: 'ep-ckan-show',
                label: 'CKAN Action API (package_show)',
                path: '/api/public/ckan/package_show?id=SLUG_DATASET',
              },
            ].map((ep) => (
              <div
                key={ep.id}
                className="p-3.5 bg-slate-50 border border-slate-200 rounded-md space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {ep.label}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(`${window.location.origin}${ep.path}`, ep.id)
                    }
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 hover:text-teal-900"
                  >
                    {copiedId === ep.id ? (
                      <>
                        <Check className="w-3 h-3" />
                        Tersalin
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Salin URL
                      </>
                    )}
                  </button>
                </div>
                <p className="font-mono text-[11px] text-slate-600 break-all">
                  {ep.path}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECTION C: GOOGLE BIGQUERY DATA WAREHOUSE (NAIK KELAS SKALA BESAR — OPSIONAL & NON-BREAKING) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs">
              {bqStatus?.config?.configured && bqStatus.ok ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  BigQuery Terhubung ({bqStatus.config.location})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-slate-600">
                  <Wrench className="w-3.5 h-3.5" />
                  Mode Siap Aktif (Opsional — Google Sheet OPD tetap berjalan normal)
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">
                Data Warehouse Lintas Dinas (BigQuery)
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 mt-0.5">
              Integrasi Google BigQuery &amp; Analitik SQL Lintas OPD
            </h2>
          </div>

          <button
            type="button"
            onClick={loadBqStatus}
            disabled={bqLoading}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${bqLoading ? 'animate-spin' : ''}`}
            />
            Cek Koneksi BigQuery
          </button>
        </div>

        <div className="p-6 space-y-5">
          {bqStatus?.message && (
            <div
              className={`p-3 text-xs rounded-md border ${
                bqStatus.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
            >
              {bqStatus.message}
            </div>
          )}

          {bqFeedback && (
            <div
              className={`p-3 text-xs rounded-md border ${
                bqFeedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {bqFeedback.text}
            </div>
          )}

          {/* Push Sheet OPD -> Tabel BigQuery */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
            <div className="lg:col-span-8">
              <label
                htmlFor="bq-sheet-select"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Pilih Google Sheet OPD untuk Disinkronkan ke BigQuery
              </label>
              <select
                id="bq-sheet-select"
                value={bqSelectedSheetId || sheets[0]?.id || ''}
                onChange={(e) => setBqSelectedSheetId(e.target.value)}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              >
                {sheets.length === 0 ? (
                  <option value="">Belum ada Sheet OPD terdaftar</option>
                ) : (
                  sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.namaOpd} — {s.judulDataset} [{s.sheetName}] (
                      {(rowsBySheet[s.id] ?? []).length} baris)
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="lg:col-span-4 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleSyncSheetToBigQuery}
                disabled={
                  bqSyncing ||
                  bqBatchSyncing ||
                  sheets.length === 0 ||
                  !bqStatus?.config?.configured
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Zap className="w-3.5 h-3.5 text-teal-400" />
                {bqSyncing ? 'Menyinkronkan...' : 'Push 1 Sheet'}
              </button>
              <button
                type="button"
                onClick={handleBatchSyncBigQuery}
                disabled={
                  bqBatchSyncing ||
                  bqSyncing ||
                  sheets.length === 0 ||
                  !bqStatus?.config?.configured
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 h-10 px-3 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
              >
                <Database className="w-3.5 h-3.5" />
                {bqBatchSyncing ? 'Arsip Batch...' : 'Arsipkan Semua'}
              </button>
            </div>
          </div>

          {/* Penjaga Kapasitas 10 Juta Sel Google Sheet (Proyeksi 20–30 Tahun) */}
          {sheets.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700">
                  Monitor Kapasitas 10 Juta Sel Google Sheet (Arsip 20–30 Tahun)
                </span>
                <span className="text-[11px] text-slate-500">
                  Pecah tab/tahun atau arsipkan ke BigQuery jika mendekati 50%
                </span>
              </div>
              <div className="overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-white border-b border-slate-200 text-[11px] text-slate-500">
                      <th className="py-2 px-3">Dataset OPD</th>
                      <th className="py-2 px-3 text-right">Baris × Kolom</th>
                      <th className="py-2 px-3 text-right">Total Sel</th>
                      <th className="py-2 px-3 text-right">% Batas 10 Jt</th>
                      <th className="py-2 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {evaluateSheetCapacity(sheets, rowsBySheet).map((cap) => (
                      <tr key={cap.sheetId}>
                        <td className="py-1.5 px-3 font-medium text-slate-800">
                          {cap.judulDataset}{' '}
                          <span className="text-[11px] text-slate-400">
                            ({cap.sheetName})
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                          {cap.rows.toLocaleString('id-ID')} × {cap.cols}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {cap.usedCells.toLocaleString('id-ID')}
                        </td>
                        <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-700">
                          {cap.usagePct}%
                        </td>
                        <td className="py-1.5 px-3 text-right">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              cap.status === 'Aman'
                                ? 'bg-emerald-50 text-emerald-700'
                                : cap.status === 'Pantau'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {cap.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daftar Tabel BigQuery Aktif */}
          {bqStatus?.tables && bqStatus.tables.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-700">
                Tabel BigQuery Aktif ({bqStatus.tables.length})
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {bqStatus.tables.map((t) => (
                  <div
                    key={t.tableId}
                    className="px-3.5 py-2 flex items-center justify-between gap-3"
                  >
                    <span className="font-mono text-slate-800">{t.tableId}</span>
                    <span className="font-mono tabular-nums text-slate-500">
                      {t.numRows.toLocaleString('id-ID')} baris
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Konsol SQL Analitik Read-Only (SELECT only, max 100 MB) */}
          <form onSubmit={handleRunBqSql} className="space-y-2.5 pt-2 border-t border-slate-200">
            <label
              htmlFor="bq-sql-input"
              className="block text-xs font-medium text-slate-700"
            >
              Konsol SQL Analitik Lintas Dinas (Khusus SELECT Read-Only · Batas
              Aman 100 MB/Query)
            </label>
            <textarea
              id="bq-sql-input"
              rows={3}
              value={bqSql}
              onChange={(e) => setBqSql(e.target.value)}
              placeholder="SELECT _nama_opd, COUNT(*) AS total_baris FROM `PROJECT_ID.satu_data_sektoral.opd_dinkes_sheet1` GROUP BY _nama_opd"
              className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                Perintah DROP, DELETE, UPDATE, INSERT otomatis diblokir oleh
                server.
              </span>
              <button
                type="submit"
                disabled={
                  bqQuerying || !bqSql.trim() || !bqStatus?.config?.configured
                }
                className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50"
              >
                {bqQuerying ? 'Menjalankan...' : 'Jalankan Query SQL'}
              </button>
            </div>
          </form>

          {bqQueryResult && (
            <div className="space-y-2">
              {!bqQueryResult.ok ? (
                <div className="p-3 text-xs bg-red-50 border border-red-200 text-red-700 rounded-md">
                  {bqQueryResult.message}
                </div>
              ) : (
                <div className="border border-slate-200 rounded-md overflow-x-auto">
                  <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 text-[11px] text-slate-600 font-mono">
                    {bqQueryResult.totalRows} baris · {bqQueryResult.latencyMs} ms
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 bg-white text-left text-slate-500">
                        {bqQueryResult.columns.map((col) => (
                          <th key={col} className="py-2 px-3 font-mono font-medium">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {bqQueryResult.rows.slice(0, 30).map((row, idx) => (
                        <tr key={idx}>
                          {bqQueryResult.columns.map((col) => (
                            <td key={col} className="py-1.5 px-3 text-slate-700">
                              {String(row[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Super Admin Auth Sheet Registration Form */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs">
              {isConfigured ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Google Sheet Akun Terhubung
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                  <Wrench className="w-3.5 h-3.5" />
                  Belum Dihubungkan (Mode Lokal)
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">Milik Super Admin Walidata</span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 mt-0.5">
              Daftarkan Google Sheet Daftar Akun OPD
            </h2>
          </div>

          {!isPlaceholderEndpoint(savedCfg.sheetUrl) && (
            <a
              href={savedCfg.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka Sheet Akun
            </a>
          )}
        </div>

        {/* 4-Step Quick Guide */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-slate-600">
          <div>
            <p className="font-semibold text-slate-900">
              1. Buat Google Sheet Baru
            </p>
            <p className="mt-0.5 leading-relaxed">
              Buat 1 Spreadsheet di Drive Super Admin (mis.{' '}
              <span className="font-medium text-slate-800">
                Master_Akun_OPD_Nagekeo
              </span>
              ).
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              2. Pasang Code_Akun_OPD.gs
            </p>
            <p className="mt-0.5 leading-relaxed">
              Buka <strong>Extensions → Apps Script</strong>, salin skrip{' '}
              <code className="font-mono text-slate-800">Code_Akun_OPD.gs</code>{' '}
              di bawah, lalu simpan.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              3. Deploy sebagai Web App
            </p>
            <p className="mt-0.5 leading-relaxed">
              Klik <strong>Deploy → New Deployment → Web App</strong> (Execute
              as: <em>Me</em>, Access: <em>Anyone</em>), salin URL{' '}
              <code className="font-mono text-slate-800">/exec</code>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              4. Tempel &amp; Simpan di Sini
            </p>
            <p className="mt-0.5 leading-relaxed">
              Masukkan URL Sheet &amp; URL Web App di form bawah lalu klik{' '}
              <strong>Simpan &amp; Uji Koneksi</strong>.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveAuthSheet} className="p-6 space-y-4">
          {saveMessage && (
            <div
              className={`p-3 text-xs rounded-md border ${
                saveMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {saveMessage.text}
            </div>
          )}

          {pingResult && (
            <div
              className={`p-3 text-xs rounded-md border ${
                pingResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {pingResult.message}
              {pingResult.latencyMs > 0 ? ` (${pingResult.latencyMs} ms)` : ''}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <label
                htmlFor="auth-sheet-url"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                URL Google Sheet Daftar Akun OPD (Milik Super Admin)
              </label>
              <input
                id="auth-sheet-url"
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1ABC.../edit#gid=0"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>

            <div className="lg:col-span-4">
              <label
                htmlFor="auth-sheet-tab"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Nama Tab Sheet
              </label>
              <input
                id="auth-sheet-tab"
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Akun_OPD"
                className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-webhook-url"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              URL Webhook Web App Apps Script (hasil Deploy Code_Akun_OPD.gs)
            </label>
            <input
              id="auth-webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              required
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`}
              />
              {testing ? 'Menguji Koneksi...' : 'Uji Koneksi Webhook'}
            </button>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Konfigurasi Sheet Akun
            </button>
          </div>
        </form>
      </section>

      {/* Apps Script Template Panel */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Template Google Apps Script (doGet &amp; doPost)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pilih{' '}
              <code className="font-mono text-slate-700">Code_Akun_OPD.gs</code>{' '}
              untuk Sheet Akun Super Admin, atau{' '}
              <code className="font-mono text-slate-700">Code.gs</code> untuk
              dicangkokkan pada Sheet milik masing-masing OPD.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setScriptTab('akun')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scriptTab === 'akun'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Code_Akun_OPD.gs (Sheet Akun Admin)
              </button>
              <button
                type="button"
                onClick={() => setScriptTab('dynamic')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scriptTab === 'dynamic'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Code.gs (Universal Sheet OPD)
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                handleCopy(
                  scriptTab === 'dynamic'
                    ? APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE
                    : APPS_SCRIPT_AUTH_TEMPLATE,
                  `script-${scriptTab}`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedId === `script-${scriptTab}` ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Skrip Tersalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Skrip
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-slate-950 text-slate-100 p-5 overflow-x-auto max-h-[420px]">
          <pre className="text-xs font-mono leading-relaxed">
            <code>
              {scriptTab === 'dynamic'
                ? APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE
                : APPS_SCRIPT_AUTH_TEMPLATE}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
