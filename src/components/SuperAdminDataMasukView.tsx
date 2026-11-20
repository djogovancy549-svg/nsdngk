import { useMemo, useState } from 'react';
import {
  BarChart3,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  exportDynamicRowsToCsv,
  inferInputTypeFromHeader,
} from '../services/dynamicSheetService';
import { DynamicSheetRow, OpdDynamicSheet } from '../types/satuData';

interface SuperAdminDataMasukViewProps {
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  syncingSheetId: string | null;
  onSyncSheet: (sheet: OpdDynamicSheet) => Promise<void>;
  onGoToAkunSheet: () => void;
}

type ChartViewMode = 'all' | 'bar' | 'donut' | 'line';

const CHART_COLORS = [
  '#0B1B2B',
  '#0F766E',
  '#0284C7',
  '#D97706',
  '#6366F1',
  '#10B981',
  '#E11D48',
  '#475569',
];

/**
 * Tampilan Read-Only khusus Super Admin ("Super Admin mendapatkan data saja").
 * Dilengkapi analitik interaktif Grafik Bar, Donut, dan Line dengan cross-filter ke tabel.
 */
export function SuperAdminDataMasukView({
  sheets,
  rowsBySheet,
  syncingSheetId,
  onSyncSheet,
  onGoToAkunSheet,
}: SuperAdminDataMasukViewProps) {
  const [selectedSheetId, setSelectedSheetId] = useState<string>(
    () => sheets[0]?.id ?? ''
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedColumn, setSelectedColumn] = useState<string>('');
  const [chartMode, setChartMode] = useState<ChartViewMode>('all');
  const [activeValueFilter, setActiveValueFilter] = useState<string | null>(
    null
  );

  const activeSheet =
    sheets.find((s) => s.id === selectedSheetId) ?? sheets[0] ?? null;

  const rows = activeSheet ? rowsBySheet[activeSheet.id] ?? [] : [];

  const activeCol = useMemo(() => {
    if (!activeSheet || activeSheet.headers.length === 0) return '';
    if (activeSheet.headers.includes(selectedColumn)) return selectedColumn;
    // Prioritaskan kolom kategori seperti Kecamatan/Alamat/Jenis Kelamin jika ada
    const preferred = activeSheet.headers.find((h) =>
      /(kecamatan|alamat|status|jenis|kategori|desa|urusan)/i.test(h)
    );
    return preferred || activeSheet.headers[0];
  }, [activeSheet, selectedColumn]);

  // Data distribusi frekuensi untuk Bar & Donut (dari seluruh baris sheet aktif)
  const distributionData = useMemo(() => {
    if (!activeCol || rows.length === 0) return [];
    const counts = new Map<string, number>();
    for (const r of rows) {
      const raw = String(r.values[activeCol] ?? '').trim();
      const label = raw || 'Kosong';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([fullName, value]) => ({
        name: fullName.length > 16 ? `${fullName.slice(0, 16)}…` : fullName,
        fullName,
        value,
      }));
  }, [rows, activeCol]);

  // Data tren untuk Grafik Garis (Line): pakai kolom tanggal jika ada, atau progres kumulatif kategori
  const lineChartInfo = useMemo(() => {
    if (!activeSheet || rows.length === 0) {
      return {
        title: 'Grafik Garis — Tren Data',
        subtitle: 'Belum ada data untuk menampilkan tren.',
        data: [] as { name: string; jumlah: number; kumulatif: number }[],
      };
    }

    const dateCol = activeSheet.headers.find(
      (h) => inferInputTypeFromHeader(h) === 'date'
    );

    if (dateCol) {
      const byPeriod = new Map<string, number>();
      for (const r of rows) {
        const raw = String(r.values[dateCol] ?? '').trim();
        // Kelompokkan per Tahun-Bulan (YYYY-MM) atau Tahun jika format tanggal ISO
        const period =
          raw.length >= 7 && /^\d{4}-\d{2}/.test(raw)
            ? raw.slice(0, 7)
            : raw || 'Tanpa Tanggal';
        byPeriod.set(period, (byPeriod.get(period) ?? 0) + 1);
      }
      const sorted = Array.from(byPeriod.entries()).sort((a, b) =>
        a[0].localeCompare(b[0])
      );
      let running = 0;
      return {
        title: `Grafik Garis — Tren Berdasarkan "${dateCol}"`,
        subtitle: `Perkembangan jumlah baris & akumulasi data per periode ${dateCol}.`,
        data: sorted.map(([name, jumlah]) => {
          running += jumlah;
          return { name, jumlah, kumulatif: running };
        }),
      };
    }

    let running = 0;
    return {
      title: `Grafik Garis — Kurva Akumulasi "${activeCol}"`,
      subtitle: `Perbandingan frekuensi & kurva akumulasi baris pada kolom ${activeCol}.`,
      data: distributionData.map((d) => {
        running += d.value;
        return { name: d.name, jumlah: d.value, kumulatif: running };
      }),
    };
  }, [activeSheet, rows, activeCol, distributionData]);

  const filteredRows = useMemo(() => {
    let base = rows;
    if (activeValueFilter && activeCol) {
      base = base.filter((r) => {
        const raw = String(r.values[activeCol] ?? '').trim() || 'Kosong';
        return raw === activeValueFilter;
      });
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) =>
      Object.values(r.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, searchQuery, activeValueFilter, activeCol]);

  const donutTotal = distributionData.reduce((acc, d) => acc + d.value, 0);

  const toggleCrossFilter = (fullName: string) => {
    setActiveValueFilter((prev) => (prev === fullName ? null : fullName));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700 inline-flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5" />
            Mode Konsolidasi Read-Only · Kedaulatan Data pada OPD
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            Data Masuk Lintas Dinas / OPD
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Super Admin memantau, menganalisis secara interaktif (grafik batang,
            donat, dan garis), serta mengekspor data sektoral langsung dari
            Google Sheet milik masing-masing OPD.
          </p>
        </div>

        {sheets.length > 0 && activeSheet && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={activeSheet.id}
              onChange={(e) => {
                setSelectedSheetId(e.target.value);
                setSearchQuery('');
                setSelectedColumn('');
                setActiveValueFilter(null);
              }}
              aria-label="Pilih dataset OPD"
              className="h-9 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
            >
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.namaOpd} — {s.judulDataset} [{s.sheetName}] (
                  {rowsBySheet[s.id]?.length ?? 0})
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={syncingSheetId === activeSheet.id}
              onClick={() => onSyncSheet(activeSheet)}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  syncingSheetId === activeSheet.id ? 'animate-spin' : ''
                }`}
              />
              Tarik Data Terbaru
            </button>
          </div>
        )}
      </div>

      {!activeSheet ? (
        <div className="bg-white border border-slate-200 rounded-lg p-12 text-center space-y-3">
          <FileSpreadsheet className="w-8 h-8 text-slate-300 mx-auto" />
          <p className="text-sm font-semibold text-slate-900">
            Belum ada Google Sheet OPD yang terdaftar
          </p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Setelah OPD mendaftar akun dan mengajukan tautan Google Sheet mereka,
            data dari seluruh OPD akan tampil terpusat di sini.
          </p>
          <button
            type="button"
            onClick={onGoToAkunSheet}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800"
          >
            Buka Kelola Akun &amp; Sheet OPD
          </button>
        </div>
      ) : (
        <>
          {/* Interactive Visual Analytics Suite: Bar, Donut & Line */}
          {activeSheet.headers.length > 0 && (
            <section className="space-y-4">
              {/* Interactive Chart Controls Bar */}
              <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="dm-chart-col"
                      className="text-xs font-medium text-slate-600 whitespace-nowrap"
                    >
                      Kolom Analisis:
                    </label>
                    <select
                      id="dm-chart-col"
                      value={activeCol}
                      onChange={(e) => {
                        setSelectedColumn(e.target.value);
                        setActiveValueFilter(null);
                      }}
                      className="h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
                    >
                      {activeSheet.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  {activeValueFilter && (
                    <button
                      type="button"
                      onClick={() => setActiveValueFilter(null)}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium bg-teal-50 text-teal-800 border border-teal-200 rounded-md hover:bg-teal-100"
                    >
                      <span>
                        Filter: {activeCol} = &ldquo;{activeValueFilter}&rdquo;
                      </span>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Segmented Mode Switcher */}
                <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md shrink-0 self-start md:self-auto">
                  {[
                    { id: 'all' as const, label: 'Semua' },
                    { id: 'bar' as const, label: 'Batang', icon: BarChart3 },
                    { id: 'donut' as const, label: 'Donat', icon: PieChartIcon },
                    { id: 'line' as const, label: 'Garis', icon: TrendingUp },
                  ].map((tab) => {
                    const Icon = tab.icon;
                    const active = chartMode === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setChartMode(tab.id)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {Icon && <Icon className="w-3.5 h-3.5" />}
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Charts Grid */}
              <div
                className={`grid grid-cols-1 gap-5 ${
                  chartMode === 'all' ? 'xl:grid-cols-12' : ''
                }`}
              >
                {/* 1. Grafik Batang (Bar) */}
                {(chartMode === 'all' || chartMode === 'bar') && (
                  <div
                    className={`bg-white border border-slate-200 rounded-lg p-5 flex flex-col ${
                      chartMode === 'all' ? 'xl:col-span-4' : ''
                    }`}
                  >
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Grafik Batang — {activeCol}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Klik batang untuk menyaring tabel di bawah.
                      </p>
                    </div>
                    {distributionData.length === 0 ? (
                      <div className="flex-1 min-h-[220px] flex items-center justify-center text-xs text-slate-400">
                        Belum ada baris data.
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={distributionData}
                            margin={{ top: 8, right: 8, left: -16, bottom: 4 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#E2E8F0"
                            />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11, fill: '#475569' }}
                              axisLine={{ stroke: '#CBD5E1' }}
                              tickLine={false}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: '#475569' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              cursor={{ fill: '#F1F5F9' }}
                              contentStyle={{
                                backgroundColor: '#FFFFFF',
                                borderColor: '#CBD5E1',
                                borderRadius: '6px',
                                fontSize: '12px',
                              }}
                            />
                            <Bar
                              dataKey="value"
                              name="Jumlah Baris"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={42}
                              className="cursor-pointer"
                              onClick={(entry) => {
                                const target = (
                                  entry as {
                                    fullName?: string;
                                    payload?: { fullName?: string };
                                  }
                                )?.payload?.fullName ??
                                  (entry as { fullName?: string })?.fullName;
                                if (target) {
                                  toggleCrossFilter(String(target));
                                }
                              }}
                            >
                              {distributionData.map((item, idx) => (
                                <Cell
                                  key={item.fullName}
                                  fill={
                                    activeValueFilter &&
                                    activeValueFilter !== item.fullName
                                      ? '#CBD5E1'
                                      : CHART_COLORS[idx % CHART_COLORS.length]
                                  }
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Grafik Donat (Donut) */}
                {(chartMode === 'all' || chartMode === 'donut') && (
                  <div
                    className={`bg-white border border-slate-200 rounded-lg p-5 flex flex-col ${
                      chartMode === 'all' ? 'xl:col-span-4' : ''
                    }`}
                  >
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Grafik Donat — Proporsi {activeCol}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        Klik bagian donat atau legenda untuk filter silang.
                      </p>
                    </div>
                    {distributionData.length === 0 ? (
                      <div className="flex-1 min-h-[220px] flex items-center justify-center text-xs text-slate-400">
                        Belum ada baris data.
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col sm:flex-row xl:flex-col 2xl:flex-row items-center gap-4">
                        <div className="relative w-44 h-44 shrink-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={distributionData}
                                dataKey="value"
                                nameKey="fullName"
                                cx="50%"
                                cy="50%"
                                innerRadius={48}
                                outerRadius={74}
                                paddingAngle={2}
                                strokeWidth={0}
                                className="cursor-pointer"
                                onClick={(entry) => {
                                  const target = (
                                    entry as {
                                      fullName?: string;
                                      payload?: { fullName?: string };
                                    }
                                  )?.payload?.fullName ??
                                    (entry as { fullName?: string })?.fullName;
                                  if (target) {
                                    toggleCrossFilter(String(target));
                                  }
                                }}
                              >
                                {distributionData.map((item, idx) => (
                                  <Cell
                                    key={item.fullName}
                                    fill={
                                      activeValueFilter &&
                                      activeValueFilter !== item.fullName
                                        ? '#CBD5E1'
                                        : CHART_COLORS[
                                            idx % CHART_COLORS.length
                                          ]
                                    }
                                  />
                                ))}
                              </Pie>
                              <Tooltip
                                contentStyle={{
                                  backgroundColor: '#FFFFFF',
                                  borderColor: '#CBD5E1',
                                  borderRadius: '6px',
                                  fontSize: '12px',
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-lg font-semibold font-mono tabular-nums text-slate-900">
                              {donutTotal.toLocaleString('id-ID')}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              Baris
                            </span>
                          </div>
                        </div>

                        <div className="flex-1 w-full space-y-1.5 max-h-44 overflow-y-auto pr-1">
                          {distributionData.map((item, idx) => {
                            const pct =
                              donutTotal > 0
                                ? Math.round((item.value / donutTotal) * 100)
                                : 0;
                            const isPicked =
                              activeValueFilter === item.fullName;
                            return (
                              <button
                                key={item.fullName}
                                type="button"
                                onClick={() => toggleCrossFilter(item.fullName)}
                                className={`w-full flex items-center justify-between gap-2 px-1.5 py-1 rounded text-xs transition-colors ${
                                  isPicked
                                    ? 'bg-teal-50 text-teal-900 font-semibold'
                                    : 'hover:bg-slate-50 text-slate-700'
                                }`}
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-xs shrink-0"
                                    style={{
                                      backgroundColor:
                                        CHART_COLORS[idx % CHART_COLORS.length],
                                    }}
                                  />
                                  <span className="truncate">
                                    {item.fullName}
                                  </span>
                                </span>
                                <span className="font-mono tabular-nums text-[11px] shrink-0">
                                  {item.value}{' '}
                                  <span className="text-slate-400">
                                    ({pct}%)
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. Grafik Garis (Line) */}
                {(chartMode === 'all' || chartMode === 'line') && (
                  <div
                    className={`bg-white border border-slate-200 rounded-lg p-5 flex flex-col ${
                      chartMode === 'all' ? 'xl:col-span-4' : ''
                    }`}
                  >
                    <div className="mb-3">
                      <h3 className="text-sm font-semibold text-slate-900">
                        {lineChartInfo.title}
                      </h3>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {lineChartInfo.subtitle}
                      </p>
                    </div>
                    {lineChartInfo.data.length === 0 ? (
                      <div className="flex-1 min-h-[220px] flex items-center justify-center text-xs text-slate-400">
                        Belum ada baris data.
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[230px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={lineChartInfo.data}
                            margin={{ top: 8, right: 12, left: -16, bottom: 4 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="#E2E8F0"
                            />
                            <XAxis
                              dataKey="name"
                              tick={{ fontSize: 11, fill: '#475569' }}
                              axisLine={{ stroke: '#CBD5E1' }}
                              tickLine={false}
                            />
                            <YAxis
                              allowDecimals={false}
                              tick={{ fontSize: 11, fill: '#475569' }}
                              axisLine={false}
                              tickLine={false}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: '#FFFFFF',
                                borderColor: '#CBD5E1',
                                borderRadius: '6px',
                                fontSize: '12px',
                              }}
                            />
                            <Line
                              type="monotone"
                              dataKey="jumlah"
                              name="Jumlah"
                              stroke="#0F766E"
                              strokeWidth={2.5}
                              dot={{ r: 3.5, fill: '#0F766E' }}
                              activeDot={{ r: 5 }}
                            />
                            <Line
                              type="monotone"
                              dataKey="kumulatif"
                              name="Akumulasi"
                              stroke="#0B1B2B"
                              strokeWidth={2}
                              strokeDasharray="4 4"
                              dot={{ r: 3, fill: '#0B1B2B' }}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Read-Only Consolidated Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="space-y-0.5 min-w-0">
                <div className="text-xs text-slate-500">
                  {activeSheet.namaOpd} · {activeSheet.emailOpd} · Tab:{' '}
                  <span className="font-mono text-slate-700">
                    {activeSheet.sheetName}
                  </span>
                </div>
                <h2 className="text-base font-semibold text-slate-900 truncate">
                  {activeSheet.judulDataset}
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari data..."
                    className="h-9 pl-9 pr-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900 w-52"
                  />
                </div>

                <a
                  href={activeSheet.sheetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Buka Sheet Asli
                </a>

                <button
                  type="button"
                  disabled={filteredRows.length === 0}
                  onClick={() =>
                    exportDynamicRowsToCsv(
                      activeSheet.headers,
                      filteredRows,
                      `nagekeo-${activeSheet.opdId}-${activeSheet.sheetName}.csv`
                    )
                  }
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Unduh CSV
                </button>
              </div>
            </div>

            {activeSheet.headers.length === 0 ? (
              <div className="py-12 px-6 text-center text-xs text-slate-500">
                Header baris 1 belum terbaca dari Google Sheet OPD ini. Klik{' '}
                <strong>Tarik Data Terbaru</strong> atau pastikan Super Admin
                telah mencangkokkan skrip{' '}
                <code className="font-mono">Code.gs</code>.
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <p className="text-sm font-medium text-slate-900">
                  Belum ada baris data yang cocok
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {activeValueFilter
                    ? 'Hapus filter grafik aktif atau ubah kata kunci pencarian.'
                    : `Data akan muncul otomatis saat operator ${activeSheet.namaOpd} mengisi formulir dinamis.`}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                      <th className="py-2.5 px-4 w-12 font-mono">#</th>
                      {activeSheet.headers.map((header) => (
                        <th
                          key={header}
                          className="py-2.5 px-3 whitespace-nowrap"
                        >
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRows.map((row, idx) => (
                      <tr key={row._id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-slate-400">
                          {idx + 1}
                        </td>
                        {activeSheet.headers.map((header) => {
                          const isNum =
                            inferInputTypeFromHeader(header) === 'number';
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono tabular-nums">
                {filteredRows.length} baris
                {activeValueFilter ? ` (dari ${rows.length} total)` : ''} ·{' '}
                {activeSheet.headers.length} kolom header dinamis
              </span>
              <span>Read-Only · Sumber: Google Sheet {activeSheet.namaOpd}</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
