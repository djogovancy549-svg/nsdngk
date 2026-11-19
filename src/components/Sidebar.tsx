import { useState } from 'react';
import {
  BarChart3,
  Code2,
  Database,
  FileSpreadsheet,
  Globe,
  History,
  LogOut,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import {
  ActiveNavSection,
  DynamicSheetRow,
  OpdDynamicSheet,
} from '../types/satuData';

interface SidebarProps {
  activeSection: ActiveNavSection;
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  pendingGraftCount: number;
  accountsCount: number;
  publishedCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onSelectSection: (section: ActiveNavSection) => void;
  onLogout: () => void;
}

const NAV_ITEMS: {
  id: ActiveNavSection;
  label: string;
  icon: typeof BarChart3;
}[] = [
  { id: 'ringkasan', label: 'Ringkasan Eksekutif', icon: BarChart3 },
  { id: 'data_masuk', label: 'Data Masuk (Read-Only)', icon: Database },
  { id: 'publikasi', label: 'Cloning & Publikasi', icon: Globe },
  { id: 'akun_sheet', label: 'Akun & Cangkok Sheet', icon: Users },
  { id: 'konfigurasi', label: 'Skrip Code.gs & Auth', icon: Code2 },
  { id: 'aktivitas', label: 'Riwayat Aktivitas', icon: History },
];

export function Sidebar({
  activeSection,
  sheets,
  rowsBySheet,
  pendingGraftCount,
  accountsCount,
  publishedCount,
  mobileOpen,
  onCloseMobile,
  onSelectSection,
  onLogout,
}: SidebarProps) {
  const [avatarError, setAvatarError] = useState(false);

  const handleNavClick = (section: ActiveNavSection) => {
    onSelectSection(section);
    onCloseMobile();
  };

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0B1B2B] text-slate-100 border-r border-slate-800/80">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-5 h-16 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-teal-600 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="block font-semibold text-[15px] tracking-tight text-white whitespace-nowrap truncate leading-tight">
              Satu Data Nagekeo
            </span>
            <span className="block text-[11px] text-slate-400 tracking-wide whitespace-nowrap truncate">
              Super Admin Walidata
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md"
          aria-label="Tutup menu navigasi"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Primary Navigation */}
      <div className="px-3 py-4 border-b border-white/10">
        <p className="px-2.5 pb-2 text-[11px] font-medium text-slate-400 tracking-wide">
          Kendali Super Admin
        </p>
        <nav className="space-y-0.5" aria-label="Menu utama">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            const showPending =
              item.id === 'akun_sheet' && pendingGraftCount > 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavClick(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 text-sm rounded-md transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-white/12 text-white font-medium'
                    : 'text-slate-300 hover:bg-white/6 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon
                    className={`w-4 h-4 shrink-0 ${
                      isActive ? 'text-teal-400' : 'text-slate-400'
                    }`}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                {showPending ? (
                  <span className="font-mono tabular-nums text-xs font-semibold text-amber-300 shrink-0">
                    {pendingGraftCount}
                  </span>
                ) : item.id === 'publikasi' && publishedCount > 0 ? (
                  <span className="font-mono tabular-nums text-xs text-teal-300 shrink-0">
                    {publishedCount}
                  </span>
                ) : item.id === 'akun_sheet' && accountsCount > 0 ? (
                  <span className="font-mono tabular-nums text-xs text-slate-400 shrink-0">
                    {accountsCount}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Dynamic Registered OPD Sheets */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="flex items-center justify-between px-2.5 pb-2">
          <p className="text-[11px] font-medium text-slate-400 tracking-wide">
            Sheet OPD Terdaftar
          </p>
          <span className="text-xs font-mono tabular-nums text-slate-500">
            {sheets.length}
          </span>
        </div>

        {sheets.length === 0 ? (
          <p className="px-2.5 text-xs text-slate-500 leading-relaxed">
            Belum ada Google Sheet OPD terdaftar.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {sheets.map((s) => {
              const rowCount = rowsBySheet[s.id]?.length ?? 0;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => handleNavClick('data_masuk')}
                    className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left text-xs rounded-md text-slate-300 hover:bg-white/6 hover:text-white transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <FileSpreadsheet
                        className={`w-3.5 h-3.5 shrink-0 ${
                          s.status === 'Aktif'
                            ? 'text-teal-400'
                            : 'text-amber-400'
                        }`}
                      />
                      <span className="truncate">
                        {s.judulDataset}
                        <span className="block text-[10px] text-slate-400 truncate">
                          {s.namaOpd}
                        </span>
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-slate-400 shrink-0">
                      {rowCount}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Super Admin Profile Footer */}
      <div className="px-4 py-3.5 border-t border-white/10 shrink-0 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {!avatarError ? (
            <img
              src="/src/assets/images/avatar_super_admin_1795066768783.jpg"
              alt="Super Admin Walidata Kabupaten Nagekeo"
              referrerPolicy="no-referrer"
              onError={() => setAvatarError(true)}
              className="w-9 h-9 rounded-md object-cover border border-white/15 shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-md bg-slate-800 border border-white/15 text-xs font-semibold text-white flex items-center justify-center shrink-0">
              SA
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              Super Admin Walidata
            </p>
            <p className="text-[11px] text-slate-400 truncate">
              Diskominfo Kab. Nagekeo
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          title="Keluar dari konsol"
          aria-label="Keluar dari konsol"
          className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-md transition-colors shrink-0"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[264px] shrink-0 h-screen sticky top-0">
        {sidebarContent}
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label="Menu navigasi"
        >
          <div
            className="fixed inset-0 bg-slate-950/55"
            onClick={onCloseMobile}
          />
          <div className="relative w-[276px] max-w-[85vw] h-full z-10">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
}
