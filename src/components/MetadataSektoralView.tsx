import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  FileJson,
  FileSpreadsheet,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import {
  computeMetadataCompleteness,
  createDefaultDatasetMetadata,
  exportMetadataCatalogToCsv,
  exportMetadataCatalogToJson,
  saveDatasetMetadata,
  syncMetadataVariablesWithHeaders,
} from '../services/metadataService';
import {
  DatasetMetadata,
  MetadataAccessLevel,
  MetadataCollectionMethod,
  MetadataCoverage,
  MetadataFrequency,
  MetadataValidationStatus,
  MetadataVariableDataType,
  OpdDynamicSheet,
} from '../types/satuData';

interface MetadataSektoralViewProps {
  role: 'super_admin' | 'opd';
  actorEmail: string;
  defaultWalidata: string;
  sheets: OpdDynamicSheet[];
  metadataBySheet: Record<string, DatasetMetadata>;
  onMetadataSaved: (sheetId: string, metadata: DatasetMetadata) => void;
}

const FREQUENCY_OPTIONS: MetadataFrequency[] = [
  'Harian',
  'Mingguan',
  'Bulanan',
  'Triwulanan',
  'Semesteran',
  'Tahunan',
  'Ad-Hoc',
];

const COVERAGE_OPTIONS: MetadataCoverage[] = [
  'Kabupaten',
  'Kecamatan',
  'Desa/Kelurahan',
  'Fasilitas/Unit',
];

const ACCESS_OPTIONS: MetadataAccessLevel[] = [
  'Terbuka (Publik)',
  'Terbatas (Internal OPD)',
  'Rahasia (PII Terproteksi)',
];

const METHOD_OPTIONS: MetadataCollectionMethod[] = [
  'Kompilasi Administrasi',
  'Survei',
  'Sensus',
  'Pendataan Lapangan',
  'Integrasi Sistem',
];

const VALIDATION_OPTIONS: MetadataValidationStatus[] = [
  'Belum Diverifikasi',
  'Perlu Revisi',
  'Terverifikasi Walidata',
];

const VAR_TYPE_OPTIONS: MetadataVariableDataType[] = [
  'Teks',
  'Angka',
  'Tanggal',
  'Persentase',
  'Kode Wilayah',
  'Koordinat',
];

export function MetadataSektoralView({
  role,
  actorEmail,
  defaultWalidata,
  sheets,
  metadataBySheet,
  onMetadataSaved,
}: MetadataSektoralViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [opdFilter, setOpdFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MetadataValidationStatus>('ALL');
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(
    () => sheets[0]?.id ?? null
  );
  const [editorTab, setEditorTab] = useState<'kegiatan' | 'variabel'>('kegiatan');
  const [draft, setDraft] = useState<DatasetMetadata | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const selectedSheet = useMemo(
    () => sheets.find((s) => s.id === selectedSheetId) ?? null,
    [sheets, selectedSheetId]
  );

  // Muat draft metadata setiap kali dataset yang dipilih berubah
  useEffect(() => {
    if (!selectedSheet) {
      setDraft(null);
      return;
    }
    const existing =
      metadataBySheet[selectedSheet.id] ||
      createDefaultDatasetMetadata(selectedSheet, defaultWalidata);
    setDraft(syncMetadataVariablesWithHeaders(existing, selectedSheet.headers));
    setFeedback(null);
  }, [selectedSheet, metadataBySheet, defaultWalidata]);

  const uniqueOpds = useMemo(
    () => Array.from(new Set(sheets.map((s) => s.namaOpd))).sort(),
    [sheets]
  );

  const filteredSheets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sheets.filter((sheet) => {
      const meta = metadataBySheet[sheet.id];
      const status = meta?.statusValidasi ?? 'Belum Diverifikasi';
      if (opdFilter !== 'ALL' && sheet.namaOpd !== opdFilter) return false;
      if (statusFilter !== 'ALL' && status !== statusFilter) return false;
      if (!q) return true;
      return (
        sheet.judulDataset.toLowerCase().includes(q) ||
        sheet.namaOpd.toLowerCase().includes(q) ||
        (meta?.kodeReferensi || '').toLowerCase().includes(q) ||
        (meta?.urusanPemerintahan || '').toLowerCase().includes(q)
      );
    });
  }, [sheets, metadataBySheet, searchQuery, opdFilter, statusFilter]);

  // Ringkasan KPI kelengkapan metadata
  const kpiStats = useMemo(() => {
    let verifiedCount = 0;
    let completeCount = 0;
    let totalScore = 0;

    for (const s of sheets) {
      const m = metadataBySheet[s.id];
      const { score } = computeMetadataCompleteness(m, s.headers.length);
      totalScore += score;
      if (score >= 80) completeCount += 1;
      if (m?.statusValidasi === 'Terverifikasi Walidata') verifiedCount += 1;
    }

    const avgScore =
      sheets.length > 0 ? Math.round(totalScore / sheets.length) : 0;

    return {
      total: sheets.length,
      verifiedCount,
      completeCount,
      avgScore,
    };
  }, [sheets, metadataBySheet]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSheet || !draft) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await saveDatasetMetadata(
        selectedSheet.id,
        draft,
        actorEmail,
        role
      );
      if (res.ok) {
        onMetadataSaved(selectedSheet.id, res.metadata);
        setFeedback({ type: 'success', text: res.message });
      } else {
        setFeedback({ type: 'error', text: res.message });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAutoSyncHeaders = () => {
    if (!selectedSheet || !draft) return;
    setDraft(syncMetadataVariablesWithHeaders(draft, selectedSheet.headers));
    setFeedback({
      type: 'success',
      text: `${selectedSheet.headers.length} variabel berhasil disinkronkan dari header baris 1 Google Sheet.`,
    });
  };

  const updateVarField = (
    idx: number,
    patch: Partial<DatasetMetadata['variabel'][number]>
  ) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const nextVars = prev.variabel.map((v, i) =>
        i === idx ? { ...v, ...patch } : v
      );
      return { ...prev, variabel: nextVars };
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Metadata Statistik Sektoral (MS-Kegiatan &amp; MS-Variabel)
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Standar dokumentasi dataset sesuai prinsip{' '}
            <span className="font-medium text-slate-800">
              Satu Data Indonesia (Perpres 39/2019)
            </span>
            . Setiap Google Sheet OPD dilengkapi identitas produsen data,
            frekuensi pemutakhiran, cakupan wilayah, serta kamus variabel
            otomatis dari header baris 1.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={sheets.length === 0}
            onClick={() => exportMetadataCatalogToCsv(sheets, metadataBySheet)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Ekspor CSV Katalog
          </button>
          <button
            type="button"
            disabled={sheets.length === 0}
            onClick={() => exportMetadataCatalogToJson(sheets, metadataBySheet)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            <FileJson className="w-3.5 h-3.5 text-teal-400" />
            Ekspor JSON-SDI
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Total Dataset Terdaftar</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {kpiStats.total}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Rata-Rata Kelengkapan</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-teal-700">
            {kpiStats.avgScore}%
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Metadata Siap (&ge;80%)</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {kpiStats.completeCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Terverifikasi Walidata</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-emerald-700">
            {kpiStats.verifiedCount}
          </p>
        </div>
      </div>

      {/* Tabel Direktori Metadata */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex flex-col md:flex-row md:items-center gap-2.5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari judul dataset, kode referensi, urusan, atau OPD..."
              className="w-full h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            />
          </div>
          {role === 'super_admin' && (
            <select
              value={opdFilter}
              onChange={(e) => setOpdFilter(e.target.value)}
              aria-label="Filter OPD"
              className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            >
              <option value="ALL">Semua OPD ({uniqueOpds.length})</option>
              {uniqueOpds.map((opd) => (
                <option key={opd} value={opd}>
                  {opd}
                </option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'ALL' | MetadataValidationStatus)
            }
            aria-label="Filter Status Validasi"
            className="h-8 px-2.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
          >
            <option value="ALL">Semua Status Validasi</option>
            {VALIDATION_OPTIONS.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {sheets.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Belum ada Google Sheet dataset yang terdaftar untuk dilengkapi
            metadatanya.
          </div>
        ) : filteredSheets.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Tidak ada dataset yang cocok dengan filter pencarian.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
                  <th className="py-2.5 px-4">Dataset &amp; Kode</th>
                  <th className="py-2.5 px-3">Produsen Data (OPD)</th>
                  <th className="py-2.5 px-3">Frekuensi &amp; Cakupan</th>
                  <th className="py-2.5 px-3">Kelengkapan</th>
                  <th className="py-2.5 px-3">Status Validasi</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredSheets.map((sheet) => {
                  const meta = metadataBySheet[sheet.id];
                  const { score } = computeMetadataCompleteness(
                    meta,
                    sheet.headers.length
                  );
                  const status: MetadataValidationStatus =
                    meta?.statusValidasi ?? 'Belum Diverifikasi';
                  const isSelected = selectedSheetId === sheet.id;

                  return (
                    <tr
                      key={sheet.id}
                      className={`transition-colors ${
                        isSelected ? 'bg-teal-50/50' : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-start gap-2">
                          <FileSpreadsheet className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate max-w-[260px]">
                              {sheet.judulDataset}
                            </p>
                            <p className="text-[11px] font-mono text-slate-500">
                              {meta?.kodeReferensi || 'Belum berkode'} ·{' '}
                              {sheet.headers.length} variabel
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        <p className="font-medium truncate max-w-[200px]">
                          {meta?.produsenData || sheet.namaOpd}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate max-w-[200px]">
                          {meta?.urusanPemerintahan || 'Urusan belum diisi'}
                        </p>
                      </td>
                      <td className="py-3 px-3 text-slate-700 whitespace-nowrap">
                        <p>{meta?.frekuensiPemutakhiran || 'Tahunan'}</p>
                        <p className="text-[11px] text-slate-500">
                          {meta?.cakupanWilayah || 'Kabupaten'} ·{' '}
                          {meta?.tahunData || new Date().getFullYear()}
                        </p>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2 min-w-[110px]">
                          <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                score >= 80
                                  ? 'bg-emerald-600'
                                  : score >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-slate-400'
                              }`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                          <span className="font-mono tabular-nums text-[11px] font-medium text-slate-700 w-8 text-right">
                            {score}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        {status === 'Terverifikasi Walidata' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                            <CheckCircle2 className="w-3 h-3" />
                            Terverifikasi
                          </span>
                        ) : status === 'Perlu Revisi' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-red-50 text-red-700 border border-red-200 rounded">
                            <Clock className="w-3 h-3" />
                            Perlu Revisi
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium bg-amber-50 text-amber-800 border border-amber-200 rounded">
                            <Clock className="w-3 h-3" />
                            Belum Diverifikasi
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedSheetId(sheet.id)}
                          className={`inline-flex items-center gap-1 h-7 px-2.5 text-[11px] font-medium rounded border transition-colors ${
                            isSelected
                              ? 'bg-[#0B1B2B] text-white border-[#0B1B2B]'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          {isSelected ? 'Sedang Diedit' : 'Kelola Metadata'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Panel Editor Metadata Aktif */}
      {selectedSheet && draft && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0B1B2B] text-white">
            <div className="flex items-start gap-2.5 min-w-0">
              <ClipboardList className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">
                  Editor Metadata: {selectedSheet.judulDataset}
                </h2>
                <p className="text-xs text-slate-300 truncate">
                  {selectedSheet.namaOpd} · Tab: {selectedSheet.sheetName} ·{' '}
                  {selectedSheet.headers.length} kolom terdeteksi
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() =>
                  exportMetadataCatalogToJson(
                    [selectedSheet],
                    { [selectedSheet.id]: draft },
                    `metadata-${selectedSheet.judulDataset
                      .toLowerCase()
                      .replace(/[^a-z0-9]+/g, '-')}.json`
                  )
                }
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-100 bg-white/10 hover:bg-white/20 rounded-md"
              >
                <FileJson className="w-3.5 h-3.5 text-teal-300" />
                Unduh JSON
              </button>
              <button
                type="button"
                onClick={() => setSelectedSheetId(null)}
                className="p-1.5 text-slate-300 hover:text-white rounded-md"
                aria-label="Tutup editor metadata"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Sub-Tab Selector */}
          <div className="px-5 pt-3 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50/60">
            <div className="flex items-center gap-1" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={editorTab === 'kegiatan'}
                onClick={() => setEditorTab('kegiatan')}
                className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors ${
                  editorTab === 'kegiatan'
                    ? 'border-teal-700 text-teal-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                1. MS-Kegiatan &amp; Identitas Dataset
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={editorTab === 'variabel'}
                onClick={() => setEditorTab('variabel')}
                className={`px-3.5 py-2 text-xs font-medium border-b-2 transition-colors ${
                  editorTab === 'variabel'
                    ? 'border-teal-700 text-teal-800'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                2. MS-Variabel / Kamus Kolom ({draft.variabel.length})
              </button>
            </div>

            {editorTab === 'variabel' && (
              <button
                type="button"
                onClick={handleAutoSyncHeaders}
                className="mb-1.5 inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-medium text-teal-800 bg-teal-50 border border-teal-200 rounded hover:bg-teal-100"
              >
                <Sparkles className="w-3 h-3" />
                Sinkronkan dari Header Sheet
              </button>
            )}
          </div>

          <form onSubmit={handleSave} className="p-5 space-y-5">
            {editorTab === 'kegiatan' ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Kode Referensi Dataset
                    </label>
                    <input
                      type="text"
                      value={draft.kodeReferensi}
                      onChange={(e) =>
                        setDraft({ ...draft, kodeReferensi: e.target.value })
                      }
                      placeholder="Contoh: SDI-KES-001"
                      className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Urusan Pemerintahan / Sektor
                    </label>
                    <input
                      type="text"
                      value={draft.urusanPemerintahan}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          urusanPemerintahan: e.target.value,
                        })
                      }
                      placeholder="Contoh: Kesehatan / Pekerjaan Umum"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tahun / Periode Data
                    </label>
                    <input
                      type="text"
                      value={draft.tahunData}
                      onChange={(e) =>
                        setDraft({ ...draft, tahunData: e.target.value })
                      }
                      placeholder="Contoh: 2026 atau 2021-2026"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Produsen Data (OPD)
                    </label>
                    <input
                      type="text"
                      value={draft.produsenData}
                      onChange={(e) =>
                        setDraft({ ...draft, produsenData: e.target.value })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Walidata
                    </label>
                    <input
                      type="text"
                      value={draft.walidata}
                      onChange={(e) =>
                        setDraft({ ...draft, walidata: e.target.value })
                      }
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Kontak PIC / Email Produsen
                    </label>
                    <input
                      type="text"
                      value={draft.kontakPic}
                      onChange={(e) =>
                        setDraft({ ...draft, kontakPic: e.target.value })
                      }
                      placeholder="Nama atau email PIC OPD"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Frekuensi Pemutakhiran
                    </label>
                    <select
                      value={draft.frekuensiPemutakhiran}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          frekuensiPemutakhiran: e.target
                            .value as MetadataFrequency,
                        })
                      }
                      className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    >
                      {FREQUENCY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Cakupan Wilayah
                    </label>
                    <select
                      value={draft.cakupanWilayah}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          cakupanWilayah: e.target.value as MetadataCoverage,
                        })
                      }
                      className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    >
                      {COVERAGE_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Tingkat Keterbukaan
                    </label>
                    <select
                      value={draft.tingkatAkses}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          tingkatAkses: e.target.value as MetadataAccessLevel,
                        })
                      }
                      className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    >
                      {ACCESS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Metodologi Pengumpulan
                    </label>
                    <select
                      value={draft.metodologiPengumpulan}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          metodologiPengumpulan: e.target
                            .value as MetadataCollectionMethod,
                        })
                      }
                      className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    >
                      {METHOD_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Satuan Pengukuran Utama
                    </label>
                    <input
                      type="text"
                      value={draft.satuanPengukuran}
                      onChange={(e) =>
                        setDraft({ ...draft, satuanPengukuran: e.target.value })
                      }
                      placeholder="Contoh: Jiwa, Km, Unit, Ton, Rupiah"
                      className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Konsep, Definisi &amp; Penjelasan Indikator
                    </label>
                    <textarea
                      rows={2}
                      value={draft.konsepDefinisi}
                      onChange={(e) =>
                        setDraft({ ...draft, konsepDefinisi: e.target.value })
                      }
                      placeholder="Jelaskan definisi operasional, ruang lingkup, dan manfaat dataset ini..."
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>

                {/* Panel Validasi Walidata */}
                <div className="p-4 rounded-md border border-slate-200 bg-slate-50 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-teal-700" />
                    <span>Verifikasi &amp; Catatan Walidata</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Status Validasi
                      </label>
                      {role === 'super_admin' ? (
                        <select
                          value={draft.statusValidasi}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              statusValidasi: e.target
                                .value as MetadataValidationStatus,
                            })
                          }
                          className="w-full h-9 px-2.5 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                        >
                          {VALIDATION_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="h-9 px-3 flex items-center text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md">
                          {draft.statusValidasi}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Catatan Pemeriksaan Walidata
                      </label>
                      {role === 'super_admin' ? (
                        <input
                          type="text"
                          value={draft.catatanWalidata}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              catatanWalidata: e.target.value,
                            })
                          }
                          placeholder="Catatan revisi atau persetujuan standar metadata..."
                          className="w-full h-9 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                        />
                      ) : (
                        <div className="min-h-9 px-3 py-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-md">
                          {draft.catatanWalidata ||
                            'Belum ada catatan dari Walidata.'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {draft.variabel.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-300 rounded-md">
                    Header kolom baris 1 belum terdeteksi pada Google Sheet ini.
                    Lakukan sinkronisasi sheet terlebih dahulu, lalu klik{' '}
                    <span className="font-semibold">
                      Sinkronkan dari Header Sheet
                    </span>
                    .
                  </div>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-md">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                          <th className="py-2 px-3 w-10">#</th>
                          <th className="py-2 px-3 min-w-[160px]">
                            Nama Kolom / Variabel
                          </th>
                          <th className="py-2 px-3 min-w-[240px]">
                            Definisi Variabel
                          </th>
                          <th className="py-2 px-3 w-[140px]">Tipe Data</th>
                          <th className="py-2 px-3 w-[120px]">Satuan</th>
                          <th className="py-2 px-3 w-[80px] text-center">
                            Wajib
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {draft.variabel.map((v, idx) => (
                          <tr key={`${v.namaKolom}-${idx}`}>
                            <td className="py-2 px-3 font-mono text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-3 font-mono font-medium text-slate-900">
                              {v.namaKolom}
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={v.definisi}
                                onChange={(e) =>
                                  updateVarField(idx, {
                                    definisi: e.target.value,
                                  })
                                }
                                placeholder={`Definisi kolom ${v.namaKolom}`}
                                className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                              />
                            </td>
                            <td className="py-2 px-3">
                              <select
                                value={v.tipeData}
                                onChange={(e) =>
                                  updateVarField(idx, {
                                    tipeData: e.target
                                      .value as MetadataVariableDataType,
                                  })
                                }
                                className="w-full h-8 px-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                              >
                                {VAR_TYPE_OPTIONS.map((t) => (
                                  <option key={t} value={t}>
                                    {t}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="py-2 px-3">
                              <input
                                type="text"
                                value={v.satuan}
                                onChange={(e) =>
                                  updateVarField(idx, {
                                    satuan: e.target.value,
                                  })
                                }
                                placeholder="Km / Jiwa / %"
                                className="w-full h-8 px-2.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-slate-900"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={v.wajibDiisi}
                                onChange={(e) =>
                                  updateVarField(idx, {
                                    wajibDiisi: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 accent-teal-700"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Footer Save Bar */}
            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[200px]">
                {feedback ? (
                  <div
                    className={`px-3 py-2 text-xs rounded-md border ${
                      feedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}
                  >
                    {feedback.text}
                  </div>
                ) : draft.diperbaruiPada ? (
                  <p className="text-[11px] text-slate-500">
                    Terakhir diperbarui:{' '}
                    <span className="font-mono">
                      {new Date(draft.diperbaruiPada).toLocaleString('id-ID')}
                    </span>
                    {draft.diperbaruiOleh ? ` oleh ${draft.diperbaruiOleh}` : ''}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Menyimpan Metadata...' : 'Simpan Metadata Dataset'}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
