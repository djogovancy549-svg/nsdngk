import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  Link2,
  RefreshCw,
  Trash2,
  UserPlus,
  UserX,
} from 'lucide-react';
import {
  APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE,
  OPD_DIRECTORY,
} from '../config/opdSheets';
import { getActiveAuthSheetConfig } from '../services/authSheetService';
import {
  AccountStatus,
  OpdAccount,
  OpdDynamicSheet,
} from '../types/satuData';

interface AkunOpdViewProps {
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  syncingAccounts: boolean;
  onSyncAccounts: () => Promise<void>;
  onRegisterAccount: (input: {
    opdId: string;
    namaOpd: string;
    namaLengkap: string;
    email: string;
    username: string;
    password: string;
    driveFolderUrl: string;
  }) => Promise<{ ok: boolean; message: string }>;
  onToggleStatus: (account: OpdAccount, status: AccountStatus) => Promise<void>;
  onDeleteAccount: (account: OpdAccount) => Promise<void>;
  onActivateSheetWebhook: (
    sheet: OpdDynamicSheet,
    webhookUrl: string,
    manualHeaders?: string[]
  ) => Promise<void>;
  onRevokeSheetAccess: (sheet: OpdDynamicSheet) => void;
}

export function AkunOpdView({
  accounts,
  sheets,
  syncingAccounts,
  onSyncAccounts,
  onRegisterAccount,
  onToggleStatus,
  onDeleteAccount,
  onActivateSheetWebhook,
  onRevokeSheetAccess,
}: AkunOpdViewProps) {
  const [selectedOpdId, setSelectedOpdId] = useState(OPD_DIRECTORY[0].id);
  const [customOpdName, setCustomOpdName] = useState('');
  const [namaLengkap, setNamaLengkap] = useState('');
  const [email, setEmail] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Per-sheet webhook grafting inputs
  const [webhookDrafts, setWebhookDrafts] = useState<Record<string, string>>(
    {}
  );
  const [headerDrafts, setHeaderDrafts] = useState<Record<string, string>>({});
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyCodeGs = async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      // Abaikan
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const isCustom = selectedOpdId === '__custom__';
    const resolvedNamaOpd = isCustom
      ? customOpdName.trim()
      : OPD_DIRECTORY.find((o) => o.id === selectedOpdId)?.nama ?? '';

    if (
      !resolvedNamaOpd ||
      !namaLengkap.trim() ||
      !email.trim() ||
      !username.trim() ||
      !password ||
      !driveFolderUrl.trim()
    ) {
      setFeedback({ type: 'error', text: 'Semua kolom wajib diisi.' });
      return;
    }

    if (password.length < 6) {
      setFeedback({ type: 'error', text: 'Kata sandi minimal 6 karakter.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await onRegisterAccount({
        opdId: isCustom ? '' : selectedOpdId,
        namaOpd: resolvedNamaOpd,
        namaLengkap,
        email,
        username,
        password,
        driveFolderUrl,
      });
      if (res.ok) {
        setFeedback({ type: 'success', text: res.message });
        setNamaLengkap('');
        setEmail('');
        setDriveFolderUrl('');
        setUsername('');
        setPassword('');
        setCustomOpdName('');
      } else {
        setFeedback({ type: 'error', text: res.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async (sheet: OpdDynamicSheet) => {
    const draftWebhook = (
      webhookDrafts[sheet.id] ?? sheet.webhookUrl ?? ''
    ).trim();
    const draftHeadersRaw = headerDrafts[sheet.id];
    const parsedHeaders = draftHeadersRaw
      ? draftHeadersRaw
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean)
      : undefined;

    setActivatingId(sheet.id);
    try {
      await onActivateSheetWebhook(sheet, draftWebhook, parsedHeaders);
    } finally {
      setActivatingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Akun Dinas, Folder Drive &amp; Pencangkokan Script Sheet
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Kelola akun OPD, buka Google Sheet yang didaftarkan dinas,
            cangkokkan skrip <code className="font-mono text-xs">doPost (Code.gs)</code>,
            lalu aktifkan hak akses web agar formulir &amp; tabel otomatis
            terbentuk mengikuti header baris 1 sheet OPD.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyCodeGs}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 whitespace-nowrap"
          >
            {copiedScript ? (
              <>
                <Check className="w-3.5 h-3.5" />
                Code.gs Tersalin
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                Salin Code.gs Dinamis
              </>
            )}
          </button>

          <a
            href={getActiveAuthSheetConfig().sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Sheet Akun
          </a>

          <button
            type="button"
            onClick={onSyncAccounts}
            disabled={syncingAccounts}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${syncingAccounts ? 'animate-spin' : ''}`}
            />
            Sinkron Akun
          </button>
        </div>
      </div>

      {/* SECTION 1: PENCANGKOKAN CODE.GS PADA GOOGLE SHEET OPD */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Pencangkokan doPost (Code.gs) &amp; Hak Akses Web OPD
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Buka Google Sheet OPD → Extensions → Apps Script → tempel{' '}
              <code className="font-mono">Code.gs</code> → Deploy Web App →
              tempel URL <code className="font-mono">/exec</code> di bawah untuk
              mengaktifkan hak akses web OPD.
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs text-slate-500 shrink-0">
            {sheets.length} Sheet terdaftar
          </span>
        </div>

        {sheets.length === 0 ? (
          <div className="py-12 px-6 text-center">
            <p className="text-sm font-medium text-slate-900">
              Belum ada Google Sheet yang diajukan oleh OPD
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Setelah OPD masuk menggunakan akunnya dan mendaftarkan tautan
              Google Sheet, antrean pencangkokan script akan muncul di sini.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {sheets.map((sheet) => {
              const isActive = sheet.status === 'Aktif';
              const draftWebhook =
                webhookDrafts[sheet.id] ?? sheet.webhookUrl ?? '';
              const draftHeaders =
                headerDrafts[sheet.id] ?? sheet.headers.join(', ');
              const isBusy = activatingId === sheet.id;

              return (
                <div key={sheet.id} className="p-5 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {isActive ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Hak Akses Web Aktif
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                            <Clock className="w-3.5 h-3.5" />
                            Menunggu Pencangkokan Code.gs
                          </span>
                        )}
                        <span className="text-slate-300">·</span>
                        <span className="font-medium text-slate-700">
                          {sheet.namaOpd}
                        </span>
                        <span className="text-slate-300">·</span>
                        <span className="text-slate-500">{sheet.emailOpd}</span>
                      </div>

                      <h3 className="text-sm font-semibold text-slate-900">
                        {sheet.judulDataset}{' '}
                        <span className="font-mono font-normal text-xs text-slate-500">
                          (Tab: {sheet.sheetName})
                        </span>
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {sheet.driveFolderUrl && (
                        <a
                          href={sheet.driveFolderUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          Folder Drive OPD
                        </a>
                      )}
                      <a
                        href={sheet.sheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Buka Sheet OPD
                      </a>
                      {isActive && (
                        <button
                          type="button"
                          onClick={() => onRevokeSheetAccess(sheet)}
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          Nonaktifkan Akses
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Grafting Input Row */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 pt-2">
                    <div className="lg:col-span-5">
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        URL Webhook Web App hasil cangkok doPost (/exec)
                      </label>
                      <input
                        type="url"
                        value={draftWebhook}
                        onChange={(e) =>
                          setWebhookDrafts((prev) => ({
                            ...prev,
                            [sheet.id]: e.target.value,
                          }))
                        }
                        placeholder="https://script.google.com/macros/s/.../exec"
                        className="w-full h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>

                    <div className="lg:col-span-4">
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Header Kolom Baris 1 (otomatis terdeteksi / bisa diedit)
                      </label>
                      <input
                        type="text"
                        value={draftHeaders}
                        onChange={(e) =>
                          setHeaderDrafts((prev) => ({
                            ...prev,
                            [sheet.id]: e.target.value,
                          }))
                        }
                        placeholder="Kolom 1, Kolom 2, Kolom 3"
                        className="w-full h-9 px-3 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      />
                    </div>

                    <div className="lg:col-span-3 flex items-end">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleActivate(sheet)}
                        className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-60 transition-colors whitespace-nowrap"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        {isBusy
                          ? 'Menyinkronkan...'
                          : isActive
                          ? 'Perbarui & Sinkron'
                          : 'Aktifkan Hak Akses Web'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* SECTION 2: PENDAFTARAN & DAFTAR AKUN OPD */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleRegisterSubmit}
          className="xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-3.5"
        >
          <div className="pb-3 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Daftarkan Akun Dinas Baru
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Daftarkan Folder Drive, Email resmi, Username, dan Password OPD.
            </p>
          </div>

          {feedback && (
            <div
              className={`p-3 text-xs rounded-md border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {feedback.text}
            </div>
          )}

          <div>
            <label
              htmlFor="adm-opd"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Dinas / OPD
            </label>
            <select
              id="adm-opd"
              value={selectedOpdId}
              onChange={(e) => setSelectedOpdId(e.target.value)}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
            >
              {OPD_DIRECTORY.map((opd) => (
                <option key={opd.id} value={opd.id}>
                  {opd.nama}
                </option>
              ))}
              <option value="__custom__">+ Dinas / Badan Lainnya...</option>
            </select>
          </div>

          {selectedOpdId === '__custom__' && (
            <div>
              <label
                htmlFor="adm-custom-opd"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Nama Dinas / Badan
              </label>
              <input
                id="adm-custom-opd"
                type="text"
                value={customOpdName}
                onChange={(e) => setCustomOpdName(e.target.value)}
                placeholder="Nama OPD"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
          )}

          <div>
            <label
              htmlFor="adm-drive"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              URL Folder Google Drive OPD
            </label>
            <input
              id="adm-drive"
              type="url"
              value={driveFolderUrl}
              onChange={(e) => setDriveFolderUrl(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="adm-nama"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Nama PIC
              </label>
              <input
                id="adm-nama"
                type="text"
                value={namaLengkap}
                onChange={(e) => setNamaLengkap(e.target.value)}
                placeholder="Nama lengkap"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
            <div>
              <label
                htmlFor="adm-email"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Email Resmi OPD
              </label>
              <input
                id="adm-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="opd@nagekeokab.go.id"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="adm-user"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Username
              </label>
              <input
                id="adm-user"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="opd_dinkes"
                className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
            <div>
              <label
                htmlFor="adm-pass"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Password
              </label>
              <input
                id="adm-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimal 6 karakter"
                minLength={6}
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            {submitting ? 'Menyimpan...' : 'Daftarkan Akun OPD'}
          </button>
        </form>

        <div className="xl:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Daftar Akun &amp; Folder Drive OPD ({accounts.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Akun dinas aktif dapat masuk dan mengajukan Google Sheet mereka
              sendiri.
            </p>
          </div>

          {accounts.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="text-sm font-medium text-slate-900">
                Belum ada akun OPD terdaftar
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Dinas dapat mendaftar mandiri melalui halaman depan atau melalui
                formulir di samping.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium text-slate-500">
                    <th className="py-2.5 px-5">Dinas &amp; Drive</th>
                    <th className="py-2.5 px-3">Akun</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((acc) => {
                    const isConfirming = confirmDeleteId === acc.id;
                    return (
                      <tr key={acc.id} className="hover:bg-slate-50/70">
                        <td className="py-3 px-5 align-top">
                          <div className="font-medium text-slate-900">
                            {acc.namaOpd}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {acc.namaLengkap}
                            {acc.driveFolderUrl && (
                              <>
                                {' · '}
                                <a
                                  href={acc.driveFolderUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-teal-700 underline decoration-teal-300"
                                >
                                  Buka Drive
                                </a>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top">
                          <div className="font-mono text-xs text-slate-800">
                            @{acc.username}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            {acc.email}
                          </div>
                        </td>
                        <td className="py-3 px-3 align-top whitespace-nowrap">
                          {acc.status === 'Aktif' ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Aktif
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                              <UserX className="w-3.5 h-3.5" />
                              Nonaktif
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-5 text-right align-top whitespace-nowrap">
                          {isConfirming ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={async () => {
                                  await onDeleteAccount(acc);
                                  setConfirmDeleteId(null);
                                }}
                                className="px-2 py-1 text-xs font-medium text-white bg-red-600 rounded"
                              >
                                Hapus
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded"
                              >
                                Batal
                              </button>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  onToggleStatus(
                                    acc,
                                    acc.status === 'Aktif'
                                      ? 'Nonaktif'
                                      : 'Aktif'
                                  )
                                }
                                className="text-xs font-medium text-slate-600 hover:text-slate-900 underline decoration-slate-300"
                              >
                                {acc.status === 'Aktif'
                                  ? 'Nonaktifkan'
                                  : 'Aktifkan'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(acc.id)}
                                className="p-1.5 text-slate-400 hover:text-red-700 hover:bg-red-50 rounded-md"
                                aria-label={`Hapus akun ${acc.username}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
