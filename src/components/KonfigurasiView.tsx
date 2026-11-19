import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import {
  APPS_SCRIPT_AUTH_TEMPLATE,
  APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE,
  AUTH_SHEET_CONFIG,
} from '../config/opdSheets';

export function KonfigurasiView() {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [scriptTab, setScriptTab] = useState<'dynamic' | 'akun'>('dynamic');

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Skrip Pencangkokan Code.gs &amp; Sheet Akun OPD
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-3xl">
          Gunakan skrip universal dinamis di bawah ini untuk dicangkokkan pada{' '}
          <strong>Extensions → Apps Script</strong> di Google Sheet milik
          masing-masing OPD. Skrip secara otomatis membaca header baris 1 yang
          dibuat sendiri oleh OPD.
        </p>
      </div>

      {/* Central Auth Sheet Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="text-xs text-slate-500">
            <span className="font-mono">AUTH-SHEET</span> · Penyimpanan Akun
            &amp; Folder Drive OPD · Tab:{' '}
            <span className="font-mono text-slate-700">
              {AUTH_SHEET_CONFIG.sheetName}
            </span>
          </div>
          <h2 className="text-base font-semibold text-slate-900">
            Google Sheet &amp; Webhook Akun Dinas (Tertanam di src/config/opdSheets.ts)
          </h2>
          <p className="text-xs font-mono text-slate-500 truncate max-w-2xl">
            {AUTH_SHEET_CONFIG.webhookUrl}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={AUTH_SHEET_CONFIG.sheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Buka Sheet Akun
          </a>
          <button
            type="button"
            onClick={() =>
              handleCopy(AUTH_SHEET_CONFIG.webhookUrl, 'auth-webhook')
            }
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
          >
            {copiedId === 'auth-webhook' ? (
              <Check className="w-3.5 h-3.5 text-emerald-700" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            Salin Webhook Akun
          </button>
        </div>
      </div>

      {/* Apps Script Template Panel */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Template Google Apps Script (doGet &amp; doPost)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Deploy sebagai Web App (Execute as: Me, Who has access: Anyone).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md">
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
              <button
                type="button"
                onClick={() => setScriptTab('akun')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scriptTab === 'akun'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Code_Akun_OPD.gs
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
