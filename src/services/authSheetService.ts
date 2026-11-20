import {
  AUTH_SHEET_CONFIG,
  isPlaceholderEndpoint,
  OPD_DIRECTORY,
  SUPER_ADMIN_RESERVED_IDENTIFIERS,
} from '../config/opdSheets';
import {
  AccountStatus,
  AuthSheetConfig,
  OpdAccount,
  UserSession,
} from '../types/satuData';
import {
  appendSecurityEvent,
  getLoginGuardStatus,
  recordFailedLoginAttempt,
  resetLoginGuard,
} from './cyberSecurityService';
import { extractGoogleSheetId } from './dynamicSheetService';

const ACCOUNTS_STORAGE_KEY = 'satu_data_nagekeo_accounts_v3';
const SESSION_STORAGE_KEY = 'satu_data_nagekeo_session_v3';
const AUTH_CONFIG_STORAGE_KEY = 'satu_data_nagekeo_auth_sheet_cfg_v3';
const SUPER_ADMIN_ALLOWLIST_STORAGE_KEY =
  'satu_data_nagekeo_superadmin_emails_v1';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(value: string): boolean {
  return EMAIL_REGEX.test(value.trim().toLowerCase());
}

export function loadCachedSuperAdminAllowedEmails(): string[] {
  const primary = SUPER_ADMIN_RESERVED_IDENTIFIERS.email.trim().toLowerCase();
  try {
    const raw = localStorage.getItem(SUPER_ADMIN_ALLOWLIST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map((e) => String(e).trim().toLowerCase())
          .filter((e) => EMAIL_REGEX.test(e));
        return Array.from(new Set([primary, ...cleaned]));
      }
    }
  } catch {
    // Abaikan
  }
  return [primary];
}

export function saveCachedSuperAdminAllowedEmails(emails: string[]): string[] {
  const primary = SUPER_ADMIN_RESERVED_IDENTIFIERS.email.trim().toLowerCase();
  const normalized = Array.from(
    new Set([
      primary,
      ...emails
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => EMAIL_REGEX.test(e)),
    ])
  );
  try {
    localStorage.setItem(
      SUPER_ADMIN_ALLOWLIST_STORAGE_KEY,
      JSON.stringify(normalized)
    );
  } catch {
    // Abaikan
  }
  return normalized;
}

export async function fetchSuperAdminAllowedEmails(
  actorEmail: string
): Promise<{
  ok: boolean;
  primaryEmail: string;
  allowedEmails: string[];
  message?: string;
}> {
  const primaryDefault = SUPER_ADMIN_RESERVED_IDENTIFIERS.email
    .trim()
    .toLowerCase();
  try {
    const res = await fetch('/api/auth/superadmin/allowlist', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.allowedEmails)) {
        const saved = saveCachedSuperAdminAllowedEmails(data.allowedEmails);
        return {
          ok: true,
          primaryEmail: String(data.primaryEmail || primaryDefault),
          allowedEmails: saved,
        };
      }
      return {
        ok: false,
        primaryEmail: primaryDefault,
        allowedEmails: loadCachedSuperAdminAllowedEmails(),
        message: data?.message || 'Gagal memuat daftar email Super Admin.',
      };
    }
  } catch {
    // Fallback ke cache lokal
  }
  return {
    ok: true,
    primaryEmail: primaryDefault,
    allowedEmails: loadCachedSuperAdminAllowedEmails(),
  };
}

export async function addSuperAdminAllowedEmail(
  actorEmail: string,
  newEmail: string
): Promise<{
  ok: boolean;
  allowedEmails: string[];
  message: string;
}> {
  const cleanEmail = newEmail.trim().toLowerCase();
  if (!isValidEmailAddress(cleanEmail)) {
    return {
      ok: false,
      allowedEmails: loadCachedSuperAdminAllowedEmails(),
      message: 'Format alamat email tidak valid.',
    };
  }

  try {
    const res = await fetch('/api/auth/superadmin/allowlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({ email: cleanEmail }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.allowedEmails)) {
        const saved = saveCachedSuperAdminAllowedEmails(data.allowedEmails);
        return {
          ok: true,
          allowedEmails: saved,
          message:
            data.message ||
            `Email ${cleanEmail} berhasil didaftarkan sebagai Super Admin.`,
        };
      }
      return {
        ok: false,
        allowedEmails: loadCachedSuperAdminAllowedEmails(),
        message: data?.message || 'Gagal mendaftarkan email Super Admin.',
      };
    }
  } catch {
    // Fallback lokal jika server belum terjangkau
  }

  const current = loadCachedSuperAdminAllowedEmails();
  if (current.includes(cleanEmail)) {
    return {
      ok: false,
      allowedEmails: current,
      message: `Email ${cleanEmail} sudah terdaftar sebagai Super Admin.`,
    };
  }
  const saved = saveCachedSuperAdminAllowedEmails([...current, cleanEmail]);
  return {
    ok: true,
    allowedEmails: saved,
    message: `Email ${cleanEmail} berhasil didaftarkan untuk akses Super Admin.`,
  };
}

export async function removeSuperAdminAllowedEmail(
  actorEmail: string,
  targetEmail: string
): Promise<{
  ok: boolean;
  allowedEmails: string[];
  message: string;
}> {
  const cleanTarget = targetEmail.trim().toLowerCase();
  const primary = SUPER_ADMIN_RESERVED_IDENTIFIERS.email.trim().toLowerCase();
  if (cleanTarget === primary) {
    return {
      ok: false,
      allowedEmails: loadCachedSuperAdminAllowedEmails(),
      message: 'Email utama Super Admin tidak dapat dihapus.',
    };
  }

  try {
    const res = await fetch('/api/auth/superadmin/allowlist', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({ email: cleanTarget }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data.ok && Array.isArray(data.allowedEmails)) {
        const saved = saveCachedSuperAdminAllowedEmails(data.allowedEmails);
        return {
          ok: true,
          allowedEmails: saved,
          message:
            data.message ||
            `Akses Super Admin untuk ${cleanTarget} berhasil dicabut.`,
        };
      }
      return {
        ok: false,
        allowedEmails: loadCachedSuperAdminAllowedEmails(),
        message: data?.message || 'Gagal mencabut akses email Super Admin.',
      };
    }
  } catch {
    // Fallback lokal
  }

  const next = loadCachedSuperAdminAllowedEmails().filter(
    (e) => e !== cleanTarget
  );
  const saved = saveCachedSuperAdminAllowedEmails(next);
  return {
    ok: true,
    allowedEmails: saved,
    message: `Akses Super Admin untuk ${cleanTarget} berhasil dicabut.`,
  };
}

export function getActiveAuthSheetConfig(): AuthSheetConfig {
  try {
    const raw = localStorage.getItem(AUTH_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthSheetConfig>;
      if (parsed.sheetUrl || parsed.webhookUrl) {
        const sheetUrl = parsed.sheetUrl || AUTH_SHEET_CONFIG.sheetUrl;
        return {
          sheetId:
            extractGoogleSheetId(sheetUrl) ||
            parsed.sheetId ||
            AUTH_SHEET_CONFIG.sheetId,
          sheetName: parsed.sheetName?.trim() || AUTH_SHEET_CONFIG.sheetName,
          gid: parsed.gid || '0',
          sheetUrl,
          webhookUrl: parsed.webhookUrl?.trim() || AUTH_SHEET_CONFIG.webhookUrl,
        };
      }
    }
  } catch {
    // Abaikan jika localStorage tidak tersedia
  }
  return AUTH_SHEET_CONFIG;
}

export function saveCustomAuthSheetConfig(input: {
  sheetUrl: string;
  sheetName: string;
  webhookUrl: string;
}): AuthSheetConfig {
  const next: AuthSheetConfig = {
    sheetId: extractGoogleSheetId(input.sheetUrl.trim()) || '',
    sheetName: input.sheetName.trim() || 'Akun_OPD',
    gid: '0',
    sheetUrl: input.sheetUrl.trim(),
    webhookUrl: input.webhookUrl.trim(),
  };
  try {
    localStorage.setItem(AUTH_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Abaikan
  }
  return next;
}

export function resetCustomAuthSheetConfig(): AuthSheetConfig {
  try {
    localStorage.removeItem(AUTH_CONFIG_STORAGE_KEY);
  } catch {
    // Abaikan
  }
  return AUTH_SHEET_CONFIG;
}

export async function testAuthSheetConnection(
  config: AuthSheetConfig
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = performance.now();
  if (isPlaceholderEndpoint(config.webhookUrl)) {
    return {
      ok: false,
      latencyMs: 0,
      message:
        'URL Webhook Akun masih berupa template. Masukkan URL Web App (/exec) hasil deploy Code_Akun_OPD.gs.',
    };
  }
  try {
    const url = new URL(config.webhookUrl);
    url.searchParams.set('action', 'list');
    url.searchParams.set('sheet', config.sheetName || 'Akun_OPD');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const latencyMs = Math.round(performance.now() - start);
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        message: `Webhook merespons HTTP ${res.status}. Pastikan Web App dideploy dengan akses "Anyone".`,
      };
    }
    const json = await res.json();
    if (json && json.ok && Array.isArray(json.data)) {
      return {
        ok: true,
        latencyMs,
        message: `Terhubung ke Google Sheet Akun OPD (${json.data.length} akun terbaca).`,
      };
    }
    return {
      ok: false,
      latencyMs,
      message: json?.error || 'Respons Webhook Akun tidak valid.',
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      message: `Gagal terhubung: ${
        err instanceof Error ? err.message : 'Network error'
      }`,
    };
  }
}

export async function hashPassword(plain: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(`nagekeo_sd::${plain}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    let hash = 0;
    for (let i = 0; i < plain.length; i++) {
      hash = (hash << 5) - hash + plain.charCodeAt(i);
      hash |= 0;
    }
    return `fallback_${Math.abs(hash).toString(16)}`;
  }
}

export function loadLocalAccounts(): OpdAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as OpdAccount[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export function saveLocalAccounts(accounts: OpdAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
  } catch {
    // Abaikan
  }
}

export function loadSavedSession(): UserSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UserSession;
  } catch {
    // Abaikan
  }
  return null;
}

export function saveSession(session: UserSession | null): void {
  try {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Abaikan
  }
}

export interface FetchAccountsResult {
  accounts: OpdAccount[];
  syncedFromSheet: boolean;
  message: string;
}

export async function fetchAccountsFromSheet(): Promise<FetchAccountsResult> {
  const activeCfg = getActiveAuthSheetConfig();
  const webhookIsLive = !isPlaceholderEndpoint(activeCfg.webhookUrl);

  if (webhookIsLive) {
    try {
      const url = new URL(activeCfg.webhookUrl);
      url.searchParams.set('action', 'list');
      url.searchParams.set('sheet', activeCfg.sheetName);

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (response.ok) {
        const json = await response.json();
        if (json && json.ok && Array.isArray(json.data)) {
          const normalized: OpdAccount[] = json.data.map(
            (row: Record<string, unknown>, idx: number) => {
              const opdId = String(row.opdId || `opd-${idx + 1}`);
              const ref = OPD_DIRECTORY.find((o) => o.id === opdId);
              return {
                id: String(row.id || `acc-${idx + 1}`),
                opdId,
                namaOpd: String(row.namaOpd || ref?.nama || opdId),
                namaLengkap: String(row.namaLengkap || 'Operator OPD'),
                email: String(row.email || '').trim().toLowerCase(),
                username: String(row.username || '').trim().toLowerCase(),
                passwordHash: String(row.passwordHash || ''),
                driveFolderUrl: String(row.driveFolderUrl || ''),
                role: 'opd',
                status:
                  String(row.status) === 'Nonaktif' ? 'Nonaktif' : 'Aktif',
                dibuatPada: String(
                  row.dibuatPada || new Date().toISOString().slice(0, 10)
                ),
              };
            }
          );
          saveLocalAccounts(normalized);
          return {
            accounts: normalized,
            syncedFromSheet: true,
            message: `Berhasil menyinkronkan ${normalized.length} akun OPD dari Google Sheet Akun.`,
          };
        }
      }
    } catch {
      // Fallback ke lokal
    }
  }

  const local = loadLocalAccounts();
  return {
    accounts: local,
    syncedFromSheet: false,
    message: webhookIsLive
      ? `Gagal menjangkau Webhook Akun OPD. Menampilkan ${local.length} akun lokal.`
      : `Mode lokal aktif (${local.length} akun). Daftarkan Google Sheet Akun Super Admin di menu Skrip Code.gs & Auth.`,
  };
}

export interface RegisterAccountInput {
  opdId: string;
  namaOpd: string;
  namaLengkap: string;
  email: string;
  username: string;
  password: string;
  driveFolderUrl: string;
}

export interface RegisterAccountResult {
  ok: boolean;
  account?: OpdAccount;
  syncedToSheet: boolean;
  message: string;
}

export async function registerOpdAccount(
  input: RegisterAccountInput,
  existingAccounts: OpdAccount[]
): Promise<RegisterAccountResult> {
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanUsername = input.username.trim().toLowerCase();
  const cleanOpdName = input.namaOpd.trim();

  if (!cleanOpdName) {
    return {
      ok: false,
      syncedToSheet: false,
      message: 'Nama Dinas/OPD wajib diisi.',
    };
  }

  if (!isValidEmailAddress(cleanEmail)) {
    return {
      ok: false,
      syncedToSheet: false,
      message: 'Format alamat email OPD tidak valid.',
    };
  }

  const allowedSuperAdminEmails = loadCachedSuperAdminAllowedEmails();
  if (
    cleanUsername === SUPER_ADMIN_RESERVED_IDENTIFIERS.username ||
    cleanEmail === SUPER_ADMIN_RESERVED_IDENTIFIERS.email ||
    allowedSuperAdminEmails.includes(cleanEmail)
  ) {
    return {
      ok: false,
      syncedToSheet: false,
      message:
        'Username atau email tersebut sudah terdaftar khusus untuk akses Super Admin.',
    };
  }

  const duplicate = existingAccounts.find(
    (acc) =>
      acc.username.toLowerCase() === cleanUsername ||
      acc.email.toLowerCase() === cleanEmail
  );
  if (duplicate) {
    return {
      ok: false,
      syncedToSheet: false,
      message: 'Email atau username sudah terdaftar. Gunakan kredensial lain.',
    };
  }

  const passwordHash = await hashPassword(input.password);
  const resolvedOpdId =
    input.opdId ||
    cleanOpdName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  const newAccount: OpdAccount = {
    id: `acc-${Date.now().toString(36)}`,
    opdId: resolvedOpdId,
    namaOpd: cleanOpdName,
    namaLengkap: input.namaLengkap.trim(),
    email: cleanEmail,
    username: cleanUsername,
    passwordHash,
    driveFolderUrl: input.driveFolderUrl.trim(),
    role: 'opd',
    status: 'Aktif',
    dibuatPada: new Date().toISOString().slice(0, 10),
  };

  const nextAccounts = [newAccount, ...existingAccounts];
  saveLocalAccounts(nextAccounts);

  const activeCfg = getActiveAuthSheetConfig();

  if (isPlaceholderEndpoint(activeCfg.webhookUrl)) {
    return {
      ok: true,
      account: newAccount,
      syncedToSheet: false,
      message: `Akun ${cleanOpdName} berhasil didaftarkan. Silakan masuk untuk mendaftarkan URL Google Sheet OPD Anda.`,
    };
  }

  try {
    const response = await fetch(activeCfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'register',
        sheetName: activeCfg.sheetName,
        account: newAccount,
      }),
    });

    if (response.ok) {
      return {
        ok: true,
        account: newAccount,
        syncedToSheet: true,
        message: `Akun ${cleanOpdName} berhasil didaftarkan dan tersimpan di Google Sheet Akun OPD.`,
      };
    }

    return {
      ok: true,
      account: newAccount,
      syncedToSheet: false,
      message: `Akun tersimpan lokal, namun Webhook Akun OPD merespons HTTP ${response.status}.`,
    };
  } catch {
    return {
      ok: true,
      account: newAccount,
      syncedToSheet: false,
      message: `Akun tersimpan lokal. Webhook Google Sheet Akun OPD belum dapat dijangkau.`,
    };
  }
}

export async function updateOpdAccountStatus(
  account: OpdAccount,
  status: AccountStatus,
  existingAccounts: OpdAccount[]
): Promise<{ accounts: OpdAccount[]; syncedToSheet: boolean; message: string }> {
  const updated: OpdAccount = { ...account, status };
  const next = existingAccounts.map((a) => (a.id === updated.id ? updated : a));
  saveLocalAccounts(next);

  const activeCfg = getActiveAuthSheetConfig();

  if (isPlaceholderEndpoint(activeCfg.webhookUrl)) {
    return {
      accounts: next,
      syncedToSheet: false,
      message: `Status akun ${updated.username} diubah menjadi ${status}.`,
    };
  }

  try {
    const res = await fetch(activeCfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStatus',
        sheetName: activeCfg.sheetName,
        id: updated.id,
        status,
      }),
    });
    return {
      accounts: next,
      syncedToSheet: res.ok,
      message: res.ok
        ? `Status akun ${updated.username} diperbarui di Google Sheet Akun OPD.`
        : `Status diubah lokal (HTTP ${res.status} dari Webhook).`,
    };
  } catch {
    return {
      accounts: next,
      syncedToSheet: false,
      message: `Status akun ${updated.username} diperbarui secara lokal.`,
    };
  }
}

export async function deleteOpdAccount(
  account: OpdAccount,
  existingAccounts: OpdAccount[]
): Promise<{ accounts: OpdAccount[]; syncedToSheet: boolean; message: string }> {
  const next = existingAccounts.filter((a) => a.id !== account.id);
  saveLocalAccounts(next);

  const activeCfg = getActiveAuthSheetConfig();

  if (isPlaceholderEndpoint(activeCfg.webhookUrl)) {
    return {
      accounts: next,
      syncedToSheet: false,
      message: `Akun ${account.username} dihapus.`,
    };
  }

  try {
    const res = await fetch(activeCfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'delete',
        sheetName: activeCfg.sheetName,
        id: account.id,
      }),
    });
    return {
      accounts: next,
      syncedToSheet: res.ok,
      message: res.ok
        ? `Akun ${account.username} dihapus dari Google Sheet Akun OPD.`
        : `Akun dihapus lokal (HTTP ${res.status} dari Webhook).`,
    };
  } catch {
    return {
      accounts: next,
      syncedToSheet: false,
      message: `Akun ${account.username} dihapus secara lokal.`,
    };
  }
}

export interface LoginResult {
  ok: boolean;
  session?: UserSession;
  message?: string;
}

export async function authenticateUser(
  identifier: string,
  password: string,
  accounts: OpdAccount[],
  loginRole: 'opd' | 'super_admin' = 'opd'
): Promise<LoginResult> {
  const cleanEmail = identifier.trim().toLowerCase();

  // Wajib menggunakan alamat email yang valid (tidak menerima akses bebas tanpa email terdaftar)
  if (!isValidEmailAddress(cleanEmail)) {
    return {
      ok: false,
      message:
        loginRole === 'super_admin'
          ? 'Masukkan alamat email resmi Super Admin yang terdaftar.'
          : 'Masukkan alamat email yang sudah didaftarkan untuk akun User/OPD Anda.',
    };
  }

  // Cek proteksi brute-force klien
  const guard = getLoginGuardStatus();
  if (guard.locked) {
    return {
      ok: false,
      message: `Akses sementara dikunci karena percobaan gagal berulang. Coba lagi dalam ${guard.remainingSec} detik.`,
    };
  }

  // 1. Jalur Khusus Super Admin — HANYA terbuka untuk email dalam daftar putih resmi Super Admin
  if (loginRole === 'super_admin') {
    let serverHandled = false;
    try {
      const serverRes = await fetch('/api/auth/superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: cleanEmail,
          password,
          loginRole: 'super_admin',
        }),
      });

      const contentType = serverRes.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        if (serverRes.status === 429) {
          const data = await serverRes.json();
          appendSecurityEvent({
            kategori: 'Brute Force',
            tingkat: 'Kritis',
            aktor: cleanEmail,
            target: 'Autentikasi Super Admin',
            detail:
              data?.message ||
              'Server memblokir upaya brute-force pada akun Super Admin.',
            diblokir: true,
          });
          return {
            ok: false,
            message:
              data?.message ||
              'Terlalu banyak percobaan gagal. Akses dikunci oleh server.',
          };
        }

        if (serverRes.status === 403) {
          const data = await serverRes.json();
          appendSecurityEvent({
            kategori: 'Login Gagal',
            tingkat: 'Tinggi',
            aktor: cleanEmail,
            target: 'Gerbang Super Admin (Email Allowlist)',
            detail:
              data?.message ||
              `Email ${cleanEmail} ditolak karena tidak termasuk dalam daftar email resmi Super Admin.`,
            diblokir: true,
          });
          return {
            ok: false,
            message:
              data?.message ||
              'Akses Super Admin ditolak. Email ini tidak terdaftar dalam daftar email resmi Super Admin.',
          };
        }

        if (serverRes.ok || serverRes.status === 401) {
          const data = await serverRes.json();
          serverHandled = true;
          if (data.ok && data.session) {
            resetLoginGuard();
            return {
              ok: true,
              session: data.session as UserSession,
            };
          }
          appendSecurityEvent({
            kategori: 'Login Gagal',
            tingkat: 'Tinggi',
            aktor: cleanEmail,
            target: 'Autentikasi Super Admin',
            detail:
              data?.message ||
              'Percobaan masuk Super Admin gagal dengan kata sandi salah.',
            diblokir: false,
          });
          return {
            ok: false,
            message: data?.message || 'Kata sandi Super Admin tidak sesuai.',
          };
        }
      }
    } catch {
      // Endpoint server tidak terjangkau (misal mode statis / restart)
    }

    // Fallback verifikasi hash SHA-256 (tanpa plaintext) & email allowlist lokal
    if (!serverHandled) {
      const allowedEmails = loadCachedSuperAdminAllowedEmails();
      if (!allowedEmails.includes(cleanEmail)) {
        appendSecurityEvent({
          kategori: 'Login Gagal',
          tingkat: 'Tinggi',
          aktor: cleanEmail,
          target: 'Gerbang Super Admin (Email Allowlist)',
          detail: `Email ${cleanEmail} ditolak karena tidak termasuk dalam daftar email resmi Super Admin.`,
          diblokir: true,
        });
        return {
          ok: false,
          message:
            'Akses Super Admin ditolak. Email ini tidak terdaftar dalam daftar email resmi Super Admin.',
        };
      }

      const SUPER_ADMIN_SHA256 =
        '96a2c0e63ea4bf155d594b9ae9e69e8ed88bf6f3916fe96da1358fea81b6d7d8';
      const rawHash = await hashPassword(password);
      const trimmedHash = await hashPassword(password.trim());
      if (rawHash === SUPER_ADMIN_SHA256 || trimmedHash === SUPER_ADMIN_SHA256) {
        resetLoginGuard();
        return {
          ok: true,
          session: {
            id: `super-admin:${cleanEmail}`,
            role: 'super_admin',
            username: SUPER_ADMIN_RESERVED_IDENTIFIERS.username,
            email: cleanEmail,
            namaLengkap: 'Super Admin Walidata',
            opdId: null,
            namaOpd: 'Diskominfo Kabupaten Nagekeo',
          },
        };
      }

      const fail = recordFailedLoginAttempt(cleanEmail);
      appendSecurityEvent({
        kategori: fail.locked ? 'Brute Force' : 'Login Gagal',
        tingkat: fail.locked ? 'Kritis' : 'Tinggi',
        aktor: cleanEmail,
        target: 'Autentikasi Super Admin',
        detail: fail.locked
          ? 'Percobaan masuk Super Admin gagal 5 kali berturut-turut. Akses dikunci.'
          : 'Percobaan masuk Super Admin gagal dengan kata sandi salah.',
        diblokir: fail.locked,
      });
      return {
        ok: false,
        message: fail.locked
          ? `Kata sandi salah 5 kali berturut-turut. Akses dikunci ${fail.remainingSec} detik.`
          : `Kata sandi Super Admin tidak sesuai. Sisa percobaan: ${fail.remainingAttempts}.`,
      };
    }
  }

  // 2. Jalur User / OPD — WAJIB menggunakan email yang sudah didaftarkan & berstatus Aktif
  const candidate = accounts.find(
    (acc) => acc.email.trim().toLowerCase() === cleanEmail
  );

  if (!candidate) {
    const fail = recordFailedLoginAttempt(cleanEmail);
    return {
      ok: false,
      message: fail.locked
        ? `Terlalu banyak percobaan gagal. Akses dikunci ${fail.remainingSec} detik.`
        : `Email belum terdaftar sebagai akun User/OPD. Pastikan Anda masuk dengan email yang sudah didaftarkan. Sisa percobaan: ${fail.remainingAttempts}.`,
    };
  }

  if (candidate.status !== 'Aktif') {
    return {
      ok: false,
      message:
        'Akun dengan email ini sedang dinonaktifkan oleh Super Admin Walidata.',
    };
  }

  const inputHash = await hashPassword(password);
  if (candidate.passwordHash !== inputHash) {
    const fail = recordFailedLoginAttempt(cleanEmail);
    return {
      ok: false,
      message: fail.locked
        ? `Kata sandi salah 5 kali berturut-turut. Akses dikunci ${fail.remainingSec} detik.`
        : `Kata sandi tidak sesuai. Sisa percobaan: ${fail.remainingAttempts}.`,
    };
  }

  resetLoginGuard();
  return {
    ok: true,
    session: {
      id: candidate.id,
      role: 'opd',
      username: candidate.username,
      email: candidate.email,
      namaLengkap: candidate.namaLengkap,
      opdId: candidate.opdId,
      namaOpd: candidate.namaOpd,
      driveFolderUrl: candidate.driveFolderUrl,
    },
  };
}

const OPD_DELETE_PIN_PREFIX = 'satu_data_nagekeo_opd_delpin_v1_';

export function hasOpdDeletePin(opdKey: string): boolean {
  try {
    return Boolean(localStorage.getItem(`${OPD_DELETE_PIN_PREFIX}${opdKey}`));
  } catch {
    return false;
  }
}

export async function saveOpdDeletePin(
  opdKey: string,
  pin: string
): Promise<void> {
  const hashed = await hashPassword(`delpin:${opdKey}:${pin.trim()}`);
  try {
    localStorage.setItem(`${OPD_DELETE_PIN_PREFIX}${opdKey}`, hashed);
  } catch {
    // Abaikan
  }
}

export async function verifyOpdDeletePin(
  opdKey: string,
  pin: string
): Promise<boolean> {
  try {
    const stored = localStorage.getItem(`${OPD_DELETE_PIN_PREFIX}${opdKey}`);
    if (!stored) return true;
    const candidate = await hashPassword(`delpin:${opdKey}:${pin.trim()}`);
    return stored === candidate;
  } catch {
    return false;
  }
}

export function clearOpdDeletePin(opdKey: string): void {
  try {
    localStorage.removeItem(`${OPD_DELETE_PIN_PREFIX}${opdKey}`);
  } catch {
    // Abaikan
  }
}
