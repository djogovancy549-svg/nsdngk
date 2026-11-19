import {
  OpdDynamicSheet,
  PublishedDatasetClone,
  SecurityEventEntry,
  SecuritySeverity,
} from '../types/satuData';

const SECURITY_EVENTS_KEY = 'satu_data_nagekeo_sec_events_v1';
const LOGIN_GUARD_KEY = 'satu_data_nagekeo_login_guard_v1';
const MAX_CLIENT_ATTEMPTS = 5;
const CLIENT_LOCKOUT_MS = 60 * 1000;

export function loadSecurityEvents(): SecurityEventEntry[] {
  try {
    const raw = localStorage.getItem(SECURITY_EVENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SecurityEventEntry[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export function appendSecurityEvent(input: {
  kategori: SecurityEventEntry['kategori'];
  tingkat: SecuritySeverity;
  aktor: string;
  target: string;
  detail: string;
  diblokir: boolean;
}): SecurityEventEntry[] {
  const entry: SecurityEventEntry = {
    id: `sec-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const next = [entry, ...loadSecurityEvents()].slice(0, 120);
  try {
    localStorage.setItem(SECURITY_EVENTS_KEY, JSON.stringify(next));
  } catch {
    // Abaikan
  }
  return next;
}

export function clearSecurityEvents(): void {
  try {
    localStorage.removeItem(SECURITY_EVENTS_KEY);
  } catch {
    // Abaikan
  }
}

// Client-side brute-force guard for OPD & general login attempts
interface LoginGuardState {
  failedCount: number;
  lockedUntil: number;
}

export function getLoginGuardStatus(): {
  locked: boolean;
  remainingSec: number;
  failedCount: number;
} {
  try {
    const raw = localStorage.getItem(LOGIN_GUARD_KEY);
    if (!raw) return { locked: false, remainingSec: 0, failedCount: 0 };
    const parsed = JSON.parse(raw) as LoginGuardState;
    const now = Date.now();
    if (parsed.lockedUntil > now) {
      return {
        locked: true,
        remainingSec: Math.ceil((parsed.lockedUntil - now) / 1000),
        failedCount: parsed.failedCount,
      };
    }
    return {
      locked: false,
      remainingSec: 0,
      failedCount: parsed.failedCount || 0,
    };
  } catch {
    return { locked: false, remainingSec: 0, failedCount: 0 };
  }
}

export function recordFailedLoginAttempt(identifier: string): {
  locked: boolean;
  remainingSec: number;
  remainingAttempts: number;
} {
  const current = getLoginGuardStatus();
  const nextCount = current.failedCount + 1;
  const shouldLock = nextCount >= MAX_CLIENT_ATTEMPTS;
  const state: LoginGuardState = {
    failedCount: shouldLock ? 0 : nextCount,
    lockedUntil: shouldLock ? Date.now() + CLIENT_LOCKOUT_MS : 0,
  };

  try {
    localStorage.setItem(LOGIN_GUARD_KEY, JSON.stringify(state));
  } catch {
    // Abaikan
  }

  appendSecurityEvent({
    kategori: shouldLock ? 'Brute Force' : 'Login Gagal',
    tingkat: shouldLock ? 'Tinggi' : 'Sedang',
    aktor: identifier || 'Anonim',
    target: 'Gerbang Autentikasi',
    detail: shouldLock
      ? `5 kali percobaan login gagal berturut-turut untuk "${identifier}". Akses dikunci otomatis 60 detik.`
      : `Percobaan login gagal (${nextCount}/${MAX_CLIENT_ATTEMPTS}) untuk "${identifier}".`,
    diblokir: shouldLock,
  });

  return {
    locked: shouldLock,
    remainingSec: shouldLock ? Math.ceil(CLIENT_LOCKOUT_MS / 1000) : 0,
    remainingAttempts: Math.max(0, MAX_CLIENT_ATTEMPTS - nextCount),
  };
}

export function resetLoginGuard(): void {
  try {
    localStorage.removeItem(LOGIN_GUARD_KEY);
  } catch {
    // Abaikan
  }
}

// Payload threat detection & sanitization (XSS, SQLi, Google Sheets Formula Injection)
const XSS_PATTERN =
  /(<\s*script\b|javascript:|on(error|load|click|mouseover)\s*=|<\s*iframe\b|<\s*object\b)/i;
const SQLI_PATTERN =
  /(\bunion\s+select\b|\bdrop\s+table\b|\bdelete\s+from\b|'\s*or\s*'1'\s*=\s*'1|--\s*$)/i;
const FORMULA_INJECTION_PATTERN =
  /^(=|\+|-|@)\s*(cmd|powershell|importxml|importhtml|importdata|importrange|hyperlink|webservice|exec|system)/i;

export interface SanitizeResult {
  sanitizedValues: Record<string, string>;
  threatsDetected: { field: string; threatType: string; sample: string }[];
}

export function inspectAndSanitizeValues(
  values: Record<string, string>,
  actor: string,
  target: string
): SanitizeResult {
  const sanitizedValues: Record<string, string> = {};
  const threatsDetected: { field: string; threatType: string; sample: string }[] =
    [];

  for (const [key, rawVal] of Object.entries(values)) {
    let val = String(rawVal ?? '');

    if (XSS_PATTERN.test(val)) {
      threatsDetected.push({
        field: key,
        threatType: 'XSS / Script Injection',
        sample: val.slice(0, 60),
      });
      val = val
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/javascript:/gi, 'blocked:');
    }

    if (SQLI_PATTERN.test(val)) {
      threatsDetected.push({
        field: key,
        threatType: 'SQL Injection Pattern',
        sample: val.slice(0, 60),
      });
    }

    if (FORMULA_INJECTION_PATTERN.test(val.trim())) {
      threatsDetected.push({
        field: key,
        threatType: 'Google Sheets Formula Injection',
        sample: val.slice(0, 60),
      });
      // Prefix with single quote so Google Sheets treats it strictly as plain text
      val = `'${val}`;
    }

    sanitizedValues[key] = val;
  }

  if (threatsDetected.length > 0) {
    appendSecurityEvent({
      kategori: 'Injeksi Payload',
      tingkat: 'Tinggi',
      aktor: actor,
      target,
      detail: `Terdeteksi & dinetralkan ${threatsDetected
        .map((t) => `${t.threatType} pada kolom "${t.field}"`)
        .join('; ')}.`,
      diblokir: true,
    });
  }

  return { sanitizedValues, threatsDetected };
}

// PII / UU PDP Column Exposure Scanner
const SENSITIVE_PII_PATTERNS = [
  { label: 'NIK / Identitas Kependudukan', re: /\b(nik|ktp|kk|no\.?\s*kk)\b/i },
  { label: 'Nomor Telepon / HP / WA', re: /(no\.?\s*hp|telp|telepon|whatsapp|\bwa\b|handphone)/i },
  { label: 'Alamat Pribadi', re: /\balamat\b/i },
  { label: 'Tanggal Lahir', re: /(tgl\.?\s*lahir|tanggal\s*lahir)/i },
  { label: 'Email Pribadi', re: /\b(email|surel)\b/i },
  { label: 'Kredensial / Sandi', re: /(password|sandi|pin|token|secret)/i },
];

export interface PiiExposureItem {
  scope: 'Sheet OPD' | 'Publikasi Kominfo';
  judul: string;
  opdNama: string;
  sensitiveHeaders: { header: string; category: string }[];
  isPublic: boolean;
}

export function scanPiiExposure(
  sheets: OpdDynamicSheet[],
  clones: PublishedDatasetClone[]
): PiiExposureItem[] {
  const findings: PiiExposureItem[] = [];

  for (const s of sheets) {
    const hits: { header: string; category: string }[] = [];
    for (const h of s.headers) {
      const matched = SENSITIVE_PII_PATTERNS.find((p) => p.re.test(h));
      if (matched) hits.push({ header: h, category: matched.label });
    }
    if (hits.length > 0) {
      findings.push({
        scope: 'Sheet OPD',
        judul: `${s.judulDataset} (${s.sheetName})`,
        opdNama: s.namaOpd,
        sensitiveHeaders: hits,
        isPublic: false,
      });
    }
  }

  for (const c of clones) {
    const hits: { header: string; category: string }[] = [];
    for (const h of c.selectedHeaders) {
      const matched = SENSITIVE_PII_PATTERNS.find((p) => p.re.test(h));
      if (matched) hits.push({ header: h, category: matched.label });
    }
    if (hits.length > 0) {
      findings.push({
        scope: 'Publikasi Kominfo',
        judul: `${c.judulPublikasi} (${c.targetTabName})`,
        opdNama: c.sourceOpdNama,
        sensitiveHeaders: hits,
        isPublic: c.statusPublikasi === 'Dipublikasikan',
      });
    }
  }

  return findings;
}

export interface AiThreatAnalysis {
  tingkatAncaman: string;
  skorKeamanan: number;
  ringkasanEksekutif: string;
  temuanKerentanan: {
    judul: string;
    tingkat: string;
    vektorSerangan: string;
    dampak: string;
    rekomendasi: string;
  }[];
  deteksiAnomali: string[];
  langkahMitigasiPrioritas: string[];
}

export async function requestAiThreatAnalysis(
  snapshot: Record<string, unknown>
): Promise<{ ok: boolean; analysis?: AiThreatAnalysis; error?: string }> {
  try {
    const res = await fetch('/api/security/analyze-threats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json?.error || `Server merespons HTTP ${res.status}`,
      };
    }
    return { ok: true, analysis: json.analysis as AiThreatAnalysis };
  } catch {
    return {
      ok: false,
      error: 'Gagal menghubungi layanan analisis AI di server.',
    };
  }
}

export interface AiPayloadInspection {
  status: string;
  kategoriSerangan: string;
  penjelasan: string;
  tindakanDisarankan: string;
}

export async function requestAiPayloadInspection(
  payload: string
): Promise<{ ok: boolean; inspection?: AiPayloadInspection; error?: string }> {
  try {
    const res = await fetch('/api/security/inspect-payload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error: json?.error || `Server merespons HTTP ${res.status}`,
      };
    }
    return { ok: true, inspection: json.inspection as AiPayloadInspection };
  } catch {
    return {
      ok: false,
      error: 'Gagal menghubungi layanan inspeksi payload AI di server.',
    };
  }
}
