import { ArrowRight, CheckCircle2, Clock, Database } from 'lucide-react';
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
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
} from '../types/satuData';
import { HeroBannerSlider } from './HeroBannerSlider';

interface RingkasanViewProps {
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  onGoToDataMasuk: () => void;
  onGoToAkunSheet: () => void;
}

export function RingkasanView({
  accounts,
  sheets,
  rowsBySheet,
  onGoToDataMasuk,
  onGoToAkunSheet,
}: RingkasanViewProps) {
  const activeSheets = sheets.filter((s) => s.status === 'Aktif');
  const pendingSheets = sheets.filter(
    (s) => s.status === 'Menunggu Cangkok Script'
  );
  const totalRows = sheets.reduce(
    (acc, s) => acc + (rowsBySheet[s.id]?.length ?? 0),
    0
  );

  const chartData = sheets.map((s) => ({
    name:
      s.judulDataset.length > 18
        ? `${s.judulDataset.slice(0, 18)}…`
        : s.judulDataset,
    opd: s.namaOpd,
    baris: rowsBySheet[s.id]?.length ?? 0,
  }));

  return (
    <div className="space-y-8">
      <HeroBannerSlider />

      {/* Super Admin Executive Command Banner */}
      <section className="rounded-lg bg-gradient-to-br from-[#0B1B2B] via-[#10253A] to-[#16324F] text-white p-6 sm:p-7 border border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <p className="text-xs font-medium text-teal-300 tracking-wide">
              Dashboard Super Admin Walidata · Kedaulatan Data OPD Nagekeo
            </p>
            <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-white leading-snug">
              Konsolidasi Data Dinamis Lintas Google Sheet OPD
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Setiap OPD mendaftarkan Folder Drive dan Google Sheet mereka
              sendiri. Super Admin mencangkokkan skrip{' '}
              <code className="font-mono text-teal-200">doPost (Code.gs)</code>{' '}
              untuk membuka form &amp; tabel otomatis bagi OPD, serta menerima
              konsolidasi data secara read-only.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onGoToAkunSheet}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-950 bg-white rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Cangkok Script ({pendingSheets.length})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onGoToDataMasuk}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium text-white bg-white/10 border border-white/15 rounded-md hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
            >
              <Database className="w-3.5 h-3.5" />
              Lihat Data Masuk
            </button>
          </div>
        </div>
      </section>

      {/* 4-Column Metric Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Akun Dinas Terdaftar
          </p>
          <p className="mt-2 text-3xl font-semibold font-mono tabular-nums text-slate-900">
            {accounts.length}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            OPD dengan Folder Drive &amp; Email resmi
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Sheet Aktif (Hak Akses Web)
          </p>
          <p className="mt-2 text-3xl font-semibold font-mono tabular-nums text-emerald-700">
            {activeSheets.length}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Dari {sheets.length} Google Sheet terdaftar
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Menunggu Cangkok Script
          </p>
          <p className="mt-2 text-3xl font-semibold font-mono tabular-nums text-amber-700">
            {pendingSheets.length}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Perlu pemasangan Code.gs oleh Super Admin
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Total Baris Data Masuk
          </p>
          <p className="mt-2 text-3xl font-semibold font-mono tabular-nums text-slate-900">
            {totalRows.toLocaleString('id-ID')}
          </p>
          <p className="mt-1.5 text-xs text-slate-500">
            Konsolidasi read-only seluruh dataset OPD
          </p>
        </div>
      </div>

      {/* Chart + Registered Sheets Overview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              Volume Baris Data per Dataset OPD
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Jumlah baris data masuk dari masing-masing Google Sheet milik OPD.
            </p>
          </div>
          {chartData.length === 0 ? (
            <div className="flex-1 min-h-[240px] flex flex-col items-center justify-center text-center px-4">
              <p className="text-sm font-medium text-slate-900">
                Belum ada dataset OPD yang terhubung
              </p>
              <p className="mt-1 text-xs text-slate-500 max-w-sm">
                Grafik akan terisi otomatis setelah OPD mendaftarkan URL Google
                Sheet dan data mulai masuk.
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 12, left: -12, bottom: 4 }}
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
                    tick={{ fontSize: 12, fill: '#475569' }}
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
                    dataKey="baris"
                    name="Jumlah Baris"
                    fill="#0B1B2B"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="xl:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Status Integrasi Sheet OPD
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Daftar dataset yang diajukan dinas.
              </p>
            </div>
            <button
              type="button"
              onClick={onGoToAkunSheet}
              className="text-xs font-medium text-slate-700 hover:text-slate-900 underline decoration-slate-300 whitespace-nowrap"
            >
              Kelola
            </button>
          </div>

          {sheets.length === 0 ? (
            <div className="flex-1 py-12 px-6 text-center text-xs text-slate-500">
              Belum ada Google Sheet OPD yang didaftarkan.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 flex-1">
              {sheets.map((s) => (
                <div
                  key={s.id}
                  onClick={onGoToDataMasuk}
                  className="px-5 py-3 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {s.judulDataset}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {s.namaOpd} · {s.headers.length} kolom
                    </p>
                  </div>
                  <div className="shrink-0">
                    {s.status === 'Aktif' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Aktif
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                        <Clock className="w-3.5 h-3.5" />
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
