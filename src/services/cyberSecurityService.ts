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

function buildClientFallbackThreatAnalysis(
  snapshot: Record<string, unknown>
): AiThreatAnalysis {
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

  let skorKeamanan = 92 - criticalCount * 15 - publicPiiCount * 18 - Math.min(blockedCount * 2, 12);
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

  const temuanKerentanan: AiThreatAnalysis['temuanKerentanan'] = [];
  if (publicPiiCount > 0) {
    temuanKerentanan.push({
      judul: 'Eksposur Kolom Data Pribadi (PII) pada Dataset Publik',
      tingkat: 'Kritis',
      vektorSerangan: 'Pengumpulan Data Pribadi / Scraping Publik (UU PDP)',
      dampak: 'Kolom sensitif (NIK, No. HP, Alamat) berisiko bocor ke publik.',
      rekomendasi:
        'Hapus atau anonimisasi kolom PII di menu Publikasi Kominfo sebelum dipublikasikan.',
    });
  }
  if (piiItems.length > publicPiiCount) {
    temuanKerentanan.push({
      judul: 'Kolom Sensitif Terdeteksi di Sheet Internal OPD',
      tingkat: 'Sedang',
      vektorSerangan: 'Salah Konfigurasi Izin Berbagi Google Sheet',
      dampak: 'Data penduduk pada sheet OPD berisiko diakses jika tautan dibagikan terbuka.',
      rekomendasi:
        'Batasi izin Google Sheet OPD hanya untuk akun resmi dan wajibkan PIN Hapus OPD.',
    });
  }
  if (temuanKerentanan.length === 0) {
    temuanKerentanan.push({
      judul: 'Postur Keamanan Dasar Terjaga',
      tingkat: 'Rendah',
      vektorSerangan: 'Pemantauan Rutin Webhook & Kredensial',
      dampak: 'Belum terdeteksi anomali serangan aktif pada telemetri saat ini.',
      rekomendasi:
        'Pastikan setiap OPD mengaktifkan PIN Keamanan Hapus dan lakukan rotasi sandi berkala.',
    });
  }

  return {
    tingkatAncaman,
    skorKeamanan,
    ringkasanEksekutif: `Audit keamanan mencatat skor ${skorKeamanan}/100 dengan tingkat ancaman ${tingkatAncaman} dari ${totalSheets} sheet OPD (${activeSheets} aktif), ${blockedCount} insiden diblokir, dan ${publicPiiCount} peringatan PII publik.`,
    temuanKerentanan,
    deteksiAnomali:
      blockedCount > 0
        ? [`Tercatat ${blockedCount} upaya mencurigakan yang berhasil diblokir otomatis.`]
        : ['Tidak ditemukan pola brute-force, injeksi formula Google Sheets, atau anomali kritis.'],
    langkahMitigasiPrioritas: [
      'Ganti kata sandi default Super Admin melalui environment variable server.',
      'Wajibkan seluruh OPD mengaktifkan PIN Keamanan Hapus.',
      'Saring kolom PII (NIK, No. HP, Alamat) sebelum mempublikasikan dataset di Publikasi Kominfo.',
      'Audit berkala URL Webhook Apps Script (/exec) agar hanya dari domain script.google.com.',
    ],
  };
}

function buildClientFallbackPayloadInspection(
  sample: string
): AiPayloadInspection {
  if (/<\s*script|javascript:|on\w+\s*=|<\s*iframe/i.test(sample)) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'Cross-Site Scripting (XSS)',
      penjelasan:
        'Payload mengandung tag skrip atau event handler HTML yang dapat mengeksekusi kode berbahaya.',
      tindakanDisarankan:
        'Tolak dan sanitasi input dengan menghapus tag HTML/skrip sebelum menyimpan data.',
    };
  }
  if (
    /^\s*[=+\-@]/.test(sample) ||
    /=(IMPORTXML|IMPORTRANGE|IMPORTDATA|HYPERLINK|CMD)/i.test(sample)
  ) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'Google Sheets / CSV Formula Injection',
      penjelasan:
        'Input diawali karakter formula (=, +, -, @) atau fungsi eksternal Google Sheets yang berisiko menarik data keluar.',
      tindakanDisarankan:
        "Awali nilai sel dengan tanda petik tunggal (') agar Google Sheets memperlakukannya sebagai teks biasa.",
    };
  }
  if (
    /(\bunion\b\s+\bselect\b|\bdrop\b\s+\btable\b|\bor\b\s+1\s*=\s*1|--\s*$)/i.test(
      sample
    )
  ) {
    return {
      status: 'Berbahaya',
      kategoriSerangan: 'SQL Injection',
      penjelasan: 'Terdeteksi pola query SQL berbahaya pada input.',
      tindakanDisarankan:
        'Blokir payload dan catat aktor pengirim ke log insiden keamanan.',
    };
  }
  if (/\b\d{16}\b/.test(sample) || /(nik|password|secret|token)\s*[:=]/i.test(sample)) {
    return {
      status: 'Mencurigakan',
      kategoriSerangan: 'Potensi Kebocoran PII / Kredensial',
      penjelasan:
        'Sampel memuat pola angka 16 digit (mirip NIK) atau kata kunci kredensial sensitif.',
      tindakanDisarankan:
        'Lakukan masking atau hapus data pribadi tersebut sebelum dibagikan ke ruang publik.',
    };
  }
  return {
    status: 'Aman',
    kategoriSerangan: 'Tidak Ada Ancaman Terdeteksi',
    penjelasan:
      'Tidak ditemukan pola XSS, SQL Injection, Formula Injection Google Sheets, maupun kebocoran kredensial.',
    tindakanDisarankan:
      'Tetap terapkan validasi standar saat memasukkan data ke Google Sheet OPD.',
  };
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
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (res.ok && json.ok && json.analysis) {
        return { ok: true, analysis: json.analysis as AiThreatAnalysis };
      }
    }
  } catch {
    // Fallback ke analisis heuristik lokal jika endpoint server tidak terjangkau
  }
  return {
    ok: true,
    analysis: buildClientFallbackThreatAnalysis(snapshot),
  };
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
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (res.ok && json.ok && json.inspection) {
        return { ok: true, inspection: json.inspection as AiPayloadInspection };
      }
    }
  } catch {
    // Fallback ke inspektor heuristik lokal jika endpoint server tidak terjangkau
  }
  return {
    ok: true,
    inspection: buildClientFallbackPayloadInspection(payload),
  };
}
