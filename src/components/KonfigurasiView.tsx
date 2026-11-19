import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  Save,
  Wrench,
} from 'lucide-react';
import {
  APPS_SCRIPT_AUTH_TEMPLATE,
  APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE,
  isPlaceholderEndpoint,
} from '../config/opdSheets';
import {
  getActiveAuthSheetConfig,
  saveCustomAuthSheetConfig,
  testAuthSheetConnection,
} from '../services/authSheetService';
import { extractGoogleSheetId } from '../services/dynamicSheetService';

export function KonfigurasiView() {
  const initialCfg = getActiveAuthSheetConfig();
  const [sheetUrl, setSheetUrl] = useState(
    isPlaceholderEndpoint(initialCfg.sheetUrl) ? '' : initialCfg.sheetUrl
  );
  const [sheetName, setSheetName] = useState(initialCfg.sheetName || 'Akun_OPD');
  const [webhookUrl, setWebhookUrl] = useState(
    isPlaceholderEndpoint(initialCfg.webhookUrl) ? '' : initialCfg.webhookUrl
  );
  const [savedCfg, setSavedCfg] = useState(initialCfg);

  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [testing, setTesting] = useState(false);
  const [pingResult, setPingResult] = useState<{
    ok: boolean;
    latencyMs: number;
    message: string;
  } | null>(null);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptTab, setScriptTab] = useState<'akun' | 'dynamic'>('akun');

  const isConfigured =
    !isPlaceholderEndpoint(savedCfg.sheetUrl) &&
    !isPlaceholderEndpoint(savedCfg.webhookUrl);

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, 2000);
    } catch {
      // Abaikan
    }
  };

  const handleSaveAuthSheet = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMessage(null);
    setPingResult(null);

    if (!sheetUrl.trim() || !webhookUrl.trim()) {
      setSaveMessage({
        type: 'error',
        text: 'URL Google Sheet Akun dan URL Webhook Web App (/exec) wajib diisi.',
      });
      return;
    }

    if (!extractGoogleSheetId(sheetUrl.trim())) {
      setSaveMessage({
        type: 'error',
        text: 'URL Google Sheet tidak valid. Contoh: https://docs.google.com/spreadsheets/d/ID_SHEET/edit',
      });
      return;
    }

    if (!webhookUrl.trim().startsWith('https://script.google.com/')) {
      setSaveMessage({
        type: 'error',
        text: 'URL Webhook harus berupa URL Google Apps Script Web App (https://script.google.com/macros/s/.../exec).',
      });
      return;
    }

    const updated = saveCustomAuthSheetConfig({
      sheetUrl,
      sheetName,
      webhookUrl,
    });
    setSavedCfg(updated);
    setSaveMessage({
      type: 'success',
      text: 'Konfigurasi Google Sheet Akun OPD berhasil disimpan. Seluruh pendaftaran dan sinkronisasi akun kini terhubung ke Sheet Super Admin Anda.',
    });
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setPingResult(null);
    try {
      const targetCfg =
        sheetUrl.trim() && webhookUrl.trim()
          ? {
              ...savedCfg,
              sheetUrl: sheetUrl.trim(),
              sheetName: sheetName.trim() || 'Akun_OPD',
              webhookUrl: webhookUrl.trim(),
            }
          : savedCfg;
      const result = await testAuthSheetConnection(targetCfg);
      setPingResult(result);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Pengaturan Google Sheet Akun &amp; Skrip Code.gs
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          Daftarkan Google Sheet milik Super Admin sebagai basis data akun
          operator OPD, lalu gunakan skrip universal untuk dicangkokkan ke Sheet
          masing-masing OPD.
        </p>
      </div>

      {/* Super Admin Auth Sheet Registration Form */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs">
              {isConfigured ? (
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Google Sheet Akun Terhubung
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                  <Wrench className="w-3.5 h-3.5" />
                  Belum Dihubungkan (Mode Lokal)
                </span>
              )}
              <span className="text-slate-300">·</span>
              <span className="text-slate-500">Milik Super Admin Walidata</span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 mt-0.5">
              Daftarkan Google Sheet Daftar Akun OPD
            </h2>
          </div>

          {!isPlaceholderEndpoint(savedCfg.sheetUrl) && (
            <a
              href={savedCfg.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Buka Sheet Akun
            </a>
          )}
        </div>

        {/* 4-Step Quick Guide */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-slate-600">
          <div>
            <p className="font-semibold text-slate-900">
              1. Buat Google Sheet Baru
            </p>
            <p className="mt-0.5 leading-relaxed">
              Buat 1 Spreadsheet di Drive Super Admin (mis.{' '}
              <span className="font-medium text-slate-800">
                Master_Akun_OPD_Nagekeo
              </span>
              ).
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              2. Pasang Code_Akun_OPD.gs
            </p>
            <p className="mt-0.5 leading-relaxed">
              Buka <strong>Extensions → Apps Script</strong>, salin skrip{' '}
              <code className="font-mono text-slate-800">Code_Akun_OPD.gs</code>{' '}
              di bawah, lalu simpan.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              3. Deploy sebagai Web App
            </p>
            <p className="mt-0.5 leading-relaxed">
              Klik <strong>Deploy → New Deployment → Web App</strong> (Execute
              as: <em>Me</em>, Access: <em>Anyone</em>), salin URL{' '}
              <code className="font-mono text-slate-800">/exec</code>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              4. Tempel &amp; Simpan di Sini
            </p>
            <p className="mt-0.5 leading-relaxed">
              Masukkan URL Sheet &amp; URL Web App di form bawah lalu klik{' '}
              <strong>Simpan &amp; Uji Koneksi</strong>.
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveAuthSheet} className="p-6 space-y-4">
          {saveMessage && (
            <div
              className={`p-3 text-xs rounded-md border ${
                saveMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {saveMessage.text}
            </div>
          )}

          {pingResult && (
            <div
              className={`p-3 text-xs rounded-md border ${
                pingResult.ok
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              {pingResult.message}
              {pingResult.latencyMs > 0 ? ` (${pingResult.latencyMs} ms)` : ''}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8">
              <label
                htmlFor="auth-sheet-url"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                URL Google Sheet Daftar Akun OPD (Milik Super Admin)
              </label>
              <input
                id="auth-sheet-url"
                type="url"
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/1ABC.../edit#gid=0"
                className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
                required
              />
            </div>

            <div className="lg:col-span-4">
              <label
                htmlFor="auth-sheet-tab"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Nama Tab Sheet
              </label>
              <input
                id="auth-sheet-tab"
                type="text"
                value={sheetName}
                onChange={(e) => setSheetName(e.target.value)}
                placeholder="Akun_OPD"
                className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-webhook-url"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              URL Webhook Web App Apps Script (hasil Deploy Code_Akun_OPD.gs)
            </label>
            <input
              id="auth-webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/AKfycb.../exec"
              className="w-full h-10 px-3 text-sm font-mono bg-white border border-slate-300 rounded-md focus:outline-none focus:border-slate-900"
              required
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              disabled={testing}
              onClick={handleTestConnection}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`}
              />
              {testing ? 'Menguji Koneksi...' : 'Uji Koneksi Webhook'}
            </button>

            <button
              type="submit"
              className="inline-flex items-center gap-1.5 h-10 px-5 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              Simpan Konfigurasi Sheet Akun
            </button>
          </div>
        </form>
      </section>

      {/* Apps Script Template Panel */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Template Google Apps Script (doGet &amp; doPost)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Pilih{' '}
              <code className="font-mono text-slate-700">Code_Akun_OPD.gs</code>{' '}
              untuk Sheet Akun Super Admin, atau{' '}
              <code className="font-mono text-slate-700">Code.gs</code> untuk
              dicangkokkan pada Sheet milik masing-masing OPD.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => setScriptTab('akun')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scriptTab === 'akun'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Code_Akun_OPD.gs (Sheet Akun Admin)
              </button>
              <button
                type="button"
                onClick={() => setScriptTab('dynamic')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scriptTab === 'dynamic'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Code.gs (Universal Sheet OPD)
              </button>
            </div>

            <button
              type="button"
              onClick={() =>
                handleCopy(
                  scriptTab === 'dynamic'
                    ? APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE
                    : APPS_SCRIPT_AUTH_TEMPLATE,
                  `script-${scriptTab}`
                )
              }
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedId === `script-${scriptTab}` ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Skrip Tersalin
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Salin Skrip
                </>
              )}
            </button>
          </div>
        </div>

        <div className="bg-slate-950 text-slate-100 p-5 overflow-x-auto max-h-[420px]">
          <pre className="text-xs font-mono leading-relaxed">
            <code>
              {scriptTab === 'dynamic'
                ? APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE
                : APPS_SCRIPT_AUTH_TEMPLATE}
            </code>
          </pre>
        </div>
      </div>
    </div>
  );
}
