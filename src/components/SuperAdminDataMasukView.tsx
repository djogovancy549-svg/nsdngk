import { useMemo, useState } from 'react';
import {
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  RefreshCw,
  Search,
} from 'lucide-react';
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

/**
 * Tampilan Read-Only khusus Super Admin ("Super Admin mendapatkan data saja").
 * Kedaulatan edit/hapus data tetap berada di masing-masing OPD pemilik Sheet.
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

  const activeSheet =
    sheets.find((s) => s.id === selectedSheetId) ?? sheets[0] ?? null;

  const rows = activeSheet ? rowsBySheet[activeSheet.id] ?? [] : [];

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      Object.values(r.values).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [rows, searchQuery]);

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
            Super Admin memantau dan mengekspor data sektoral yang berasal
            langsung dari Google Sheet milik masing-masing OPD tanpa mengubah
            struktur maupun isi data milik OPD.
          </p>
        </div>

        {sheets.length > 0 && activeSheet && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <select
              value={activeSheet.id}
              onChange={(e) => {
                setSelectedSheetId(e.target.value);
                setSearchQuery('');
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
              <strong>Tarik Data Terbaru</strong> atau pastikan Super Admin telah
              mencangkokkan skrip <code className="font-mono">Code.gs</code>.
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="text-sm font-medium text-slate-900">
                Belum ada baris data masuk untuk dataset ini
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Data akan muncul secara otomatis saat operator{' '}
                {activeSheet.namaOpd} mengisi formulir dinamis atau saat data
                ditarik dari Google Sheet.
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
              {filteredRows.length} baris · {activeSheet.headers.length} kolom
              header dinamis
            </span>
            <span>Read-Only · Sumber: Google Sheet {activeSheet.namaOpd}</span>
          </div>
        </div>
      )}
    </div>
  );
}
