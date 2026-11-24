import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  FileJson,
  FileText,
  Filter,
  Globe,
  RefreshCw,
  Search,
  ShieldCheck,
  Table as TableIcon,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  fetchPublicCatalog,
  fetchPublicCatalogDetail,
  PublicCatalogDataset,
  PublicCatalogListResponse,
} from '../services/cloudflareWafService';
import { exportDynamicRowsToCsv } from '../services/dynamicSheetService';
import { RegencyWhiteLabelConfig } from '../services/regencyConfigService';
import { DynamicSheetRow } from '../types/satuData';

interface PublicCatalogViewProps {
  regencyConfig: RegencyWhiteLabelConfig;
  onGoToLogin: () => void;
}

export function PublicCatalogView({
  regencyConfig,
  onGoToLogin,
}: PublicCatalogViewProps) {
  const [query, setQuery] = useState('');
  const [selectedOpd, setSelectedOpd] = useState('');
  const [selectedUrusan, setSelectedUrusan] = useState('');
  const [selectedTahun, setSelectedTahun] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<PublicCatalogListResponse | null>(null);

  // Selected dataset explorer
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDataset, setSelectedDataset] =
    useState<PublicCatalogDataset | null>(null);
  const [explorerTab, setExplorerTab] = useState<'table' | 'chart' | 'metadata'>(
    'table'
  );
  const [rowSearch, setRowSearch] = useState('');
  const [chartColumn, setChartColumn] = useState('');

  const loadCatalog = async () => {
    setLoading(true);
    try {
      const res = await fetchPublicCatalog({
        q: query.trim() || undefined,
        opd: selectedOpd || undefined,
        urusan: selectedUrusan || undefined,
        tahun: selectedTahun || undefined,
      });
      setCatalog(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog();
    }, 150);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, selectedOpd, selectedUrusan, selectedTahun]);

  const handleOpenDataset = async (ds: PublicCatalogDataset) => {
    setSelectedSlug(ds.slug);
    setExplorerTab('table');
    setRowSearch('');
    setDetailLoading(true);
    try {
      const full = await fetchPublicCatalogDetail(ds.slug);
      const resolved = full || ds;
      setSelectedDataset(resolved);
      const firstTextCol =
        resolved.headers.find(
          (h) => !/^(tahun|jumlah|total|nilai|luas|persen|anggaran)/i.test(h)
        ) ||
        resolved.headers[0] ||
        '';
      setChartColumn(firstTextCol);
    } finally {
      setDetailLoading(false);
    }
  };

  const previewRows = useMemo(
    () => selectedDataset?.previewRows ?? [],
    [selectedDataset]
  );

  const filteredPreviewRows = useMemo(() => {
    const q = rowSearch.trim().toLowerCase();
    if (!q) return previewRows;
    return previewRows.filter((r) =>
      Object.values(r.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [previewRows, rowSearch]);

  const chartDistribution = useMemo(() => {
    if (!selectedDataset || !chartColumn || previewRows.length === 0) {
      return [];
    }
    const counts = new Map<string, number>();
    for (const r of previewRows) {
      const raw = String(r.values[chartColumn] ?? '').trim() || '(Kosong)';
      counts.set(raw, (counts.get(raw) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [selectedDataset, chartColumn, previewRows]);

  const handleDownloadCsv = () => {
    if (!selectedDataset) return;
    const rowsAsDynamic: DynamicSheetRow[] = filteredPreviewRows.map((r) => ({
      _id: r._id,
      _updatedAt: r._updatedAt,
      values: r.values,
    }));
    exportDynamicRowsToCsv(
      selectedDataset.headers,
      rowsAsDynamic,
      `${selectedDataset.slug}.csv`
    );
  };

  const handleDownloadJsonSdi = () => {
    if (!selectedDataset) return;
    const payload = {
      portal: regencyConfig.namaPortal,
      kabupaten: regencyConfig.namaKabupaten,
      walidata: selectedDataset.walidata,
      metadata: {
        kodeReferensi: selectedDataset.kodeReferensi,
        judulDataset: selectedDataset.judulDataset,
        deskripsi: selectedDataset.deskripsi,
        produsenData: selectedDataset.produsenData,
        urusanPemerintahan: selectedDataset.urusanPemerintahan,
        tahunData: selectedDataset.tahunData,
        frekuensiPemutakhiran: selectedDataset.frekuensiPemutakhiran,
        cakupanWilayah: selectedDataset.cakupanWilayah,
        metodologiPengumpulan: selectedDataset.metodologiPengumpulan,
        satuanPengukuran: selectedDataset.satuanPengukuran,
        variabel: selectedDataset.variabel,
        diperbaruiPada: selectedDataset.diperbaruiPada,
      },
      headers: selectedDataset.headers,
      totalBaris: filteredPreviewRows.length,
      data: filteredPreviewRows.map((r) => r.values),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedDataset.slug}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasActiveFilter = Boolean(
    query.trim() || selectedOpd || selectedUrusan || selectedTahun
  );

  return (
    <div className="space-y-6">
      {/* Citizen Showcase Hero + Search */}
      <section className="bg-[#0B1B2B] text-white rounded-lg border border-slate-800 p-6 sm:p-8 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-300">
              <Globe className="w-3.5 h-3.5" />
              Etalase Data Publik Terbuka · {regencyConfig.namaKabupaten}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Katalog Pencarian Data Publik {regencyConfig.namaPortal}
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Telusuri, visualisasikan, dan unduh dataset resmi terverifikasi
              Walidata ({regencyConfig.namaWalidata}) tanpa perlu login. Kolom
              data pribadi (PII seperti NIK, No. HP, Alamat) serta tautan
              internal OPD disaring otomatis di server.
            </p>
          </div>

          <button
            type="button"
            onClick={onGoToLogin}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-900 bg-white rounded-md hover:bg-slate-100 shrink-0 self-start"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Masuk Portal OPD / Admin
          </button>
        </div>

        {/* Search & Faceted Filters */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari judul dataset, dinas, urusan, atau nama kolom..."
              aria-label="Cari dataset publik"
              className="w-full h-10 pl-9 pr-3 text-sm text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          <div className="md:col-span-3">
            <select
              aria-label="Filter Produsen Data OPD"
              value={selectedOpd}
              onChange={(e) => setSelectedOpd(e.target.value)}
              className="w-full h-10 px-3 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none"
            >
              <option value="">Semua Produsen / OPD</option>
              {(catalog?.facets.opdList ?? []).map((opd) => (
                <option key={opd} value={opd}>
                  {opd}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              aria-label="Filter Urusan Pemerintahan"
              value={selectedUrusan}
              onChange={(e) => setSelectedUrusan(e.target.value)}
              className="w-full h-10 px-3 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none"
            >
              <option value="">Semua Urusan</option>
              {(catalog?.facets.urusanList ?? []).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2 flex gap-2">
            <select
              aria-label="Filter Tahun Data"
              value={selectedTahun}
              onChange={(e) => setSelectedTahun(e.target.value)}
              className="flex-1 h-10 px-3 text-xs font-medium text-slate-900 bg-white border border-slate-200 rounded-md focus:outline-none"
            >
              <option value="">Semua Tahun</option>
              {(catalog?.facets.tahunList ?? []).map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setSelectedOpd('');
                  setSelectedUrusan('');
                  setSelectedTahun('');
                }}
                title="Reset filter"
                className="h-10 px-2.5 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Metrics & Open Interoperability Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800 text-xs text-slate-300">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-teal-400" />
              <strong className="font-mono tabular-nums text-white">
                {catalog?.totalDatasets ?? 0}
              </strong>{' '}
              dataset publik terverifikasi
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              Zero PII · Standar Satu Data Indonesia (Perpres 39/2019)
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px]">
            <a
              href="/api/public/dcat.json"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-300 hover:text-teal-200 underline decoration-teal-700 font-mono"
            >
              DCAT.json
            </a>
            <a
              href="/api/public/ckan/package_list"
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-300 hover:text-teal-200 underline decoration-teal-700 font-mono"
            >
              CKAN API v3
            </a>
          </div>
        </div>
      </section>

      {/* Dataset Explorer Panel when Selected */}
      {selectedSlug && selectedDataset && (
        <section className="bg-white border border-slate-300 rounded-lg overflow-hidden shadow-xs">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {selectedDataset.sourceType === 'kominfo_clone'
                    ? 'Publikasi Resmi Kominfo'
                    : 'Terverifikasi Walidata'}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600 font-medium">
                  {selectedDataset.produsenData}
                </span>
                {selectedDataset.tahunData && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-600">
                      Tahun {selectedDataset.tahunData}
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-lg font-semibold text-slate-900">
                {selectedDataset.judulDataset}
              </h2>
              {selectedDataset.deskripsi && (
                <p className="text-xs text-slate-600 max-w-4xl">
                  {selectedDataset.deskripsi}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={selectedDataset.headers.length === 0}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh CSV
              </button>
              <button
                type="button"
                onClick={handleDownloadJsonSdi}
                className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                <FileJson className="w-3.5 h-3.5" />
                Unduh JSON-SDI
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedSlug(null);
                  setSelectedDataset(null);
                }}
                className="inline-flex items-center gap-1 h-9 px-2.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                aria-label="Tutup pratinjau dataset"
              >
                <X className="w-4 h-4" />
                Tutup
              </button>
            </div>
          </div>

          {/* Explorer Tabs */}
          <div className="px-6 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setExplorerTab('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded ${
                  explorerTab === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                Tabel Data ({filteredPreviewRows.length})
              </button>
              <button
                type="button"
                onClick={() => setExplorerTab('chart')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded ${
                  explorerTab === 'chart'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" />
                Grafik Ringkas
              </button>
              <button
                type="button"
                onClick={() => setExplorerTab('metadata')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded ${
                  explorerTab === 'metadata'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Metadata SDI
              </button>
            </div>

            {explorerTab === 'table' && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={rowSearch}
                  onChange={(e) => setRowSearch(e.target.value)}
                  placeholder="Saring isi tabel..."
                  className="h-8 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900 w-56"
                />
              </div>
            )}
          </div>

          <div className="p-6">
            {detailLoading ? (
              <div className="py-10 text-center text-xs text-slate-500 inline-flex items-center justify-center gap-2 w-full">
                <RefreshCw className="w-4 h-4 animate-spin" />
                Memuat dataset publik terverifikasi...
              </div>
            ) : explorerTab === 'table' ? (
              selectedDataset.headers.length === 0 ||
              filteredPreviewRows.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  {previewRows.length === 0
                    ? 'Dataset ini terdaftar terverifikasi namun belum memiliki baris data pratinjau yang disinkronkan oleh Walidata.'
                    : 'Tidak ada baris yang cocok dengan kata kunci pencarian Anda.'}
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-md max-h-[460px]">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                      <tr className="text-[11px] font-semibold text-slate-600">
                        <th className="py-2.5 px-3 w-10 text-right font-mono">
                          #
                        </th>
                        {selectedDataset.headers.map((h) => (
                          <th key={h} className="py-2.5 px-3 whitespace-nowrap">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPreviewRows.slice(0, 200).map((row, idx) => (
                        <tr key={row._id} className="hover:bg-slate-50">
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                            {idx + 1}
                          </td>
                          {selectedDataset.headers.map((h) => (
                            <td
                              key={h}
                              className="py-2 px-3 text-slate-800 whitespace-nowrap max-w-[260px] truncate"
                              title={row.values[h] ?? ''}
                            >
                              {row.values[h] || '—'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : explorerTab === 'chart' ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">
                      Distribusi Frekuensi Nilai Kolom
                    </h3>
                    <p className="text-xs text-slate-500">
                      Ringkasan cepat berdasarkan maksimum 12 kategori terbanyak.
                    </p>
                  </div>
                  <select
                    aria-label="Pilih kolom untuk grafik"
                    value={chartColumn}
                    onChange={(e) => setChartColumn(e.target.value)}
                    className="h-9 px-3 text-xs font-medium bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                  >
                    {selectedDataset.headers.map((h) => (
                      <option key={h} value={h}>
                        Kolom: {h}
                      </option>
                    ))}
                  </select>
                </div>

                {chartDistribution.length === 0 ? (
                  <p className="py-10 text-center text-xs text-slate-500">
                    Belum tersedia baris data untuk divisualisasikan.
                  </p>
                ) : (
                  <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartDistribution}
                        margin={{ top: 10, right: 16, left: 0, bottom: 32 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                        <XAxis
                          dataKey="name"
                          tick={{ fontSize: 11, fill: '#475569' }}
                          interval={0}
                          angle={-15}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: '#475569' }}
                        />
                        <Tooltip />
                        <Bar
                          dataKey="value"
                          name="Jumlah Baris"
                          fill="#0F766E"
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                  {[
                    {
                      label: 'Kode Referensi SDI',
                      value: selectedDataset.kodeReferensi || '—',
                    },
                    {
                      label: 'Produsen Data (OPD)',
                      value: selectedDataset.produsenData || '—',
                    },
                    {
                      label: 'Walidata',
                      value: selectedDataset.walidata || '—',
                    },
                    {
                      label: 'Urusan Pemerintahan',
                      value: selectedDataset.urusanPemerintahan || '—',
                    },
                    {
                      label: 'Tahun Data',
                      value: selectedDataset.tahunData || '—',
                    },
                    {
                      label: 'Frekuensi Pemutakhiran',
                      value: selectedDataset.frekuensiPemutakhiran || '—',
                    },
                    {
                      label: 'Cakupan Wilayah',
                      value: selectedDataset.cakupanWilayah || '—',
                    },
                    {
                      label: 'Metodologi',
                      value: selectedDataset.metodologiPengumpulan || '—',
                    },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="p-3 bg-slate-50 border border-slate-200 rounded-md"
                    >
                      <p className="text-[11px] text-slate-500">{m.label}</p>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {m.value}
                      </p>
                    </div>
                  ))}
                </div>

                {selectedDataset.variabel.length > 0 && (
                  <div className="border border-slate-200 rounded-md overflow-hidden">
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-800">
                      Kamus Variabel (MS-Variabel)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-slate-200 text-[11px] text-slate-500 bg-white">
                            <th className="py-2 px-3">Nama Kolom</th>
                            <th className="py-2 px-3">Tipe</th>
                            <th className="py-2 px-3">Satuan</th>
                            <th className="py-2 px-3">Definisi Operasional</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedDataset.variabel.map((v) => (
                            <tr key={v.namaKolom}>
                              <td className="py-2 px-3 font-mono font-medium text-slate-900">
                                {v.namaKolom}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {v.tipeData}
                              </td>
                              <td className="py-2 px-3 text-slate-600">
                                {v.satuan || '—'}
                              </td>
                              <td className="py-2 px-3 text-slate-700">
                                {v.definisi || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Dataset Results Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>
              Menampilkan{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {catalog?.datasets.length ?? 0}
              </strong>{' '}
              dataset publik terverifikasi
            </span>
          </div>

          <button
            type="button"
            onClick={() => void loadCatalog()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Segarkan Katalog
          </button>
        </div>

        {loading && !catalog ? (
          <div className="bg-white border border-slate-200 rounded-lg p-12 text-center text-xs text-slate-500">
            Memuat katalog data publik...
          </div>
        ) : !catalog || catalog.datasets.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
            <Database className="w-9 h-9 text-slate-300 mx-auto" />
            <h2 className="text-base font-semibold text-slate-900">
              {hasActiveFilter
                ? 'Tidak Ada Dataset yang Cocok dengan Pencarian'
                : 'Belum Ada Dataset Publik yang Disinkronkan ke Etalase Warga'}
            </h2>
            <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed">
              {hasActiveFilter
                ? 'Coba ubah kata kunci pencarian atau reset filter Dinas/Urusan/Tahun.'
                : 'Demi kepatuhan Satu Data Indonesia & perlindungan data pribadi (UU PDP), hanya dataset dengan status Metadata "Terverifikasi Walidata" dan akses "Terbuka (Publik)" (atau Publikasi Kominfo berstatus "Dipublikasikan") yang ditampilkan di sini setelah Walidata menekan tombol Sinkronkan Feed Publik di menu Konfigurasi.'}
            </p>
            <div className="pt-1 flex flex-wrap justify-center gap-2">
              {hasActiveFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setSelectedOpd('');
                    setSelectedUrusan('');
                    setSelectedTahun('');
                  }}
                  className="h-9 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Reset Filter
                </button>
              )}
              <button
                type="button"
                onClick={onGoToLogin}
                className="h-9 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800"
              >
                Masuk sebagai Walidata / OPD
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.datasets.map((ds) => {
              const isSelected = selectedSlug === ds.slug;
              return (
                <article
                  key={ds.id}
                  className={`bg-white border rounded-lg p-5 flex flex-col justify-between gap-4 transition-colors ${
                    isSelected
                      ? 'border-teal-600 ring-1 ring-teal-600'
                      : 'border-slate-200 hover:border-slate-400'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {ds.sourceType === 'kominfo_clone'
                          ? 'Publikasi Kominfo'
                          : 'Terverifikasi Walidata'}
                      </span>
                      <span className="font-mono text-slate-500">
                        {ds.tahunData || '—'}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 leading-snug">
                        {ds.judulDataset}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-teal-700">
                        {ds.produsenData}
                      </p>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {ds.deskripsi ||
                        `Dataset resmi ${ds.urusanPemerintahan || 'sektoral'} dari ${ds.produsenData}.`}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="text-[11px] font-mono tabular-nums text-slate-500">
                      {ds.headers.length} kolom ·{' '}
                      {ds.jumlahBaris.toLocaleString('id-ID')} baris
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenDataset(ds)}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800"
                    >
                      Lihat Data
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
