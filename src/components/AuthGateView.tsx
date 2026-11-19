import React, { useState } from 'react';
import { LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { OPD_DIRECTORY } from '../config/opdSheets';
import {
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
} from '../types/satuData';
import { HeroBannerSlider } from './HeroBannerSlider';
import { RunningSummaryTicker } from './RunningSummaryTicker';

interface AuthGateViewProps {
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  onLogin: (
    identifier: string,
    password: string
  ) => Promise<{ ok: boolean; message?: string }>;
  onRegister: (input: {
    opdId: string;
    namaOpd: string;
    namaLengkap: string;
    email: string;
    username: string;
    password: string;
    driveFolderUrl: string;
  }) => Promise<{ ok: boolean; message: string }>;
}

export function AuthGateView({
  accounts,
  sheets,
  rowsBySheet,
  onLogin,
  onRegister,
}: AuthGateViewProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Register state
  const [selectedOpdId, setSelectedOpdId] = useState(OPD_DIRECTORY[0].id);
  const [customOpdName, setCustomOpdName] = useState('');
  const [namaLengkap, setNamaLengkap] = useState('');
  const [email, setEmail] = useState('');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [username, setUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regBusy, setRegBusy] = useState(false);
  const [regFeedback, setRegFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      const res = await onLogin(identifier, password);
      if (!res.ok) {
        setLoginError(
          res.message || 'Gagal masuk. Periksa kembali kredensial Anda.'
        );
      }
    } finally {
      setLoginBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegFeedback(null);

    const isCustom = selectedOpdId === '__custom__';
    const resolvedNamaOpd = isCustom
      ? customOpdName.trim()
      : OPD_DIRECTORY.find((o) => o.id === selectedOpdId)?.nama ?? '';

    if (!resolvedNamaOpd) {
      setRegFeedback({
        type: 'error',
        text: 'Nama Dinas/OPD wajib diisi.',
      });
      return;
    }

    if (regPassword.length < 6) {
      setRegFeedback({
        type: 'error',
        text: 'Kata sandi minimal 6 karakter.',
      });
      return;
    }

    if (regPassword !== regConfirm) {
      setRegFeedback({
        type: 'error',
        text: 'Konfirmasi kata sandi tidak cocok.',
      });
      return;
    }

    setRegBusy(true);
    try {
      const res = await onRegister({
        opdId: isCustom ? '' : selectedOpdId,
        namaOpd: resolvedNamaOpd,
        namaLengkap,
        email,
        username,
        password: regPassword,
        driveFolderUrl,
      });
      if (res.ok) {
        setRegFeedback({ type: 'success', text: res.message });
        setIdentifier(username.trim().toLowerCase());
        setPassword('');
        setNamaLengkap('');
        setEmail('');
        setDriveFolderUrl('');
        setUsername('');
        setRegPassword('');
        setRegConfirm('');
        setCustomOpdName('');
      } else {
        setRegFeedback({ type: 'error', text: res.message });
      }
    } finally {
      setRegBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <RunningSummaryTicker
        accounts={accounts}
        sheets={sheets}
        rowsBySheet={rowsBySheet}
      />

      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-md bg-[#0B1B2B] text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-teal-400" />
          </div>
          <span className="font-semibold text-[15px] tracking-tight text-slate-900 whitespace-nowrap truncate">
            Satu Data Nagekeo
          </span>
        </div>

        <div
          className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md shrink-0"
          role="tablist"
          aria-label="Mode akses portal"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => {
              setMode('login');
              setLoginError(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Masuk Portal
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => {
              setMode('register');
              setRegFeedback(null);
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Daftar Akun Dinas
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        <HeroBannerSlider />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Sovereign Data Architecture Overview */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div>
              <p className="text-xs font-medium text-teal-700">
                Pemerintah Kabupaten Nagekeo · Kedaulatan Data Sektoral OPD
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
                Satu Data Dinamis Berbasis Google Drive &amp; Sheet Milik OPD
              </h1>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                Setiap Dinas/OPD mendaftarkan akun, email resmi, tautan Folder
                Google Drive, serta URL Google Sheet yang mereka kelola sendiri.
                Setelah Super Admin mencangkokkan skrip{' '}
                <code className="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">
                  doPost (Code.gs)
                </code>
                , formulir dan tabel web terbentuk otomatis mengikuti header
                baris 1 pada sheet milik OPD tersebut.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 text-xs">
              <div>
                <p className="font-semibold text-slate-900">
                  01. Daftar Akun &amp; Drive OPD
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  OPD mendaftarkan email, username, password, Folder Drive, lalu
                  mengajukan URL Google Sheet mereka.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  02. Cangkok Script Code.gs
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Super Admin mencangkokkan skrip dinamis pada Extensions sheet
                  OPD dan mengaktifkan hak akses web.
                </p>
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  03. Form &amp; Tabel Otomatis
                </p>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  Form input dan tabel otomatis menyesuaikan header sheet OPD.
                  Super Admin menerima data read-only saja.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                Dilindungi enkripsi SHA-256, proteksi brute-force &amp; audit AI
                keamanan siber.
              </span>
              <span className="text-[11px] text-slate-400">
                Akses Walidata terbatas untuk administrator resmi.
              </span>
            </div>
          </div>

          {/* Right: Login / Register Card */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
            {mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="pb-3 border-b border-slate-200">
                  <h2 className="text-base font-semibold text-slate-900">
                    Masuk ke Portal Satu Data
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Masuk sebagai Super Admin Walidata atau Operator Dinas/OPD.
                  </p>
                </div>

                {loginError && (
                  <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                    {loginError}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Username atau Email
                  </label>
                  <input
                    id="login-identifier"
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Masukkan username atau email terdaftar"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Kata Sandi
                  </label>
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginBusy}
                  className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
                >
                  <LogIn className="w-4 h-4" />
                  {loginBusy ? 'Memverifikasi...' : 'Masuk ke Portal'}
                </button>

                <p className="text-xs text-center text-slate-500 pt-1">
                  Dinas belum terdaftar?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className="font-medium text-slate-900 underline decoration-slate-300"
                  >
                    Daftar Akun &amp; Folder Drive OPD
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleRegisterSubmit} className="space-y-3">
                <div className="pb-3 border-b border-slate-200">
                  <h2 className="text-base font-semibold text-slate-900">
                    Pendaftaran Akun &amp; Folder Drive OPD
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Setelah mendaftar, masuk untuk mengajukan URL Google Sheet
                    OPD Anda.
                  </p>
                </div>

                {regFeedback && (
                  <div
                    className={`p-3 text-xs rounded-md border ${
                      regFeedback.type === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : 'bg-red-50 border-red-200 text-red-700'
                    }`}
                  >
                    {regFeedback.text}
                  </div>
                )}

                <div>
                  <label
                    htmlFor="gate-opd"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    Dinas / OPD
                  </label>
                  <select
                    id="gate-opd"
                    value={selectedOpdId}
                    onChange={(e) => setSelectedOpdId(e.target.value)}
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                  >
                    {OPD_DIRECTORY.map((opd) => (
                      <option key={opd.id} value={opd.id}>
                        {opd.nama}
                      </option>
                    ))}
                    <option value="__custom__">
                      + Dinas / Badan / Bagian Lainnya...
                    </option>
                  </select>
                </div>

                {selectedOpdId === '__custom__' && (
                  <div>
                    <label
                      htmlFor="gate-custom-opd"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Nama Dinas / Badan / Bagian
                    </label>
                    <input
                      id="gate-custom-opd"
                      type="text"
                      value={customOpdName}
                      onChange={(e) => setCustomOpdName(e.target.value)}
                      placeholder="Contoh: Dinas Koperasi, UKM & Perdagangan"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                )}

                <div>
                  <label
                    htmlFor="gate-drive"
                    className="block text-xs font-medium text-slate-700 mb-1"
                  >
                    URL Folder Google Drive OPD
                  </label>
                  <input
                    id="gate-drive"
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
                      htmlFor="gate-nama"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Nama PIC / Operator
                    </label>
                    <input
                      id="gate-nama"
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
                      htmlFor="gate-email"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Email Resmi OPD
                    </label>
                    <input
                      id="gate-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="opd@nagekeokab.go.id"
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="gate-username"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Username
                    </label>
                    <input
                      id="gate-username"
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="opd_user"
                      className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gate-password"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Password
                    </label>
                    <input
                      id="gate-password"
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Min. 6"
                      minLength={6}
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="gate-confirm"
                      className="block text-xs font-medium text-slate-700 mb-1"
                    >
                      Ulangi
                    </label>
                    <input
                      id="gate-confirm"
                      type="password"
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder="Ulangi"
                      minLength={6}
                      className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={regBusy}
                  className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {regBusy ? 'Mendaftarkan Akun...' : 'Daftar Akun Dinas'}
                </button>

                <p className="text-xs text-center text-slate-500 pt-1">
                  Sudah punya akun?{' '}
                  <button
                    type="button"
                    onClick={() => setMode('login')}
                    className="font-medium text-slate-900 underline decoration-slate-300"
                  >
                    Masuk di sini
                  </button>
                </p>
              </form>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
