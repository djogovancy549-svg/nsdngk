import {
  DatasetMetadata,
  DynamicSheetRow,
  OpdDynamicSheet,
  PublishedDatasetClone,
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

export interface CloudflarePreflightCheck {
  id: string;
  title: string;
  status: 'pass' | 'warn' | 'pending';
  detail: string;
}

export interface CloudflarePreflightResult {
  ok: boolean;
  readinessScore: number;
  domainResmi: string;
  recommendedHost: string;
  cloudflareApiConfigured: boolean;
  metrics: {
    behindCloudflare: boolean;
    strictOriginLock: boolean;
    hasOriginVerifySecret: boolean;
    blockHighThreatScore: boolean;
    turnstileConfigured: boolean;
    sovereignSheetCount: number;
    sovereignRowCount: number;
    publicCatalogCount: number;
  };
  checks: CloudflarePreflightCheck[];
  blueprint: {
    dnsRecord: {
      type: string;
      name: string;
      target: string;
      proxied: boolean;
      sslMode: string;
      minTlsVersion: string;
      alwaysUseHttps: boolean;
    };
    transformRule: {
      name: string;
      expression: string;
      headerName: string;
      headerValue: string;
    };
    wafCustomRule: {
      name: string;
      expression: string;
      action: string;
    };
    rateLimitRule: {
      name: string;
      expression: string;
      requestsPerPeriod: number;
      periodSeconds: number;
      action: string;
    };
  };
}

export interface PublicCatalogVariableItem {
  namaKolom: string;
  definisi: string;
  tipeData: string;
  satuan: string;
}

export interface PublicCatalogPreviewRow {
  _id: string;
  _updatedAt: string;
  values: Record<string, string>;
}

export interface PublicCatalogDataset {
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
  previewRows?: PublicCatalogPreviewRow[];
  jumlahBaris: number;
  diperbaruiPada: string;
}

export interface PublicCatalogListResponse {
  ok: boolean;
  portalName: string;
  regencyName: string;
  walidataName: string;
  totalDatasets: number;
  facets: {
    opdList: string[];
    urusanList: string[];
    tahunList: string[];
  };
  datasets: PublicCatalogDataset[];
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

export async function fetchCloudflarePreflight(
  actorEmail: string
): Promise<CloudflarePreflightResult | null> {
  try {
    const res = await fetch('/api/security/cloudflare-waf/preflight', {
      method: 'GET',
      headers: {
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.ok) return data as CloudflarePreflightResult;
    }
  } catch {
    // Abaikan
  }
  return null;
}

export async function applyCloudflareRemoteSettings(
  actorEmail: string
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/security/cloudflare-waf/apply-remote', {
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
        message:
          data?.message || 'Sinkronisasi konfigurasi SSL Cloudflare selesai.',
      };
    }
  } catch {
    // Abaikan
  }
  return {
    ok: false,
    message: 'Gagal menghubungi endpoint sinkronisasi Cloudflare server.',
  };
}

function triggerTextFileDownload(
  content: string,
  filename: string,
  mimeType: string
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadCloudflareBundleJson(
  preflight: CloudflarePreflightResult
): void {
  const filename = `cloudflare-dns-waf-${preflight.domainResmi.replace(
    /[^a-z0-9.-]+/gi,
    '-'
  )}.json`;
  triggerTextFileDownload(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        domainResmi: preflight.domainResmi,
        recommendedHost: preflight.recommendedHost,
        blueprint: preflight.blueprint,
      },
      null,
      2
    ),
    filename,
    'application/json;charset=utf-8;'
  );
}

export function downloadCloudflareSetupScript(
  preflight: CloudflarePreflightResult
): void {
  const { dnsRecord, transformRule, wafCustomRule } = preflight.blueprint;
  const script = `#!/usr/bin/env bash
# ==============================================================================
# Skrip Otomasi Rilis DNS, SSL Strict & Cloudflare WAF — ${preflight.recommendedHost}
# Jalankan sekali saat domain produksi sudah dipindahkan nameserver-nya ke Cloudflare.
# Pastikan env var CLOUDFLARE_ZONE_ID dan CLOUDFLARE_API_TOKEN sudah diekspor.
# ==============================================================================
set -euo pipefail

if [[ -z "\${CLOUDFLARE_ZONE_ID:-}" || -z "\${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "Error: Set CLOUDFLARE_ZONE_ID dan CLOUDFLARE_API_TOKEN terlebih dahulu."
  exit 1
fi

CF_API="https://api.cloudflare.com/client/v4/zones/\${CLOUDFLARE_ZONE_ID}"
AUTH_HEADER="Authorization: Bearer \${CLOUDFLARE_API_TOKEN}"

echo "[1/4] Mengaktifkan SSL Full (Strict) & Always Use HTTPS..."
curl -sS -X PATCH "\${CF_API}/settings/ssl" -H "\${AUTH_HEADER}" -H "Content-Type: application/json" --data '{"value":"strict"}' >/dev/null
curl -sS -X PATCH "\${CF_API}/settings/always_use_https" -H "\${AUTH_HEADER}" -H "Content-Type: application/json" --data '{"value":"on"}' >/dev/null
curl -sS -X PATCH "\${CF_API}/settings/min_tls_version" -H "\${AUTH_HEADER}" -H "Content-Type: application/json" --data '{"value":"1.2"}' >/dev/null

echo "[2/4] Membuat/Memperbarui DNS Record Proxied (${dnsRecord.name})..."
echo "Catatan: Ganti TARGET_ORIGIN_HOST dengan IP/Hostname server produksi Anda jika berbeda."
TARGET_HOST="\${TARGET_ORIGIN_HOST:-${dnsRecord.target}}"
curl -sS -X POST "\${CF_API}/dns_records" -H "\${AUTH_HEADER}" -H "Content-Type: application/json" \\
  --data "{\\"type\\":\\"${dnsRecord.type}\\",\\"name\\":\\"${dnsRecord.name}\\",\\"content\\":\\"\${TARGET_HOST}\\",\\"proxied\\":true,\\"ttl\\":1}" >/dev/null || true

echo "[3/4] Petunjuk Transform Rule Origin Lock (${transformRule.headerName}):"
echo "  Expression : ${transformRule.expression}"
echo "  Header     : ${transformRule.headerName}"
echo "  Value      : ${transformRule.headerValue}"

echo "[4/4] Petunjuk Custom WAF Rule:"
echo "  Expression : ${wafCustomRule.expression}"
echo "  Action     : ${wafCustomRule.action}"

echo "Selesai! Setelah DNS aktif (Awan Oranye), aktifkan 'Strict Origin Lock' di menu Konfigurasi Portal."
`;
  triggerTextFileDownload(
    script,
    `cloudflare-deploy-${preflight.domainResmi.replace(/[^a-z0-9.-]+/gi, '-')}.sh`,
    'text/x-shellscript;charset=utf-8;'
  );
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
  metadataBySheet: Record<string, DatasetMetadata>,
  publishedClones: PublishedDatasetClone[] = []
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
      variabel: meta?.variabel ?? [],
      previewRows: rows.slice(0, 500),
      jumlahBaris: rows.length,
      statusValidasi: meta?.statusValidasi ?? 'Belum Diverifikasi',
      tingkatAkses: meta?.tingkatAkses ?? 'Terbuka (Publik)',
    };
  });

  const clones = publishedClones
    .filter((c) => c.statusPublikasi === 'Dipublikasikan')
    .map((c) => ({
      id: c.id,
      sourceOpdNama: c.sourceOpdNama,
      judulPublikasi: c.judulPublikasi,
      kategori: c.kategori,
      ringkasan: c.ringkasan,
      selectedHeaders: c.selectedHeaders,
      rows: c.rows.slice(0, 500),
      statusPublikasi: c.statusPublikasi,
      dipublikasikanPada: c.dipublikasikanPada,
    }));

  try {
    const res = await fetch('/api/public/catalog/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({ datasets, clones }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        publishedCount: Number(data?.publishedCount ?? 0),
        message:
          data?.message ||
          'Sinkronisasi Etalase Publik & endpoint harvesting CKAN/DCAT selesai.',
      };
    }
  } catch {
    // Tangani di bawah
  }
  return {
    ok: false,
    publishedCount: 0,
    message: 'Gagal menyinkronkan katalog publik ke server.',
  };
}

export async function fetchPublicCatalog(filters?: {
  q?: string;
  opd?: string;
  urusan?: string;
  tahun?: string;
}): Promise<PublicCatalogListResponse | null> {
  try {
    const params = new URLSearchParams();
    if (filters?.q) params.set('q', filters.q);
    if (filters?.opd) params.set('opd', filters.opd);
    if (filters?.urusan) params.set('urusan', filters.urusan);
    if (filters?.tahun) params.set('tahun', filters.tahun);
    const qs = params.toString();
    const res = await fetch(`/api/public/catalog${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.ok) return data as PublicCatalogListResponse;
    }
  } catch {
    // Fallback
  }
  return null;
}

export async function fetchPublicCatalogDetail(
  slug: string
): Promise<PublicCatalogDataset | null> {
  try {
    const res = await fetch(
      `/api/public/catalog/${encodeURIComponent(slug)}`,
      {
        method: 'GET',
        cache: 'no-store',
      }
    );
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.ok && data?.dataset) {
        return data.dataset as PublicCatalogDataset;
      }
    }
  } catch {
    // Abaikan
  }
  return null;
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
  partitionCount: number;
  maxRowsPerPartition: number;
  needsPartitionSplit: boolean;
  status: 'Aman' | 'Pantau' | 'Perlu Pecah Partisi' | 'Perlu Arsip BigQuery';
}

export function evaluateSheetCapacity(
  sheets: OpdDynamicSheet[],
  rowsBySheet: Record<string, DynamicSheetRow[]>,
  maxRowsPerPartition = 25_000
): SheetCapacitySummary[] {
  return sheets.map((s) => {
    const rows = (rowsBySheet[s.id] ?? []).length;
    const cols = Math.max(1, (s.headers || []).length);
    const usedCells = (rows + 1) * cols;
    const usagePct = Number(
      ((usedCells / GOOGLE_SHEET_MAX_CELLS) * 100).toFixed(3)
    );
    const manifestCount = s.partitionManifest?.length ?? 0;
    const computedShards = Math.max(
      1,
      Math.ceil(Math.max(1, rows) / Math.max(1000, maxRowsPerPartition))
    );
    const partitionCount = Math.max(manifestCount, computedShards);
    const needsPartitionSplit =
      rows > maxRowsPerPartition && manifestCount <= 1;

    let status: SheetCapacitySummary['status'] = 'Aman';
    if (usedCells >= 7_500_000) status = 'Perlu Arsip BigQuery';
    else if (needsPartitionSplit) status = 'Perlu Pecah Partisi';
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
      partitionCount,
      maxRowsPerPartition,
      needsPartitionSplit,
      status,
    };
  });
}
