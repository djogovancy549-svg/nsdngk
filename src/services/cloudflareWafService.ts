import {
  DatasetMetadata,
  DynamicSheetRow,
  OpdDynamicSheet,
} from '../types/satuData';

export interface CloudflareEdgeTelemetry {
  behindCloudflare: boolean;
  cfRay: string | null;
  cfCountry: string | null;
  cfThreatScore: string | null;
  clientIp: string;
}

export interface CloudflareWafConfigView {
  strictOriginLock: boolean;
  originVerifyHeaderName: string;
  originVerifySecret: string;
  blockHighThreatScore: boolean;
  threatScoreThreshold: number;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  hasTurnstileSecret: boolean;
  updatedAt: string;
}

export interface CloudflareWafMetrics {
  inspected: number;
  blockedOriginBypass: number;
  blockedThreatScore: number;
  wafBlocks: number;
}

export interface CloudflareWafStatusResponse {
  ok: boolean;
  edgeTelemetry: CloudflareEdgeTelemetry;
  config: CloudflareWafConfigView;
  metrics: CloudflareWafMetrics;
}

export async function fetchCloudflareWafStatus(
  actorEmail: string
): Promise<CloudflareWafStatusResponse | null> {
  try {
    const res = await fetch('/api/security/cloudflare-waf', {
      method: 'GET',
      headers: {
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.ok) return data as CloudflareWafStatusResponse;
    }
  } catch {
    // Abaikan jika server sedang restart
  }
  return null;
}

export async function updateCloudflareWafConfig(
  actorEmail: string,
  payload: {
    strictOriginLock?: boolean;
    blockHighThreatScore?: boolean;
    threatScoreThreshold?: number;
    turnstileEnabled?: boolean;
    turnstileSiteKey?: string;
    turnstileSecretKey?: string;
  }
): Promise<{
  ok: boolean;
  config?: CloudflareWafConfigView;
  message: string;
}> {
  try {
    const res = await fetch('/api/security/cloudflare-waf', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify(payload),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        config: data?.config,
        message:
          data?.message ||
          (res.ok
            ? 'Konfigurasi Cloudflare WAF disimpan.'
            : 'Gagal memperbarui konfigurasi Cloudflare WAF.'),
      };
    }
  } catch {
    // Tangani di bawah
  }
  return {
    ok: false,
    message: 'Server tidak merespons saat memperbarui Cloudflare WAF.',
  };
}

export async function rotateCloudflareOriginSecret(
  actorEmail: string
): Promise<{ ok: boolean; originVerifySecret?: string; message: string }> {
  try {
    const res = await fetch('/api/security/cloudflare-waf/rotate-origin-secret', {
      method: 'POST',
      headers: {
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        originVerifySecret: data?.originVerifySecret,
        message:
          data?.message ||
          'Token verifikasi Origin Cloudflare berhasil diperbarui.',
      };
    }
  } catch {
    // Abaikan
  }
  return {
    ok: false,
    message: 'Gagal merotasi token verifikasi Origin Cloudflare.',
  };
}

export async function fetchTurnstilePublicConfig(): Promise<{
  enabled: boolean;
  siteKey: string;
}> {
  try {
    const res = await fetch('/api/auth/turnstile-config', {
      method: 'GET',
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      return {
        enabled: Boolean(data?.enabled && data?.siteKey),
        siteKey: String(data?.siteKey || ''),
      };
    }
  } catch {
    // Fallback
  }
  return { enabled: false, siteKey: '' };
}

export async function syncPublicHarvestCatalog(
  actorEmail: string,
  sheets: OpdDynamicSheet[],
  rowsBySheet: Record<string, DynamicSheetRow[]>,
  metadataBySheet: Record<string, DatasetMetadata>
): Promise<{ ok: boolean; publishedCount: number; message: string }> {
  const datasets = sheets.map((s) => {
    const meta = metadataBySheet[s.id];
    const rows = rowsBySheet[s.id] ?? [];
    return {
      id: s.id,
      judulDataset: s.judulDataset,
      deskripsi: s.deskripsi,
      namaOpd: s.namaOpd,
      headers: s.headers,
      jumlahBaris: rows.length,
      statusValidasi: meta?.statusValidasi ?? 'Belum Diverifikasi',
      tingkatAkses: meta?.tingkatAkses ?? 'Terbuka (Publik)',
    };
  });

  try {
    const res = await fetch('/api/public/catalog/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({ datasets }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        publishedCount: Number(data?.publishedCount ?? 0),
        message:
          data?.message ||
          'Sinkronisasi endpoint harvesting CKAN/DCAT selesai.',
      };
    }
  } catch {
    // Tangani di bawah
  }
  return {
    ok: false,
    publishedCount: 0,
    message: 'Gagal menyinkronkan katalog harvesting publik ke server.',
  };
}

export const GOOGLE_SHEET_MAX_CELLS = 10_000_000;

export interface SheetCapacitySummary {
  sheetId: string;
  judulDataset: string;
  namaOpd: string;
  sheetName: string;
  rows: number;
  cols: number;
  usedCells: number;
  usagePct: number;
  status: 'Aman' | 'Pantau' | 'Perlu Arsip BigQuery';
}

export function evaluateSheetCapacity(
  sheets: OpdDynamicSheet[],
  rowsBySheet: Record<string, DynamicSheetRow[]>
): SheetCapacitySummary[] {
  return sheets.map((s) => {
    const rows = (rowsBySheet[s.id] ?? []).length;
    const cols = Math.max(1, (s.headers || []).length);
    const usedCells = (rows + 1) * cols;
    const usagePct = Number(
      ((usedCells / GOOGLE_SHEET_MAX_CELLS) * 100).toFixed(3)
    );
    let status: SheetCapacitySummary['status'] = 'Aman';
    if (usedCells >= 5_000_000) status = 'Perlu Arsip BigQuery';
    else if (usedCells >= 1_500_000) status = 'Pantau';

    return {
      sheetId: s.id,
      judulDataset: s.judulDataset,
      namaOpd: s.namaOpd,
      sheetName: s.sheetName,
      rows,
      cols,
      usedCells,
      usagePct,
      status,
    };
  });
}
