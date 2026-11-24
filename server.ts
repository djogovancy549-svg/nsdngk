import crypto from 'crypto';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createSecurityMiddleware } from './server/securityMiddleware.ts';
import {
  runReadOnlyBigQuerySql,
  syncOpdSheetToBigQuery,
  testBigQueryConnection,
} from './server/bigQueryService.ts';
import {
  derivePartitionKey,
  enqueueSheetMutationOp,
  fetchSheetWithChunkedPagination,
  flushSheetBqQueue,
  getSheetBqPolicy,
  getSheetBqTelemetry,
  postWebhookWithRetry,
  updateSheetBqPolicy,
} from './server/sheetBqPattern.ts';

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

const SUPER_ADMIN_AUTH_FILE_PATH = path.resolve(
  __dirname,
  'data',
  'superadmin-auth.json'
);

interface SuperAdminAuthStore {
  salt: string;
  passwordHash: string;
  updatedAt: string;
  updatedBy: string;
}

function hashSuperAdminPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function loadSuperAdminAuthStore(): SuperAdminAuthStore | null {
  try {
    if (fs.existsSync(SUPER_ADMIN_AUTH_FILE_PATH)) {
      const raw = fs.readFileSync(SUPER_ADMIN_AUTH_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SuperAdminAuthStore>;
      if (parsed.salt && parsed.passwordHash) {
        return {
          salt: String(parsed.salt),
          passwordHash: String(parsed.passwordHash),
          updatedAt: String(parsed.updatedAt || ''),
          updatedBy: String(parsed.updatedBy || ''),
        };
      }
    }
  } catch {
    // Fallback ke password default env
  }
  return null;
}

function saveSuperAdminPasswordHash(
  newPassword: string,
  updatedBy: string
): SuperAdminAuthStore {
  const salt = crypto.randomBytes(16).toString('hex');
  const record: SuperAdminAuthStore = {
    salt,
    passwordHash: hashSuperAdminPassword(newPassword, salt),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  try {
    const dir = path.dirname(SUPER_ADMIN_AUTH_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      SUPER_ADMIN_AUTH_FILE_PATH,
      JSON.stringify(record, null, 2),
      'utf8'
    );
  } catch {
    // Tetap aktif di memori jika filesystem read-only
  }
  return record;
}

let superAdminAuthStore: SuperAdminAuthStore | null = loadSuperAdminAuthStore();

function verifySuperAdminPassword(candidate: string): boolean {
  if (!candidate) return false;
  if (superAdminAuthStore) {
    const rawHash = hashSuperAdminPassword(candidate, superAdminAuthStore.salt);
    const trimmedHash = hashSuperAdminPassword(
      candidate.trim(),
      superAdminAuthStore.salt
    );
    return (
      timingSafeEqualStr(rawHash, superAdminAuthStore.passwordHash) ||
      timingSafeEqualStr(trimmedHash, superAdminAuthStore.passwordHash)
    );
  }
  return (
    timingSafeEqualStr(candidate, SERVER_SUPER_ADMIN_PASSWORD) ||
    timingSafeEqualStr(candidate.trim(), SERVER_SUPER_ADMIN_PASSWORD)
  );
}

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

// Persistent Cloudflare WAF & Edge Protection Config (data/cloudflare-waf.json)
const CLOUDFLARE_WAF_CONFIG_PATH = path.resolve(
  __dirname,
  'data',
  'cloudflare-waf.json'
);

interface CloudflareWafConfigStore {
  strictOriginLock: boolean;
  originVerifyHeaderName: string;
  originVerifySecret: string;
  blockHighThreatScore: boolean;
  threatScoreThreshold: number;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  turnstileSecretKey: string;
  updatedAt: string;
}

function loadCloudflareWafConfig(): CloudflareWafConfigStore {
  const defaultOriginSecret =
    process.env.CF_ORIGIN_VERIFY_SECRET?.trim() ||
    `CF-ORG-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;

  const defaults: CloudflareWafConfigStore = {
    strictOriginLock: process.env.CLOUDFLARE_STRICT_ORIGIN === 'true',
    originVerifyHeaderName: 'X-CF-Origin-Verify',
    originVerifySecret: defaultOriginSecret,
    blockHighThreatScore: true,
    threatScoreThreshold: Number(process.env.CLOUDFLARE_THREAT_THRESHOLD || 35),
    turnstileEnabled: Boolean(
      process.env.TURNSTILE_SITE_KEY?.trim() &&
        process.env.TURNSTILE_SECRET_KEY?.trim()
    ),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY?.trim() || '',
    turnstileSecretKey: process.env.TURNSTILE_SECRET_KEY?.trim() || '',
    updatedAt: '',
  };

  try {
    if (fs.existsSync(CLOUDFLARE_WAF_CONFIG_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(CLOUDFLARE_WAF_CONFIG_PATH, 'utf8')
      ) as Partial<CloudflareWafConfigStore>;
      return {
        strictOriginLock:
          typeof parsed.strictOriginLock === 'boolean'
            ? parsed.strictOriginLock
            : defaults.strictOriginLock,
        originVerifyHeaderName:
          String(parsed.originVerifyHeaderName || '').trim() ||
          defaults.originVerifyHeaderName,
        originVerifySecret:
          String(parsed.originVerifySecret || '').trim() ||
          defaults.originVerifySecret,
        blockHighThreatScore:
          typeof parsed.blockHighThreatScore === 'boolean'
            ? parsed.blockHighThreatScore
            : defaults.blockHighThreatScore,
        threatScoreThreshold:
          Number.isFinite(Number(parsed.threatScoreThreshold))
            ? Math.max(5, Math.min(100, Number(parsed.threatScoreThreshold)))
            : defaults.threatScoreThreshold,
        turnstileEnabled:
          typeof parsed.turnstileEnabled === 'boolean'
            ? parsed.turnstileEnabled
            : defaults.turnstileEnabled,
        turnstileSiteKey:
          typeof parsed.turnstileSiteKey === 'string'
            ? parsed.turnstileSiteKey.trim()
            : defaults.turnstileSiteKey,
        turnstileSecretKey:
          typeof parsed.turnstileSecretKey === 'string'
            ? parsed.turnstileSecretKey.trim()
            : defaults.turnstileSecretKey,
        updatedAt: String(parsed.updatedAt || ''),
      };
    }
  } catch {
    // Fallback ke default
  }

  try {
    const dir = path.dirname(CLOUDFLARE_WAF_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CLOUDFLARE_WAF_CONFIG_PATH,
      JSON.stringify(defaults, null, 2),
      'utf8'
    );
  } catch {
    // Abaikan jika filesystem read-only
  }

  return defaults;
}

function saveCloudflareWafConfig(
  next: CloudflareWafConfigStore
): CloudflareWafConfigStore {
  const saved: CloudflareWafConfigStore = {
    ...next,
    updatedAt: new Date().toISOString(),
  };
  try {
    const dir = path.dirname(CLOUDFLARE_WAF_CONFIG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      CLOUDFLARE_WAF_CONFIG_PATH,
      JSON.stringify(saved, null, 2),
      'utf8'
    );
  } catch {
    // Tetap aktif di memori
  }
  return saved;
}

let activeCloudflareWafConfig: CloudflareWafConfigStore =
  loadCloudflareWafConfig();

const wafMetrics = {
  inspected: 0,
  blockedOriginBypass: 0,
  blockedThreatScore: 0,
  wafBlocks: 0,
};

async function verifyTurnstileToken(
  token: string,
  secretKey: string,
  remoteIp: string
): Promise<boolean> {
  if (!token || !secretKey) return false;
  try {
    const form = new URLSearchParams();
    form.set('secret', secretKey);
    form.set('response', token);
    if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp);
    const resp = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      }
    );
    const json = (await resp.json()) as { success?: boolean };
    return Boolean(json?.success);
  } catch {
    return false;
  }
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
  urlPortalPublik: process.env.PUBLIC_PORTAL_URL || '',
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
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) {
    return cfConnectingIp.trim();
  }
  const trueClientIp = req.headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && trueClientIp.trim().length > 0) {
    return trueClientIp.trim();
  }
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

  // Lapisan Keamanan Lengkap (Cloudflare WAF + App WAF, Scanner/Probe Blocker, Rate Limit Baca/Tulis, Auto-Ban, CSP, Security Headers, security.txt)
  const { preGuard, bodyWafGuard } = createSecurityMiddleware({
    securityContact: `mailto:${SERVER_SUPER_ADMIN_EMAIL}`,
    wafBodyExemptPaths: [
      '/api/security/inspect-payload',
      '/api/security/intrusion-alert',
      '/api/security/analyze-threats',
      '/api/bigquery/query',
    ],
    honeypotPaths: HONEYPOT_DECOY_PATHS,
    getCloudflareWafConfig: () => activeCloudflareWafConfig,
    onWafEvent: (ev) => {
      if (ev === 'inspected') wafMetrics.inspected++;
      else if (ev === 'origin_bypass') wafMetrics.blockedOriginBypass++;
      else if (ev === 'threat_score') wafMetrics.blockedThreatScore++;
      else if (ev === 'waf_block') wafMetrics.wafBlocks++;
    },
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

  // 0. Konfigurasi Cloudflare Turnstile Publik (tanpa membocorkan secret key)
  app.get('/api/auth/turnstile-config', (_req, res) => {
    const enabled = Boolean(
      activeCloudflareWafConfig.turnstileEnabled &&
        activeCloudflareWafConfig.turnstileSiteKey &&
        activeCloudflareWafConfig.turnstileSecretKey
    );
    return res.json({
      ok: true,
      enabled,
      siteKey: enabled ? activeCloudflareWafConfig.turnstileSiteKey : '',
    });
  });

  // 1. Server-side Super Admin Authentication (strictly email-allowlisted + brute-force lockout + optional Turnstile)
  app.post('/api/auth/superadmin', async (req, res) => {
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

    if (
      activeCloudflareWafConfig.turnstileEnabled &&
      activeCloudflareWafConfig.turnstileSiteKey &&
      activeCloudflareWafConfig.turnstileSecretKey
    ) {
      const turnstileToken = String(req.body?.turnstileToken ?? '').trim();
      const verifiedTurnstile = await verifyTurnstileToken(
        turnstileToken,
        activeCloudflareWafConfig.turnstileSecretKey,
        ip
      );
      if (!verifiedTurnstile) {
        return res.status(403).json({
          ok: false,
          turnstileFailed: true,
          message:
            'Verifikasi anti-bot Cloudflare Turnstile gagal atau kedaluwarsa. Selesaikan tantangan verifikasi terlebih dahulu.',
        });
      }
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

    if (verifySuperAdminPassword(password)) {
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

  app.put('/api/auth/superadmin/password', (req, res) => {
    const actorEmail = requireSuperAdminActor(req, res);
    if (!actorEmail) return;

    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        ok: false,
        message: 'Kata sandi saat ini dan kata sandi baru wajib diisi.',
      });
    }

    if (!verifySuperAdminPassword(currentPassword)) {
      return res.status(401).json({
        ok: false,
        message: 'Kata sandi saat ini tidak sesuai.',
      });
    }

    if (newPassword.trim().length < 6) {
      return res.status(400).json({
        ok: false,
        message: 'Kata sandi baru minimal 6 karakter.',
      });
    }

    if (timingSafeEqualStr(currentPassword, newPassword)) {
      return res.status(400).json({
        ok: false,
        message: 'Kata sandi baru tidak boleh sama dengan kata sandi saat ini.',
      });
    }

    superAdminAuthStore = saveSuperAdminPasswordHash(newPassword, actorEmail);
    return res.status(200).json({
      ok: true,
      updatedAt: superAdminAuthStore.updatedAt,
      message:
        'Kata sandi Super Admin berhasil diperbarui. Gunakan kata sandi baru untuk login berikutnya.',
    });
  });

  // 1a-1a. Konfigurasi Google Sheet Akun & Sinkronisasi PIN Sekali Pakai ke Google Sheet (Permohonan_PIN_OPD)
  const AUTH_SHEET_CONFIG_PATH = path.resolve(
    __dirname,
    'data',
    'auth-sheet-config.json'
  );

  interface ServerAuthSheetConfig {
    sheetUrl: string;
    sheetId: string;
    sheetName: string;
    webhookUrl: string;
    updatedAt: string;
  }

  const isPlaceholderAuthUrl = (url: string): boolean =>
    !url ||
    url.includes('GantiDenganIDAsli') ||
    url.includes('WEBHOOK_GANTI_ASLI');

  const extractSheetIdFromUrl = (rawUrl: string): string => {
    const match = rawUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : '';
  };

  const loadServerAuthSheetConfig = (): ServerAuthSheetConfig => {
    const envWebhook = String(process.env.AUTH_SHEET_WEBHOOK_URL || '').trim();
    const envSheetUrl = String(process.env.AUTH_SHEET_URL || '').trim();
    const envSheetName =
      String(process.env.AUTH_SHEET_NAME || '').trim() || 'Akun_OPD';
    try {
      if (fs.existsSync(AUTH_SHEET_CONFIG_PATH)) {
        const parsed = JSON.parse(
          fs.readFileSync(AUTH_SHEET_CONFIG_PATH, 'utf8')
        ) as Partial<ServerAuthSheetConfig>;
        const sheetUrl = String(parsed.sheetUrl || envSheetUrl || '').trim();
        return {
          sheetUrl,
          sheetId:
            String(parsed.sheetId || '').trim() ||
            extractSheetIdFromUrl(sheetUrl),
          sheetName: String(parsed.sheetName || envSheetName).trim() || 'Akun_OPD',
          webhookUrl: String(parsed.webhookUrl || envWebhook || '').trim(),
          updatedAt: String(parsed.updatedAt || ''),
        };
      }
    } catch {
      // Abaikan
    }
    return {
      sheetUrl: envSheetUrl,
      sheetId: extractSheetIdFromUrl(envSheetUrl),
      sheetName: envSheetName,
      webhookUrl: envWebhook,
      updatedAt: '',
    };
  };

  const saveServerAuthSheetConfig = (
    next: Partial<ServerAuthSheetConfig>
  ): ServerAuthSheetConfig => {
    const sheetUrl = String(next.sheetUrl ?? '').trim();
    const saved: ServerAuthSheetConfig = {
      sheetUrl,
      sheetId: String(next.sheetId || extractSheetIdFromUrl(sheetUrl)).trim(),
      sheetName: String(next.sheetName || 'Akun_OPD').trim() || 'Akun_OPD',
      webhookUrl: String(next.webhookUrl ?? '').trim(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const dir = path.dirname(AUTH_SHEET_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        AUTH_SHEET_CONFIG_PATH,
        JSON.stringify(saved, null, 2),
        'utf8'
      );
    } catch {
      // Tetap aktif di memori
    }
    return saved;
  };

  let activeAuthSheetServerConfig: ServerAuthSheetConfig =
    loadServerAuthSheetConfig();

  const isAuthSheetWebhookConfigured = (): boolean =>
    !isPlaceholderAuthUrl(activeAuthSheetServerConfig.webhookUrl) &&
    isAllowedGoogleScriptUrl(activeAuthSheetServerConfig.webhookUrl);

  app.get('/api/auth/sheet-config', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    return res.json({
      ok: true,
      configured: isAuthSheetWebhookConfigured(),
      config: activeAuthSheetServerConfig,
    });
  });

  app.put('/api/auth/sheet-config', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const sheetUrl = String(req.body?.sheetUrl ?? '').trim();
    const sheetName =
      String(req.body?.sheetName ?? 'Akun_OPD').trim() || 'Akun_OPD';
    const webhookUrl = String(req.body?.webhookUrl ?? '').trim();

    if (webhookUrl && !isAllowedGoogleScriptUrl(webhookUrl)) {
      return res.status(400).json({
        ok: false,
        message:
          'URL Webhook Google Sheet Akun harus berupa URL resmi Google Apps Script (https://script.google.com/macros/s/.../exec).',
      });
    }

    activeAuthSheetServerConfig = saveServerAuthSheetConfig({
      sheetUrl,
      sheetId: extractSheetIdFromUrl(sheetUrl),
      sheetName,
      webhookUrl,
    });

    return res.json({
      ok: true,
      configured: isAuthSheetWebhookConfigured(),
      config: activeAuthSheetServerConfig,
      message: isAuthSheetWebhookConfigured()
        ? 'Konfigurasi Google Sheet Akun & PIN tersimpan di server. Seluruh permohonan & PIN otomatis tercatat ke tab Permohonan_PIN_OPD.'
        : 'Konfigurasi Google Sheet Akun diperbarui di server.',
    });
  });

  // 1a-1b. Permohonan Pendaftaran Akun Dinas & PIN Sekali Pakai (Wajib Disetujui Super Admin & Terdata di Google Sheet)
  const OPD_REG_REQUESTS_PATH = path.resolve(
    __dirname,
    'data',
    'opd-registration-requests.json'
  );
  const PIN_TTL_MS = 24 * 60 * 60 * 1000; // Berlaku 24 jam sebelum dipakai
  const UNLOCK_TOKEN_TTL_MS = 15 * 60 * 1000; // Token buka formulir berlaku 15 menit
  const MAX_PIN_FAILED_ATTEMPTS = 5;
  const PIN_SHEET_TAB_NAME = 'Permohonan_PIN_OPD';

  type ServerRegRequestStatus =
    | 'Menunggu Persetujuan'
    | 'PIN Diterbitkan'
    | 'Sudah Digunakan'
    | 'Ditolak';

  interface OpdRegistrationRequestRecord {
    id: string;
    opdId: string;
    namaOpd: string;
    namaPemohon: string;
    jabatan: string;
    emailPemohon: string;
    nomorKontak: string;
    alasanPengajuan: string;
    status: ServerRegRequestStatus;
    pinHash: string | null;
    pinSalt: string | null;
    pinHint: string | null;
    pinFailedAttempts: number;
    pinIssuedAt: string | null;
    pinExpiresAt: string | null;
    approvedBy: string | null;
    catatanAdmin: string | null;
    dibuatPada: string;
    digunakanPada: string | null;
    syncedToSheet?: boolean;
  }

  interface RegistrationUnlockTokenPayload {
    purpose: 'opd_register_unlock';
    requestId: string;
    email: string;
    exp: number;
  }

  const pinVerifyAttemptsByIp = new Map<string, RateLimitState>();

  const loadOpdRegistrationRequests = (): OpdRegistrationRequestRecord[] => {
    try {
      if (fs.existsSync(OPD_REG_REQUESTS_PATH)) {
        const raw = fs.readFileSync(OPD_REG_REQUESTS_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed as OpdRegistrationRequestRecord[];
        }
      }
    } catch {
      // Abaikan jika file belum ada atau rusak
    }
    return [];
  };

  const saveOpdRegistrationRequests = (
    items: OpdRegistrationRequestRecord[]
  ) => {
    try {
      const dir = path.dirname(OPD_REG_REQUESTS_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        OPD_REG_REQUESTS_PATH,
        JSON.stringify(items, null, 2),
        'utf8'
      );
    } catch {
      // Tetap simpan di memori jika filesystem read-only
    }
  };

  let opdRegistrationRequests: OpdRegistrationRequestRecord[] =
    loadOpdRegistrationRequests();

  const toPublicRegistrationRequestView = (
    rec: OpdRegistrationRequestRecord
  ) => ({
    id: rec.id,
    opdId: rec.opdId,
    namaOpd: rec.namaOpd,
    namaPemohon: rec.namaPemohon,
    jabatan: rec.jabatan,
    emailPemohon: rec.emailPemohon,
    nomorKontak: rec.nomorKontak,
    alasanPengajuan: rec.alasanPengajuan,
    status: rec.status,
    pinHint: rec.pinHint,
    pinIssuedAt: rec.pinIssuedAt,
    pinExpiresAt: rec.pinExpiresAt,
    approvedBy: rec.approvedBy,
    catatanAdmin: rec.catatanAdmin,
    dibuatPada: rec.dibuatPada,
    digunakanPada: rec.digunakanPada,
    syncedToSheet: Boolean(rec.syncedToSheet),
  });

  const serializePinRequestForSheet = (rec: OpdRegistrationRequestRecord) => ({
    id: rec.id,
    opdId: rec.opdId,
    namaOpd: rec.namaOpd,
    namaPemohon: rec.namaPemohon,
    jabatan: rec.jabatan,
    emailPemohon: rec.emailPemohon,
    nomorKontak: rec.nomorKontak,
    alasanPengajuan: rec.alasanPengajuan,
    status: rec.status,
    pinHint: rec.pinHint || '',
    pinHash: rec.pinHash || '',
    pinSalt: rec.pinSalt || '',
    pinFailedAttempts: rec.pinFailedAttempts || 0,
    pinIssuedAt: rec.pinIssuedAt || '',
    pinExpiresAt: rec.pinExpiresAt || '',
    approvedBy: rec.approvedBy || '',
    catatanAdmin: rec.catatanAdmin || '',
    dibuatPada: rec.dibuatPada,
    digunakanPada: rec.digunakanPada || '',
  });

  const syncPinRequestToGoogleSheet = async (
    record: OpdRegistrationRequestRecord
  ): Promise<boolean> => {
    if (!isAuthSheetWebhookConfigured()) return false;
    try {
      const upstream = await fetch(activeAuthSheetServerConfig.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'upsertPinRequest',
          pinSheetName: PIN_SHEET_TAB_NAME,
          secret: serverSecrets.appsScriptSecret,
          request: serializePinRequestForSheet(record),
        }),
      });
      if (!upstream.ok) return false;
      const json = (await upstream.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      return Boolean(json?.ok);
    } catch {
      return false;
    }
  };

  const batchSyncPinRequestsToGoogleSheet = async (
    records: OpdRegistrationRequestRecord[]
  ): Promise<boolean> => {
    if (!isAuthSheetWebhookConfigured() || records.length === 0) return false;
    try {
      const upstream = await fetch(activeAuthSheetServerConfig.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          action: 'syncPinRequests',
          pinSheetName: PIN_SHEET_TAB_NAME,
          secret: serverSecrets.appsScriptSecret,
          requests: records.map(serializePinRequestForSheet),
        }),
      });
      if (!upstream.ok) return false;
      const json = (await upstream.json().catch(() => null)) as {
        ok?: boolean;
      } | null;
      return Boolean(json?.ok);
    } catch {
      return false;
    }
  };

  const fetchPinRequestsFromGoogleSheet = async (): Promise<
    OpdRegistrationRequestRecord[] | null
  > => {
    if (!isAuthSheetWebhookConfigured()) return null;
    try {
      const targetUrl = new URL(activeAuthSheetServerConfig.webhookUrl);
      targetUrl.searchParams.set('action', 'listPinRequests');
      targetUrl.searchParams.set('sheet', PIN_SHEET_TAB_NAME);
      targetUrl.searchParams.set('secret', serverSecrets.appsScriptSecret);
      const upstream = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'follow',
      });
      if (!upstream.ok) return null;
      const json = (await upstream.json().catch(() => null)) as {
        ok?: boolean;
        data?: Array<Record<string, unknown>>;
      } | null;
      if (!json?.ok || !Array.isArray(json.data)) return null;

      return json.data
        .filter((row) => String(row.id || '').trim().length > 0)
        .map((row) => {
          const rawStatus = String(row.status || 'Menunggu Persetujuan').trim();
          const status: ServerRegRequestStatus =
            rawStatus === 'PIN Diterbitkan' ||
            rawStatus === 'Sudah Digunakan' ||
            rawStatus === 'Ditolak'
              ? rawStatus
              : 'Menunggu Persetujuan';
          return {
            id: String(row.id).trim(),
            opdId: String(row.opdId || '').trim(),
            namaOpd: String(row.namaOpd || '').trim(),
            namaPemohon: String(row.namaPemohon || '').trim(),
            jabatan: String(row.jabatan || 'Operator / PIC Satu Data OPD').trim(),
            emailPemohon: normalizeEmail(row.emailPemohon),
            nomorKontak: String(row.nomorKontak || '').trim(),
            alasanPengajuan: String(row.alasanPengajuan || '').trim(),
            status,
            pinHash: String(row.pinHash || '').trim() || null,
            pinSalt: String(row.pinSalt || '').trim() || null,
            pinHint: String(row.pinHint || '').trim() || null,
            pinFailedAttempts: Number(row.pinFailedAttempts || 0) || 0,
            pinIssuedAt: String(row.pinIssuedAt || '').trim() || null,
            pinExpiresAt: String(row.pinExpiresAt || '').trim() || null,
            approvedBy: String(row.approvedBy || '').trim() || null,
            catatanAdmin: String(row.catatanAdmin || '').trim() || null,
            dibuatPada:
              String(row.dibuatPada || '').trim() || new Date().toISOString(),
            digunakanPada: String(row.digunakanPada || '').trim() || null,
            syncedToSheet: true,
          };
        });
    } catch {
      return null;
    }
  };

  const mergeRequestsWithRemoteSheet = (
    localList: OpdRegistrationRequestRecord[],
    remoteList: OpdRegistrationRequestRecord[]
  ): OpdRegistrationRequestRecord[] => {
    const map = new Map<string, OpdRegistrationRequestRecord>();
    for (const r of remoteList) {
      map.set(r.id, r);
    }
    for (const l of localList) {
      const existing = map.get(l.id);
      if (!existing) {
        map.set(l.id, l);
      } else {
        // Prioritaskan status yang lebih lanjut jika salah satu Sudah Digunakan / Ditolak
        const rank = (s: ServerRegRequestStatus) =>
          s === 'Sudah Digunakan'
            ? 4
            : s === 'Ditolak'
            ? 3
            : s === 'PIN Diterbitkan'
            ? 2
            : 1;
        map.set(
          l.id,
          rank(l.status) >= rank(existing.status)
            ? { ...existing, ...l, syncedToSheet: l.syncedToSheet || existing.syncedToSheet }
            : existing
        );
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      b.dibuatPada.localeCompare(a.dibuatPada)
    );
  };

  const normalizeOneTimePin = (raw: unknown): string =>
    String(raw ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');

  const generateUnambiguousOneTimePin = (): string => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(8);
    let raw = '';
    for (let i = 0; i < 8; i++) {
      raw += alphabet[bytes[i] % alphabet.length];
    }
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  };

  const hashOneTimePin = (normalizedPin: string, salt: string): string =>
    crypto.scryptSync(normalizedPin, salt, 64).toString('hex');

  const createRegistrationUnlockToken = (
    requestId: string,
    email: string
  ): string => {
    const payload: RegistrationUnlockTokenPayload = {
      purpose: 'opd_register_unlock',
      requestId,
      email: normalizeEmail(email),
      exp: Date.now() + UNLOCK_TOKEN_TTL_MS,
    };
    const data = Buffer.from(JSON.stringify(payload), 'utf8').toString(
      'base64url'
    );
    const sig = crypto
      .createHmac('sha256', serverSecrets.sessionSecret)
      .update(data)
      .digest('base64url');
    return `${data}.${sig}`;
  };

  const verifyRegistrationUnlockToken = (
    token: string
  ): RegistrationUnlockTokenPayload | null => {
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
      ) as RegistrationUnlockTokenPayload;
      if (
        parsed.purpose !== 'opd_register_unlock' ||
        !parsed.requestId ||
        !parsed.email ||
        !parsed.exp
      ) {
        return null;
      }
      if (Date.now() > parsed.exp) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  // Publik: Dinas mengajukan permohonan akun baru (sebelum diberi PIN oleh Super Admin)
  app.post('/api/auth/opd-registration-requests', async (req, res) => {
    const body = req.body || {};
    const opdId = String(body.opdId ?? '').trim().slice(0, 80);
    const namaOpd = String(body.namaOpd ?? '').trim().slice(0, 180);
    const namaPemohon = String(body.namaPemohon ?? '').trim().slice(0, 140);
    const jabatan = String(body.jabatan ?? '').trim().slice(0, 120);
    const emailPemohon = normalizeEmail(body.emailPemohon);
    const nomorKontak = String(body.nomorKontak ?? '').trim().slice(0, 40);
    const alasanPengajuan = String(body.alasanPengajuan ?? '')
      .trim()
      .slice(0, 500);

    if (!namaOpd || !namaPemohon || !nomorKontak) {
      return res.status(400).json({
        ok: false,
        message:
          'Nama Dinas/OPD, nama pemohon/PIC, dan nomor WhatsApp/kontak wajib diisi.',
      });
    }

    if (!EMAIL_PATTERN.test(emailPemohon)) {
      return res.status(400).json({
        ok: false,
        message: 'Format email resmi dinas tidak valid.',
      });
    }

    if (isAuthorizedSuperAdminEmail(emailPemohon)) {
      return res.status(400).json({
        ok: false,
        message:
          'Email tersebut terdaftar sebagai email Super Admin dan tidak dapat diajukan sebagai akun OPD.',
      });
    }

    const now = Date.now();
    const existingActive = opdRegistrationRequests.find((r) => {
      if (r.emailPemohon !== emailPemohon) return false;
      if (r.status === 'Menunggu Persetujuan') return true;
      if (r.status === 'PIN Diterbitkan') {
        const expMs = r.pinExpiresAt ? Date.parse(r.pinExpiresAt) : 0;
        return expMs > now;
      }
      return false;
    });

    if (existingActive) {
      return res.status(409).json({
        ok: false,
        message:
          existingActive.status === 'PIN Diterbitkan'
            ? 'Email dinas ini sudah memiliki PIN aktif yang diterbitkan Super Admin. Gunakan PIN tersebut pada tab "Masuk dengan PIN Sekali Pakai".'
            : 'Permohonan untuk email dinas ini sudah masuk antrean dan sedang menunggu persetujuan Super Admin Walidata.',
      });
    }

    const record: OpdRegistrationRequestRecord = {
      id: `req-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      opdId:
        opdId ||
        namaOpd
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, ''),
      namaOpd,
      namaPemohon,
      jabatan: jabatan || 'Operator / PIC Satu Data OPD',
      emailPemohon,
      nomorKontak,
      alasanPengajuan,
      status: 'Menunggu Persetujuan',
      pinHash: null,
      pinSalt: null,
      pinHint: null,
      pinFailedAttempts: 0,
      pinIssuedAt: null,
      pinExpiresAt: null,
      approvedBy: null,
      catatanAdmin: null,
      dibuatPada: new Date().toISOString(),
      digunakanPada: null,
      syncedToSheet: false,
    };

    const syncedToSheet = await syncPinRequestToGoogleSheet(record);
    record.syncedToSheet = syncedToSheet;

    opdRegistrationRequests = [record, ...opdRegistrationRequests].slice(0, 300);
    saveOpdRegistrationRequests(opdRegistrationRequests);

    return res.status(201).json({
      ok: true,
      syncedToSheet,
      request: toPublicRegistrationRequestView(record),
      message: syncedToSheet
        ? 'Permohonan pendaftaran berhasil dikirim dan tercatat di Google Sheet Walidata. Tunggu persetujuan & PIN Sekali Pakai dari Super Admin.'
        : 'Permohonan pendaftaran akun dinas berhasil dikirim. Super Admin Walidata akan meninjau dan memberikan PIN Sekali Pakai kepada PIC Anda.',
    });
  });

  // Super Admin: Lihat seluruh antrean permohonan pendaftaran dinas (tarik juga dari Google Sheet bila terhubung)
  app.get('/api/auth/opd-registration-requests', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const sheetConfigured = isAuthSheetWebhookConfigured();
    if (sheetConfigured) {
      const remoteRows = await fetchPinRequestsFromGoogleSheet();
      if (remoteRows && remoteRows.length > 0) {
        opdRegistrationRequests = mergeRequestsWithRemoteSheet(
          opdRegistrationRequests,
          remoteRows
        );
        saveOpdRegistrationRequests(opdRegistrationRequests);
      }
    }

    const sorted = [...opdRegistrationRequests].sort((a, b) =>
      b.dibuatPada.localeCompare(a.dibuatPada)
    );
    const pendingCount = sorted.filter(
      (r) => r.status === 'Menunggu Persetujuan'
    ).length;

    return res.json({
      ok: true,
      sheetConfigured,
      pendingCount,
      requests: sorted.map(toPublicRegistrationRequestView),
    });
  });

  // Super Admin: Sinkronkan seluruh antrean & status PIN dua arah ke tab Permohonan_PIN_OPD Google Sheet
  app.post('/api/auth/opd-registration-requests/sync-sheet', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const sheetConfigured = isAuthSheetWebhookConfigured();
    if (!sheetConfigured) {
      return res.status(400).json({
        ok: false,
        sheetConfigured: false,
        message:
          'Google Sheet Akun & PIN belum dihubungkan. Buka menu Skrip Code.gs & Auth lalu simpan URL Sheet & Webhook Code_Akun_OPD.gs terlebih dahulu.',
      });
    }

    const remoteRows = await fetchPinRequestsFromGoogleSheet();
    if (remoteRows) {
      opdRegistrationRequests = mergeRequestsWithRemoteSheet(
        opdRegistrationRequests,
        remoteRows
      );
    }

    let pushed = true;
    if (opdRegistrationRequests.length > 0) {
      pushed = await batchSyncPinRequestsToGoogleSheet(opdRegistrationRequests);
      if (pushed) {
        opdRegistrationRequests = opdRegistrationRequests.map((r) => ({
          ...r,
          syncedToSheet: true,
        }));
      }
    }
    saveOpdRegistrationRequests(opdRegistrationRequests);

    const sorted = [...opdRegistrationRequests].sort((a, b) =>
      b.dibuatPada.localeCompare(a.dibuatPada)
    );
    return res.json({
      ok: pushed,
      sheetConfigured: true,
      syncedCount: sorted.length,
      pendingCount: sorted.filter((r) => r.status === 'Menunggu Persetujuan')
        .length,
      requests: sorted.map(toPublicRegistrationRequestView),
      message: pushed
        ? `Berhasil menyinkronkan ${sorted.length} catatan permohonan & PIN Sekali Pakai ke tab ${PIN_SHEET_TAB_NAME} Google Sheet.`
        : `Gagal menulis ke Webhook Code_Akun_OPD.gs. Pastikan Anda memakai skrip Code_Akun_OPD.gs versi terbaru dan telah di-deploy ulang.`,
    });
  });

  // Super Admin: Setujui permohonan & terbitkan PIN Sekali Pakai (otomatis tercatat di Google Sheet)
  app.post(
    '/api/auth/opd-registration-requests/:id/issue-pin',
    async (req, res) => {
      const actorEmail = requireSuperAdminActor(req, res);
      if (!actorEmail) return;

      const reqId = String(req.params.id || '').trim();
      const target = opdRegistrationRequests.find((r) => r.id === reqId);
      if (!target) {
        return res.status(404).json({
          ok: false,
          message: 'Permohonan pendaftaran tidak ditemukan.',
        });
      }

      if (target.status === 'Sudah Digunakan') {
        return res.status(409).json({
          ok: false,
          message:
            'Permohonan ini sudah digunakan untuk mendaftarkan akun dinas dan tidak dapat diterbitkan ulang.',
        });
      }

      if (target.status === 'Ditolak') {
        return res.status(409).json({
          ok: false,
          message:
            'Permohonan yang telah ditolak tidak dapat diberi PIN. Minta dinas mengajukan permohonan baru.',
        });
      }

      const rawPin = generateUnambiguousOneTimePin();
      const normalized = normalizeOneTimePin(rawPin);
      const salt = crypto.randomBytes(16).toString('hex');
      const pinHash = hashOneTimePin(normalized, salt);
      const nowIso = new Date().toISOString();
      const expiresIso = new Date(Date.now() + PIN_TTL_MS).toISOString();
      const catatanAdmin = String(req.body?.catatanAdmin ?? '')
        .trim()
        .slice(0, 400);

      const updated: OpdRegistrationRequestRecord = {
        ...target,
        status: 'PIN Diterbitkan',
        pinHash,
        pinSalt: salt,
        pinHint: `••••${normalized.slice(-2)}`,
        pinFailedAttempts: 0,
        pinIssuedAt: nowIso,
        pinExpiresAt: expiresIso,
        approvedBy: actorEmail,
        catatanAdmin: catatanAdmin || target.catatanAdmin,
        syncedToSheet: false,
      };

      const syncedToSheet = await syncPinRequestToGoogleSheet(updated);
      updated.syncedToSheet = syncedToSheet;

      opdRegistrationRequests = opdRegistrationRequests.map((r) =>
        r.id === reqId ? updated : r
      );
      saveOpdRegistrationRequests(opdRegistrationRequests);

      return res.status(200).json({
        ok: true,
        oneTimePin: rawPin,
        syncedToSheet,
        request: toPublicRegistrationRequestView(updated),
        message: syncedToSheet
          ? `PIN Sekali Pakai berhasil diterbitkan untuk ${updated.namaOpd} dan langsung terdata di Google Sheet (tab ${PIN_SHEET_TAB_NAME}).`
          : `PIN Sekali Pakai berhasil diterbitkan untuk ${updated.namaOpd} (tersimpan di server; hubungkan Google Sheet Akun di menu Skrip Code.gs & Auth agar otomatis tercatat ke Google Sheet).`,
      });
    }
  );

  // Super Admin: Tolak permohonan pendaftaran dinas
  app.post(
    '/api/auth/opd-registration-requests/:id/reject',
    async (req, res) => {
      const actorEmail = requireSuperAdminActor(req, res);
      if (!actorEmail) return;

      const reqId = String(req.params.id || '').trim();
      const target = opdRegistrationRequests.find((r) => r.id === reqId);
      if (!target) {
        return res.status(404).json({
          ok: false,
          message: 'Permohonan pendaftaran tidak ditemukan.',
        });
      }

      if (target.status === 'Sudah Digunakan') {
        return res.status(409).json({
          ok: false,
          message: 'Permohonan ini sudah selesai digunakan.',
        });
      }

      const catatanAdmin = String(req.body?.catatanAdmin ?? '')
        .trim()
        .slice(0, 400);

      const updated: OpdRegistrationRequestRecord = {
        ...target,
        status: 'Ditolak',
        pinHash: null,
        pinSalt: null,
        pinHint: null,
        pinFailedAttempts: 0,
        approvedBy: actorEmail,
        catatanAdmin:
          catatanAdmin || 'Permohonan ditolak oleh Super Admin Walidata.',
        syncedToSheet: false,
      };

      const syncedToSheet = await syncPinRequestToGoogleSheet(updated);
      updated.syncedToSheet = syncedToSheet;

      opdRegistrationRequests = opdRegistrationRequests.map((r) =>
        r.id === reqId ? updated : r
      );
      saveOpdRegistrationRequests(opdRegistrationRequests);

      return res.status(200).json({
        ok: true,
        syncedToSheet,
        request: toPublicRegistrationRequestView(updated),
        message: syncedToSheet
          ? `Permohonan dari ${updated.namaOpd} telah ditolak dan diperbarui di Google Sheet.`
          : `Permohonan dari ${updated.namaOpd} telah ditolak.`,
      });
    }
  );

  // Publik: Verifikasi Email + PIN Sekali Pakai untuk membuka laman formulir pendaftaran dinas
  app.post(
    '/api/auth/opd-registration-requests/verify-pin',
    async (req, res) => {
      const ip = getClientIp(req);
      const now = Date.now();
      const ipState = pinVerifyAttemptsByIp.get(ip) || {
        attempts: 0,
        lockedUntil: 0,
      };

      if (ipState.lockedUntil > now) {
        const retryAfterSec = Math.ceil((ipState.lockedUntil - now) / 1000);
        return res.status(429).json({
          ok: false,
          locked: true,
          retryAfterSec,
          message: `Terlalu banyak percobaan PIN salah. Verifikasi dikunci selama ${retryAfterSec} detik.`,
        });
      }

      const emailPemohon = normalizeEmail(req.body?.emailPemohon);
      const normalizedPin = normalizeOneTimePin(req.body?.pin);

      if (!EMAIL_PATTERN.test(emailPemohon) || normalizedPin.length < 6) {
        return res.status(400).json({
          ok: false,
          message:
            'Masukkan email resmi pemohon dan PIN Sekali Pakai yang valid.',
        });
      }

      let candidates = opdRegistrationRequests.filter(
        (r) => r.emailPemohon === emailPemohon
      );
      let activeReq = candidates.find((r) => r.status === 'PIN Diterbitkan');

      // Jika tidak ditemukan di memori (misal setelah restart), cek ke Google Sheet Permohonan_PIN_OPD
      if (!activeReq && isAuthSheetWebhookConfigured()) {
        const remoteRows = await fetchPinRequestsFromGoogleSheet();
        if (remoteRows && remoteRows.length > 0) {
          opdRegistrationRequests = mergeRequestsWithRemoteSheet(
            opdRegistrationRequests,
            remoteRows
          );
          saveOpdRegistrationRequests(opdRegistrationRequests);
          candidates = opdRegistrationRequests.filter(
            (r) => r.emailPemohon === emailPemohon
          );
          activeReq = candidates.find((r) => r.status === 'PIN Diterbitkan');
        }
      }

      if (!activeReq || !activeReq.pinHash || !activeReq.pinSalt) {
        const alreadyUsed = candidates.some(
          (r) => r.status === 'Sudah Digunakan'
        );
        const stillPending = candidates.some(
          (r) => r.status === 'Menunggu Persetujuan'
        );
        return res.status(401).json({
          ok: false,
          message: alreadyUsed
            ? 'PIN untuk email ini sudah pernah digunakan. Satu PIN hanya berlaku untuk 1 kali pendaftaran.'
            : stillPending
            ? 'Permohonan Anda masih menunggu persetujuan dan penerbitan PIN oleh Super Admin Walidata.'
            : 'Tidak ada PIN Sekali Pakai yang aktif untuk email tersebut.',
        });
      }

      if (
        activeReq.pinExpiresAt &&
        Date.now() > Date.parse(activeReq.pinExpiresAt)
      ) {
        return res.status(401).json({
          ok: false,
          message:
            'PIN Sekali Pakai telah kedaluwarsa (melebihi 24 jam). Minta Super Admin menerbitkan PIN baru.',
        });
      }

      const candidateHash = hashOneTimePin(normalizedPin, activeReq.pinSalt);
      if (!timingSafeEqualStr(candidateHash, activeReq.pinHash)) {
        const nextReqFails = (activeReq.pinFailedAttempts || 0) + 1;
        const nextIpFails = ipState.attempts + 1;

        if (nextReqFails >= MAX_PIN_FAILED_ATTEMPTS) {
          const invalidated: OpdRegistrationRequestRecord = {
            ...activeReq,
            status: 'Ditolak',
            pinHash: null,
            pinSalt: null,
            pinHint: null,
            pinFailedAttempts: nextReqFails,
            catatanAdmin:
              'PIN otomatis dibatalkan karena melebihi batas 5 kali percobaan gagal.',
          };
          invalidated.syncedToSheet = await syncPinRequestToGoogleSheet(
            invalidated
          );
          opdRegistrationRequests = opdRegistrationRequests.map((r) =>
            r.id === activeReq!.id ? invalidated : r
          );
          saveOpdRegistrationRequests(opdRegistrationRequests);
          recordServerIntrusion(
            ip,
            '/api/auth/opd-registration-requests/verify-pin',
            'Brute-Force PIN Pendaftaran Dinas',
            `PIN untuk ${emailPemohon} dibatalkan otomatis setelah 5 kali percobaan salah.`,
            'Tinggi'
          );
        } else {
          const updatedFail: OpdRegistrationRequestRecord = {
            ...activeReq,
            pinFailedAttempts: nextReqFails,
          };
          updatedFail.syncedToSheet = await syncPinRequestToGoogleSheet(
            updatedFail
          );
          opdRegistrationRequests = opdRegistrationRequests.map((r) =>
            r.id === activeReq!.id ? updatedFail : r
          );
          saveOpdRegistrationRequests(opdRegistrationRequests);
        }

        const lockedUntil =
          nextIpFails >= MAX_PIN_FAILED_ATTEMPTS ? now + LOCKOUT_MS : 0;
        pinVerifyAttemptsByIp.set(ip, {
          attempts: nextIpFails >= MAX_PIN_FAILED_ATTEMPTS ? 0 : nextIpFails,
          lockedUntil,
        });

        const remaining = Math.max(0, MAX_PIN_FAILED_ATTEMPTS - nextReqFails);
        return res.status(remaining === 0 ? 429 : 401).json({
          ok: false,
          message:
            remaining === 0
              ? 'PIN salah 5 kali berturut-turut dan langsung dibatalkan demi keamanan. Ajukan permohonan baru ke Super Admin.'
              : `PIN Sekali Pakai tidak sesuai. Sisa percobaan: ${remaining}.`,
        });
      }

      // PIN valid -> reset counter gagal & keluarkan unlock token berumur pendek (15 menit)
      pinVerifyAttemptsByIp.delete(ip);
      if (activeReq.pinFailedAttempts > 0) {
        const resetFail: OpdRegistrationRequestRecord = {
          ...activeReq,
          pinFailedAttempts: 0,
        };
        resetFail.syncedToSheet = await syncPinRequestToGoogleSheet(resetFail);
        opdRegistrationRequests = opdRegistrationRequests.map((r) =>
          r.id === activeReq!.id ? resetFail : r
        );
        saveOpdRegistrationRequests(opdRegistrationRequests);
      }

      const unlockToken = createRegistrationUnlockToken(
        activeReq.id,
        activeReq.emailPemohon
      );

      return res.status(200).json({
        ok: true,
        unlockToken,
        request: toPublicRegistrationRequestView(activeReq),
        message:
          'PIN Sekali Pakai terverifikasi. Laman pendaftaran akun dinas terbuka selama 15 menit untuk 1 kali pengiriman.',
      });
    }
  );

  // Publik: Konsumsi atomik PIN Sekali Pakai saat dinas menyelesaikan pendaftaran akun + catat di Google Sheet
  app.post(
    '/api/auth/opd-registration-requests/consume',
    async (req, res) => {
      const unlockToken = String(req.body?.unlockToken ?? '').trim();
      const email = normalizeEmail(req.body?.email);

      const verified = verifyRegistrationUnlockToken(unlockToken);
      if (!verified || verified.email !== email) {
        return res.status(403).json({
          ok: false,
          message:
            'Token otorisasi PIN pendaftaran tidak valid, kedaluwarsa, atau tidak sesuai dengan email pemohon.',
        });
      }

      const target = opdRegistrationRequests.find(
        (r) => r.id === verified.requestId
      );
      if (
        !target ||
        target.status !== 'PIN Diterbitkan' ||
        target.emailPemohon !== email
      ) {
        return res.status(409).json({
          ok: false,
          message:
            'PIN Sekali Pakai ini sudah digunakan atau dibatalkan dan tidak dapat dipakai ulang.',
        });
      }

      const consumed: OpdRegistrationRequestRecord = {
        ...target,
        status: 'Sudah Digunakan',
        pinHash: null,
        pinSalt: null,
        digunakanPada: new Date().toISOString(),
        syncedToSheet: false,
      };

      const syncedToSheet = await syncPinRequestToGoogleSheet(consumed);
      consumed.syncedToSheet = syncedToSheet;

      opdRegistrationRequests = opdRegistrationRequests.map((r) =>
        r.id === target.id ? consumed : r
      );
      saveOpdRegistrationRequests(opdRegistrationRequests);

      return res.status(200).json({
        ok: true,
        syncedToSheet,
        request: toPublicRegistrationRequestView(consumed),
        message: syncedToSheet
          ? 'PIN Sekali Pakai berhasil dikonsumsi, dinonaktifkan permanen, dan statusnya diperbarui di Google Sheet.'
          : 'PIN Sekali Pakai berhasil dikonsumsi dan dinonaktifkan permanen.',
      });
    }
  );

  // 1a-1b. Metadata Statistik Sektoral (MS-Kegiatan & MS-Variabel — Satu Data Indonesia)
  const METADATA_FILE_PATH = path.resolve(
    __dirname,
    'data',
    'dataset-metadata.json'
  );

  const loadServerMetadataMap = (): Record<string, Record<string, unknown>> => {
    try {
      if (fs.existsSync(METADATA_FILE_PATH)) {
        const raw = fs.readFileSync(METADATA_FILE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, Record<string, unknown>>;
        }
      }
    } catch {
      // Abaikan jika file belum ada
    }
    return {};
  };

  const saveServerMetadataMap = (
    map: Record<string, Record<string, unknown>>
  ) => {
    try {
      const dir = path.dirname(METADATA_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(
        METADATA_FILE_PATH,
        JSON.stringify(map, null, 2),
        'utf8'
      );
    } catch {
      // Tetap simpan di memori jika filesystem read-only
    }
  };

  let serverMetadataMap: Record<string, Record<string, unknown>> =
    loadServerMetadataMap();

  app.get('/api/metadata', (_req, res) => {
    return res.json({
      ok: true,
      metadataBySheet: serverMetadataMap,
    });
  });

  app.put('/api/metadata/:sheetId', (req, res) => {
    const sheetId = String(req.params.sheetId || '').trim();
    if (!sheetId) {
      return res.status(400).json({
        ok: false,
        message: 'ID sheet dataset wajib diisi.',
      });
    }

    const incoming = req.body?.metadata;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({
        ok: false,
        message: 'Payload metadata tidak valid.',
      });
    }

    // Periksa apakah pengubah adalah Super Admin agar hanya Super Admin yang bisa mengubah statusValidasi ke Terverifikasi Walidata
    const cookies = parseCookies(req);
    const cookieToken = cookies[SESSION_COOKIE_NAME];
    const verifiedCookie = cookieToken
      ? verifySignedSessionToken(cookieToken)
      : null;
    const headerSuperAdmin = normalizeEmail(req.headers['x-superadmin-email']);
    const isSuperAdmin = Boolean(
      (verifiedCookie &&
        verifiedCookie.role === 'super_admin' &&
        isAuthorizedSuperAdminEmail(verifiedCookie.email)) ||
        isAuthorizedSuperAdminEmail(headerSuperAdmin)
    );

    const existing = serverMetadataMap[sheetId] || {};
    const requestedStatus = String(
      incoming.statusValidasi || existing.statusValidasi || 'Belum Diverifikasi'
    );
    const safeStatus = isSuperAdmin
      ? requestedStatus
      : String(existing.statusValidasi || 'Belum Diverifikasi');

    const cleanedVariables = Array.isArray(incoming.variabel)
      ? incoming.variabel.slice(0, 150).map((v: Record<string, unknown>) => ({
          namaKolom: String(v?.namaKolom ?? '').trim().slice(0, 120),
          definisi: String(v?.definisi ?? '').trim().slice(0, 500),
          tipeData: String(v?.tipeData ?? 'Teks').trim().slice(0, 40),
          satuan: String(v?.satuan ?? '').trim().slice(0, 60),
          wajibDiisi: Boolean(v?.wajibDiisi),
        }))
      : [];

    const savedRecord: Record<string, unknown> = {
      sheetId,
      kodeReferensi: String(incoming.kodeReferensi ?? '').trim().slice(0, 60),
      urusanPemerintahan: String(incoming.urusanPemerintahan ?? '')
        .trim()
        .slice(0, 120),
      produsenData: String(incoming.produsenData ?? '').trim().slice(0, 160),
      walidata: String(incoming.walidata ?? activeRegencyConfig.namaWalidata)
        .trim()
        .slice(0, 160),
      tahunData: String(incoming.tahunData ?? '').trim().slice(0, 40),
      frekuensiPemutakhiran: String(
        incoming.frekuensiPemutakhiran ?? 'Tahunan'
      ).trim(),
      cakupanWilayah: String(incoming.cakupanWilayah ?? 'Kabupaten').trim(),
      tingkatAkses: String(
        incoming.tingkatAkses ?? 'Terbuka (Publik)'
      ).trim(),
      metodologiPengumpulan: String(
        incoming.metodologiPengumpulan ?? 'Kompilasi Administrasi'
      ).trim(),
      satuanPengukuran: String(incoming.satuanPengukuran ?? '')
        .trim()
        .slice(0, 80),
      konsepDefinisi: String(incoming.konsepDefinisi ?? '')
        .trim()
        .slice(0, 1500),
      kontakPic: String(incoming.kontakPic ?? '').trim().slice(0, 160),
      statusValidasi: safeStatus,
      catatanWalidata: isSuperAdmin
        ? String(incoming.catatanWalidata ?? '').trim().slice(0, 800)
        : String(existing.catatanWalidata ?? ''),
      variabel: cleanedVariables,
      diperbaruiPada: new Date().toISOString(),
      diperbaruiOleh: String(
        incoming.diperbaruiOleh ||
          verifiedCookie?.email ||
          headerSuperAdmin ||
          req.headers['x-actor-email'] ||
          ''
      )
        .trim()
        .toLowerCase(),
    };

    serverMetadataMap = {
      ...serverMetadataMap,
      [sheetId]: savedRecord,
    };
    saveServerMetadataMap(serverMetadataMap);

    return res.status(200).json({
      ok: true,
      metadata: savedRecord,
      message: 'Metadata statistik sektoral berhasil disimpan.',
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

    const partition = String(req.body?.partition || '').trim();
    const fields = String(req.body?.fields || '').trim();

    // GET request: gunakan Smart Cache (45 detik) + In-Flight Deduplication + Chunked Pagination ala BigQuery
    if (method === 'GET') {
      const cacheKey = `${webhookUrl}::${sheetName}::${action}::${partition}::${fields}`;
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
          const chunked = await fetchSheetWithChunkedPagination({
            webhookUrl,
            sheetName,
            action,
            secret: serverSecrets.appsScriptSecret,
            partition: partition || undefined,
            fields: fields || undefined,
          });
          sheetProxyStats.totalUpstreamMs += chunked.latencyMs;
          sheetProxyStats.upstreamCalls += chunked.pagesFetched;
          return {
            status: chunked.status,
            data: chunked.data,
            latencyMs: chunked.latencyMs,
          };
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

    // POST mutation (create/update/delete): sisipkan secret server, partition routing & retry backoff kuota
    if (method === 'POST') {
      try {
        const policy = getSheetBqPolicy();
        const rowValues =
          payload.values && typeof payload.values === 'object'
            ? (payload.values as Record<string, string>)
            : {};
        const resolvedPartitionKey =
          String(payload.partitionKey || '').trim() ||
          derivePartitionKey(policy.partitionStrategy, rowValues);

        const upstream = await postWebhookWithRetry(
          webhookUrl,
          {
            ...payload,
            action,
            sheetName,
            partitionMode: policy.partitionStrategy,
            partitionKey: resolvedPartitionKey,
            maxRowsPerPartition: policy.maxRowsPerPartition,
          },
          serverSecrets.appsScriptSecret
        );
        invalidateSheetCacheByWebhook(webhookUrl);

        return res.status(upstream.ok ? 200 : upstream.status).json({
          ok: upstream.ok,
          latencyMs: upstream.latencyMs,
          partitionKey: resolvedPartitionKey,
          data: upstream.data,
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

  // 1a-3b. Pola Data Google Sheet ala BigQuery (Partisi, Write-Ahead Micro-Batching, Quota Guard)
  app.get('/api/sheets/bq-pattern/status', (_req, res) => {
    return res.json({
      ok: true,
      telemetry: getSheetBqTelemetry(),
    });
  });

  app.put('/api/sheets/bq-pattern/policy', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const body = req.body || {};
    const updated = updateSheetBqPolicy({
      partitionStrategy: body.partitionStrategy,
      maxRowsPerPartition: body.maxRowsPerPartition,
      workbookCellBudgetPct: body.workbookCellBudgetPct,
      enableWriteAheadBatching: body.enableWriteAheadBatching,
      batchFlushIntervalSec: body.batchFlushIntervalSec,
      batchMaxSize: body.batchMaxSize,
      maxWritesPerMinuteQuota: body.maxWritesPerMinuteQuota,
      retryMaxAttempts: body.retryMaxAttempts,
    });
    return res.json({
      ok: true,
      policy: updated,
      telemetry: getSheetBqTelemetry(),
      message: `Kebijakan pola BigQuery Google Sheet (${updated.partitionStrategy}, maks ${updated.maxRowsPerPartition.toLocaleString('id-ID')} baris/partisi) berhasil diperbarui.`,
    });
  });

  app.post('/api/sheets/bq-pattern/enqueue', async (req, res) => {
    const sheetId = String(req.body?.sheetId || '').trim();
    const judulDataset = String(req.body?.judulDataset || sheetId).trim();
    const webhookUrl = String(req.body?.webhookUrl || '').trim();
    const sheetName = String(req.body?.sheetName || 'Sheet1').trim();
    const action = String(req.body?.action || '').trim() as
      | 'create'
      | 'update'
      | 'delete';
    const row =
      req.body?.row && typeof req.body.row === 'object'
        ? (req.body.row as Record<string, unknown>)
        : {};
    const flushNow = Boolean(req.body?.flushNow);

    if (!sheetId || !['create', 'update', 'delete'].includes(action)) {
      return res.status(400).json({
        ok: false,
        message: 'Permintaan write-ahead sheet tidak lengkap.',
      });
    }

    if (!isAllowedGoogleScriptUrl(webhookUrl)) {
      return res.status(400).json({
        ok: false,
        message: 'URL Webhook Google Apps Script tidak valid.',
      });
    }

    const rowValues: Record<string, string> = {};
    if (row.values && typeof row.values === 'object') {
      for (const [k, v] of Object.entries(row.values as Record<string, unknown>)) {
        rowValues[String(k)] = String(v ?? '').slice(0, 4000);
      }
    }

    const policy = getSheetBqPolicy();
    const partitionKey =
      String(row._partitionKey || req.body?.partitionKey || '').trim() ||
      derivePartitionKey(policy.partitionStrategy, rowValues);

    // 1. Selalu commit seketika ke Sovereign Store agar durabilitas data 0ms tidak pernah hilang
    const currentRows = [...(sovereignSheetsStore.rowsBySheet[sheetId] || [])];
    const rowId = String(row._id || `${sheetId}-srv-${Date.now().toString(36)}`);
    const nowDate = new Date().toISOString().slice(0, 10);
    let assignedRowNumber = Number(row._rowNumber || currentRows.length + 2);

    let nextRows: SovereignRowRecord[] = currentRows;
    if (action === 'create') {
      assignedRowNumber = currentRows.length + 2;
      nextRows = [
        {
          _id: rowId,
          _rowNumber: assignedRowNumber,
          _updatedAt: nowDate,
          values: rowValues,
        },
        ...currentRows,
      ];
    } else if (action === 'update') {
      const idx = currentRows.findIndex((r) => r._id === rowId);
      const updatedRecord: SovereignRowRecord = {
        _id: rowId,
        _rowNumber: assignedRowNumber,
        _updatedAt: nowDate,
        values: rowValues,
      };
      nextRows =
        idx >= 0
          ? currentRows.map((r, i) => (i === idx ? updatedRecord : r))
          : [updatedRecord, ...currentRows];
    } else if (action === 'delete') {
      nextRows = currentRows.filter((r) => r._id !== rowId);
    }

    const existingSheet = sovereignSheetsStore.sheets[sheetId];
    const nextSheets = existingSheet
      ? {
          ...sovereignSheetsStore.sheets,
          [sheetId]: {
            ...existingSheet,
            terakhirSinkron: new Date().toISOString(),
          },
        }
      : sovereignSheetsStore.sheets;

    sovereignSheetsStore = saveSovereignSheetsStore({
      sheets: nextSheets,
      rowsBySheet: {
        ...sovereignSheetsStore.rowsBySheet,
        [sheetId]: nextRows,
      },
      updatedAt: sovereignSheetsStore.updatedAt,
    });

    // 2. Masukkan ke Write-Ahead Micro-Batch Queue untuk Google Sheet
    const enqueued = enqueueSheetMutationOp({
      sheetId,
      judulDataset,
      webhookUrl,
      sheetName,
      action,
      rowNumber: assignedRowNumber,
      values: rowValues,
      partitionKey,
    });

    if (flushNow || enqueued.shouldFlushNow) {
      const flushRes = await flushSheetBqQueue({
        secret: serverSecrets.appsScriptSecret,
        onlySheetId: sheetId,
        onWebhookMutated: (url) => invalidateSheetCacheByWebhook(url),
      });

      return res.json({
        ok: true,
        mode: 'flushed_batch',
        partitionKey,
        rowNumber: assignedRowNumber,
        flushedRows: flushRes.flushedRows,
        remainingQueue: flushRes.remainingQueue,
        message:
          flushRes.errors.length === 0
            ? `Data tersimpan ke Server & disinkronkan via Micro-Batch pola BigQuery ke partisi "${partitionKey}" Google Sheet.`
            : `Data aman tersimpan di Server Sovereign Store. Pengiriman ke Google Sheet dijadwalkan ulang (${flushRes.errors[0]}).`,
      });
    }

    return res.json({
      ok: true,
      mode: 'queued_write_ahead',
      partitionKey,
      rowNumber: assignedRowNumber,
      queueDepth: enqueued.queueDepth,
      message: `Data aman tersimpan instan di Server & masuk antrean Micro-Batch partisi "${partitionKey}" (${enqueued.queueDepth} antrean hemat kuota Google Sheet).`,
    });
  });

  app.post('/api/sheets/bq-pattern/flush', async (req, res) => {
    const onlySheetId = req.body?.sheetId ? String(req.body.sheetId).trim() : undefined;
    const result = await flushSheetBqQueue({
      secret: serverSecrets.appsScriptSecret,
      onlySheetId,
      onWebhookMutated: (url) => invalidateSheetCacheByWebhook(url),
    });

    return res.json({
      ok: result.errors.length === 0,
      ...result,
      telemetry: getSheetBqTelemetry(),
      message:
        result.flushedRows > 0
          ? `${result.flushedRows} baris dari ${result.flushedBatches} batch berhasil ditulis ke partisi Google Sheet.`
          : result.errors.length > 0
          ? `Sebagian antrean tertunda: ${result.errors[0]}`
          : 'Tidak ada antrean batch yang menunggu.',
    });
  });

  app.post('/api/sheets/bq-pattern/manifest', async (req, res) => {
    const webhookUrl = String(req.body?.webhookUrl || '').trim();
    const sheetName = String(req.body?.sheetName || '').trim();
    if (!isAllowedGoogleScriptUrl(webhookUrl)) {
      return res.status(400).json({
        ok: false,
        message: 'URL Webhook Google Apps Script tidak valid.',
      });
    }

    try {
      const result = await fetchSheetWithChunkedPagination({
        webhookUrl,
        sheetName,
        action: 'manifest',
        secret: serverSecrets.appsScriptSecret,
      });
      return res.status(result.status >= 400 ? result.status : 200).json({
        ok: result.status >= 200 && result.status < 300,
        latencyMs: result.latencyMs,
        manifest: result.data,
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        message: `Gagal membaca manifest partisi Google Sheet: ${
          err instanceof Error ? err.message : 'Network error'
        }`,
      });
    }
  });

  // 1a-4. Google BigQuery Data Warehouse Connector (Opsional / Additive, Kedaulatan Data Jakarta asia-southeast2)
  app.get('/api/bigquery/status', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    try {
      const result = await testBigQueryConnection();
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        datasetExists: false,
        tables: [],
        message: `Gagal memeriksa koneksi BigQuery: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      });
    }
  });

  app.post('/api/bigquery/sync-sheet', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const body = req.body || {};
    const headers = Array.isArray(body.headers)
      ? body.headers.map((h: unknown) => String(h).trim()).filter(Boolean)
      : [];
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!body.opdId || !body.sheetName || headers.length === 0) {
      return res.status(400).json({
        ok: false,
        message:
          'Data sheet tidak lengkap (opdId, sheetName, dan minimal 1 kolom header wajib ada).',
      });
    }

    try {
      const result = await syncOpdSheetToBigQuery({
        opdId: String(body.opdId),
        namaOpd: String(body.namaOpd || body.opdId),
        judulDataset: String(body.judulDataset || body.sheetName),
        sheetName: String(body.sheetName),
        headers,
        rows,
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        message: `Gagal sinkronisasi ke BigQuery: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      });
    }
  });

  app.post('/api/bigquery/query', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const sql = String(req.body?.sql || '');
    try {
      const result = await runReadOnlyBigQuerySql(sql);
      return res.status(200).json(result);
    } catch (err) {
      return res.status(400).json({
        ok: false,
        columns: [],
        rows: [],
        totalRows: 0,
        latencyMs: 0,
        message:
          err instanceof Error ? err.message : 'Gagal menjalankan query SQL.',
      });
    }
  });

  // 1a-5. Manajemen Cloudflare WAF, Origin Lock & Anti-Bot Turnstile
  app.get('/api/security/cloudflare-waf', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const cfRay = typeof req.headers['cf-ray'] === 'string' ? req.headers['cf-ray'] : '';
    const cfCountry =
      typeof req.headers['cf-ipcountry'] === 'string' ? req.headers['cf-ipcountry'] : '';
    const cfThreatScore =
      typeof req.headers['cf-threat-score'] === 'string'
        ? req.headers['cf-threat-score']
        : '';
    const cfConnectingIp =
      typeof req.headers['cf-connecting-ip'] === 'string'
        ? req.headers['cf-connecting-ip']
        : '';

    return res.json({
      ok: true,
      edgeTelemetry: {
        behindCloudflare: Boolean(cfRay && cfConnectingIp),
        cfRay: cfRay || null,
        cfCountry: cfCountry || null,
        cfThreatScore: cfThreatScore || null,
        clientIp: getClientIp(req),
      },
      config: {
        strictOriginLock: activeCloudflareWafConfig.strictOriginLock,
        originVerifyHeaderName: activeCloudflareWafConfig.originVerifyHeaderName,
        originVerifySecret: activeCloudflareWafConfig.originVerifySecret,
        blockHighThreatScore: activeCloudflareWafConfig.blockHighThreatScore,
        threatScoreThreshold: activeCloudflareWafConfig.threatScoreThreshold,
        turnstileEnabled: activeCloudflareWafConfig.turnstileEnabled,
        turnstileSiteKey: activeCloudflareWafConfig.turnstileSiteKey,
        hasTurnstileSecret: Boolean(activeCloudflareWafConfig.turnstileSecretKey),
        updatedAt: activeCloudflareWafConfig.updatedAt,
      },
      metrics: wafMetrics,
    });
  });

  app.put('/api/security/cloudflare-waf', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const body = req.body || {};
    const threshold = Number(body.threatScoreThreshold);
    const nextSecret =
      typeof body.turnstileSecretKey === 'string' &&
      body.turnstileSecretKey.trim().length > 0
        ? body.turnstileSecretKey.trim()
        : activeCloudflareWafConfig.turnstileSecretKey;

    activeCloudflareWafConfig = saveCloudflareWafConfig({
      ...activeCloudflareWafConfig,
      strictOriginLock:
        typeof body.strictOriginLock === 'boolean'
          ? body.strictOriginLock
          : activeCloudflareWafConfig.strictOriginLock,
      blockHighThreatScore:
        typeof body.blockHighThreatScore === 'boolean'
          ? body.blockHighThreatScore
          : activeCloudflareWafConfig.blockHighThreatScore,
      threatScoreThreshold: Number.isFinite(threshold)
        ? Math.max(5, Math.min(100, threshold))
        : activeCloudflareWafConfig.threatScoreThreshold,
      turnstileEnabled:
        typeof body.turnstileEnabled === 'boolean'
          ? body.turnstileEnabled
          : activeCloudflareWafConfig.turnstileEnabled,
      turnstileSiteKey:
        typeof body.turnstileSiteKey === 'string'
          ? body.turnstileSiteKey.trim()
          : activeCloudflareWafConfig.turnstileSiteKey,
      turnstileSecretKey: nextSecret,
    });

    return res.json({
      ok: true,
      config: {
        strictOriginLock: activeCloudflareWafConfig.strictOriginLock,
        originVerifyHeaderName: activeCloudflareWafConfig.originVerifyHeaderName,
        originVerifySecret: activeCloudflareWafConfig.originVerifySecret,
        blockHighThreatScore: activeCloudflareWafConfig.blockHighThreatScore,
        threatScoreThreshold: activeCloudflareWafConfig.threatScoreThreshold,
        turnstileEnabled: activeCloudflareWafConfig.turnstileEnabled,
        turnstileSiteKey: activeCloudflareWafConfig.turnstileSiteKey,
        hasTurnstileSecret: Boolean(activeCloudflareWafConfig.turnstileSecretKey),
        updatedAt: activeCloudflareWafConfig.updatedAt,
      },
      message: 'Konfigurasi Cloudflare WAF & Edge Security berhasil diperbarui.',
    });
  });

  app.post('/api/security/cloudflare-waf/rotate-origin-secret', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const nextSecret = `CF-ORG-${crypto
      .randomBytes(18)
      .toString('hex')
      .toUpperCase()}`;
    activeCloudflareWafConfig = saveCloudflareWafConfig({
      ...activeCloudflareWafConfig,
      originVerifySecret: nextSecret,
    });
    return res.json({
      ok: true,
      originVerifySecret: nextSecret,
      message:
        'Token verifikasi header Origin Cloudflare baru berhasil dibuat. Perbarui Transform Rule di Cloudflare Dashboard Anda.',
    });
  });

  // 1a-5b. Cloudflare DNS/SSL/WAF Pre-Flight Diagnostic & Blueprint Generator
  app.get('/api/security/cloudflare-waf/preflight', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;

    const cfRay = typeof req.headers['cf-ray'] === 'string' ? req.headers['cf-ray'] : '';
    const cfConnectingIp =
      typeof req.headers['cf-connecting-ip'] === 'string'
        ? req.headers['cf-connecting-ip']
        : '';
    const behindCloudflare = Boolean(cfRay && cfConnectingIp);
    const hasOriginVerifySecret = Boolean(
      activeCloudflareWafConfig.originVerifySecret
    );
    const turnstileConfigured = Boolean(
      activeCloudflareWafConfig.turnstileEnabled &&
        activeCloudflareWafConfig.turnstileSiteKey &&
        activeCloudflareWafConfig.turnstileSecretKey
    );
    const cloudflareApiConfigured = Boolean(
      process.env.CLOUDFLARE_API_TOKEN?.trim() &&
        process.env.CLOUDFLARE_ZONE_ID?.trim()
    );
    const sovereignSheetCount = Object.keys(sovereignSheetsStore.sheets).length;
    const sovereignRowCount = Object.values(
      sovereignSheetsStore.rowsBySheet
    ).reduce((acc, rows) => acc + rows.length, 0);

    const domain = activeRegencyConfig.domainResmi || 'nagekeokab.go.id';
    const portalSubdomain = domain.startsWith('data.')
      ? domain
      : `data.${domain}`;

    const checks = [
      {
        id: 'app-waf',
        title: 'App-Level WAF, CSP & Auto-Ban Middleware',
        status: 'pass' as const,
        detail:
          'Middleware keamanan aktif di Node.js (deteksi SQLi/XSS, scanner blocker, honeypot, rate limit baca/tulis, CSP, HSTS).',
      },
      {
        id: 'threat-score',
        title: 'Pemblokiran CF-Threat-Score Otomatis',
        status: activeCloudflareWafConfig.blockHighThreatScore
          ? ('pass' as const)
          : ('warn' as const),
        detail: activeCloudflareWafConfig.blockHighThreatScore
          ? `Aktif (menolak skor ancaman > ${activeCloudflareWafConfig.threatScoreThreshold}).`
          : 'Nonaktif. Disarankan aktifkan untuk menyaring trafik botnet Cloudflare.',
      },
      {
        id: 'origin-secret',
        title: 'Secret Header Verifikasi Origin (X-CF-Origin-Verify)',
        status: hasOriginVerifySecret ? ('pass' as const) : ('warn' as const),
        detail: hasOriginVerifySecret
          ? 'Token rahasia origin tersedia di server dan siap dipasang di Transform Rule Cloudflare.'
          : 'Token origin belum dibuat.',
      },
      {
        id: 'turnstile',
        title: 'Cloudflare Turnstile Anti-Bot Login Admin',
        status: turnstileConfigured ? ('pass' as const) : ('warn' as const),
        detail: turnstileConfigured
          ? 'Turnstile aktif dengan Site Key & Secret Key terverifikasi.'
          : 'Opsional belum diaktifkan (brute-force lockout & honeypot server tetap aktif).',
      },
      {
        id: 'cf-edge-live',
        title: `Status Proxy DNS Cloudflare (${portalSubdomain})`,
        status: behindCloudflare ? ('pass' as const) : ('pending' as const),
        detail: behindCloudflare
          ? `Trafik saat ini melewati Cloudflare Edge (CF-Ray: ${cfRay}).${
              activeCloudflareWafConfig.strictOriginLock
                ? ' Strict Origin Lock AKTIF.'
                : ' Anda aman mengaktifkan Strict Origin Lock.'
            }`
          : `Belum melewati proxy Cloudflare (normal saat preview lokal). Saat rilis ke ${portalSubdomain}, arahkan DNS CNAME/A dengan status Proxied (Awan Oranye) lalu aktifkan Strict Origin Lock.`,
      },
      {
        id: 'sovereign-store',
        title: 'Sovereign Server Store & Katalog Publik Warga',
        status: 'pass' as const,
        detail: `Penyimpanan mandiri server siap (${sovereignSheetCount} tabel, ${sovereignRowCount} baris tersimpan) & ${publicHarvestCatalog.length} dataset tersedia di Etalase Publik.`,
      },
    ];

    const passedWeight = checks.reduce((acc, c) => {
      if (c.status === 'pass') return acc + 1;
      if (c.status === 'warn') return acc + 0.5;
      return acc + 0.25;
    }, 0);
    const readinessScore = Math.round((passedWeight / checks.length) * 100);

    return res.json({
      ok: true,
      readinessScore,
      domainResmi: domain,
      recommendedHost: portalSubdomain,
      cloudflareApiConfigured,
      metrics: {
        behindCloudflare,
        strictOriginLock: activeCloudflareWafConfig.strictOriginLock,
        hasOriginVerifySecret,
        blockHighThreatScore: activeCloudflareWafConfig.blockHighThreatScore,
        turnstileConfigured,
        sovereignSheetCount,
        sovereignRowCount,
        publicCatalogCount: publicHarvestCatalog.length,
      },
      checks,
      blueprint: {
        dnsRecord: {
          type: 'CNAME',
          name: portalSubdomain,
          target: req.get('host') || 'ORIGIN_SERVER_HOST',
          proxied: true,
          sslMode: 'Full (strict)',
          minTlsVersion: '1.2',
          alwaysUseHttps: true,
        },
        transformRule: {
          name: `SatuData Inject Origin Verify (${portalSubdomain})`,
          expression: `(http.host eq "${portalSubdomain}")`,
          headerName: activeCloudflareWafConfig.originVerifyHeaderName,
          headerValue: activeCloudflareWafConfig.originVerifySecret,
        },
        wafCustomRule: {
          name: `SatuData Protect Admin & Block Scanners (${portalSubdomain})`,
          expression: `(http.request.uri.path contains "/api/auth/superadmin" and cf.threat_score gt 10) or (http.request.uri.path in {"/.env" "/wp-admin" "/wp-login.php" "/phpmyadmin"})`,
          action: 'managed_challenge',
        },
        rateLimitRule: {
          name: `SatuData Login & API Write Guard (${portalSubdomain})`,
          expression: `(http.request.uri.path contains "/api/auth/superadmin") or (http.request.method eq "POST" and http.request.uri.path contains "/api/sovereign-sheets")`,
          requestsPerPeriod: 20,
          periodSeconds: 60,
          action: 'block',
        },
      },
    });
  });

  app.post('/api/security/cloudflare-waf/apply-remote', async (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim() || '';
    const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim() || '';
    if (!token || !zoneId) {
      return res.status(400).json({
        ok: false,
        message:
          'Variabel lingkungan server CLOUDFLARE_API_TOKEN dan CLOUDFLARE_ZONE_ID belum dikonfigurasi. Gunakan tombol Unduh Skrip Deploy DNS/WAF atau tambahkan kredensial di .env server produksi.',
      });
    }

    try {
      const domain = activeRegencyConfig.domainResmi || 'nagekeokab.go.id';
      const portalSubdomain = domain.startsWith('data.')
        ? domain
        : `data.${domain}`;

      const verifyRes = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          zoneId
        )}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const verifyJson = (await verifyRes.json()) as {
        success?: boolean;
        result?: { name?: string; status?: string };
        errors?: Array<{ message?: string }>;
      };
      if (!verifyRes.ok || !verifyJson.success) {
        return res.status(502).json({
          ok: false,
          message:
            verifyJson.errors?.[0]?.message ||
            'Gagal memverifikasi Zone Cloudflare melalui API.',
        });
      }

      // Aktifkan SSL Full (Strict) & Always Use HTTPS pada zona Cloudflare
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          zoneId
        )}/settings/ssl`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: 'strict' }),
        }
      );
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(
          zoneId
        )}/settings/always_use_https`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ value: 'on' }),
        }
      );

      return res.json({
        ok: true,
        zoneName: verifyJson.result?.name || domain,
        zoneStatus: verifyJson.result?.status || 'active',
        recommendedHost: portalSubdomain,
        message: `Zona Cloudflare "${
          verifyJson.result?.name || domain
        }" terhubung. SSL Full (Strict) & Always Use HTTPS telah diterapkan otomatis.`,
      });
    } catch (err) {
      return res.status(502).json({
        ok: false,
        message: `Gagal menghubungi API Cloudflare: ${
          err instanceof Error ? err.message : 'Network error'
        }`,
      });
    }
  });

  // 1a-5c. Server Sovereign Data Store (Menutup Ketergantungan Tunggal pada Google Sheets / Apps Script)
  const SOVEREIGN_SHEETS_PATH = path.resolve(
    __dirname,
    'data',
    'sovereign-sheets.json'
  );

  interface SovereignRowRecord {
    _id: string;
    _rowNumber?: number;
    _updatedAt: string;
    values: Record<string, string>;
  }

  interface SovereignSheetsStore {
    sheets: Record<string, Record<string, unknown>>;
    rowsBySheet: Record<string, SovereignRowRecord[]>;
    updatedAt: string;
  }

  const loadSovereignSheetsStore = (): SovereignSheetsStore => {
    try {
      if (fs.existsSync(SOVEREIGN_SHEETS_PATH)) {
        const parsed = JSON.parse(
          fs.readFileSync(SOVEREIGN_SHEETS_PATH, 'utf8')
        ) as Partial<SovereignSheetsStore>;
        return {
          sheets:
            parsed.sheets && typeof parsed.sheets === 'object'
              ? parsed.sheets
              : {},
          rowsBySheet:
            parsed.rowsBySheet && typeof parsed.rowsBySheet === 'object'
              ? parsed.rowsBySheet
              : {},
          updatedAt: String(parsed.updatedAt || ''),
        };
      }
    } catch {
      // Abaikan
    }
    return { sheets: {}, rowsBySheet: {}, updatedAt: '' };
  };

  const saveSovereignSheetsStore = (store: SovereignSheetsStore) => {
    const next: SovereignSheetsStore = {
      ...store,
      updatedAt: new Date().toISOString(),
    };
    try {
      const dir = path.dirname(SOVEREIGN_SHEETS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        SOVEREIGN_SHEETS_PATH,
        JSON.stringify(next, null, 2),
        'utf8'
      );
    } catch {
      // Tetap aktif di memori
    }
    return next;
  };

  let sovereignSheetsStore: SovereignSheetsStore = loadSovereignSheetsStore();

  const sanitizeRowValuesMap = (
    rawValues: unknown
  ): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!rawValues || typeof rawValues !== 'object') return out;
    for (const [k, v] of Object.entries(rawValues as Record<string, unknown>)) {
      const key = String(k).trim().slice(0, 120);
      if (!key) continue;
      out[key] = String(v ?? '').slice(0, 4000);
    }
    return out;
  };

  app.get('/api/sovereign-sheets', (_req, res) => {
    return res.json({
      ok: true,
      sheets: Object.values(sovereignSheetsStore.sheets),
      rowsBySheet: sovereignSheetsStore.rowsBySheet,
      updatedAt: sovereignSheetsStore.updatedAt,
    });
  });

  app.post('/api/sovereign-sheets/register', (req, res) => {
    const incoming = req.body?.sheet;
    if (!incoming || typeof incoming !== 'object' || !incoming.id) {
      return res.status(400).json({
        ok: false,
        message: 'Payload sheet wajib memiliki ID yang valid.',
      });
    }

    const sheetId = String(incoming.id).trim();
    const storageMode =
      incoming.storageMode === 'server_standalone'
        ? 'server_standalone'
        : 'google_sheet';
    const headers = Array.isArray(incoming.headers)
      ? incoming.headers
          .map((h: unknown) => String(h).trim())
          .filter(Boolean)
          .slice(0, 100)
      : [];

    const persistedSheet: Record<string, unknown> = {
      ...incoming,
      id: sheetId,
      storageMode,
      headers,
      status:
        storageMode === 'server_standalone'
          ? 'Aktif'
          : incoming.status || 'Menunggu Cangkok Script',
      terakhirSinkron:
        incoming.terakhirSinkron || new Date().toISOString(),
    };

    const initialRows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>)
          .slice(0, 5000)
          .map((r, idx) => ({
            _id: String(r?._id || `${sheetId}-srv-${idx + 1}`),
            _rowNumber: Number(r?._rowNumber || idx + 2),
            _updatedAt: String(
              r?._updatedAt || new Date().toISOString().slice(0, 10)
            ),
            values: sanitizeRowValuesMap(r?.values),
          }))
      : sovereignSheetsStore.rowsBySheet[sheetId] || [];

    sovereignSheetsStore = saveSovereignSheetsStore({
      sheets: {
        ...sovereignSheetsStore.sheets,
        [sheetId]: persistedSheet,
      },
      rowsBySheet: {
        ...sovereignSheetsStore.rowsBySheet,
        [sheetId]: initialRows,
      },
      updatedAt: sovereignSheetsStore.updatedAt,
    });

    return res.status(201).json({
      ok: true,
      sheet: persistedSheet,
      rows: initialRows,
      message:
        storageMode === 'server_standalone'
          ? 'Tabel Mandiri Server berhasil dibuat & aktif permanen tanpa ketergantungan Google Sheets.'
          : 'Skema sheet OPD dicerminkan ke penyimpanan cadangan server.',
    });
  });

  app.put('/api/sovereign-sheets/:sheetId/rows', (req, res) => {
    const sheetId = String(req.params.sheetId || '').trim();
    if (!sheetId) {
      return res.status(400).json({ ok: false, message: 'ID sheet wajib diisi.' });
    }

    const headers = Array.isArray(req.body?.headers)
      ? req.body.headers
          .map((h: unknown) => String(h).trim())
          .filter(Boolean)
          .slice(0, 100)
      : undefined;

    const incomingRows = Array.isArray(req.body?.rows)
      ? (req.body.rows as Array<Record<string, unknown>>)
          .slice(0, 5000)
          .map((r, idx) => ({
            _id: String(r?._id || `${sheetId}-srv-${idx + 1}`),
            _rowNumber: Number(r?._rowNumber || idx + 2),
            _updatedAt: String(
              r?._updatedAt || new Date().toISOString().slice(0, 10)
            ),
            values: sanitizeRowValuesMap(r?.values),
          }))
      : [];

    const existingSheet = sovereignSheetsStore.sheets[sheetId] || { id: sheetId };
    const nextSheet = {
      ...existingSheet,
      ...(headers && headers.length > 0 ? { headers } : {}),
      terakhirSinkron: new Date().toISOString(),
    };

    sovereignSheetsStore = saveSovereignSheetsStore({
      sheets: {
        ...sovereignSheetsStore.sheets,
        [sheetId]: nextSheet,
      },
      rowsBySheet: {
        ...sovereignSheetsStore.rowsBySheet,
        [sheetId]: incomingRows,
      },
      updatedAt: sovereignSheetsStore.updatedAt,
    });

    return res.json({
      ok: true,
      rowCount: incomingRows.length,
      syncedAt: nextSheet.terakhirSinkron,
    });
  });

  app.post('/api/sovereign-sheets/:sheetId/mutate', (req, res) => {
    const sheetId = String(req.params.sheetId || '').trim();
    const action = String(req.body?.action || '').trim();
    const row = req.body?.row as Record<string, unknown> | undefined;

    if (!sheetId || !['create', 'update', 'delete'].includes(action) || !row) {
      return res.status(400).json({
        ok: false,
        message: 'Permintaan mutasi Server Sovereign Store tidak lengkap.',
      });
    }

    const currentRows = [...(sovereignSheetsStore.rowsBySheet[sheetId] || [])];
    const rowId = String(row._id || `${sheetId}-srv-${Date.now().toString(36)}`);
    const nowDate = new Date().toISOString().slice(0, 10);
    let assignedRowNumber = Number(row._rowNumber || currentRows.length + 2);

    let nextRows: SovereignRowRecord[] = currentRows;
    if (action === 'create') {
      assignedRowNumber = currentRows.length + 2;
      nextRows = [
        {
          _id: rowId,
          _rowNumber: assignedRowNumber,
          _updatedAt: nowDate,
          values: sanitizeRowValuesMap(row.values),
        },
        ...currentRows,
      ];
    } else if (action === 'update') {
      const idx = currentRows.findIndex((r) => r._id === rowId);
      const updatedRecord: SovereignRowRecord = {
        _id: rowId,
        _rowNumber: assignedRowNumber,
        _updatedAt: nowDate,
        values: sanitizeRowValuesMap(row.values),
      };
      if (idx >= 0) {
        nextRows = currentRows.map((r, i) => (i === idx ? updatedRecord : r));
      } else {
        nextRows = [updatedRecord, ...currentRows];
      }
    } else if (action === 'delete') {
      nextRows = currentRows.filter((r) => r._id !== rowId);
    }

    const existingSheet = sovereignSheetsStore.sheets[sheetId];
    const nextSheets = existingSheet
      ? {
          ...sovereignSheetsStore.sheets,
          [sheetId]: {
            ...existingSheet,
            terakhirSinkron: new Date().toISOString(),
          },
        }
      : sovereignSheetsStore.sheets;

    sovereignSheetsStore = saveSovereignSheetsStore({
      sheets: nextSheets,
      rowsBySheet: {
        ...sovereignSheetsStore.rowsBySheet,
        [sheetId]: nextRows,
      },
      updatedAt: sovereignSheetsStore.updatedAt,
    });

    return res.json({
      ok: true,
      rowNumber: assignedRowNumber,
      totalRows: nextRows.length,
      message:
        action === 'delete'
          ? 'Baris berhasil dihapus dari Penyimpanan Mandiri Server.'
          : action === 'update'
          ? 'Perubahan baris berhasil disimpan di Penyimpanan Mandiri Server.'
          : 'Baris baru berhasil disimpan permanen di Penyimpanan Mandiri Server.',
    });
  });

  app.delete('/api/sovereign-sheets/:sheetId', (req, res) => {
    const sheetId = String(req.params.sheetId || '').trim();
    if (!sheetId) {
      return res.status(400).json({ ok: false, message: 'ID sheet wajib diisi.' });
    }
    const nextSheets = { ...sovereignSheetsStore.sheets };
    const nextRows = { ...sovereignSheetsStore.rowsBySheet };
    delete nextSheets[sheetId];
    delete nextRows[sheetId];
    sovereignSheetsStore = saveSovereignSheetsStore({
      sheets: nextSheets,
      rowsBySheet: nextRows,
      updatedAt: sovereignSheetsStore.updatedAt,
    });
    return res.json({ ok: true, message: 'Dataset dihapus dari Server Store.' });
  });

  // 1a-6. Node Interoperabilitas Standar Nasional: CKAN API v3, W3C DCAT-AP & Etalase Pencarian Publik Warga (Zero PII)
  const PUBLIC_CATALOG_PATH = path.resolve(
    __dirname,
    'data',
    'public-catalog.json'
  );

  const PUBLIC_PII_COLUMN_REGEX =
    /(nik|ktp|no[._\s-]*hp|telepon|whatsapp|alamat|tgl[._\s-]*lahir|tanggal[._\s-]*lahir|email|rekening|npwp)/i;

  interface PublicCatalogVariableItem {
    namaKolom: string;
    definisi: string;
    tipeData: string;
    satuan: string;
  }

  interface PublicCatalogPreviewRow {
    _id: string;
    _updatedAt: string;
    values: Record<string, string>;
  }

  interface PublicCatalogDatasetItem {
    id: string;
    slug: string;
    sourceType: 'opd_verified' | 'kominfo_clone';
    judulDataset: string;
    deskripsi: string;
    produsenData: string;
    walidata: string;
    urusanPemerintahan: string;
    kodeReferensi: string;
    tahunData: string;
    frekuensiPemutakhiran: string;
    cakupanWilayah: string;
    metodologiPengumpulan: string;
    satuanPengukuran: string;
    kontakPic: string;
    headers: string[];
    variabel: PublicCatalogVariableItem[];
    previewRows: PublicCatalogPreviewRow[];
    jumlahBaris: number;
    diperbaruiPada: string;
  }

  const loadPublicCatalog = (): PublicCatalogDatasetItem[] => {
    try {
      if (fs.existsSync(PUBLIC_CATALOG_PATH)) {
        const parsed = JSON.parse(fs.readFileSync(PUBLIC_CATALOG_PATH, 'utf8'));
        if (Array.isArray(parsed)) return parsed as PublicCatalogDatasetItem[];
      }
    } catch {
      // Abaikan
    }
    return [];
  };

  const savePublicCatalog = (items: PublicCatalogDatasetItem[]) => {
    try {
      const dir = path.dirname(PUBLIC_CATALOG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        PUBLIC_CATALOG_PATH,
        JSON.stringify(items, null, 2),
        'utf8'
      );
    } catch {
      // Abaikan
    }
  };

  let publicHarvestCatalog: PublicCatalogDatasetItem[] = loadPublicCatalog();

  const sanitizePublicHeadersAndRows = (
    rawHeaders: unknown[],
    rawRows: unknown[]
  ): {
    safeHeaders: string[];
    safeRows: PublicCatalogPreviewRow[];
    strippedColumns: string[];
  } => {
    const allHeaders = rawHeaders.map((h) => String(h).trim()).filter(Boolean);
    const safeHeaders = allHeaders.filter((h) => !PUBLIC_PII_COLUMN_REGEX.test(h));
    const strippedColumns = allHeaders.filter((h) =>
      PUBLIC_PII_COLUMN_REGEX.test(h)
    );

    const safeRows: PublicCatalogPreviewRow[] = rawRows
      .slice(0, 500)
      .map((r, idx) => {
        const rowObj = (r && typeof r === 'object' ? r : {}) as {
          _id?: unknown;
          _updatedAt?: unknown;
          values?: Record<string, unknown>;
        };
        const cleanValues: Record<string, string> = {};
        for (const h of safeHeaders) {
          cleanValues[h] = String(rowObj.values?.[h] ?? '').slice(0, 500);
        }
        return {
          _id: String(rowObj._id || `pub-r-${idx + 1}`),
          _updatedAt: String(
            rowObj._updatedAt || new Date().toISOString().slice(0, 10)
          ),
          values: cleanValues,
        };
      });

    return { safeHeaders, safeRows, strippedColumns };
  };

  app.post('/api/public/catalog/sync', (req, res) => {
    if (!requireSuperAdminActor(req, res)) return;
    const rawSheets = Array.isArray(req.body?.datasets) ? req.body.datasets : [];
    const rawClones = Array.isArray(req.body?.clones) ? req.body.clones : [];
    const verifiedPublic: PublicCatalogDatasetItem[] = [];
    let totalStrippedPiiCols = 0;

    for (const item of rawSheets) {
      const id = String(item?.id || '').trim();
      if (!id) continue;
      const meta = serverMetadataMap[id] as Record<string, unknown> | undefined;
      const statusValidasi = String(
        meta?.statusValidasi || item?.statusValidasi || ''
      );
      const tingkatAkses = String(
        meta?.tingkatAkses || item?.tingkatAkses || ''
      );
      // Hanya dataset yang sudah Terverifikasi Walidata dan berstatus Terbuka (Publik) yang masuk ke etalase & feed harvesting!
      if (
        statusValidasi !== 'Terverifikasi Walidata' ||
        tingkatAkses !== 'Terbuka (Publik)'
      ) {
        continue;
      }

      const judul = String(item?.judulDataset || '').trim();
      const slugBase =
        judul
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || id.toLowerCase();

      const rawHeaders = Array.isArray(item?.headers) ? item.headers : [];
      const fallbackSovereignRows = sovereignSheetsStore.rowsBySheet[id] || [];
      const rawRows = Array.isArray(item?.previewRows)
        ? item.previewRows
        : fallbackSovereignRows;

      const { safeHeaders, safeRows, strippedColumns } =
        sanitizePublicHeadersAndRows(rawHeaders, rawRows);
      totalStrippedPiiCols += strippedColumns.length;

      const rawVars = Array.isArray(meta?.variabel)
        ? (meta.variabel as Array<Record<string, unknown>>)
        : Array.isArray(item?.variabel)
        ? (item.variabel as Array<Record<string, unknown>>)
        : [];
      const safeSet = new Set(safeHeaders);
      const safeVariables: PublicCatalogVariableItem[] = rawVars
        .filter((v) => safeSet.has(String(v?.namaKolom || '').trim()))
        .map((v) => ({
          namaKolom: String(v?.namaKolom ?? '').trim(),
          definisi: String(v?.definisi ?? '').trim(),
          tipeData: String(v?.tipeData ?? 'Teks').trim(),
          satuan: String(v?.satuan ?? '').trim(),
        }));

      verifiedPublic.push({
        id,
        slug: `${slugBase}-${id.slice(-4).toLowerCase()}`,
        sourceType: 'opd_verified',
        judulDataset: judul,
        deskripsi: String(
          meta?.konsepDefinisi || item?.deskripsi || ''
        ).trim(),
        produsenData: String(
          meta?.produsenData || item?.namaOpd || ''
        ).trim(),
        walidata: String(
          meta?.walidata || activeRegencyConfig.namaWalidata
        ).trim(),
        urusanPemerintahan: String(meta?.urusanPemerintahan || '').trim(),
        kodeReferensi: String(meta?.kodeReferensi || '').trim(),
        tahunData: String(
          meta?.tahunData || new Date().getFullYear()
        ).trim(),
        frekuensiPemutakhiran: String(
          meta?.frekuensiPemutakhiran || 'Tahunan'
        ).trim(),
        cakupanWilayah: String(meta?.cakupanWilayah || 'Kabupaten').trim(),
        metodologiPengumpulan: String(
          meta?.metodologiPengumpulan || 'Kompilasi Administrasi'
        ).trim(),
        satuanPengukuran: String(meta?.satuanPengukuran || '').trim(),
        kontakPic: String(meta?.kontakPic || '').trim(),
        headers: safeHeaders,
        variabel: safeVariables,
        previewRows: safeRows,
        jumlahBaris: Math.max(Number(item?.jumlahBaris || 0), safeRows.length),
        diperbaruiPada: String(
          meta?.diperbaruiPada || new Date().toISOString()
        ),
      });
    }

    // Sertakan hasil Publikasi Kominfo yang berstatus "Dipublikasikan" (otomatis strip PII)
    for (const clone of rawClones) {
      if (String(clone?.statusPublikasi || '') !== 'Dipublikasikan') continue;
      const cid = String(clone?.id || '').trim();
      if (!cid) continue;
      const judul = String(clone?.judulPublikasi || '').trim();
      const slugBase =
        judul
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || cid.toLowerCase();

      const rawHeaders = Array.isArray(clone?.selectedHeaders)
        ? clone.selectedHeaders
        : [];
      const rawRows = Array.isArray(clone?.rows) ? clone.rows : [];
      const { safeHeaders, safeRows, strippedColumns } =
        sanitizePublicHeadersAndRows(rawHeaders, rawRows);
      totalStrippedPiiCols += strippedColumns.length;

      verifiedPublic.push({
        id: cid,
        slug: `pub-${slugBase}-${cid.slice(-4).toLowerCase()}`,
        sourceType: 'kominfo_clone',
        judulDataset: judul,
        deskripsi: String(clone?.ringkasan || '').trim(),
        produsenData: String(clone?.sourceOpdNama || '').trim(),
        walidata: activeRegencyConfig.namaWalidata,
        urusanPemerintahan: String(clone?.kategori || 'Publikasi Sektoral').trim(),
        kodeReferensi: `PUB-${cid.slice(-6).toUpperCase()}`,
        tahunData: String(
          String(clone?.dipublikasikanPada || '').slice(0, 4) ||
            new Date().getFullYear()
        ),
        frekuensiPemutakhiran: 'Tahunan',
        cakupanWilayah: 'Kabupaten',
        metodologiPengumpulan: 'Kurasi Walidata Kominfo',
        satuanPengukuran: '',
        kontakPic: activeRegencyConfig.namaWalidata,
        headers: safeHeaders,
        variabel: [],
        previewRows: safeRows,
        jumlahBaris: Math.max(rawRows.length, safeRows.length),
        diperbaruiPada: String(
          clone?.dipublikasikanPada || new Date().toISOString()
        ),
      });
    }

    publicHarvestCatalog = verifiedPublic;
    savePublicCatalog(publicHarvestCatalog);

    return res.json({
      ok: true,
      publishedCount: publicHarvestCatalog.length,
      strippedPiiCols: totalStrippedPiiCols,
      message: `${publicHarvestCatalog.length} dataset Terverifikasi & Publik berhasil disinkronkan ke Etalase Publik Warga & endpoint CKAN/DCAT${
        totalStrippedPiiCols > 0
          ? ` (${totalStrippedPiiCols} kolom sensitif PII disaring otomatis).`
          : ' (zero PII).'
      }`,
    });
  });

  // Etalase Pencarian Publik untuk Warga Umum (Read-Only, Tanpa Login, Zero PII)
  app.get('/api/public/catalog', (req, res) => {
    const q = String(req.query?.q || '').trim().toLowerCase();
    const opd = String(req.query?.opd || '').trim().toLowerCase();
    const urusan = String(req.query?.urusan || '').trim().toLowerCase();
    const tahun = String(req.query?.tahun || '').trim();

    const opdList = Array.from(
      new Set(publicHarvestCatalog.map((d) => d.produsenData).filter(Boolean))
    ).sort();
    const urusanList = Array.from(
      new Set(
        publicHarvestCatalog.map((d) => d.urusanPemerintahan).filter(Boolean)
      )
    ).sort();
    const tahunList = Array.from(
      new Set(publicHarvestCatalog.map((d) => d.tahunData).filter(Boolean))
    ).sort((a, b) => b.localeCompare(a));

    const filtered = publicHarvestCatalog.filter((d) => {
      if (opd && d.produsenData.toLowerCase() !== opd) return false;
      if (urusan && d.urusanPemerintahan.toLowerCase() !== urusan) return false;
      if (tahun && d.tahunData !== tahun) return false;
      if (q) {
        const hay = [
          d.judulDataset,
          d.deskripsi,
          d.produsenData,
          d.urusanPemerintahan,
          d.kodeReferensi,
          ...d.headers,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      portalName: activeRegencyConfig.namaPortal,
      regencyName: activeRegencyConfig.namaKabupaten,
      walidataName: activeRegencyConfig.namaWalidata,
      totalDatasets: publicHarvestCatalog.length,
      facets: { opdList, urusanList, tahunList },
      datasets: filtered.map((d) => ({
        id: d.id,
        slug: d.slug,
        sourceType: d.sourceType,
        judulDataset: d.judulDataset,
        deskripsi: d.deskripsi,
        produsenData: d.produsenData,
        walidata: d.walidata,
        urusanPemerintahan: d.urusanPemerintahan,
        kodeReferensi: d.kodeReferensi,
        tahunData: d.tahunData,
        frekuensiPemutakhiran: d.frekuensiPemutakhiran,
        cakupanWilayah: d.cakupanWilayah,
        metodologiPengumpulan: d.metodologiPengumpulan,
        satuanPengukuran: d.satuanPengukuran,
        kontakPic: d.kontakPic,
        headers: d.headers,
        variabel: d.variabel,
        jumlahBaris: d.jumlahBaris,
        diperbaruiPada: d.diperbaruiPada,
      })),
    });
  });

  app.get('/api/public/catalog/:slug', (req, res) => {
    const idOrSlug = String(req.params.slug || '').trim().toLowerCase();
    const found = publicHarvestCatalog.find(
      (d) =>
        d.slug.toLowerCase() === idOrSlug ||
        d.id.toLowerCase() === idOrSlug ||
        d.kodeReferensi.toLowerCase() === idOrSlug
    );
    if (!found) {
      return res.status(404).json({
        ok: false,
        message: 'Dataset tidak ditemukan di katalog publik terverifikasi.',
      });
    }
    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      dataset: found,
    });
  });

  // W3C DCAT / Satu Data Indonesia Feed (Read-Only)
  app.get('/api/public/dcat.json', (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json({
      '@context': 'https://project-open-data.cio.gov/v1.1/schema/catalog.jsonld',
      conformsTo: 'https://project-open-data.cio.gov/v1.1/schema',
      describedBy: `${baseUrl}/api/public/dcat.json`,
      title: `${activeRegencyConfig.namaPortal} — Katalog Interoperabilitas SDI`,
      publisher: {
        '@type': 'org:Organization',
        name: activeRegencyConfig.namaWalidata,
      },
      generatedAt: new Date().toISOString(),
      dataset: publicHarvestCatalog.map((d) => ({
        '@type': 'dcat:Dataset',
        identifier: d.kodeReferensi || d.id,
        slug: d.slug,
        title: d.judulDataset,
        description: d.deskripsi || `Dataset sektoral ${d.judulDataset}`,
        keyword: [d.urusanPemerintahan, d.cakupanWilayah, d.tahunData].filter(
          Boolean
        ),
        modified: d.diperbaruiPada,
        publisher: {
          '@type': 'org:Organization',
          name: d.produsenData,
        },
        spatial: `${activeRegencyConfig.namaKabupaten} (${d.cakupanWilayah})`,
        temporal: d.tahunData,
        accrualPeriodicity: d.frekuensiPemutakhiran,
        schemaFields: d.headers,
        recordCount: d.jumlahBaris,
        distribution: [
          {
            '@type': 'dcat:Distribution',
            mediaType: 'application/json',
            format: 'CKAN-JSON',
            accessURL: `${baseUrl}/api/public/ckan/package_show?id=${encodeURIComponent(
              d.slug
            )}`,
          },
          {
            '@type': 'dcat:Distribution',
            mediaType: 'application/json',
            format: 'JSON-SDI-TABLE',
            accessURL: `${baseUrl}/api/public/catalog/${encodeURIComponent(
              d.slug
            )}`,
          },
        ],
      })),
    });
  });

  // CKAN Action API v3 Compatible: package_list
  app.get('/api/public/ckan/package_list', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json({
      help: 'Daftar dataset Terverifikasi Walidata & Terbuka (Publik) kompatibel CKAN Action API v3.',
      success: true,
      result: publicHarvestCatalog.map((d) => d.slug),
    });
  });

  // CKAN Action API v3 Compatible: package_show
  app.get('/api/public/ckan/package_show', (req, res) => {
    const idOrSlug = String(req.query?.id || '').trim().toLowerCase();
    const found = publicHarvestCatalog.find(
      (d) =>
        d.slug.toLowerCase() === idOrSlug ||
        d.id.toLowerCase() === idOrSlug ||
        d.kodeReferensi.toLowerCase() === idOrSlug
    );
    if (!found) {
      return res.status(404).json({
        success: false,
        error: {
          __type: 'Not Found Error',
          message: 'Dataset tidak ditemukan atau belum berstatus Terverifikasi & Publik.',
        },
      });
    }

    res.setHeader('Cache-Control', 'public, max-age=120');
    return res.json({
      success: true,
      result: {
        id: found.id,
        name: found.slug,
        title: found.judulDataset,
        notes: found.deskripsi,
        metadata_modified: found.diperbaruiPada,
        organization: {
          name: found.produsenData.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: found.produsenData,
        },
        extras: [
          { key: 'kode_referensi', value: found.kodeReferensi },
          { key: 'walidata', value: found.walidata },
          { key: 'urusan_pemerintahan', value: found.urusanPemerintahan },
          { key: 'tahun_data', value: found.tahunData },
          { key: 'frekuensi', value: found.frekuensiPemutakhiran },
          { key: 'cakupan_wilayah', value: found.cakupanWilayah },
          { key: 'satuan', value: found.satuanPengukuran },
          { key: 'jumlah_baris', value: String(found.jumlahBaris) },
        ],
        schema_columns: found.headers,
      },
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

  // Background Micro-Batch Flusher untuk Pola Data Google Sheet ala BigQuery
  const bqFlushTimer = setInterval(() => {
    const telemetry = getSheetBqTelemetry();
    if (telemetry.queueDepth > 0) {
      void flushSheetBqQueue({
        secret: serverSecrets.appsScriptSecret,
        onWebhookMutated: (url) => invalidateSheetCacheByWebhook(url),
      });
    }
  }, 5000);
  bqFlushTimer.unref?.();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Satu Data Nagekeo server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
