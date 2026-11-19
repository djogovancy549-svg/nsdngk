import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  CheckSquare,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Globe,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Square,
  Trash2,
  Wifi,
} from 'lucide-react';
import {
  APPS_SCRIPT_PUBLISH_TEMPLATE,
  isPlaceholderEndpoint,
} from '../config/opdSheets';
import { exportDynamicRowsToCsv } from '../services/dynamicSheetService';
import {
  getActivePublishSheetConfig,
  hasCustomPublishSheetConfig,
  resetCustomPublishSheetConfig,
  saveCustomPublishSheetConfig,
  testPublishSheetConnection,
} from '../services/publishSheetService';
import {
  DynamicSheetRow,
  OpdDynamicSheet,
  PublishStatus,
  PublishedDatasetClone,
} from '../types/satuData';

interface PublikasiKominfoViewProps {
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  clones: PublishedDatasetClone[];
  onCreateClone: (
    clone: Omit<PublishedDatasetClone, 'id' | 'dipublikasikanPada' | 'syncedToKominfoSheet'>
  ) => Promise<void>;
  onToggleCloneStatus: (
    clone: PublishedDatasetClone,
    status: PublishStatus
  ) => Promise<void>;
  onResyncClone: (clone: PublishedDatasetClone) => Promise<void>;
  onDeleteClone: (clone: PublishedDatasetClone) => Promise<void>;
}

function makeDefaultTabName(sheet: OpdDynamicSheet): string {
  const clean = `${sheet.namaOpd.replace(/Dinas\s+/i, '')}_${sheet.sheetName}`
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_|_$/g, '');
  return `Pub_${clean}`.slice(0, 40);
}

export function PublikasiKominfoView({
  sheets,
  rowsBySheet,
  clones,
  onCreateClone,
  onToggleCloneStatus,
  onResyncClone,
  onDeleteClone,
}: PublikasiKominfoViewProps) {
  // 1. Konfigurasi Google Sheet Publikasi Dinas Kominfo
  const activeCfg = getActivePublishSheetConfig();
  const [pubSheetUrl, setPubSheetUrl] = useState(
    isPlaceholderEndpoint(activeCfg.sheetUrl) ? '' : activeCfg.sheetUrl
  );
  const [pubSheetName, setPubSheetName] = useState(activeCfg.sheetName);
  const [pubWebhookUrl, setPubWebhookUrl] = useState(
    isPlaceholderEndpoint(activeCfg.webhookUrl) ? '' : activeCfg.webhookUrl
  );
  const [isCustomCfg, setIsCustomCfg] = useState(() =>
    hasCustomPublishSheetConfig()
  );
  const [cfgSavedMsg, setCfgSavedMsg] = useState<string | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);
  const [showScript, setShowScript] = useState(false);

  // 2. Studio Cloning & Kurasi Data
  const [sourceSheetId, setSourceSheetId] = useState<string>(
    () => sheets[0]?.id ?? ''
  );
  const sourceSheet =
    sheets.find((s) => s.id === sourceSheetId) ?? sheets[0] ?? null;
  const sourceRows = sourceSheet ? rowsBySheet[sourceSheet.id] ?? [] : [];

  const [judulPublikasi, setJudulPublikasi] = useState('');
  const [kategori, setKategori] = useState('Data Sektoral');
  const [targetTabName, setTargetTabName] = useState('');
  const [ringkasan, setRingkasan] = useState('');
  const [selectedHeaders, setSelectedHeaders] = useState<string[]>([]);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [rowSearch, setRowSearch] = useState('');
  const [publishStatusOnCreate, setPublishStatusOnCreate] =
    useState<PublishStatus>('Dipublikasikan');
  const [cloningBusy, setCloningBusy] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);

  // 3. Preview modal / drawer inline for cloned catalog
  const [previewCloneId, setPreviewCloneId] = useState<string | null>(null);

  useEffect(() => {
    if (!sourceSheet) {
      setSelectedHeaders([]);
      setSelectedRowIds([]);
      return;
    }
    setJudulPublikasi(
      `${sourceSheet.judulDataset} — Publikasi ${sourceSheet.namaOpd}`
    );
    setTargetTabName(makeDefaultTabName(sourceSheet));
    setRingkasan(sourceSheet.deskripsi || '');
    setSelectedHeaders([...sourceSheet.headers]);
    setSelectedRowIds((rowsBySheet[sourceSheet.id] ?? []).map((r) => r._id));
    setRowSearch('');
    setCloneError(null);
  }, [sourceSheet?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredSourceRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    if (!q) return sourceRows;
    return sourceRows.filter((r) =>
      Object.values(r.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [sourceRows, rowSearch]);

  const handleSavePublishConfig = (e: React.FormEvent) => {
    e.preventDefault();
    saveCustomPublishSheetConfig({
      sheetUrl: pubSheetUrl,
      sheetName: pubSheetName,
      webhookUrl: pubWebhookUrl,
    });
    setIsCustomCfg(true);
    setTestResult(null);
    setCfgSavedMsg(
      'Konfigurasi Google Sheet Publikasi Dinas Kominfo berhasil disimpan.'
    );
  };

  const handleResetPublishConfig = () => {
    const def = resetCustomPublishSheetConfig();
    setPubSheetUrl(isPlaceholderEndpoint(def.sheetUrl) ? '' : def.sheetUrl);
    setPubSheetName(def.sheetName);
    setPubWebhookUrl(
      isPlaceholderEndpoint(def.webhookUrl) ? '' : def.webhookUrl
    );
    setIsCustomCfg(false);
    setTestResult(null);
    setCfgSavedMsg('Konfigurasi dikembalikan ke bawaan.');
  };

  const handleTestConnection = async () => {
    setTestingConn(true);
    setTestResult(null);
    try {
      const res = await testPublishSheetConnection(pubWebhookUrl, pubSheetName);
      setTestResult(res);
    } finally {
      setTestingConn(false);
    }
  };

  const handleCopyPublishScript = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_PUBLISH_TEMPLATE);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      // Abaikan
    }
  };

  const toggleHeader = (header: string) => {
    setSelectedHeaders((prev) =>
      prev.includes(header)
        ? prev.filter((h) => h !== header)
        : [...prev, header]
    );
  };

  const toggleRow = (rowId: string) => {
    setSelectedRowIds((prev) =>
      prev.includes(rowId)
        ? prev.filter((id) => id !== rowId)
        : [...prev, rowId]
    );
  };

  const allFilteredSelected =
    filteredSourceRows.length > 0 &&
    filteredSourceRows.every((r) => selectedRowIds.includes(r._id));

  const toggleAllFilteredRows = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(filteredSourceRows.map((r) => r._id));
      setSelectedRowIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      const merged = new Set([
        ...selectedRowIds,
        ...filteredSourceRows.map((r) => r._id),
      ]);
      setSelectedRowIds(Array.from(merged));
    }
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCloneError(null);

    if (!sourceSheet) {
      setCloneError('Pilih dataset sumber OPD terlebih dahulu.');
      return;
    }
    if (!judulPublikasi.trim() || !targetTabName.trim()) {
      setCloneError('Judul publikasi dan nama tab tujuan di Sheet Kominfo wajib diisi.');
      return;
    }
    if (selectedHeaders.length === 0) {
      setCloneError('Pilih minimal 1 kolom header untuk dipublikasikan.');
      return;
    }
    if (selectedRowIds.length === 0) {
      setCloneError('Pilih minimal 1 baris data untuk di-clone.');
      return;
    }

    const rowIdSet = new Set(selectedRowIds);
    const clonedRows: DynamicSheetRow[] = sourceRows
      .filter((r) => rowIdSet.has(r._id))
      .map((r) => {
        const pickedValues: Record<string, string> = {};
        selectedHeaders.forEach((h) => {
          pickedValues[h] = r.values[h] ?? '';
        });
        return {
          _id: `clone-${r._id}`,
          _updatedAt: new Date().toISOString().slice(0, 10),
          values: pickedValues,
        };
      });

    setCloningBusy(true);
    try {
      await onCreateClone({
        sourceSheetId: sourceSheet.id,
        sourceOpdNama: sourceSheet.namaOpd,
        sourceSheetName: sourceSheet.sheetName,
        judulPublikasi: judulPublikasi.trim(),
        kategori: kategori.trim() || 'Data Sektoral',
        ringkasan: ringkasan.trim(),
        targetTabName: targetTabName.trim(),
        selectedHeaders,
        rows: clonedRows,
        statusPublikasi: publishStatusOnCreate,
      });
    } finally {
      setCloningBusy(false);
    }
  };

  const publishedCount = clones.filter(
    (c) => c.statusPublikasi === 'Dipublikasikan'
  ).length;
  const isWebhookLive = !isPlaceholderEndpoint(pubWebhookUrl);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700 inline-flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5" />
            Kurasi &amp; Publikasi Resmi · Dinas Kominfo Kabupaten Nagekeo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            Cloning Data untuk Publikasi (Sheet Kominfo)
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Pilih dataset, kolom (misalnya menyembunyikan kolom sensitif), dan
            baris tertentu dari Google Sheet OPD untuk di-clone ke Google Sheet
            Publikasi milik Super Admin (Dinas Kominfo). Data asli OPD tetap
            utuh dan terpisah.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-600 shrink-0">
          <span>
            <strong className="text-slate-900">{clones.length}</strong> clone
          </span>
          <span className="text-slate-300">|</span>
          <span>
            <strong className="text-emerald-700">{publishedCount}</strong>{' '}
            dipublikasikan
          </span>
        </div>
      </div>

      {/* Section 1: Konfigurasi Google Sheet Publikasi Dinas Kominfo */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              1. Google Sheet Publikasi Milik Super Admin (Dinas Kominfo)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Status:{' '}
              <span
                className={
                  isWebhookLive
                    ? 'text-emerald-700 font-medium'
                    : 'text-amber-700 font-medium'
                }
              >
                {isWebhookLive
                  ? 'Webhook Sheet Publikasi Kominfo Terdaftar'
                  : 'Belum Terhubung — Daftarkan URL Sheet & Webhook Kominfo'}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopyPublishScript}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 whitespace-nowrap"
            >
              {copiedScript ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Code_Publikasi_Kominfo.gs Tersalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Code_Publikasi_Kominfo.gs
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              className="h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              {showScript ? 'Tutup Skrip' : 'Lihat Skrip'}
            </button>
            {pubSheetUrl && (
              <a
                href={pubSheetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
              >
                Buka Sheet Kominfo
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>

        <form onSubmit={handleSavePublishConfig} className="p-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-5">
              <label
                htmlFor="pub-sheet-url"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                URL Google Sheet Publikasi Kominfo
              </label>
              <input
                id="pub-sheet-url"
                type="url"
                value={pubSheetUrl}
                onChange={(e) => {
                  setPubSheetUrl(e.target.value);
                  setCfgSavedMsg(null);
                }}
                placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                className="w-full h-9 px-3 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
            <div className="lg:col-span-2">
              <label
                htmlFor="pub-sheet-tab"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Tab Katalog
              </label>
              <input
                id="pub-sheet-tab"
                type="text"
                value={pubSheetName}
                onChange={(e) => {
                  setPubSheetName(e.target.value);
                  setCfgSavedMsg(null);
                }}
                placeholder="Katalog_Publikasi"
                className="w-full h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
            <div className="lg:col-span-5">
              <label
                htmlFor="pub-webhook-url"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                URL Webhook Apps Script Publikasi (/exec)
              </label>
              <input
                id="pub-webhook-url"
                type="url"
                value={pubWebhookUrl}
                onChange={(e) => {
                  setPubWebhookUrl(e.target.value);
                  setCfgSavedMsg(null);
                }}
                placeholder="https://script.google.com/macros/s/.../exec"
                className="w-full h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          {cfgSavedMsg && (
            <div className="p-2.5 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
              {cfgSavedMsg}
            </div>
          )}
          {testResult && (
            <div
              className={`p-2.5 text-xs rounded-md border ${
                testResult.ok
                  ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                  : 'text-red-700 bg-red-50 border-red-200'
              }`}
            >
              {testResult.message}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-teal-700 rounded-md hover:bg-teal-800"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Sheet Publikasi
            </button>
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={testingConn}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60"
            >
              <Wifi className="w-3.5 h-3.5" />
              {testingConn ? 'Menguji...' : 'Uji Koneksi Webhook'}
            </button>
            {isCustomCfg && (
              <button
                type="button"
                onClick={handleResetPublishConfig}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            )}
          </div>
        </form>

        {showScript && (
          <div className="border-t border-slate-200">
            <pre className="p-4 text-[11px] leading-relaxed font-mono text-slate-100 bg-[#0B1B2B] overflow-x-auto max-h-[340px]">
              <code>{APPS_SCRIPT_PUBLISH_TEMPLATE}</code>
            </pre>
          </div>
        )}
      </section>

      {/* Section 2: Studio Cloning & Kurasi Data */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            2. Studio Cloning &amp; Seleksi Data Publikasi
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pilih sumber Google Sheet OPD, centang hanya kolom dan baris yang
            layak dipublikasikan, lalu clone ke Google Sheet Dinas Kominfo.
          </p>
        </div>

        {sheets.length === 0 ? (
          <div className="py-12 px-6 text-center text-xs text-slate-500">
            Belum ada Google Sheet OPD yang terdaftar. Setelah OPD mendaftarkan
            sheet dan mengirim data, Anda dapat melakukan cloning publikasi di
            sini.
          </div>
        ) : (
          <form onSubmit={handleCloneSubmit} className="p-5 space-y-6">
            {cloneError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                {cloneError}
              </div>
            )}

            {/* Source & Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="lg:col-span-2">
                <label
                  htmlFor="clone-source"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Pilih Dataset Sumber OPD
                </label>
                <select
                  id="clone-source"
                  value={sourceSheet?.id ?? ''}
                  onChange={(e) => setSourceSheetId(e.target.value)}
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                >
                  {sheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.namaOpd} — {s.judulDataset} [{s.sheetName}] (
                      {rowsBySheet[s.id]?.length ?? 0} baris)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="clone-tab-target"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Nama Tab Tujuan (di Sheet Kominfo)
                </label>
                <input
                  id="clone-tab-target"
                  type="text"
                  value={targetTabName}
                  onChange={(e) => setTargetTabName(e.target.value)}
                  placeholder="Pub_Dinkes_Sheet1"
                  className="w-full h-10 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="clone-status"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Status Awal Publikasi
                </label>
                <select
                  id="clone-status"
                  value={publishStatusOnCreate}
                  onChange={(e) =>
                    setPublishStatusOnCreate(e.target.value as PublishStatus)
                  }
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                >
                  <option value="Dipublikasikan">Langsung Dipublikasikan</option>
                  <option value="Draft">Simpan sebagai Draft</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label
                  htmlFor="clone-title"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Judul Dataset Publikasi
                </label>
                <input
                  id="clone-title"
                  type="text"
                  value={judulPublikasi}
                  onChange={(e) => setJudulPublikasi(e.target.value)}
                  placeholder="Judul resmi untuk katalog publikasi"
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="clone-cat"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Kategori / Sektor
                </label>
                <input
                  id="clone-cat"
                  type="text"
                  value={kategori}
                  onChange={(e) => setKategori(e.target.value)}
                  placeholder="Kesehatan / Pendidikan / Infrastruktur"
                  className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="clone-desc"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Catatan / Ringkasan Kurasi (Opsional)
              </label>
              <input
                id="clone-desc"
                type="text"
                value={ringkasan}
                onChange={(e) => setRingkasan(e.target.value)}
                placeholder="Misalnya: Kolom nomor HP disembunyikan untuk privasi publik."
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>

            {/* Step 3: Column Picker */}
            {sourceSheet && (
              <div className="space-y-2.5 pt-2 border-t border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800">
                    Pilih Kolom yang Hendak Dipublikasikan (
                    <span className="font-mono tabular-nums">
                      {selectedHeaders.length}/{sourceSheet.headers.length}
                    </span>
                    )
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedHeaders(
                        selectedHeaders.length === sourceSheet.headers.length
                          ? []
                          : [...sourceSheet.headers]
                      )
                    }
                    className="text-xs font-medium text-teal-700 hover:text-teal-900"
                  >
                    {selectedHeaders.length === sourceSheet.headers.length
                      ? 'Kosongkan Semua'
                      : 'Pilih Semua Kolom'}
                  </button>
                </div>

                {sourceSheet.headers.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    Header belum terbaca pada sheet sumber ini.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {sourceSheet.headers.map((header) => {
                      const active = selectedHeaders.includes(header);
                      return (
                        <button
                          key={header}
                          type="button"
                          onClick={() => toggleHeader(header)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                            active
                              ? 'bg-[#0B1B2B] text-white border-[#0B1B2B]'
                              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          {active ? (
                            <CheckSquare className="w-3.5 h-3.5 text-teal-400" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          {header}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Row Picker Table */}
            {sourceSheet && (
              <div className="space-y-3 pt-2 border-t border-slate-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-800">
                    Pilih Baris Data untuk Di-clone (
                    <span className="font-mono tabular-nums">
                      {selectedRowIds.length}/{sourceRows.length}
                    </span>{' '}
                    baris terpilih)
                  </p>
                  <div className="relative w-full sm:w-64">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="search"
                      value={rowSearch}
                      onChange={(e) => setRowSearch(e.target.value)}
                      placeholder="Filter baris sumber..."
                      className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                {sourceRows.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md">
                    Belum ada baris data pada sheet sumber ini. Tarik data OPD
                    terlebih dahulu di menu Data Masuk.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-md overflow-x-auto max-h-72">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                        <tr className="text-left text-slate-600">
                          <th className="py-2 px-3 w-10">
                            <button
                              type="button"
                              onClick={toggleAllFilteredRows}
                              aria-label="Pilih semua baris"
                              className="text-slate-700 hover:text-slate-900"
                            >
                              {allFilteredSelected ? (
                                <CheckSquare className="w-4 h-4 text-teal-700" />
                              ) : (
                                <Square className="w-4 h-4 text-slate-400" />
                              )}
                            </button>
                          </th>
                          {selectedHeaders.map((h) => (
                            <th key={h} className="py-2 px-3 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredSourceRows.map((row) => {
                          const checked = selectedRowIds.includes(row._id);
                          return (
                            <tr
                              key={row._id}
                              onClick={() => toggleRow(row._id)}
                              className={`cursor-pointer transition-colors ${
                                checked ? 'bg-teal-50/40' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2 px-3">
                                {checked ? (
                                  <CheckSquare className="w-4 h-4 text-teal-700" />
                                ) : (
                                  <Square className="w-4 h-4 text-slate-400" />
                                )}
                              </td>
                              {selectedHeaders.map((h) => (
                                <td
                                  key={h}
                                  className="py-2 px-3 text-slate-800 whitespace-nowrap"
                                >
                                  {row.values[h] || '—'}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end pt-3 border-t border-slate-200">
              <button
                type="submit"
                disabled={cloningBusy || !sourceSheet}
                className="inline-flex items-center gap-2 h-10 px-5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60"
              >
                <Send className="w-3.5 h-3.5" />
                {cloningBusy
                  ? 'Menyimpan Clone ke Sheet Kominfo...'
                  : 'Clone & Simpan ke Google Sheet Kominfo'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Section 3: Katalog Data Publikasi Dinas Kominfo */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-900">
            3. Katalog Data Ter-clone &amp; Status Publikasi Kominfo
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Atur status tayang setiap hasil cloning data secara mandiri tanpa
            memengaruhi Google Sheet asli milik OPD.
          </p>
        </div>

        {clones.length === 0 ? (
          <div className="py-12 px-6 text-center text-xs text-slate-500">
            Belum ada dataset hasil cloning publikasi. Gunakan Studio Cloning di
            atas untuk memilih data OPD yang hendak dipublikasikan.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {clones.map((clone) => {
              const isPublished = clone.statusPublikasi === 'Dipublikasikan';
              const isPreviewOpen = previewCloneId === clone.id;
              return (
                <div key={clone.id} className="p-5 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            isPublished ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {clone.statusPublikasi}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-600">
                          Sumber: {clone.sourceOpdNama} ({clone.sourceSheetName})
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono text-slate-500">
                          Tab Kominfo: {clone.targetTabName}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="font-mono tabular-nums text-slate-500">
                          {clone.selectedHeaders.length} kolom ·{' '}
                          {clone.rows.length} baris
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {clone.judulPublikasi}
                      </h3>
                      {clone.ringkasan && (
                        <p className="text-xs text-slate-500">
                          {clone.ringkasan}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          onToggleCloneStatus(
                            clone,
                            isPublished ? 'Draft' : 'Dipublikasikan'
                          )
                        }
                        className={`h-8 px-3 text-xs font-medium rounded-md border whitespace-nowrap ${
                          isPublished
                            ? 'text-amber-800 bg-amber-50 border-amber-200 hover:bg-amber-100'
                            : 'text-white bg-emerald-700 border-emerald-700 hover:bg-emerald-800'
                        }`}
                      >
                        {isPublished ? 'Tarik ke Draft' : 'Publikasikan'}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setPreviewCloneId(isPreviewOpen ? null : clone.id)
                        }
                        className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        {isPreviewOpen ? 'Tutup' : 'Pratinjau'}
                      </button>

                      <button
                        type="button"
                        onClick={() => onResyncClone(clone)}
                        className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                        title="Kirim ulang ke Google Sheet Publikasi Kominfo"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Kirim ke Sheet
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          exportDynamicRowsToCsv(
                            clone.selectedHeaders,
                            clone.rows,
                            `${clone.targetTabName}.csv`
                          )
                        }
                        className="inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        <Download className="w-3.5 h-3.5" />
                        CSV
                      </button>

                      <button
                        type="button"
                        onClick={() => onDeleteClone(clone)}
                        className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md"
                        aria-label={`Hapus ${clone.judulPublikasi}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isPreviewOpen && (
                    <div className="border border-slate-200 rounded-md overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr className="text-left text-slate-600">
                            <th className="py-2 px-3 w-10 font-mono">#</th>
                            {clone.selectedHeaders.map((h) => (
                              <th
                                key={h}
                                className="py-2 px-3 whitespace-nowrap"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {clone.rows.map((r, i) => (
                            <tr key={r._id} className="hover:bg-slate-50/70">
                              <td className="py-2 px-3 font-mono tabular-nums text-slate-400">
                                {i + 1}
                              </td>
                              {clone.selectedHeaders.map((h) => (
                                <td
                                  key={h}
                                  className="py-2 px-3 text-slate-800 whitespace-nowrap"
                                >
                                  {r.values[h] || '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
