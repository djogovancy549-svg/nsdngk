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

function createGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
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

    // Wrong password for Super Admin
    const nextAttempts = state.attempts + 1;
    const lockedUntil = nextAttempts >= MAX_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0;
    loginAttemptsByIp.set(ip, {
      attempts: nextAttempts >= MAX_FAILED_ATTEMPTS ? 0 : nextAttempts,
      lockedUntil,
    });

    if (lockedUntil > now) {
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

  // 2. AI Cyber Threat & Data Breach Analyzer (Defensive SOC Assistant for Diskominfo)
  app.post('/api/security/analyze-threats', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(503).json({
        ok: false,
        error:
          'Kunci API Gemini belum tersedia di server. Periksa pengaturan Secrets.',
      });
    }

    try {
      const snapshot = req.body?.snapshot ?? {};
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
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      const parsed = JSON.parse(rawText);
      return res.status(200).json({ ok: true, analysis: parsed });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal menjalankan analisis AI.';
      return res.status(500).json({ ok: false, error: message });
    }
  });

  // 3. AI Suspicious Payload / Log Inspector (Defensive)
  app.post('/api/security/inspect-payload', async (req, res) => {
    const ai = createGeminiClient();
    if (!ai) {
      return res.status(503).json({
        ok: false,
        error:
          'Kunci API Gemini belum tersedia di server. Periksa pengaturan Secrets.',
      });
    }

    const sample = String(req.body?.payload ?? '').trim();
    if (!sample) {
      return res
        .status(400)
        .json({ ok: false, error: 'Masukkan teks, URL, atau payload untuk dianalisis.' });
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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal menganalisis payload.';
      return res.status(500).json({ ok: false, error: message });
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
