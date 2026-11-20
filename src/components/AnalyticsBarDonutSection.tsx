import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ChartDatum {
  name: string;
  value: number;
  detail?: string;
}

interface AnalyticsBarDonutSectionProps {
  barTitle: string;
  barSubtitle: string;
  barSeriesLabel: string;
  barData: ChartDatum[];
  barEmptyText?: string;
  donutTitle: string;
  donutSubtitle: string;
  donutCenterLabel: string;
  donutData: ChartDatum[];
  donutEmptyText?: string;
  donutHeaderRight?: React.ReactNode;
}

const CHART_PALETTE = [
  '#0B1B2B',
  '#0F766E',
  '#0284C7',
  '#D97706',
  '#475569',
  '#10B981',
  '#6366F1',
  '#E11D48',
];

export function AnalyticsBarDonutSection({
  barTitle,
  barSubtitle,
  barSeriesLabel,
  barData,
  barEmptyText = 'Belum ada data untuk ditampilkan pada grafik batang.',
  donutTitle,
  donutSubtitle,
  donutCenterLabel,
  donutData,
  donutEmptyText = 'Belum ada data untuk ditampilkan pada grafik donat.',
  donutHeaderRight,
}: AnalyticsBarDonutSectionProps) {
  const nonZeroDonut = donutData.filter((d) => d.value > 0);
  const donutTotal = nonZeroDonut.reduce((acc, d) => acc + d.value, 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
      {/* Grafik Bar (7 kolom) */}
      <section className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-slate-900">{barTitle}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{barSubtitle}</p>
        </div>

        {barData.length === 0 ? (
          <div className="flex-1 min-h-[240px] flex items-center justify-center text-center px-4">
            <p className="text-xs text-slate-500 max-w-sm">{barEmptyText}</p>
          </div>
        ) : (
          <div className="flex-1 min-h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
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
                  dataKey="value"
                  name={barSeriesLabel}
                  fill="#0B1B2B"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={48}
                >
                  {barData.map((_, idx) => (
                    <Cell
                      key={idx}
                      fill={idx % 2 === 0 ? '#0B1B2B' : '#0F766E'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Grafik Donut (5 kolom) */}
      <section className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {donutTitle}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{donutSubtitle}</p>
          </div>
          {donutHeaderRight && <div className="shrink-0">{donutHeaderRight}</div>}
        </div>

        {nonZeroDonut.length === 0 ? (
          <div className="flex-1 min-h-[240px] flex items-center justify-center text-center px-4">
            <p className="text-xs text-slate-500 max-w-xs">{donutEmptyText}</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col sm:flex-row xl:flex-col 2xl:flex-row items-center gap-5">
            <div className="relative w-48 h-48 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={nonZeroDonut}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={82}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {nonZeroDonut.map((_, idx) => (
                      <Cell
                        key={idx}
                        fill={CHART_PALETTE[idx % CHART_PALETTE.length]}
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
                <span className="text-xl font-semibold font-mono tabular-nums text-slate-900">
                  {donutTotal.toLocaleString('id-ID')}
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5">
                  {donutCenterLabel}
                </span>
              </div>
            </div>

            <div className="flex-1 w-full space-y-2 max-h-52 overflow-y-auto pr-1">
              {nonZeroDonut.map((item, idx) => {
                const pct =
                  donutTotal > 0
                    ? Math.round((item.value / donutTotal) * 100)
                    : 0;
                return (
                  <div
                    key={`${item.name}-${idx}`}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{
                          backgroundColor:
                            CHART_PALETTE[idx % CHART_PALETTE.length],
                        }}
                      />
                      <span className="text-slate-700 truncate">
                        {item.name}
                      </span>
                    </div>
                    <span className="font-mono tabular-nums text-slate-900 font-medium shrink-0">
                      {item.value.toLocaleString('id-ID')}{' '}
                      <span className="text-slate-400 font-normal">
                        ({pct}%)
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
