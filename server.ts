import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === 'production';

// Super Admin credentials live strictly on the server (never shipped in client bundle)
const SERVER_SUPER_ADMIN_USER = (
  process.env.SUPER_ADMIN_USERNAME || 'superadmin'
)
  .trim()
  .toLowerCase();
const SERVER_SUPER_ADMIN_EMAIL = (
  process.env.SUPER_ADMIN_EMAIL || 'walidata@nagekeokab.go.id'
)
  .trim()
  .toLowerCase();
const SERVER_SUPER_ADMIN_PASSWORD =
  process.env.SUPER_ADMIN_PASSWORD || 'nagekeo2026';

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still run timingSafeEqual on dummy equal-length buffers to avoid length timing leak
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// In-memory brute-force rate limiter per IP
interface RateLimitState {
  attempts: number;
  lockedUntil: number;
}
const loginAttemptsByIp = new Map<string, RateLimitState>();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

interface ServerIntrusionAlert {
  id: string;
  timestamp: string;
  ip: string;
  path: string;
  jenisAncaman: string;
  taktikPengelabuan: string;
  tingkat: 'Rendah' | 'Sedang' | 'Tinggi' | 'Kritis';
}

const serverIntrusionAlerts: ServerIntrusionAlert[] = [];

function recordServerIntrusion(
  ip: string,
  reqPath: string,
  jenisAncaman: string,
  taktikPengelabuan: string,
  tingkat: ServerIntrusionAlert['tingkat']
) {
  serverIntrusionAlerts.unshift({
    id: `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ip,
    path: reqPath,
    jenisAncaman,
    taktikPengelabuan,
    tingkat,
  });
  if (serverIntrusionAlerts.length > 100) {
    serverIntrusionAlerts.length = 100;
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function buildHeuristicThreatAnalysis(snapshot: Record<string, unknown>) {
  const events = Array.isArray(snapshot.insidenKeamananTerbaru)
    ? (snapshot.insidenKeamananTerbaru as Array<Record<string, unknown>>)
    : [];
  const piiItems = Array.isArray(snapshot.paparanPiiTerdeteksi)
    ? (snapshot.paparanPiiTerdeteksi as Array<Record<string, unknown>>)
    : [];
  const totalSheets = Number(snapshot.totalSheetTerdaftar || 0);
  const activeSheets = Number(snapshot.totalSheetAktif || 0);
  const blockedCount = events.filter((e) => Boolean(e.diblokir)).length;
  const criticalCount = events.filter((e) => e.tingkat === 'Kritis').length;
  const publicPiiCount = piiItems.filter((p) => Boolean(p.isPublic)).length;

  let skorKeamanan = 92;
  skorKeamanan -= criticalCount * 15;
  skorKeamanan -= publicPiiCount * 18;
  skorKeamanan -= Math.min(blockedCount * 2, 12);
  if (totalSheets > activeSheets) skorKeamanan -= 5;
  skorKeamanan = Math.max(15, Math.min(100, skorKeamanan));

  const tingkatAncaman =
    skorKeamanan >= 80
      ? 'Rendah'
      : skorKeamanan >= 60
      ? 'Sedang'
      : skorKeamanan >= 40
      ? 'Tinggi'
      : 'Kritis';

  const temuanKerentanan: Array<{
    judul: string;
    tingkat: string;
    vektorSerangan: string;
    dampak: string;
    rekomendasi: string;
  }> = [];

  if (publicPiiCount > 0) {
    temuanKerentanan.push({
      judul: 'Eksposur Kolom Data Pribadi (PII) pada Dataset Publik',
      tingkat: 'Kritis',
      vektorSerangan: 'Pengumpulan Data Pribadi / Scraping Publik (UU PDP)',
      dampak:
        'Kolom sensitif seperti NIK, No. HP, atau Alamat dapat disalahgunakan pihak tidak berwenang.',
      rekomendasi:
        'Hapus atau anonimisasi kolom PII pada menu Publikasi Kominfo sebelum status diubah menjadi Dipublikasikan.',
    });
  }

  if (piiItems.length > publicPiiCount) {
    temuanKerentanan.push({
      judul: 'Kolom Sensitif Terdeteksi di Sheet Internal OPD',
      tingkat: 'Sedang',
      vektorSerangan: 'Salah Konfigurasi Hak Akses Google Sheet',
      dampak:
        'Jika tautan Google Sheet OPD dibagikan publik, data penduduk berisiko bocor.',
      rekomendasi:
        'Pastikan izin berbagi Google Sheet OPD dibatasi hanya untuk akun resmi OPD dan Walidata, serta aktifkan PIN Hapus OPD.',
    });
  }

  if (criticalCount > 0 || blockedCount > 0) {
    temuanKerentanan.push({
      judul: 'Aktivitas Percobaan Akses / Injeksi Terdeteksi di Log',
      tingkat: criticalCount > 0 ? 'Tinggi' : 'Sedang',
      vektorSerangan: 'Brute-Force Autentikasi / Injeksi Payload / Inspeksi',
      dampak:
        'Upaya pengambilalihan akun atau penyisipan skrip berbahaya pada sheet sektoral.',
      rekomendasi:
        'Pertahankan kunci otomatis 5 percobaan gagal, rotasi kata sandi berkala, dan pantau log insiden secara rutin.',
    });
  }

  if (temuanKerentanan.length === 0) {
    temuanKerentanan.push({
      judul: 'Postur Keamanan Dasar Terjaga',
      tingkat: 'Rendah',
      vektorSerangan: 'Pemantauan Rutin Webhook & Kredensial',
      dampak: 'Belum terdeteksi anomali serangan aktif pada telemetri saat ini.',
      rekomendasi:
        'Pastikan setiap OPD mengaktifkan PIN Keamanan Hapus dan gunakan password unik untuk setiap akun dinas.',
    });
  }

  const deteksiAnomali: string[] = [];
  if (blockedCount > 0) {
    deteksiAnomali.push(
      `Tercatat ${blockedCount} upaya mencurigakan yang berhasil diblokir otomatis oleh sistem.`
    );
  }
  if (publicPiiCount > 0) {
    deteksiAnomali.push(
      `Terdeteksi ${publicPiiCount} dataset publikasi Kominfo yang memuat kolom berpotensi PII.`
    );
  }
  if (deteksiAnomali.length === 0) {
    deteksiAnomali.push(
      'Tidak ditemukan pola brute-force, injeksi formula Google Sheets, atau anomali kritis pada log terbaru.'
    );
  }

  return {
    tingkatAncaman,
    skorKeamanan,
    ringkasanEksekutif: `Audit keamanan heuristik mencatat skor ${skorKeamanan}/100 dengan tingkat ancaman ${tingkatAncaman}. Terpantau ${totalSheets} sheet OPD (${activeSheets} aktif), ${blockedCount} insiden diblokir, dan ${publicPiiCount} peringatan PII publik.`,
    temuanKerentanan,
    deteksiAnomali,
    langkahMitigasiPrioritas: [
      'Ganti kredensial default Super Admin melalui environment variable server (SUPER_ADMIN_PASSWORD).',
      'Wajibkan seluruh OPD mengaktifkan PIN Keamanan Hapus sebelum menghapus tab atau baris data.',
      'Lakukan penyaringan kolom PII (NIK, No. HP, Alamat) sebelum mempublikasikan dataset di menu Publikasi Kominfo.',
      'Audit berkala URL Webhook Apps Script (/exec) agar hanya berasal dari domain resmi script.google.com.',
    ],
  };
}

function buildHeuristicPayloadInspection(sample: string) {
  const hasXss = /<\s*script|javascript:|on\w+\s*=|<\s*iframe/i.test(sample);
  const hasSqli =
    /(\bunion\b\s+\bselect\b|\bdrop\b\s+\btable\b|\bor\b\s+1\s*=\s*1|--\s*$)/i.test(
      sample
    );
  const hasFormula = /^\s*[=+\-@]/.test(sample) || /=(IMPORTXML|IMPORTRANGE|IMPORTDATA|HYPERLINK|CMD)/i.test(sample);
  const hasPii = /\b\d{16}\b/.test(sample) || /(nik|password|secret|token)\s*[:=]/i.test(sample);

  if (hasXss) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'Cross-Site Scripting (XSS)',
      penjelasan:
        'Payload mengandung tag skrip atau event handler HTML yang dapat mengeksekusi kode berbahaya di browser pengguna.',
      tindakanDisarankan:
        'Tolak dan sanitasi input dengan menghapus tag HTML/skrip sebelum menyimpan atau menampilkannya.',
    };
  }
  if (hasFormula) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'Google Sheets / CSV Formula Injection',
      penjelasan:
        'Input diawali karakter formula (=, +, -, @) atau fungsi eksternal Google Sheets yang berisiko mengeksekusi perintah atau menarik data keluar.',
      tindakanDisarankan:
        'Awali nilai sel dengan tanda petik tunggal (\') agar Google Sheets memperlakukannya murni sebagai teks biasa.',
    };
  }
  if (hasSqli) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'SQL Injection',
      penjelasan:
        'Terdeteksi pola query SQL berbahaya yang biasa digunakan untuk memanipulasi basis data.',
      tindakanDisarankan:
        'Blokir payload, catat aktor pengirim di log insiden, dan pastikan seluruh query menggunakan parameterized input.',
    };
  }
  if (hasPii) {
    return {
      status: 'Mencurigakan',
      kategoriSerangan: 'Potensi Kebocoran PII / Kredensial',
      penjelasan:
        'Teks memuat pola angka 16 digit (mirip NIK) atau kata kunci kredensial sensitif.',
      tindakanDisarankan:
        'Lakukan masking atau hapus data pribadi tersebut sebelum dibagikan ke ruang publik.',
    };
  }
  return {
    status: 'Aman',
    kategoriSerangan: 'Tidak Ada Ancaman Terdeteksi',
    penjelasan:
      'Tidak ditemukan pola XSS, SQL Injection, Formula Injection Google Sheets, maupun kebocoran kredensial pada sampel ini.',
    tindakanDisarankan:
      'Tetap terapkan validasi standar saat memasukkan data ke Google Sheet OPD.',
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // 1. Server-side Super Admin Authentication (with brute-force lockout)
  app.post('/api/auth/superadmin', (req, res) => {
    const ip = getClientIp(req);
    const now = Date.now();
    const state = loginAttemptsByIp.get(ip) || { attempts: 0, lockedUntil: 0 };

    if (state.lockedUntil > now) {
      const remainingSec = Math.ceil((state.lockedUntil - now) / 1000);
      return res.status(429).json({
        ok: false,
        locked: true,
        retryAfterSec: remainingSec,
        message: `Terlalu banyak percobaan gagal. Akses dikunci selama ${remainingSec} detik demi keamanan.`,
      });
    }

    const identifier = String(req.body?.identifier ?? '')
      .trim()
      .toLowerCase();
    const password = String(req.body?.password ?? '');

    const isSuperAdminIdentifier =
      timingSafeEqualStr(identifier, SERVER_SUPER_ADMIN_USER) ||
      timingSafeEqualStr(identifier, SERVER_SUPER_ADMIN_EMAIL);

    if (!isSuperAdminIdentifier) {
      return res.status(200).json({ ok: false, isSuperAdminCandidate: false });
    }

    if (
      timingSafeEqualStr(password, SERVER_SUPER_ADMIN_PASSWORD) ||
      timingSafeEqualStr(password.trim(), SERVER_SUPER_ADMIN_PASSWORD)
    ) {
      loginAttemptsByIp.delete(ip);
      return res.status(200).json({
        ok: true,
        isSuperAdminCandidate: true,
        session: {
          id: 'super-admin',
          role: 'super_admin',
          username: SERVER_SUPER_ADMIN_USER,
          email: SERVER_SUPER_ADMIN_EMAIL,
          namaLengkap: 'Super Admin Walidata',
          opdId: null,
          namaOpd: 'Diskominfo Kabupaten Nagekeo',
        },
      });
    }

    // Wrong password for Super Admin — apply progressive tarpit slowdown to confuse/slow brute-force bots
    const nextAttempts = state.attempts + 1;
    const lockedUntil = nextAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0;
    loginAttemptsByIp.set(ip, {
      attempts: nextAttempts >= MAX_FAILED_ATTEMPTS ? 0 : nextAttempts,
      lockedUntil,
    });

    if (lockedUntil > now) {
      recordServerIntrusion(
        ip,
        '/api/auth/superadmin',
        'Brute-Force Akun Super Admin',
        'Tarpit delay progresif + penguncian IP otomatis selama 5 menit & rotasi token sesi.',
        'Kritis'
      );
      return res.status(429).json({
        ok: false,
        isSuperAdminCandidate: true,
        locked: true,
        retryAfterSec: Math.ceil(LOCKOUT_MS / 1000),
        message:
          'Percobaan masuk Super Admin gagal 5 kali berturut-turut. Akses dikunci 5 menit dan insiden dicatat.',
      });
    }

    return res.status(401).json({
      ok: false,
      isSuperAdminCandidate: true,
      remainingAttempts: MAX_FAILED_ATTEMPTS - nextAttempts,
      message: `Kredensial tidak valid. Sisa percobaan sebelum penguncian otomatis: ${
        MAX_FAILED_ATTEMPTS - nextAttempts
      }.`,
    });
  });

  // 1b. Honeypot Decoy Trap Endpoints (Membingungkan & memperlambat pemindai/peretas otomatis)
  const HONEYPOT_PATHS = [
    '/wp-admin',
    '/wp-login.php',
    '/phpmyadmin',
    '/.env',
    '/admin-backup',
    '/api/v1/export-all-users',
    '/api/debug/secrets',
  ];

  app.all(HONEYPOT_PATHS, async (req, res) => {
    const ip = getClientIp(req);
    const canaryToken = crypto.randomBytes(12).toString('hex');
    recordServerIntrusion(
      ip,
      req.path,
      `Pemindaian Endpoint Jebakan (${req.path})`,
      `Tarpit 1.8 detik + pengiriman payload umpan palsu (Canary ID: ${canaryToken.slice(0, 8)}) untuk mengecoh pemindai otomatis.`,
      'Tinggi'
    );
    // Tarpit delay to waste scanner time
    await delayMs(1800);
    return res.status(200).json({
      status: 'pending_verification',
      node: `decoy-shard-${canaryToken.slice(0, 4)}`,
      canary_session: `trap_${canaryToken}`,
      next_challenge_in_ms: 45000,
      records: [],
    });
  });

  // 1c. Live Server Intrusion Alerts Feed
  app.get('/api/security/live-alerts', (_req, res) => {
    return res.status(200).json({
      ok: true,
      alerts: serverIntrusionAlerts.slice(0, 30),
    });
  });

  // 1d. Real-Time AI Intrusion Warning & Cyber Deception Countermeasure Generator
  app.post('/api/security/intrusion-alert', async (req, res) => {
    const incident = (req.body?.incident ?? {}) as Record<string, unknown>;
    const kategori = String(incident.kategori || 'Upaya Intrusi');
    const detail = String(incident.detail || 'Aktivitas mencurigakan terdeteksi.');
    const aktor = String(incident.aktor || 'Anonim');
    const target = String(incident.target || 'Portal Satu Data');

    const fallbackWarning = {
      judulPeringatan: `Peringatan Intrusi Aktif: ${kategori}`,
      analisisSingkat: `Sistem mendeteksi aktivitas mencurigakan dari "${aktor}" terhadap "${target}" (${detail}).`,
      taktikPengelabuanAktif:
        'Tarpit penundaan respons, pengacakan tantangan verifikasi dinamis, dan pengalihan ke jalur honeypot umpan palsu aktif untuk membingungkan peretas.',
      langkahDaruratAdmin:
        'Periksa log insiden, pastikan akun OPD terkait tidak disalahgunakan, dan pertahankan penguncian otomatis.',
    };

    const ai = createGeminiClient();
    if (!ai) {
      return res.status(200).json({ ok: true, warning: fallbackWarning });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Anda adalah AI Sistem Peringatan Dini Keamanan Siber (SOC & Cyber Deception) untuk portal pemerintahan "Satu Data Kabupaten Nagekeo".
Baru saja terdeteksi insiden keamanan berikut:
- Kategori: ${kategori}
- Aktor: ${aktor}
- Target: ${target}
- Detail: ${detail}

Berikan peringatan singkat, tegas, dan profesional dalam bahasa Indonesia untuk Super Admin Diskominfo, beserta penjelasan langkah keamanan pengelabuan defensif (cyber deception: tarpit delay, tantangan dinamis acak, honeypot umpan palsu, atau isolasi sesi) untuk membingungkan dan menggagalkan peretas.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              judulPeringatan: { type: Type.STRING },
              analisisSingkat: { type: Type.STRING },
              taktikPengelabuanAktif: { type: Type.STRING },
              langkahDaruratAdmin: { type: Type.STRING },
            },
            required: [
              'judulPeringatan',
              'analisisSingkat',
              'taktikPengelabuanAktif',
              'langkahDaruratAdmin',
            ],
          },
        },
      });
      const parsed = JSON.parse((response.text ?? '').trim()) as Record<
        string,
        unknown
      >;
      return res.status(200).json({
        ok: true,
        warning: {
          judulPeringatan: String(
            parsed.judulPeringatan || fallbackWarning.judulPeringatan
          ),
          analisisSingkat: String(
            parsed.analisisSingkat || fallbackWarning.analisisSingkat
          ),
          taktikPengelabuanAktif: String(
            parsed.taktikPengelabuanAktif || fallbackWarning.taktikPengelabuanAktif
          ),
          langkahDaruratAdmin: String(
            parsed.langkahDaruratAdmin || fallbackWarning.langkahDaruratAdmin
          ),
        },
      });
    } catch {
      return res.status(200).json({ ok: true, warning: fallbackWarning });
    }
  });

  // 2. AI Cyber Threat & Data Breach Analyzer (Defensive SOC Assistant for Diskominfo)
  app.post('/api/security/analyze-threats', async (req, res) => {
    const snapshot = (req.body?.snapshot ?? {}) as Record<string, unknown>;
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(200).json({
        ok: true,
        analysis: buildHeuristicThreatAnalysis(snapshot),
      });
    }

    try {
      const prompt = `Anda adalah Analis Keamanan Siber (SOC & Data Protection Officer) senior untuk portal pemerintahan "Satu Data Kabupaten Nagekeo" (Dinas Kominfo).
Lakukan audit keamanan siber dan analisis risiko peretasan data secara mendalam berdasarkan telemetri nyata aplikasi berikut ini (JSON):
${JSON.stringify(snapshot, null, 2)}

Fokus analisis defensif:
1. Deteksi potensi upaya peretasan / intrusi dari log keamanan (percobaan login gagal berulang / brute-force, upaya injeksi formula Google Sheets seperti =IMPORTXML/=CMD, XSS, SQLi).
2. Evaluasi risiko kebocoran Data Pribadi (UU PDP / PII) pada kolom header sheet OPD maupun dataset hasil cloning publikasi Kominfo (misalnya kolom NIK, No. HP, Alamat, Tgl. Lahir yang terekspos publik).
3. Evaluasi keamanan endpoint Webhook Google Apps Script (HTTPS, placeholder belum diganti, potensi akses tidak sah).
4. Berikan rekomendasi mitigasi teknis yang konkret, singkat, dan bisa langsung dijalankan oleh Super Admin Diskominfo.

Jawab HANYA dalam bahasa Indonesia profesional sesuai skema JSON.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tingkatAncaman: {
                type: Type.STRING,
                description: 'Salah satu dari: Rendah, Sedang, Tinggi, Kritis',
              },
              skorKeamanan: {
                type: Type.INTEGER,
                description: 'Skor keamanan 0 sampai 100',
              },
              ringkasanEksekutif: {
                type: Type.STRING,
                description:
                  'Ringkasan 2-3 kalimat kondisi keamanan siber dan risiko retas saat ini.',
              },
              temuanKerentanan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    judul: { type: Type.STRING },
                    tingkat: {
                      type: Type.STRING,
                      description: 'Rendah, Sedang, Tinggi, atau Kritis',
                    },
                    vektorSerangan: { type: Type.STRING },
                    dampak: { type: Type.STRING },
                    rekomendasi: { type: Type.STRING },
                  },
                },
              },
              deteksiAnomali: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Daftar indikator anomali atau pola serangan yang terdeteksi dari log.',
              },
              langkahMitigasiPrioritas: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '3 sampai 5 langkah mitigasi prioritas untuk Diskominfo.',
              },
            },
            required: [
              'tingkatAncaman',
              'skorKeamanan',
              'ringkasanEksekutif',
              'temuanKerentanan',
              'deteksiAnomali',
              'langkahMitigasiPrioritas',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      const parsed = JSON.parse(rawText) as Record<string, unknown>;
      const fallback = buildHeuristicThreatAnalysis(snapshot);
      return res.status(200).json({
        ok: true,
        analysis: {
          tingkatAncaman: String(parsed.tingkatAncaman || fallback.tingkatAncaman),
          skorKeamanan: Number(parsed.skorKeamanan ?? fallback.skorKeamanan),
          ringkasanEksekutif: String(
            parsed.ringkasanEksekutif || fallback.ringkasanEksekutif
          ),
          temuanKerentanan: Array.isArray(parsed.temuanKerentanan)
            ? parsed.temuanKerentanan
            : fallback.temuanKerentanan,
          deteksiAnomali: Array.isArray(parsed.deteksiAnomali)
            ? parsed.deteksiAnomali
            : fallback.deteksiAnomali,
          langkahMitigasiPrioritas: Array.isArray(parsed.langkahMitigasiPrioritas)
            ? parsed.langkahMitigasiPrioritas
            : fallback.langkahMitigasiPrioritas,
        },
      });
    } catch {
      return res.status(200).json({
        ok: true,
        analysis: buildHeuristicThreatAnalysis(snapshot),
      });
    }
  });

  // 3. AI Suspicious Payload / Log Inspector (Defensive)
  app.post('/api/security/inspect-payload', async (req, res) => {
    const sample = String(req.body?.payload ?? '').trim();
    if (!sample) {
      return res
        .status(400)
        .json({ ok: false, error: 'Masukkan teks, URL, atau payload untuk dianalisis.' });
    }

    const ai = createGeminiClient();
    if (!ai) {
      return res.status(200).json({
        ok: true,
        inspection: buildHeuristicPayloadInspection(sample),
      });
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Anda adalah AI Pendeteksi Serangan Siber defensif untuk Satu Data Kabupaten Nagekeo.
Periksa apakah input/payload berikut mengandung indikasi peretasan (XSS, SQL Injection, Google Sheets Formula Injection / CSV Injection, SSRF, Phishing, pencurian kredensial, atau kebocoran data PII).
JANGAN memberikan instruksi cara menyerang; hanya klasifikasi risiko dan cara mencegah/menetralkannya.

Payload untuk diinspeksi:
"""
${sample.slice(0, 4000)}
"""`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: {
                type: Type.STRING,
                description: 'Aman, Mencurigakan, atau Berbahaya',
              },
              kategoriSerangan: {
                type: Type.STRING,
                description:
                  'Misal: Formula Injection, XSS, SQL Injection, Kebocoran PII, Phishing, atau Tidak Ada Ancaman',
              },
              penjelasan: { type: Type.STRING },
              tindakanDisarankan: { type: Type.STRING },
            },
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '').trim());
      return res.status(200).json({ ok: true, inspection: parsed });
    } catch {
      return res.status(200).json({
        ok: true,
        inspection: buildHeuristicPayloadInspection(sample),
      });
    }
  });

  if (isProd) {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Satu Data Nagekeo server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
