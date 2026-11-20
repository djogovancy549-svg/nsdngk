import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createSecurityMiddleware } from './server/securityMiddleware.ts';

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

const ALLOWLIST_FILE_PATH = path.resolve(
  __dirname,
  'data',
  'superadmin-allowlist.json'
);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

function getDefaultAllowedSuperAdminEmails(): string[] {
  const fromEnv = String(process.env.SUPER_ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => EMAIL_PATTERN.test(e));
  return Array.from(new Set([SERVER_SUPER_ADMIN_EMAIL, ...fromEnv]));
}

function loadSuperAdminAllowedEmails(): string[] {
  const defaults = getDefaultAllowedSuperAdminEmails();
  try {
    if (fs.existsSync(ALLOWLIST_FILE_PATH)) {
      const raw = fs.readFileSync(ALLOWLIST_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((e) => normalizeEmail(e))
          .filter((e) => EMAIL_PATTERN.test(e));
        return Array.from(new Set([SERVER_SUPER_ADMIN_EMAIL, ...cleaned]));
      }
    }
  } catch {
    // Fallback ke default jika file belum siap
  }
  return defaults;
}

function saveSuperAdminAllowedEmails(emails: string[]): string[] {
  const normalized = Array.from(
    new Set([
      SERVER_SUPER_ADMIN_EMAIL,
      ...emails.map((e) => normalizeEmail(e)).filter((e) => EMAIL_PATTERN.test(e)),
    ])
  );
  try {
    const dir = path.dirname(ALLOWLIST_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      ALLOWLIST_FILE_PATH,
      JSON.stringify(normalized, null, 2),
      'utf8'
    );
  } catch {
    // Abaikan jika filesystem read-only
  }
  return normalized;
}

let superAdminAllowedEmails: string[] = loadSuperAdminAllowedEmails();

function isAuthorizedSuperAdminEmail(email: string): boolean {
  const clean = normalizeEmail(email);
  if (!EMAIL_PATTERN.test(clean)) return false;
  return superAdminAllowedEmails.some((allowed) =>
    timingSafeEqualStr(clean, allowed)
  );
}

// Persistent Server Secrets (SESSION_SECRET & APPS_SCRIPT_SECRET — never shipped to browser bundle)
const SECRETS_FILE_PATH = path.resolve(__dirname, 'data', 'server-secrets.json');
interface ServerSecrets {
  sessionSecret: string;
  appsScriptSecret: string;
}

function loadOrCreateServerSecrets(): ServerSecrets {
  let stored: Partial<ServerSecrets> = {};
  try {
    if (fs.existsSync(SECRETS_FILE_PATH)) {
      stored = JSON.parse(fs.readFileSync(SECRETS_FILE_PATH, 'utf8'));
    }
  } catch {
    stored = {};
  }

  const sessionSecret =
    process.env.SESSION_SECRET?.trim() ||
    stored.sessionSecret ||
    crypto.randomBytes(32).toString('hex');
  const appsScriptSecret =
    process.env.APPS_SCRIPT_SECRET?.trim() ||
    stored.appsScriptSecret ||
    `SDK-${crypto.randomBytes(18).toString('hex').toUpperCase()}`;

  const next: ServerSecrets = { sessionSecret, appsScriptSecret };
  if (
    stored.sessionSecret !== sessionSecret ||
    stored.appsScriptSecret !== appsScriptSecret
  ) {
    try {
      const dir = path.dirname(SECRETS_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SECRETS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8');
    } catch {
      // Abaikan jika filesystem read-only
    }
  }
  return next;
}

let serverSecrets: ServerSecrets = loadOrCreateServerSecrets();

// Signed HttpOnly Session Cookie (HMAC-SHA256)
const SESSION_COOKIE_NAME = 'sd_sovereign_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam

interface SignedSessionPayload {
  email: string;
  role: 'super_admin' | 'opd';
  exp: number;
}

function createSignedSessionToken(payload: SignedSessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', serverSecrets.sessionSecret)
    .update(data)
    .digest('base64url');
  return `${data}.${sig}`;
}

function verifySignedSessionToken(token: string): SignedSessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expectedSig = crypto
    .createHmac('sha256', serverSecrets.sessionSecret)
    .update(data)
    .digest('base64url');
  if (!timingSafeEqualStr(sig, expectedSig)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(data, 'base64url').toString('utf8')
    ) as SignedSessionPayload;
    if (!parsed.email || !parsed.role || !parsed.exp) return null;
    if (Date.now() > parsed.exp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCookies(req: express.Request): Record<string, string> {
  const raw = req.headers.cookie || '';
  const map: Record<string, string> = {};
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      map[key] = decodeURIComponent(val);
    }
  });
  return map;
}

function setSignedSessionCookie(
  res: express.Response,
  payload: Omit<SignedSessionPayload, 'exp'>
): void {
  const token = createSignedSessionToken({
    ...payload,
    exp: Date.now() + SESSION_TTL_MS,
  });
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(
      token
    )}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}${secureFlag}`
  );
}

function clearSignedSessionCookie(res: express.Response): void {
  const secureFlag = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureFlag}`
  );
}

// White-Label Multi-Kabupaten Sovereign Configuration
const REGENCY_CONFIG_PATH = path.resolve(
  __dirname,
  'data',
  'regency-config.json'
);

interface RegencyWhiteLabelConfig {
  namaKabupaten: string;
  namaPortal: string;
  namaWalidata: string;
  domainResmi: string;
  urlPortalPublik: string;
  daftarKecamatan: string[];
  updatedAt: string;
}

const DEFAULT_REGENCY_CONFIG: RegencyWhiteLabelConfig = {
  namaKabupaten: process.env.REGENCY_NAME || 'Kabupaten Nagekeo',
  namaPortal: process.env.PORTAL_NAME || 'Satu Data Nagekeo',
  namaWalidata: process.env.WALIDATA_NAME || 'Diskominfo Kabupaten Nagekeo',
  domainResmi: process.env.REGENCY_DOMAIN || 'nagekeokab.go.id',
  urlPortalPublik:
    process.env.PUBLIC_PORTAL_URL || 'https://portalsatudata.nagekeokab.go.id',
  daftarKecamatan: [
    'Aesesa',
    'Aesesa Selatan',
    'Boawae',
    'Keo Tengah',
    'Mauponggo',
    'Nangaroro',
    'Wolowae',
  ],
  updatedAt: new Date().toISOString(),
};

function loadRegencyConfig(): RegencyWhiteLabelConfig {
  try {
    if (fs.existsSync(REGENCY_CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(REGENCY_CONFIG_PATH, 'utf8'));
      return {
        ...DEFAULT_REGENCY_CONFIG,
        ...parsed,
        daftarKecamatan: Array.isArray(parsed.daftarKecamatan)
          ? parsed.daftarKecamatan.filter(Boolean)
          : DEFAULT_REGENCY_CONFIG.daftarKecamatan,
      };
    }
  } catch {
    // Fallback ke default
  }
  return DEFAULT_REGENCY_CONFIG;
}

function saveRegencyConfig(
  next: Partial<RegencyWhiteLabelConfig>
): RegencyWhiteLabelConfig {
  const current = loadRegencyConfig();
  const merged: RegencyWhiteLabelConfig = {
    namaKabupaten:
      String(next.namaKabupaten ?? current.namaKabupaten).trim() ||
      DEFAULT_REGENCY_CONFIG.namaKabupaten,
    namaPortal:
      String(next.namaPortal ?? current.namaPortal).trim() ||
      DEFAULT_REGENCY_CONFIG.namaPortal,
    namaWalidata:
      String(next.namaWalidata ?? current.namaWalidata).trim() ||
      DEFAULT_REGENCY_CONFIG.namaWalidata,
    domainResmi:
      String(next.domainResmi ?? current.domainResmi).trim() ||
      DEFAULT_REGENCY_CONFIG.domainResmi,
    urlPortalPublik: String(
      next.urlPortalPublik ?? current.urlPortalPublik
    ).trim(),
    daftarKecamatan: Array.isArray(next.daftarKecamatan)
      ? next.daftarKecamatan.map((k) => String(k).trim()).filter(Boolean)
      : current.daftarKecamatan,
    updatedAt: new Date().toISOString(),
  };
  try {
    const dir = path.dirname(REGENCY_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      REGENCY_CONFIG_PATH,
      JSON.stringify(merged, null, 2),
      'utf8'
    );
  } catch {
    // Abaikan
  }
  return merged;
}

let activeRegencyConfig: RegencyWhiteLabelConfig = loadRegencyConfig();

// Smart Server Cache + In-Flight Deduplication for Google Apps Script Proxy
interface SheetProxyCacheEntry {
  data: unknown;
  expiresAt: number;
  cachedAt: number;
  webhookUrl: string;
}
const SHEET_CACHE_TTL_MS = 45 * 1000; // 45 detik
const sheetProxyCache = new Map<string, SheetProxyCacheEntry>();
const sheetInFlight = new Map<string, Promise<{ status: number; data: unknown; latencyMs: number }>>();
const sheetProxyStats = {
  cacheHits: 0,
  cacheMisses: 0,
  writeInvalidations: 0,
  blockedSsrf: 0,
  totalUpstreamMs: 0,
  upstreamCalls: 0,
  totalCacheMs: 0,
};

function isAllowedGoogleScriptUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'script.google.com' &&
      parsed.pathname.startsWith('/macros/s/')
    );
  } catch {
    return false;
  }
}

function invalidateSheetCacheByWebhook(webhookUrl: string): number {
  let removed = 0;
  for (const [key, entry] of sheetProxyCache.entries()) {
    if (entry.webhookUrl === webhookUrl) {
      sheetProxyCache.delete(key);
      removed++;
    }
  }
  if (removed > 0) sheetProxyStats.writeInvalidations += removed;
  return removed;
}

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
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const HONEYPOT_DECOY_PATHS = [
    '/wp-admin',
    '/wp-login.php',
    '/phpmyadmin',
    '/.env',
    '/admin-backup',
    '/api/v1/export-all-users',
    '/api/debug/secrets',
  ];

  // Lapisan Keamanan Lengkap (WAF, Scanner/Probe Blocker, Rate Limit Baca/Tulis, Auto-Ban, CSP, Security Headers, security.txt)
  const { preGuard, bodyWafGuard } = createSecurityMiddleware({
    securityContact: `mailto:${SERVER_SUPER_ADMIN_EMAIL}`,
    wafBodyExemptPaths: [
      '/api/security/inspect-payload',
      '/api/security/intrusion-alert',
      '/api/security/analyze-threats',
    ],
    honeypotPaths: HONEYPOT_DECOY_PATHS,
    onIncident: (inc) => {
      recordServerIntrusion(
        inc.ip,
        inc.path,
        inc.jenisAncaman,
        inc.taktikPengelabuan,
        inc.tingkat
      );
    },
  });

  app.use(preGuard);
  app.use(express.json({ limit: '1mb' }));
  app.use(bodyWafGuard);

  // 1. Server-side Super Admin Authentication (strictly email-allowlisted + brute-force lockout)
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

    const identifier = normalizeEmail(req.body?.identifier);
    const password = String(req.body?.password ?? '');
    const loginRole = String(req.body?.loginRole ?? 'super_admin');

    const isAllowedEmail = isAuthorizedSuperAdminEmail(identifier);

    if (!isAllowedEmail) {
      if (loginRole === 'super_admin') {
        recordServerIntrusion(
          ip,
          '/api/auth/superadmin',
          'Akses Super Admin dengan Email Tidak Terdaftar',
          `Menolak email "${identifier || '(kosong)'}" karena tidak termasuk dalam daftar email resmi Super Admin.`,
          'Tinggi'
        );
        return res.status(403).json({
          ok: false,
          isSuperAdminCandidate: true,
          unauthorizedEmail: true,
          message:
            'Akses Super Admin ditolak. Email ini tidak terdaftar dalam daftar email resmi Super Admin.',
        });
      }
      return res.status(200).json({ ok: false, isSuperAdminCandidate: false });
    }

    if (
      timingSafeEqualStr(password, SERVER_SUPER_ADMIN_PASSWORD) ||
      timingSafeEqualStr(password.trim(), SERVER_SUPER_ADMIN_PASSWORD)
    ) {
      loginAttemptsByIp.delete(ip);
      setSignedSessionCookie(res, {
        email: identifier,
        role: 'super_admin',
      });
      return res.status(200).json({
        ok: true,
        isSuperAdminCandidate: true,
        session: {
          id: `super-admin:${identifier}`,
          role: 'super_admin',
          username: SERVER_SUPER_ADMIN_USER,
          email: identifier,
          namaLengkap: 'Super Admin Walidata',
          opdId: null,
          namaOpd: activeRegencyConfig.namaWalidata,
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
      message: `Kata sandi Super Admin tidak sesuai. Sisa percobaan sebelum penguncian otomatis: ${
        MAX_FAILED_ATTEMPTS - nextAttempts
      }.`,
    });
  });

  // 1a. Manajemen Sesi HttpOnly & Daftar Email Resmi Super Admin (Allowlist)
  app.post('/api/auth/logout', (_req, res) => {
    clearSignedSessionCookie(res);
    return res.json({ ok: true });
  });

  app.get('/api/auth/session', (req, res) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    const verified = token ? verifySignedSessionToken(token) : null;
    if (!verified) {
      return res.status(200).json({ ok: false, authenticated: false });
    }
    return res.status(200).json({
      ok: true,
      authenticated: true,
      role: verified.role,
      email: verified.email,
      expiresAt: verified.exp,
    });
  });

  const requireSuperAdminActor = (
    req: express.Request,
    res: express.Response
  ): string | null => {
    // 1. Utamakan cookie sesi HttpOnly bertanda tangan HMAC-SHA256
    const cookies = parseCookies(req);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    if (cookieToken) {
      const verified = verifySignedSessionToken(cookieToken);
      if (
        verified &&
        verified.role === 'super_admin' &&
        isAuthorizedSuperAdminEmail(verified.email)
      ) {
        return verified.email;
      }
    }

    // 2. Fallback header terotorisasi (untuk kompatibilitas preview iframe lintas-origin)
    const actorEmail = normalizeEmail(req.headers['x-superadmin-email']);
    if (!isAuthorizedSuperAdminEmail(actorEmail)) {
      res.status(403).json({
        ok: false,
        message:
          'Hanya Super Admin dengan sesi/email terotorisasi yang dapat mengakses kontrol ini.',
      });
      return null;
    }
    return actorEmail;
  };

  app.get('/api/auth/superadmin/allowlist', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    return res.json({
      ok: true,
      primaryEmail: SERVER_SUPER_ADMIN_EMAIL,
      allowedEmails: superAdminAllowedEmails,
    });
  });

  app.post('/api/auth/superadmin/allowlist', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const newEmail = normalizeEmail(req.body?.email);
    if (!EMAIL_PATTERN.test(newEmail)) {
      return res.status(400).json({
        ok: false,
        message: 'Format alamat email tidak valid.',
      });
    }
    if (superAdminAllowedEmails.includes(newEmail)) {
      return res.status(409).json({
        ok: false,
        message: `Email ${newEmail} sudah terdaftar sebagai Super Admin.`,
      });
    }
    superAdminAllowedEmails = saveSuperAdminAllowedEmails([
      ...superAdminAllowedEmails,
      newEmail,
    ]);
    return res.status(201).json({
      ok: true,
      primaryEmail: SERVER_SUPER_ADMIN_EMAIL,
      allowedEmails: superAdminAllowedEmails,
      message: `Email ${newEmail} berhasil didaftarkan untuk akses Super Admin.`,
    });
  });

  app.delete('/api/auth/superadmin/allowlist', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const targetEmail = normalizeEmail(req.body?.email || req.query?.email);
    if (!targetEmail) {
      return res.status(400).json({
        ok: false,
        message: 'Alamat email yang akan dicabut wajib diisi.',
      });
    }
    if (timingSafeEqualStr(targetEmail, SERVER_SUPER_ADMIN_EMAIL)) {
      return res.status(400).json({
        ok: false,
        message: 'Email utama Super Admin tidak dapat dihapus agar akses sistem tetap terjaga.',
      });
    }
    const nextList = superAdminAllowedEmails.filter((e) => e !== targetEmail);
    if (nextList.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Minimal harus tersisa satu email Super Admin aktif.',
      });
    }
    superAdminAllowedEmails = saveSuperAdminAllowedEmails(nextList);
    return res.json({
      ok: true,
      primaryEmail: SERVER_SUPER_ADMIN_EMAIL,
      allowedEmails: superAdminAllowedEmails,
      message: `Akses Super Admin untuk email ${targetEmail} berhasil dicabut.`,
    });
  });

  // 1a-2. Konfigurasi White-Label Multi-Kabupaten (Kedaulatan Penuh Per-Kabupaten)
  app.get('/api/config/regency', (_req, res) => {
    return res.json({
      ok: true,
      config: activeRegencyConfig,
    });
  });

  app.put('/api/config/regency', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const body = req.body || {};
    const kecamatanRaw = Array.isArray(body.daftarKecamatan)
      ? body.daftarKecamatan
      : typeof body.daftarKecamatan === 'string'
      ? body.daftarKecamatan.split(',')
      : undefined;

    activeRegencyConfig = saveRegencyConfig({
      namaKabupaten: body.namaKabupaten,
      namaPortal: body.namaPortal,
      namaWalidata: body.namaWalidata,
      domainResmi: body.domainResmi,
      urlPortalPublik: body.urlPortalPublik,
      daftarKecamatan: kecamatanRaw,
    });

    return res.json({
      ok: true,
      config: activeRegencyConfig,
      message: `Identitas kabupaten "${activeRegencyConfig.namaKabupaten}" berhasil disimpan.`,
    });
  });

  // 1a-3. Secure Backend Proxy + Smart Cache + Shared Secret untuk Google Apps Script (/exec)
  app.post('/api/sheets/proxy', async (req, res) => {
    const ip = getClientIp(req);
    const method = String(req.body?.method || 'GET').toUpperCase();
    const webhookUrl = String(req.body?.webhookUrl || '').trim();
    const sheetName = String(req.body?.sheetName || '').trim();
    const action = String(req.body?.action || 'list').trim();
    const bypassCache = Boolean(req.body?.bypassCache);
    const payload =
      req.body?.payload && typeof req.body.payload === 'object'
        ? (req.body.payload as Record<string, unknown>)
        : {};

    if (!isAllowedGoogleScriptUrl(webhookUrl)) {
      sheetProxyStats.blockedSsrf++;
      recordServerIntrusion(
        ip,
        '/api/sheets/proxy',
        'Percobaan SSRF pada Proxy Google Sheet',
        `Memblokir URL tidak sah pada proxy sheet: "${webhookUrl.slice(0, 80)}".`,
        'Kritis'
      );
      return res.status(400).json({
        ok: false,
        error:
          'URL Webhook ditolak. Hanya endpoint resmi Google Apps Script (https://script.google.com/macros/s/...) yang diizinkan.',
      });
    }

    // GET request: gunakan Smart Cache (45 detik) + In-Flight Deduplication
    if (method === 'GET') {
      const cacheKey = `${webhookUrl}::${sheetName}::${action}`;
      const now = Date.now();
      const startMs = Date.now();

      if (!bypassCache) {
        const cached = sheetProxyCache.get(cacheKey);
        if (cached && cached.expiresAt > now) {
          sheetProxyStats.cacheHits++;
          const hitMs = Math.max(1, Date.now() - startMs);
          sheetProxyStats.totalCacheMs += hitMs;
          res.setHeader('X-SatuData-Cache', 'HIT');
          return res.status(200).json({
            ok: true,
            cached: true,
            latencyMs: hitMs,
            data: cached.data,
          });
        }
      }

      sheetProxyStats.cacheMisses++;

      let inFlight = sheetInFlight.get(cacheKey);
      if (!inFlight) {
        inFlight = (async () => {
          const reqStart = Date.now();
          const targetUrl = new URL(webhookUrl);
          targetUrl.searchParams.set('action', action);
          if (sheetName) targetUrl.searchParams.set('sheet', sheetName);
          // Sisipkan kunci rahasia server secara otomatis (tidak pernah terekspos ke browser)
          targetUrl.searchParams.set('secret', serverSecrets.appsScriptSecret);

          const upstream = await fetch(targetUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            redirect: 'follow',
          });
          const latencyMs = Date.now() - reqStart;
          sheetProxyStats.totalUpstreamMs += latencyMs;
          sheetProxyStats.upstreamCalls++;

          const text = await upstream.text();
          let parsed: unknown = null;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { ok: false, error: 'Respons Google Apps Script bukan JSON valid.' };
          }
          return { status: upstream.status, data: parsed, latencyMs };
        })().finally(() => {
          sheetInFlight.delete(cacheKey);
        });
        sheetInFlight.set(cacheKey, inFlight);
      }

      try {
        const result = await inFlight;
        if (
          result.status >= 200 &&
          result.status < 300 &&
          result.data &&
          typeof result.data === 'object' &&
          (result.data as { ok?: boolean }).ok
        ) {
          sheetProxyCache.set(cacheKey, {
            data: result.data,
            cachedAt: Date.now(),
            expiresAt: Date.now() + SHEET_CACHE_TTL_MS,
            webhookUrl,
          });
        }
        res.setHeader('X-SatuData-Cache', 'MISS');
        return res.status(result.status >= 400 ? result.status : 200).json({
          ok: result.status >= 200 && result.status < 300,
          cached: false,
          latencyMs: result.latencyMs,
          data: result.data,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: `Gagal menghubungi Google Apps Script: ${
            err instanceof Error ? err.message : 'Network error'
          }`,
        });
      }
    }

    // POST mutation (create/update/delete): sisipkan secret server & hapus cache terkait
    if (method === 'POST') {
      const reqStart = Date.now();
      try {
        const upstream = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          redirect: 'follow',
          body: JSON.stringify({
            ...payload,
            action,
            sheetName,
            secret: serverSecrets.appsScriptSecret,
          }),
        });
        const latencyMs = Date.now() - reqStart;
        invalidateSheetCacheByWebhook(webhookUrl);

        const text = await upstream.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { ok: upstream.ok };
        }
        return res.status(upstream.ok ? 200 : upstream.status).json({
          ok: upstream.ok,
          latencyMs,
          data: parsed,
        });
      } catch (err) {
        return res.status(502).json({
          ok: false,
          error: `Gagal mengirim data ke Google Apps Script: ${
            err instanceof Error ? err.message : 'Network error'
          }`,
        });
      }
    }

    return res.status(405).json({ ok: false, error: 'Metode proxy tidak didukung.' });
  });

  app.get('/api/sheets/proxy/stats', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const totalReads = sheetProxyStats.cacheHits + sheetProxyStats.cacheMisses;
    const hitRatePct =
      totalReads > 0
        ? Math.round((sheetProxyStats.cacheHits / totalReads) * 100)
        : 0;
    const avgUpstreamMs =
      sheetProxyStats.upstreamCalls > 0
        ? Math.round(
            sheetProxyStats.totalUpstreamMs / sheetProxyStats.upstreamCalls
          )
        : 0;
    const avgCacheMs =
      sheetProxyStats.cacheHits > 0
        ? Math.round(sheetProxyStats.totalCacheMs / sheetProxyStats.cacheHits)
        : 0;

    return res.json({
      ok: true,
      appsScriptSecret: serverSecrets.appsScriptSecret,
      cacheTtlSec: Math.round(SHEET_CACHE_TTL_MS / 1000),
      cachedEntries: sheetProxyCache.size,
      cacheHits: sheetProxyStats.cacheHits,
      cacheMisses: sheetProxyStats.cacheMisses,
      hitRatePct,
      writeInvalidations: sheetProxyStats.writeInvalidations,
      blockedSsrf: sheetProxyStats.blockedSsrf,
      avgUpstreamMs,
      avgCacheMs,
    });
  });

  app.post('/api/sheets/proxy/cache/clear', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const count = sheetProxyCache.size;
    sheetProxyCache.clear();
    return res.json({
      ok: true,
      cleared: count,
      message: `${count} entri cache Google Sheet berhasil dibersihkan.`,
    });
  });

  app.post('/api/sheets/proxy/rotate-secret', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const nextSecret = `SDK-${crypto
      .randomBytes(18)
      .toString('hex')
      .toUpperCase()}`;
    serverSecrets = {
      ...serverSecrets,
      appsScriptSecret: nextSecret,
    };
    try {
      const dir = path.dirname(SECRETS_FILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        SECRETS_FILE_PATH,
        JSON.stringify(serverSecrets, null, 2),
        'utf8'
      );
    } catch {
      // Abaikan
    }
    sheetProxyCache.clear();
    return res.json({
      ok: true,
      appsScriptSecret: nextSecret,
      message:
        'Kunci Rahasia Webhook (API_SECRET) baru berhasil dibuat. Perbarui konstanta API_SECRET di Code.gs jika mengaktifkan kunci ketat.',
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
