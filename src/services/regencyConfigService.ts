export interface RegencyWhiteLabelConfig {
  namaKabupaten: string;
  namaPortal: string;
  namaWalidata: string;
  domainResmi: string;
  urlPortalPublik: string;
  daftarKecamatan: string[];
  updatedAt?: string;
}

export interface SheetProxyStats {
  appsScriptSecret: string;
  cacheTtlSec: number;
  cachedEntries: number;
  cacheHits: number;
  cacheMisses: number;
  hitRatePct: number;
  writeInvalidations: number;
  blockedSsrf: number;
  avgUpstreamMs: number;
  avgCacheMs: number;
}

const REGENCY_STORAGE_KEY = 'satu_data_sovereign_regency_cfg_v1';

export const DEFAULT_REGENCY_CONFIG: RegencyWhiteLabelConfig = {
  namaKabupaten: 'Kabupaten Nagekeo',
  namaPortal: 'Satu Data Nagekeo',
  namaWalidata: 'Diskominfo Kabupaten Nagekeo',
  domainResmi: 'nagekeokab.go.id',
  urlPortalPublik: '',
  daftarKecamatan: [
    'Aesesa',
    'Aesesa Selatan',
    'Boawae',
    'Keo Tengah',
    'Mauponggo',
    'Nangaroro',
    'Wolowae',
  ],
};

export function loadCachedRegencyConfig(): RegencyWhiteLabelConfig {
  try {
    const raw = localStorage.getItem(REGENCY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RegencyWhiteLabelConfig>;
      return {
        ...DEFAULT_REGENCY_CONFIG,
        ...parsed,
        daftarKecamatan: Array.isArray(parsed.daftarKecamatan)
          ? parsed.daftarKecamatan.filter(Boolean)
          : DEFAULT_REGENCY_CONFIG.daftarKecamatan,
      };
    }
  } catch {
    // Abaikan
  }
  return DEFAULT_REGENCY_CONFIG;
}

export function saveCachedRegencyConfig(
  cfg: RegencyWhiteLabelConfig
): RegencyWhiteLabelConfig {
  try {
    localStorage.setItem(REGENCY_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Abaikan
  }
  return cfg;
}

export async function fetchRegencyConfig(): Promise<RegencyWhiteLabelConfig> {
  try {
    const res = await fetch('/api/config/regency', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data?.ok && data.config) {
        return saveCachedRegencyConfig(data.config as RegencyWhiteLabelConfig);
      }
    }
  } catch {
    // Fallback ke cache lokal
  }
  return loadCachedRegencyConfig();
}

export async function updateRegencyConfig(
  actorEmail: string,
  next: Omit<RegencyWhiteLabelConfig, 'updatedAt'>
): Promise<{
  ok: boolean;
  config: RegencyWhiteLabelConfig;
  message: string;
}> {
  try {
    const res = await fetch('/api/config/regency', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify(next),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data?.ok && data.config) {
        const saved = saveCachedRegencyConfig(
          data.config as RegencyWhiteLabelConfig
        );
        return {
          ok: true,
          config: saved,
          message:
            data.message ||
            `Identitas ${saved.namaKabupaten} berhasil diperbarui.`,
        };
      }
      return {
        ok: false,
        config: loadCachedRegencyConfig(),
        message: data?.message || 'Gagal menyimpan konfigurasi kabupaten.',
      };
    }
  } catch {
    // Fallback lokal
  }
  const saved = saveCachedRegencyConfig({
    ...next,
    updatedAt: new Date().toISOString(),
  });
  return {
    ok: true,
    config: saved,
    message: `Identitas ${saved.namaKabupaten} tersimpan di browser.`,
  };
}

export async function fetchSheetProxyStats(
  actorEmail: string
): Promise<SheetProxyStats | null> {
  try {
    const res = await fetch('/api/sheets/proxy/stats', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const data = await res.json();
      if (data?.ok) {
        return data as SheetProxyStats;
      }
    }
  } catch {
    // Abaikan
  }
  return null;
}

export async function clearSheetProxyCache(
  actorEmail: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/sheets/proxy/cache/clear', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const data = await res.json();
    return {
      ok: Boolean(res.ok && data?.ok),
      message: data?.message || 'Cache dibersihkan.',
    };
  } catch {
    return { ok: false, message: 'Gagal menghubungi server proxy.' };
  }
}

export async function rotateAppsScriptSecret(
  actorEmail: string
): Promise<{ ok: boolean; appsScriptSecret?: string; message: string }> {
  try {
    const res = await fetch('/api/sheets/proxy/rotate-secret', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const data = await res.json();
    return {
      ok: Boolean(res.ok && data?.ok),
      appsScriptSecret: data?.appsScriptSecret,
      message: data?.message || 'Kunci rahasia berhasil diperbarui.',
    };
  } catch {
    return { ok: false, message: 'Gagal merotasi kunci rahasia di server.' };
  }
}

export async function logoutServerSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
  } catch {
    // Abaikan
  }
}
