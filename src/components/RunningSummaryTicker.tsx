import {
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
} from '../types/satuData';

interface RunningSummaryTickerProps {
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  scopedOpdName?: string | null;
}

export function RunningSummaryTicker({
  accounts,
  sheets,
  rowsBySheet,
  scopedOpdName = null,
}: RunningSummaryTickerProps) {
  const totalSheets = sheets.length;
  const activeSheets = sheets.filter((s) => s.status === 'Aktif').length;
  const pendingSheets = sheets.filter(
    (s) => s.status === 'Menunggu Cangkok Script'
  ).length;
  const totalRows = sheets.reduce(
    (acc, s) => acc + (rowsBySheet[s.id]?.length ?? 0),
    0
  );

  const items: string[] = scopedOpdName
    ? [
        `Portal Kedaulatan Data: ${scopedOpdName}`,
        `Google Sheet Terdaftar: ${totalSheets} sheet`,
        `Sheet Aktif (Hak Akses Web): ${activeSheets}`,
        `Menunggu Cangkok Script Admin: ${pendingSheets}`,
        `Total Baris Data Tersimpan: ${totalRows.toLocaleString('id-ID')} baris`,
      ]
    : [
        `Satu Data Kabupaten Nagekeo — Kedaulatan Data OPD`,
        `Akun Dinas Terdaftar: ${accounts.length} OPD`,
        `Google Sheet Terdaftar: ${totalSheets} dataset`,
        `Sheet Aktif: ${activeSheets} · Menunggu Cangkok Script: ${pendingSheets}`,
        `Total Baris Data Masuk: ${totalRows.toLocaleString('id-ID')} baris`,
        ...sheets.map(
          (s) =>
            `${s.namaOpd} (${s.judulDataset}): ${
              rowsBySheet[s.id]?.length ?? 0
            } baris`
        ),
      ];

  const renderTrack = (keyPrefix: string) => (
    <div className="flex items-center shrink-0">
      {items.map((text, idx) => (
        <span
          key={`${keyPrefix}-${idx}`}
          className="inline-flex items-center text-xs text-slate-200 whitespace-nowrap"
        >
          <span className="font-medium tracking-wide">{text}</span>
          <span className="mx-5 text-teal-400/70" aria-hidden="true">
            ·
          </span>
        </span>
      ))}
    </div>
  );

  return (
    <div
      aria-label="Ringkasan data berjalan"
      className="w-full bg-[#0B1B2B] border-b border-slate-800 overflow-hidden h-9 flex items-center"
    >
      <div className="px-3 sm:px-4 h-full bg-teal-700 text-white text-[11px] font-semibold tracking-wide flex items-center shrink-0 whitespace-nowrap z-10">
        Ringkasan Data
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="animate-marquee">
          {renderTrack('a')}
          {renderTrack('b')}
        </div>
      </div>
    </div>
  );
}
