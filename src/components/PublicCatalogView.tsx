import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Compass,
  Database,
  Download,
  FileJson,
  FileText,
  Filter,
  Globe,
  GraduationCap,
  HandHeart,
  HeartPulse,
  Landmark,
  LineChart,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sprout,
  Table as TableIcon,
  Users,
  Waves,
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
import { OPD_DIRECTORY } from '../config/opdSheets';
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
  registeredAccountsCount?: number;
  registeredSheetsCount?: number;
}

const SECTOR_ICON_MAP: Record<string, typeof Database> = {
  dinkes: HeartPulse,
  disdikbud: GraduationCap,
  distan: Sprout,
  dpupr: Landmark,
  disdukcapil: Users,
  dkp: Waves,
  dispar: Compass,
  dinsos: HandHeart,
  bappelitbangda: LineChart,
  diskominfo: Radio,
};

export function PublicCatalogView({
  regencyConfig,
  registeredAccountsCount = 0,
  registeredSheetsCount = 0,
}: PublicCatalogViewProps) {
  const [query, setQuery] = useState('');
  const [selectedOpd, setSelectedOpd] = useState('');
  const [selectedUrusan, setSelectedUrusan] = useState('');
  const [selectedTahun, setSelectedTahun] = useState('');
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<PublicCatalogListResponse | null>(null);
  const [heroImageFailed, setHeroImageFailed] = useState(false);

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

  const catalogListRef = useRef<HTMLElement | null>(null);
  const explorerRef = useRef<HTMLElement | null>(null);

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
      window.setTimeout(() => {
        explorerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 60);
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

  const resetAllFilters = () => {
    setQuery('');
    setSelectedOpd('');
    setSelectedUrusan('');
    setSelectedTahun('');
  };

  const handleFilterByUrusan = (urusan: string) => {
    setSelectedUrusan((prev) => (prev === urusan ? '' : urusan));
    window.setTimeout(() => {
      catalogListRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 60);
  };

  const handleFilterByOpd = (namaOpd: string) => {
    setSelectedOpd((prev) => (prev === namaOpd ? '' : namaOpd));
    window.setTimeout(() => {
      catalogListRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 60);
  };

  const sectorItems = useMemo(() => {
    const countsByUrusan = new Map<string, number>();
    for (const ds of catalog?.datasets ?? []) {
      const key = (ds.urusanPemerintahan || '').trim();
      if (key) {
        countsByUrusan.set(key, (countsByUrusan.get(key) ?? 0) + 1);
      }
    }
    const items = OPD_DIRECTORY.map((opd) => ({
      id: opd.id,
      urusan: opd.urusan,
      singkatan: opd.singkatan,
      namaOpd: opd.nama,
      icon: SECTOR_ICON_MAP[opd.id] || Database,
      count: countsByUrusan.get(opd.urusan) ?? 0,
    }));

    for (const u of catalog?.facets.urusanList ?? []) {
      if (!items.some((i) => i.urusan.toLowerCase() === u.toLowerCase())) {
        items.push({
          id: `dyn-${u.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          urusan: u,
          singkatan: 'Sektoral',
          namaOpd: 'OPD Teknis Daerah',
          icon: Database,
          count: countsByUrusan.get(u) ?? 0,
        });
      }
    }
    return items;
  }, [catalog]);

  const opdOptions = useMemo(() => {
    const merged = new Set<string>([
      ...OPD_DIRECTORY.map((o) => o.nama),
      ...(catalog?.facets.opdList ?? []),
    ]);
    return Array.from(merged).sort();
  }, [catalog]);

  const urusanOptionsCount = useMemo(() => {
    return sectorItems.length;
  }, [sectorItems]);

  const domainDisplay = regencyConfig.domainResmi.startsWith('data.')
    ? regencyConfig.domainResmi
    : `data.${regencyConfig.domainResmi}`;

  const totalOpdScope = Math.max(OPD_DIRECTORY.length, registeredAccountsCount);

  return (
    <div className="space-y-10">
      {/* 1. Modern Civic Hero + Integrated Unified Command Search */}
      <section className="relative bg-hero-lines text-white rounded-xl border border-slate-800/90 shadow-[0_12px_36px_-16px_rgba(7,19,31,0.5)] overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-stretch">
          {/* Left: Authoritative Header, Mandate & Unified Command Search */}
          <div className="lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-between gap-7">
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-teal-300">
                <Globe className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Portal Resmi Pemerintah {regencyConfig.namaKabupaten}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="text-slate-300">
                  Walidata: {regencyConfig.namaWalidata}
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-[36px] font-semibold tracking-tight leading-[1.15] text-white">
                Pusat Data Terbuka &amp; Informasi Sektoral{' '}
                {regencyConfig.namaPortal}
              </h1>

              <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
                Telusuri, visualisasikan, dan unduh dataset pembangunan resmi
                lintas Organisasi Perangkat Daerah (OPD){' '}
                {regencyConfig.namaKabupaten} tanpa login. Seluruh data
                diverifikasi Walidata sesuai Perpres No. 39 Tahun 2019 dan
                disaring otomatis dari informasi pribadi (UU PDP).
              </p>
            </div>

            {/* Unified Modern Command Search Bar */}
            <div className="space-y-3">
              <div className="bg-white rounded-xl p-1.5 shadow-lg ring-1 ring-white/15">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-1.5 items-center">
                  <div className="md:col-span-5 relative flex items-center">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Cari dataset, dinas, topik, atau kolom..."
                      aria-label="Cari dataset publik"
                      className="w-full h-10 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent rounded-lg focus:outline-none focus:bg-slate-50"
                    />
                  </div>

                  <div className="md:col-span-4 md:border-l md:border-slate-200/80 md:pl-1.5">
                    <select
                      aria-label="Filter Produsen Data OPD"
                      value={selectedOpd}
                      onChange={(e) => setSelectedOpd(e.target.value)}
                      className="w-full h-10 px-2.5 text-xs font-medium text-slate-800 bg-transparent rounded-lg focus:outline-none focus:bg-slate-50"
                    >
                      <option value="">Semua Produsen / OPD</option>
                      {opdOptions.map((opd) => (
                        <option key={opd} value={opd}>
                          {opd}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="md:col-span-3 md:border-l md:border-slate-200/80 md:pl-1.5 flex items-center gap-1.5">
                    <select
                      aria-label="Filter Tahun Data"
                      value={selectedTahun}
                      onChange={(e) => setSelectedTahun(e.target.value)}
                      className="flex-1 h-10 px-2.5 text-xs font-medium text-slate-800 bg-transparent rounded-lg focus:outline-none focus:bg-slate-50"
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
                        onClick={resetAllFilters}
                        title="Reset semua filter"
                        aria-label="Reset semua filter"
                        className="h-9 px-2.5 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 hover:text-slate-900 shrink-0 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-300">
                <span className="text-slate-400">
                  Interoperabilitas Terbuka · {urusanOptionsCount} Bidang Urusan
                </span>
                <div className="flex items-center gap-4">
                  <a
                    href="/api/public/dcat.json"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-300 hover:text-teal-200 underline underline-offset-4 decoration-teal-700/80 font-mono whitespace-nowrap transition-colors"
                  >
                    DCAT.json (W3C)
                  </a>
                  <a
                    href="/api/public/ckan/package_list"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-teal-300 hover:text-teal-200 underline underline-offset-4 decoration-teal-700/80 font-mono whitespace-nowrap transition-colors"
                  >
                    CKAN API v3
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Regional Visual Showcase */}
          <div className="lg:col-span-5 relative min-h-[240px] lg:min-h-full bg-slate-900 border-t lg:border-t-0 lg:border-l border-white/10">
            {!heroImageFailed ? (
              <img
                src="/src/assets/images/banner_nagekeo_civic_1795067180185.jpg"
                alt={`Pusat Pemerintahan ${regencyConfig.namaKabupaten}`}
                referrerPolicy="no-referrer"
                onError={() => setHeroImageFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#07131F] via-[#132F4C] to-[#0F4C5C]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#07131F] via-[#07131F]/45 to-[#07131F]/10" />

            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-teal-300">
                <MapPin className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Pusat Pemerintahan · {regencyConfig.namaKabupaten}
                </span>
              </div>
              <p className="text-lg font-semibold text-white leading-snug">
                Konsolidasi Data Terpadu Lintas{' '}
                {regencyConfig.daftarKecamatan.length} Kecamatan
              </p>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-200 font-mono">
                <span>{domainDisplay}</span>
                <span aria-hidden="true" className="text-slate-500">
                  ·
                </span>
                <span>Zero PII Terverifikasi</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Ringkasan Eksekutif Keterbukaan Data Daerah (Single-Elevation) */}
      <section
        aria-label="Statistik Keterbukaan Data Daerah"
        className="bg-white border border-slate-200/90 rounded-xl shadow-[0_1px_2px_rgba(11,27,43,0.04),0_8px_24px_-14px_rgba(11,27,43,0.08)] overflow-hidden"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/80">
          <div className="p-5 sm:p-6 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">
              Dataset Publik Terverifikasi
            </p>
            <p className="text-2xl sm:text-[28px] font-semibold font-mono tabular-nums text-slate-900 tracking-tight">
              {catalog?.totalDatasets ?? 0}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Siap pratinjau tabel, grafik &amp; unduh CSV / JSON-SDI
            </p>
          </div>

          <div className="p-5 sm:p-6 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">
              OPD Produsen Data
            </p>
            <p className="text-2xl sm:text-[28px] font-semibold font-mono tabular-nums text-slate-900 tracking-tight">
              {totalOpdScope}
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Instansi daerah ·{' '}
              <span className="font-mono tabular-nums">
                {registeredSheetsCount}
              </span>{' '}
              sumber tabel aktif
            </p>
          </div>

          <div className="p-5 sm:p-6 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">
              Cakupan Wilayah Administrasi
            </p>
            <p className="text-2xl sm:text-[28px] font-semibold font-mono tabular-nums text-slate-900 tracking-tight">
              {regencyConfig.daftarKecamatan.length} Kecamatan
            </p>
            <p className="text-xs text-slate-600 truncate leading-relaxed">
              {regencyConfig.daftarKecamatan.slice(0, 4).join(', ')}
              {regencyConfig.daftarKecamatan.length > 4 ? ', dll.' : ''}
            </p>
          </div>

          <div className="p-5 sm:p-6 space-y-1.5">
            <p className="text-xs font-medium text-slate-500">
              Standar Tata Kelola &amp; Privasi
            </p>
            <p className="text-2xl sm:text-[28px] font-semibold font-mono tabular-nums text-teal-700 tracking-tight">
              Perpres 39/2019
            </p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Zero PII (UU PDP) · Feed DCAT &amp; CKAN v3
            </p>
          </div>
        </div>
      </section>

      {/* 3. Selected Dataset Explorer Panel */}
      {selectedSlug && selectedDataset && (
        <section
          ref={explorerRef}
          className="bg-white border border-slate-300 rounded-xl overflow-hidden shadow-[0_4px_20px_-8px_rgba(11,27,43,0.12)]"
        >
          <div className="px-6 py-5 bg-slate-50/80 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {selectedDataset.sourceType === 'kominfo_clone'
                    ? 'Publikasi Resmi Kominfo'
                    : 'Terverifikasi Walidata'}
                </span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-700 font-medium">
                  {selectedDataset.produsenData}
                </span>
                {selectedDataset.tahunData && (
                  <>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono tabular-nums text-slate-600">
                      Tahun {selectedDataset.tahunData}
                    </span>
                  </>
                )}
              </div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                {selectedDataset.judulDataset}
              </h2>
              {selectedDataset.deskripsi && (
                <p className="text-xs sm:text-sm text-slate-600 max-w-4xl leading-relaxed">
                  {selectedDataset.deskripsi}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadCsv}
                disabled={selectedDataset.headers.length === 0}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Unduh CSV
              </button>
              <button
                type="button"
                onClick={handleDownloadJsonSdi}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap transition-colors"
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
                className="inline-flex items-center gap-1 h-9 px-3 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap transition-colors"
                aria-label="Tutup pratinjau dataset"
              >
                <X className="w-4 h-4" />
                Tutup
              </button>
            </div>
          </div>

          {/* Explorer Tabs */}
          <div className="px-6 py-3 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setExplorerTab('table')}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
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
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
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
                  className="h-9 pl-8 pr-3 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-slate-900 w-56 transition-colors"
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
                <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[460px]">
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
                        <tr key={row._id} className="hover:bg-slate-50/80">
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
                    className="h-9 px-3 text-xs font-medium bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-slate-900"
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
                      className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <p className="text-[11px] text-slate-500">{m.label}</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        {m.value}
                      </p>
                    </div>
                  ))}
                </div>

                {selectedDataset.variabel.length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
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

      {/* 4. Jelajahi Berdasarkan Sektor / Urusan Pemerintahan Daerah */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-teal-700">
              Sektor Pembangunan &amp; Urusan Pemerintahan
            </p>
            <h2 className="text-xl font-semibold tracking-tight text-slate-900 mt-0.5">
              Jelajahi Data Berdasarkan Bidang Urusan Daerah
            </h2>
          </div>

          {selectedUrusan && (
            <button
              type="button"
              onClick={() => setSelectedUrusan('')}
              className="text-xs font-medium text-teal-700 hover:text-teal-900 underline underline-offset-4 whitespace-nowrap self-start sm:self-auto"
            >
              Tampilkan Semua Sektor
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {sectorItems.map((sector) => {
            const Icon = sector.icon;
            const isActive =
              selectedUrusan.toLowerCase() === sector.urusan.toLowerCase();
            return (
              <button
                key={sector.id}
                type="button"
                onClick={() => handleFilterByUrusan(sector.urusan)}
                className={`group text-left p-4 rounded-xl border transition-all duration-150 flex flex-col justify-between gap-4 ${
                  isActive
                    ? 'bg-[#0B1B2B] text-white border-[#0B1B2B] shadow-md'
                    : 'bg-white text-slate-900 border-slate-200/90 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                      isActive
                        ? 'bg-teal-500/20 text-teal-300'
                        : 'bg-slate-100 text-slate-700 group-hover:bg-teal-50 group-hover:text-teal-700'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span
                    className={`text-[11px] font-medium ${
                      isActive ? 'text-teal-300' : 'text-slate-500'
                    }`}
                  >
                    {sector.singkatan}
                  </span>
                </div>

                <div className="space-y-2.5">
                  <div className="text-sm font-semibold leading-snug">
                    {sector.urusan}
                  </div>
                  <div
                    className={`text-xs font-mono tabular-nums pt-2.5 border-t flex items-center justify-between ${
                      isActive
                        ? 'border-slate-800 text-slate-300'
                        : 'border-slate-100 text-slate-500'
                    }`}
                  >
                    <span>{sector.count} dataset</span>
                    <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. Katalog Dataset Publik Terverifikasi */}
      <section ref={catalogListRef} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/90">
          <div className="space-y-0.5">
            <h2 className="text-xl font-semibold tracking-tight text-slate-900">
              Daftar Dataset Publik Terverifikasi
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span>
                Menampilkan{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {catalog?.datasets.length ?? 0}
                </strong>{' '}
                dari{' '}
                <strong className="font-mono tabular-nums text-slate-900">
                  {catalog?.totalDatasets ?? 0}
                </strong>{' '}
                dataset terverifikasi
              </span>
              {hasActiveFilter && (
                <>
                  <span aria-hidden="true" className="text-slate-300">
                    ·
                  </span>
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="font-medium text-teal-700 hover:text-teal-900 underline underline-offset-4"
                  >
                    Reset Filter Aktif
                  </button>
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadCatalog()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 self-start sm:self-auto whitespace-nowrap shrink-0 transition-colors"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Segarkan Katalog
          </button>
        </div>

        {loading && !catalog ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-xs text-slate-500">
            Memuat katalog data publik...
          </div>
        ) : !catalog || catalog.datasets.length === 0 ? (
          <div className="bg-white border border-slate-200/90 rounded-xl p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="flex items-start gap-4 max-w-3xl">
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-teal-700 flex items-center justify-center shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-slate-500">
                  {hasActiveFilter
                    ? 'Pencarian Tidak Menemukan Kecocokan'
                    : 'Status Sinkronisasi Etalase Publik'}
                </p>
                <h3 className="text-base font-semibold text-slate-900">
                  {hasActiveFilter
                    ? 'Tidak Ada Dataset yang Cocok dengan Filter Anda'
                    : 'Etalase Publik Menunggu Sinkronisasi Dataset Terverifikasi dari Walidata'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  {hasActiveFilter
                    ? 'Silakan ubah kata kunci pencarian atau tampilkan kembali seluruh dinas, urusan pemerintahan, dan tahun data.'
                    : 'Demi kepatuhan Satu Data Indonesia & perlindungan data pribadi (UU PDP), hanya dataset bermetadata "Terverifikasi Walidata" dengan akses "Terbuka (Publik)" atau publikasi Kominfo berstatus "Dipublikasikan" yang tampil setelah disinkronkan di menu Konfigurasi.'}
                </p>
              </div>
            </div>

            {hasActiveFilter && (
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="h-9 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap transition-colors"
                >
                  Reset Filter
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {catalog.datasets.map((ds) => {
              const isSelected = selectedSlug === ds.slug;
              return (
                <article
                  key={ds.id}
                  className={`bg-white border rounded-xl p-5 flex flex-col justify-between gap-4 transition-all duration-150 ${
                    isSelected
                      ? 'border-teal-600 ring-1 ring-teal-600 shadow-sm'
                      : 'border-slate-200/90 hover:border-slate-300 hover:-translate-y-0.5 hover:shadow-xs'
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        {ds.sourceType === 'kominfo_clone'
                          ? 'Publikasi Kominfo'
                          : 'Terverifikasi Walidata'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {ds.tahunData || '—'}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-semibold text-slate-900 leading-snug">
                        {ds.judulDataset}
                      </h3>
                      <p className="mt-1 text-xs font-medium text-teal-700">
                        {ds.produsenData}
                        {ds.urusanPemerintahan
                          ? ` · ${ds.urusanPemerintahan}`
                          : ''}
                      </p>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                      {ds.deskripsi ||
                        `Dataset resmi ${ds.urusanPemerintahan || 'sektoral'} dari ${ds.produsenData}.`}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="text-xs font-mono tabular-nums text-slate-500">
                      {ds.headers.length} kolom ·{' '}
                      {ds.jumlahBaris.toLocaleString('id-ID')} baris
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleOpenDataset(ds)}
                      className="inline-flex items-center gap-1.5 h-8 px-3.5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-lg hover:bg-slate-800 whitespace-nowrap transition-colors"
                    >
                      Lihat Data
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 6. Direktori Produsen Data (OPD) & Cakupan Wilayah Kecamatan */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 bg-white border border-slate-200/90 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Direktori Produsen Data Resmi (OPD {regencyConfig.namaKabupaten})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Pilih dinas untuk menyaring dataset publik yang diproduksi oleh
                instansi terkait.
              </p>
            </div>
            <span className="font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
              {OPD_DIRECTORY.length} OPD Inti
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200/80 bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-3 pl-6 pr-3">Kode</th>
                  <th className="py-3 px-3">Organisasi Perangkat Daerah</th>
                  <th className="py-3 px-3">Urusan Pemerintahan</th>
                  <th className="py-3 pl-3 pr-6 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {OPD_DIRECTORY.map((opd) => {
                  const isActive =
                    selectedOpd.toLowerCase() === opd.nama.toLowerCase();
                  return (
                    <tr
                      key={opd.id}
                      className={
                        isActive
                          ? 'bg-teal-50/60'
                          : 'hover:bg-slate-50/80 transition-colors'
                      }
                    >
                      <td className="py-3 pl-6 pr-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {opd.kode}
                      </td>
                      <td className="py-3 px-3 font-medium text-slate-900">
                        {opd.nama}
                      </td>
                      <td className="py-3 px-3 text-slate-600">
                        {opd.urusan}
                      </td>
                      <td className="py-3 pl-3 pr-6 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleFilterByOpd(opd.nama)}
                          className={`text-xs font-medium underline underline-offset-4 ${
                            isActive
                              ? 'text-teal-800'
                              : 'text-slate-700 hover:text-slate-950'
                          }`}
                        >
                          {isActive ? 'Hapus Filter' : 'Filter Dataset'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Wilayah Administrasi & Akses Layanan OPD */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200/90 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-teal-700 flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                Cakupan Kecamatan {regencyConfig.namaKabupaten}
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Konsolidasi data pembangunan daerah mencakup{' '}
              <strong className="font-mono tabular-nums text-slate-900">
                {regencyConfig.daftarKecamatan.length}
              </strong>{' '}
              wilayah kecamatan administratif:
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2.5 border-t border-slate-100 text-xs text-slate-700">
              {regencyConfig.daftarKecamatan.map((kec, idx) => (
                <div key={kec} className="truncate">
                  <span className="font-mono tabular-nums text-slate-400 mr-1.5">
                    {String(idx + 1).padStart(2, '0')}.
                  </span>
                  {kec}
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200/90 rounded-xl p-5 space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-teal-700 flex items-center justify-center shrink-0">
                <CalendarClock className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-slate-900">
                Siklus Pemutakhiran &amp; Format Unduhan
              </h3>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Setiap dataset publik yang dirilis oleh Walidata (
              {regencyConfig.namaWalidata}) mengikuti jadwal pemutakhiran
              sektoral resmi dan dapat diunduh dalam format terbuka:
            </p>
            <dl className="pt-2.5 border-t border-slate-100 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Frekuensi Rilis</dt>
                <dd className="font-medium text-slate-900">
                  Tahunan · Semesteran
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Format Warga</dt>
                <dd className="font-mono text-slate-900">CSV · JSON-SDI</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Lisensi Data</dt>
                <dd className="font-medium text-teal-700">
                  Terbuka Publik (Zero PII)
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* 7. Tata Kelola & Jaminan Kualitas Satu Data Kabupaten */}
      <section className="bg-white border border-slate-200/90 rounded-xl p-6 sm:p-7 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200/80 pb-4">
          <div>
            <p className="text-xs font-medium text-teal-700">
              Tata Kelola Data Pemerintah Daerah
            </p>
            <h2 className="text-lg font-semibold text-slate-900 mt-0.5">
              Bagaimana Data di Portal Ini Dikelola dan Diverifikasi
            </h2>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 text-teal-700 shrink-0" />
            <span>Kepatuhan Perpres 39/2019 &amp; UU PDP</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-2">
            <span className="inline-flex w-7 h-7 rounded-md bg-slate-100 text-slate-900 font-mono text-xs font-semibold items-center justify-center">
              01
            </span>
            <h3 className="text-sm font-semibold text-slate-900">
              Pengumpulan oleh Produsen Data (OPD)
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Setiap Dinas, Badan, dan Kecamatan menyusun dataset pada Google
              Sheet resmi miliknya sendiri beserta Metadata Kegiatan
              (MS-Kegiatan) dan Kamus Variabel (MS-Variabel).
            </p>
          </div>

          <div className="space-y-2">
            <span className="inline-flex w-7 h-7 rounded-md bg-slate-100 text-slate-900 font-mono text-xs font-semibold items-center justify-center">
              02
            </span>
            <h3 className="text-sm font-semibold text-slate-900">
              Verifikasi Walidata &amp; Penyaringan PII
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              {regencyConfig.namaWalidata} memeriksa konsistensi satuan, tahun,
              dan definisi variabel. Server menyaring kolom sensitif (seperti
              NIK, nomor telepon, dan alamat pribadi) sebelum data
              dipublikasikan.
            </p>
          </div>

          <div className="space-y-2">
            <span className="inline-flex w-7 h-7 rounded-md bg-slate-100 text-slate-900 font-mono text-xs font-semibold items-center justify-center">
              03
            </span>
            <h3 className="text-sm font-semibold text-slate-900">
              Publikasi Terbuka &amp; Interoperabilitas
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Masyarakat, akademisi, dan pelaku usaha dapat membaca grafik,
              mengunduh CSV atau JSON-SDI secara gratis, dan portal provinsi
              maupun nasional dapat memanen katalog melalui DCAT dan CKAN API.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
