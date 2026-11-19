import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, Trash2 } from 'lucide-react';
import { AuditActionType, AuditLogEntry } from '../types/satuData';

interface AktivitasViewProps {
  logs: AuditLogEntry[];
  onClearLogs: () => void;
}

const ACTION_FILTERS: ('Semua' | AuditActionType)[] = [
  'Semua',
  'Akun OPD',
  'Daftar Sheet',
  'Cangkok Script',
  'Sinkronisasi Sheet',
  'Input Data OPD',
  'Ubah Data OPD',
  'Hapus Data OPD',
];

export function AktivitasView({ logs, onClearLogs }: AktivitasViewProps) {
  const [actionFilter, setActionFilter] = useState<'Semua' | AuditActionType>(
    'Semua'
  );

  const filteredLogs = useMemo(() => {
    if (actionFilter === 'Semua') return logs;
    return logs.filter((entry) => entry.action === actionFilter);
  }, [logs, actionFilter]);

  const formatTimestamp = (iso: string) => {
    try {
      const date = new Date(iso);
      return date.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Riwayat Aktivitas Portal
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Jejak audit pendaftaran akun OPD, pengajuan Google Sheet,
            pencangkokan script <code className="font-mono text-xs">Code.gs</code>,
            dan sinkronisasi data.
          </p>
        </div>

        {logs.length > 0 && (
          <button
            type="button"
            onClick={onClearLogs}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Bersihkan Riwayat
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 overflow-x-auto">
          <div
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md"
            role="group"
            aria-label="Filter jenis aktivitas"
          >
            {ACTION_FILTERS.map((item) => {
              const active = actionFilter === item;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => setActionFilter(item)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item}
                </button>
              );
            })}
          </div>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="py-14 px-6 text-center">
            <Clock className="w-7 h-7 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-semibold text-slate-900">
              Belum ada aktivitas tercatat
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Seluruh aktivitas pendaftaran akun, pengajuan Sheet, dan
              pencangkokan script akan tercatat di sini.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                  <th className="py-2.5 px-5 whitespace-nowrap">Waktu</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Aksi</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Dinas / OPD</th>
                  <th className="py-2.5 px-3">Detail</th>
                  <th className="py-2.5 px-5 text-right whitespace-nowrap">
                    Status Sheet
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredLogs.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-5 font-mono tabular-nums text-xs text-slate-500 whitespace-nowrap">
                      {formatTimestamp(entry.timestamp)}
                    </td>
                    <td className="py-3 px-3 text-xs font-medium text-slate-900 whitespace-nowrap">
                      {entry.action}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">
                      {entry.opdNama}
                    </td>
                    <td className="py-3 px-3 text-slate-700">
                      <span className="font-mono text-xs text-slate-500 mr-2">
                        {entry.target}
                      </span>
                      <span>{entry.deskripsi}</span>
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap">
                      {entry.syncedToSheet ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Tersinkron
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">
                          Tersimpan Lokal
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
