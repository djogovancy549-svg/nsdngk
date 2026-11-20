import React, { useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Eye,
  EyeOff,
  LogIn,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import { OPD_DIRECTORY } from '../config/opdSheets';
import {
  AiIntrusionWarning,
  appendSecurityEvent,
  inspectLoginInputForAttack,
  loadDeceptionConfig,
  requestAiIntrusionWarning,
} from '../services/cyberSecurityService';
import {
  DynamicSheetRow,
  OpdAccount,
  OpdDynamicSheet,
} from '../types/satuData';
import { RegencyWhiteLabelConfig } from '../services/regencyConfigService';
import { HeroBannerSlider } from './HeroBannerSlider';
import { PortalGuideView } from './PortalGuideView';
import { RunningSummaryTicker } from './RunningSummaryTicker';

function generateDynamicChallenge() {
  const a = Math.floor(Math.random() * 8) + 2;
  const b = Math.floor(Math.random() * 8) + 2;
  const token = Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    question: `${a} + ${b}`,
    answer: String(a + b),
    token,
  };
}

interface AuthGateViewProps {
  regencyConfig: RegencyWhiteLabelConfig;
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  onLogin: (
    email: string,
    password: string,
    loginRole: 'opd' | 'super_admin'
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
  regencyConfig,
  accounts,
  sheets,
  rowsBySheet,
  onLogin,
  onRegister,
}: AuthGateViewProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'guide'>('login');

  // Login state
  const [loginRole, setLoginRole] = useState<'opd' | 'super_admin'>('opd');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [honeypotTrap, setHoneypotTrap] = useState('');
  const [failedCount, setFailedCount] = useState(0);
  const [challenge, setChallenge] = useState(() => generateDynamicChallenge());
  const [challengeInput, setChallengeInput] = useState('');
  const [aiWarning, setAiWarning] = useState<AiIntrusionWarning | null>(null);
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

  const deceptionCfg = loadDeceptionConfig();
  const requireDynamicChallenge =
    deceptionCfg.tantanganDinamisAktif && (failedCount >= 2 || aiWarning !== null);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoginBusy(true);
    try {
      // 1. Perangkap Form Honeypot (hanya bot/skrip otomatis yang mengisi medan tersembunyi ini)
      if (deceptionCfg.formHoneypotAktif && honeypotTrap.trim().length > 0) {
        appendSecurityEvent({
          kategori: 'Perangkap Honeypot',
          tingkat: 'Kritis',
          aktor: identifier.trim() || 'Bot Otomatis',
          target: 'Form Honeypot Login',
          detail:
            'Bot/skrip terdeteksi mengisi kolom jebakan tersembunyi. Tarpit & respons pengelabuan diaktifkan.',
          diblokir: true,
        });
        if (deceptionCfg.tarpitDelayAktif) {
          await new Promise((r) => setTimeout(r, 2000));
        }
        setChallenge(generateDynamicChallenge());
        setLoginError(
          'Node autentikasi sedang merotasi sesi (ERR-DECOY-409). Silakan tunggu dan ulangi verifikasi.'
        );
        return;
      }

      // 2. Deteksi Injeksi SQLi / XSS / Formula pada formulir login
      const attackCheck = inspectLoginInputForAttack(identifier, password);
      if (attackCheck.suspicious) {
        appendSecurityEvent({
          kategori: 'Injeksi Payload',
          tingkat: 'Kritis',
          aktor: identifier.slice(0, 40) || 'Anonim',
          target: 'Formulir Masuk Portal',
          detail:
            attackCheck.reason ||
            'Terdeteksi percobaan injeksi berbahaya pada kolom autentikasi.',
          diblokir: true,
        });
        if (deceptionCfg.tarpitDelayAktif) {
          await new Promise((r) => setTimeout(r, 1800));
        }
        setFailedCount((c) => c + 2);
        setChallenge(generateDynamicChallenge());
        setChallengeInput('');
        if (deceptionCfg.peringatanAiOtomatis) {
          const warn = await requestAiIntrusionWarning({
            kategori: 'Injeksi Payload pada Login',
            aktor: identifier.slice(0, 40) || 'Anonim',
            target: 'Gerbang Autentikasi Satu Data',
            detail:
              attackCheck.reason ||
              'Pola serangan injeksi terdeteksi dan diblokir.',
          });
          setAiWarning(warn);
        }
        setLoginError(
          'Peringatan Keamanan AI: Upaya injeksi terdeteksi dan diblokir. Mode pengelabuan & verifikasi dinamis diaktifkan.'
        );
        return;
      }

      // 3. Verifikasi Tantangan Dinamis (aktif setelah gagal berulang / percobaan mencurigakan)
      if (requireDynamicChallenge) {
        if (challengeInput.trim() !== challenge.answer) {
          setChallenge(generateDynamicChallenge());
          setChallengeInput('');
          setLoginError(
            'Verifikasi keamanan dinamis tidak sesuai. Kode tantangan telah diacak ulang.'
          );
          return;
        }
      }

      // 4. Tarpit delay progresif untuk memperlambat brute-force
      if (deceptionCfg.tarpitDelayAktif && failedCount >= 2) {
        await new Promise((r) =>
          setTimeout(r, Math.min(2500, failedCount * 600))
        );
      }

      const res = await onLogin(identifier, password, loginRole);
      if (!res.ok) {
        const nextFail = failedCount + 1;
        setFailedCount(nextFail);
        setChallenge(generateDynamicChallenge());
        setChallengeInput('');
        setLoginError(
          res.message || 'Gagal masuk. Periksa kembali kredensial Anda.'
        );

        if (nextFail >= 3 && deceptionCfg.peringatanAiOtomatis) {
          const warn = await requestAiIntrusionWarning({
            kategori: 'Brute Force',
            aktor: identifier.trim() || 'Anonim',
            target: 'Gerbang Autentikasi Satu Data',
            detail: `Terjadi ${nextFail} kali percobaan masuk gagal berulang.`,
          });
          setAiWarning(warn);
        }
      } else {
        setFailedCount(0);
        setAiWarning(null);
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
        setLoginRole('opd');
        setIdentifier(email.trim().toLowerCase());
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
            {regencyConfig.namaPortal}
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
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'guide'}
            onClick={() => setMode('guide')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
              mode === 'guide'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            Panduan
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
        {mode === 'guide' ? (
          <PortalGuideView
            regencyConfig={regencyConfig}
            onGoToLogin={() => {
              setMode('login');
              setLoginError(null);
            }}
            onGoToRegister={() => {
              setMode('register');
              setRegFeedback(null);
            }}
          />
        ) : (
          <>
            <HeroBannerSlider />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Sovereign Data Architecture Overview */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div>
              <p className="text-xs font-medium text-teal-700">
                Pemerintah {regencyConfig.namaKabupaten} · Kedaulatan Data Sektoral OPD
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

            <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                Dilindungi enkripsi SHA-256, proteksi brute-force &amp; audit AI
                keamanan siber.
              </span>
              <button
                type="button"
                onClick={() => setMode('guide')}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 underline decoration-teal-300"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Baca Panduan Super Admin &amp; User OPD
              </button>
            </div>
          </div>

          {/* Right: Login / Register Card */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6">
            {mode === 'login' ? (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div className="pb-3 border-b border-slate-200 space-y-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      Masuk ke Portal Satu Data
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {loginRole === 'super_admin'
                        ? 'Khusus email resmi yang terdaftar pada daftar putih Super Admin.'
                        : 'Wajib menggunakan email User / OPD yang telah didaftarkan.'}
                    </p>
                  </div>

                  <div
                    className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-md"
                    role="tablist"
                    aria-label="Jenis akun masuk"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loginRole === 'opd'}
                      onClick={() => {
                        setLoginRole('opd');
                        setLoginError(null);
                      }}
                      className={`h-8 text-xs font-medium rounded transition-colors ${
                        loginRole === 'opd'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      User / OPD
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={loginRole === 'super_admin'}
                      onClick={() => {
                        setLoginRole('super_admin');
                        setLoginError(null);
                      }}
                      className={`h-8 text-xs font-medium rounded transition-colors ${
                        loginRole === 'super_admin'
                          ? 'bg-[#0B1B2B] text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Super Admin
                    </button>
                  </div>
                </div>

                {aiWarning && (
                  <div className="p-3.5 text-xs bg-red-950 text-red-50 border border-red-800 rounded-md space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-300">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{aiWarning.judulPeringatan}</span>
                    </div>
                    <p className="text-red-100 leading-relaxed">
                      {aiWarning.analisisSingkat}
                    </p>
                    <p className="text-[11px] text-teal-300 pt-1 border-t border-red-900">
                      Pertahanan Aktif: {aiWarning.taktikPengelabuanAktif}
                    </p>
                  </div>
                )}

                {loginError && (
                  <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                    {loginError}
                  </div>
                )}

                {/* Hidden Form Honeypot Trap (hanya diisi bot otomatis) */}
                <div
                  aria-hidden="true"
                  className="absolute -left-[9999px] top-auto w-px h-px overflow-hidden"
                >
                  <label htmlFor="website_verification_url">Website</label>
                  <input
                    id="website_verification_url"
                    name="website_verification_url"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypotTrap}
                    onChange={(e) => setHoneypotTrap(e.target.value)}
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-identifier"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    {loginRole === 'super_admin'
                      ? 'Email Resmi Super Admin'
                      : 'Email Terdaftar User / OPD'}
                  </label>
                  <input
                    id="login-identifier"
                    type="email"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Masukkan alamat email"
                    autoComplete="email"
                    className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    {loginRole === 'super_admin'
                      ? 'Tidak semua email dapat masuk. Hanya email yang didaftarkan di daftar resmi Super Admin.'
                      : 'Akun User/OPD hanya dapat dibuka dengan alamat email yang sudah didaftarkan.'}
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Kata Sandi
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Masukkan kata sandi"
                      autoComplete="current-password"
                      className="w-full h-10 pl-3 pr-10 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={
                        showPassword
                          ? 'Sembunyikan kata sandi'
                          : 'Lihat kata sandi'
                      }
                      title={
                        showPassword
                          ? 'Sembunyikan kata sandi'
                          : 'Lihat kata sandi'
                      }
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {requireDynamicChallenge && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-md space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-amber-900">
                        Tantangan Verifikasi Dinamis #{challenge.token}
                      </span>
                      <span className="font-mono text-[11px] text-amber-700">
                        Berapa {challenge.question} ?
                      </span>
                    </div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={challengeInput}
                      onChange={(e) => setChallengeInput(e.target.value)}
                      placeholder="Masukkan hasil penjumlahan"
                      className="w-full h-9 px-3 text-sm font-mono bg-white border border-amber-300 rounded-md focus:outline-none focus:border-slate-900"
                      required
                    />
                  </div>
                )}

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
                      placeholder="Masukkan alamat email"
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
          </>
        )}
      </main>
    </div>
  );
}
