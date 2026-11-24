import {
  DynamicSheetRow,
  OpdDynamicSheet,
  SyncSource,
} from '../types/satuData';

const SHEETS_REGISTRY_KEY = 'satu_data_nagekeo_dynamic_sheets_v3';
const ROWS_PREFIX = 'satu_data_nagekeo_dynamic_rows_v3_';

export function extractGoogleSheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
}

export function loadRegisteredSheets(): OpdDynamicSheet[] {
  try {
    const raw = localStorage.getItem(SHEETS_REGISTRY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as OpdDynamicSheet[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export function saveRegisteredSheets(sheets: OpdDynamicSheet[]): void {
  try {
    localStorage.setItem(SHEETS_REGISTRY_KEY, JSON.stringify(sheets));
  } catch {
    // Abaikan
  }
}

export function loadLocalDynamicRows(sheetIdKey: string): DynamicSheetRow[] {
  try {
    const raw = localStorage.getItem(`${ROWS_PREFIX}${sheetIdKey}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as DynamicSheetRow[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export function saveLocalDynamicRows(
  sheetIdKey: string,
  rows: DynamicSheetRow[]
): void {
  try {
    localStorage.setItem(`${ROWS_PREFIX}${sheetIdKey}`, JSON.stringify(rows));
  } catch {
    // Abaikan
  }
}

export function loadAllDynamicRows(
  sheets: OpdDynamicSheet[]
): Record<string, DynamicSheetRow[]> {
  const map: Record<string, DynamicSheetRow[]> = {};
  for (const s of sheets) {
    map[s.id] = loadLocalDynamicRows(s.id);
  }
  return map;
}

function parseCsvMatrix(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' && next === '\n') {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = '';
        i++;
      } else if (ch === '\n') {
        currentRow.push(currentField.trim());
        lines.push(currentRow);
        currentRow = [];
        currentField = '';
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    lines.push(currentRow);
  }

  return lines;
}

export interface FetchDynamicSheetResult {
  headers: string[];
  rows: DynamicSheetRow[];
  availableTabs?: string[];
  source: SyncSource;
  syncedAt: string;
  message: string;
}

export interface SovereignStoreSnapshot {
  sheets: OpdDynamicSheet[];
  rowsBySheet: Record<string, DynamicSheetRow[]>;
  updatedAt: string;
}

export async function fetchSovereignStoreState(): Promise<SovereignStoreSnapshot | null> {
  try {
    const res = await fetch('/api/sovereign-sheets', {
      method: 'GET',
      cache: 'no-store',
    });
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.includes('application/json')) {
      const json = await res.json();
      if (json?.ok) {
        return {
          sheets: Array.isArray(json.sheets)
            ? (json.sheets as OpdDynamicSheet[])
            : [],
          rowsBySheet:
            json.rowsBySheet && typeof json.rowsBySheet === 'object'
              ? (json.rowsBySheet as Record<string, DynamicSheetRow[]>)
              : {},
          updatedAt: String(json.updatedAt || ''),
        };
      }
    }
  } catch {
    // Server store fallback ke lokal
  }
  return null;
}

export async function registerSheetToSovereignServer(
  sheet: OpdDynamicSheet,
  rows?: DynamicSheetRow[]
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('/api/sovereign-sheets/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet, rows }),
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        message: data?.message || 'Tersimpan di Server Sovereign Store.',
      };
    }
  } catch {
    // Abaikan jika server sedang offline
  }
  return { ok: false, message: 'Gagal menghubungi Server Sovereign Store.' };
}

export async function mirrorRowsToSovereignServer(
  sheetId: string,
  headers: string[],
  rows: DynamicSheetRow[]
): Promise<void> {
  try {
    await fetch(`/api/sovereign-sheets/${encodeURIComponent(sheetId)}/rows`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headers, rows }),
    });
  } catch {
    // Mirror non-blocking
  }
}

export async function mutateSovereignServerRow(
  sheetId: string,
  action: 'create' | 'update' | 'delete',
  row: DynamicSheetRow
): Promise<{ ok: boolean; rowNumber?: number; message: string }> {
  try {
    const res = await fetch(
      `/api/sovereign-sheets/${encodeURIComponent(sheetId)}/mutate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, row }),
      }
    );
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      return {
        ok: Boolean(res.ok && data?.ok),
        rowNumber: data?.rowNumber ? Number(data.rowNumber) : row._rowNumber,
        message:
          data?.message || 'Perubahan disimpan di Penyimpanan Mandiri Server.',
      };
    }
  } catch {
    // Tangani di pemanggil
  }
  return {
    ok: false,
    message: 'Server Sovereign Store tidak merespons. Data tetap aman di cache lokal.',
  };
}

export async function deleteSheetFromSovereignServer(
  sheetId: string
): Promise<void> {
  try {
    await fetch(`/api/sovereign-sheets/${encodeURIComponent(sheetId)}`, {
      method: 'DELETE',
    });
  } catch {
    // Abaikan jika offline
  }
}

/**
 * Mengambil header baris 1 dan seluruh baris data dinamis dari:
 * - Mode Tabel Mandiri Server (storageMode === 'server_standalone'): langsung baca dari /api/sovereign-sheets
 * - Mode Google Sheet OPD (Hybrid):
 *   1. Melalui Secure Backend Proxy (/api/sheets/proxy) + cerminkan ke server
 *   2. Fallback Webhook langsung
 *   3. Fallback Google Sheet GViz CSV publik
 *   4. Fallback Cadangan Server Sovereign Store (/api/sovereign-sheets)
 *   5. Fallback ke cache lokal browser
 */
export async function fetchDynamicSheetData(
  sheet: OpdDynamicSheet
): Promise<FetchDynamicSheetResult> {
  const now = new Date().toISOString();

  // Mode Mandiri Server (tanpa Google Sheet / Apps Script)
  if (sheet.storageMode === 'server_standalone') {
    const store = await fetchSovereignStoreState();
    if (store) {
      const serverSheet = store.sheets.find((s) => s.id === sheet.id);
      const serverRows = store.rowsBySheet[sheet.id] ?? loadLocalDynamicRows(sheet.id);
      const resolvedHeaders =
        serverSheet?.headers && serverSheet.headers.length > 0
          ? serverSheet.headers
          : sheet.headers;
      saveLocalDynamicRows(sheet.id, serverRows);
      return {
        headers: resolvedHeaders,
        rows: serverRows,
        source: 'server_sovereign',
        syncedAt: now,
        message: `Tersinkron dari Penyimpanan Mandiri Server (${resolvedHeaders.length} kolom, ${serverRows.length} baris · tanpa ketergantungan Google Sheet).`,
      };
    }
    const localRows = loadLocalDynamicRows(sheet.id);
    return {
      headers: sheet.headers,
      rows: localRows,
      source: 'local_cache',
      syncedAt: now,
      message: `Menampilkan ${localRows.length} baris dari cache lokal (Tabel Mandiri Server).`,
    };
  }

  // 1. Utamakan Secure Backend Proxy (/api/sheets/proxy) — menyisipkan API_SECRET server + Smart Cache 45 detik
  if (sheet.webhookUrl && sheet.webhookUrl.startsWith('https://script.google.com/')) {
    try {
      const proxyRes = await fetch('/api/sheets/proxy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          method: 'GET',
          webhookUrl: sheet.webhookUrl,
          sheetName: sheet.sheetName || '',
          action: 'list',
        }),
      });

      const ct = proxyRes.headers.get('content-type') || '';
      if (proxyRes.ok && ct.includes('application/json')) {
        const envelope = await proxyRes.json();
        const json = envelope?.data;
        if (json && json.ok && Array.isArray(json.headers)) {
          const headers = (json.headers as unknown[])
            .map((h) => String(h).trim())
            .filter(Boolean);
          const availableTabs = Array.isArray(json.availableSheets)
            ? (json.availableSheets as unknown[])
                .map((t) => String(t).trim())
                .filter(Boolean)
            : undefined;
          const rawRows = Array.isArray(json.data) ? json.data : [];
          const rows: DynamicSheetRow[] = rawRows.map(
            (item: { _rowNumber?: number; values?: Record<string, unknown> }, idx: number) => {
              const vals: Record<string, string> = {};
              headers.forEach((h) => {
                vals[h] = String(item?.values?.[h] ?? '');
              });
              return {
                _id: `${sheet.id}-r${item._rowNumber ?? idx + 2}`,
                _rowNumber: item._rowNumber ?? idx + 2,
                _updatedAt: now.slice(0, 10),
                values: vals,
              };
            }
          );

          saveLocalDynamicRows(sheet.id, rows);
          void mirrorRowsToSovereignServer(sheet.id, headers, rows);
          const cacheTag = envelope?.cached
            ? `Cache Server ${envelope.latencyMs ?? 1} ms`
            : `Proxy Aman ${envelope.latencyMs ?? 0} ms`;
          return {
            headers,
            rows,
            availableTabs,
            source: 'webhook',
            syncedAt: now,
            message: `Tersinkron melalui ${cacheTag} untuk Sheet "${sheet.sheetName}" (${headers.length} kolom, ${rows.length} baris).`,
          };
        }
      }
    } catch {
      // Fallback ke pemanggilan langsung jika proxy belum tersedia
    }

    // 1b. Fallback langsung ke Webhook Apps Script
    try {
      const url = new URL(sheet.webhookUrl);
      url.searchParams.set('action', 'list');
      if (sheet.sheetName) url.searchParams.set('sheet', sheet.sheetName);

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (res.ok) {
        const json = await res.json();
        if (json && json.ok && Array.isArray(json.headers)) {
          const headers = (json.headers as unknown[])
            .map((h) => String(h).trim())
            .filter(Boolean);
          const availableTabs = Array.isArray(json.availableSheets)
            ? (json.availableSheets as unknown[])
                .map((t) => String(t).trim())
                .filter(Boolean)
            : undefined;
          const rawRows = Array.isArray(json.data) ? json.data : [];
          const rows: DynamicSheetRow[] = rawRows.map(
            (item: { _rowNumber?: number; values?: Record<string, unknown> }, idx: number) => {
              const vals: Record<string, string> = {};
              headers.forEach((h) => {
                vals[h] = String(item?.values?.[h] ?? '');
              });
              return {
                _id: `${sheet.id}-r${item._rowNumber ?? idx + 2}`,
                _rowNumber: item._rowNumber ?? idx + 2,
                _updatedAt: now.slice(0, 10),
                values: vals,
              };
            }
          );

          saveLocalDynamicRows(sheet.id, rows);
          void mirrorRowsToSovereignServer(sheet.id, headers, rows);
          return {
            headers,
            rows,
            availableTabs,
            source: 'webhook',
            syncedAt: now,
            message: `Tersinkron langsung dari Webhook Sheet "${sheet.sheetName}" (${headers.length} kolom header, ${rows.length} baris).`,
          };
        }
      }
    } catch {
      // Lanjut ke GViz CSV
    }
  }

  // 2. Coba baca otomatis dari Google Sheet publik (GViz CSV) untuk deteksi header & data
  if (sheet.sheetId) {
    try {
      const sheetParam = sheet.sheetName
        ? `&sheet=${encodeURIComponent(sheet.sheetName)}`
        : '';
      const csvUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
        sheet.sheetId
      )}/gviz/tq?tqx=out:csv${sheetParam}`;

      const res = await fetch(csvUrl);
      if (res.ok) {
        const csvText = await res.text();
        if (!csvText.trim().startsWith('<!DOCTYPE')) {
          const matrix = parseCsvMatrix(csvText);
          if (matrix.length > 0) {
            const headers = matrix[0].map((h) => h.trim()).filter(Boolean);
            const rows: DynamicSheetRow[] = matrix
              .slice(1)
              .filter((r) => r.some((cell) => cell !== ''))
              .map((r, idx) => {
                const vals: Record<string, string> = {};
                headers.forEach((h, cIdx) => {
                  vals[h] = r[cIdx] ?? '';
                });
                return {
                  _id: `${sheet.id}-csv-${idx + 2}`,
                  _rowNumber: idx + 2,
                  _updatedAt: now.slice(0, 10),
                  values: vals,
                };
              });

            saveLocalDynamicRows(sheet.id, rows);
            void mirrorRowsToSovereignServer(sheet.id, headers, rows);
            return {
              headers,
              rows,
              source: 'sheet_csv',
              syncedAt: now,
              message: `Header & data terbaca otomatis dari Google Sheet (${headers.length} kolom, ${rows.length} baris).`,
            };
          }
        }
      }
    } catch {
      // Lanjut ke cadangan server
    }
  }

  // 3. Fallback ke Cadangan Server Sovereign Store (lintas perangkat jika Google Sheet offline)
  const serverSnapshot = await fetchSovereignStoreState();
  if (serverSnapshot && serverSnapshot.rowsBySheet[sheet.id]) {
    const serverRows = serverSnapshot.rowsBySheet[sheet.id];
    const serverSheet = serverSnapshot.sheets.find((s) => s.id === sheet.id);
    const resolvedHeaders =
      serverSheet?.headers && serverSheet.headers.length > 0
        ? serverSheet.headers
        : sheet.headers;
    saveLocalDynamicRows(sheet.id, serverRows);
    return {
      headers: resolvedHeaders,
      rows: serverRows,
      source: 'server_sovereign',
      syncedAt: now,
      message: `Google Sheet sedang tidak terjangkau. Menampilkan ${serverRows.length} baris dari Cadangan Server Sovereign.`,
    };
  }

  // 4. Fallback ke cache lokal
  const localRows = loadLocalDynamicRows(sheet.id);
  return {
    headers: sheet.headers,
    rows: localRows,
    source: 'local_cache',
    syncedAt: now,
    message: sheet.webhookUrl
      ? `Gagal menjangkau Webhook Sheet. Menampilkan ${localRows.length} baris dari penyimpanan lokal.`
      : `Sheet belum dibagikan publik atau Webhook belum dicangkokkan. Gunakan header yang tersimpan (${sheet.headers.length} kolom).`,
  };
}

export async function sendDynamicRowMutation(
  sheet: OpdDynamicSheet,
  action: 'create' | 'update' | 'delete',
  row: DynamicSheetRow
): Promise<{ syncedToSheet: boolean; rowNumber?: number; message: string }> {
  // Mode Mandiri Server: langsung simpan permanen ke /api/sovereign-sheets tanpa Google Sheet/Apps Script
  if (sheet.storageMode === 'server_standalone') {
    const serverRes = await mutateSovereignServerRow(sheet.id, action, row);
    return {
      syncedToSheet: serverRes.ok,
      rowNumber: serverRes.rowNumber,
      message: serverRes.message,
    };
  }

  if (!sheet.webhookUrl || !sheet.webhookUrl.startsWith('https://script.google.com/')) {
    const fallbackRes = await mutateSovereignServerRow(sheet.id, action, row);
    return {
      syncedToSheet: fallbackRes.ok,
      rowNumber: fallbackRes.rowNumber,
      message: fallbackRes.ok
        ? 'Disimpan di Cadangan Server Sovereign (Webhook Google Sheet belum dicangkokkan).'
        : 'Disimpan secara lokal. Webhook doPost belum dicangkokkan ke Google Sheet ini.',
    };
  }

  // 1. Kirim melalui Secure Backend Proxy (/api/sheets/proxy) — otomatis sisipkan API_SECRET & bersihkan cache terkait
  try {
    const proxyRes = await fetch('/api/sheets/proxy', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        webhookUrl: sheet.webhookUrl,
        sheetName: sheet.sheetName,
        action,
        payload: {
          rowNumber: row._rowNumber,
          values: row.values,
        },
      }),
    });

    const ct = proxyRes.headers.get('content-type') || '';
    if (proxyRes.ok && ct.includes('application/json')) {
      const envelope = await proxyRes.json();
      const upstreamData = envelope?.data;
      if (envelope?.ok && upstreamData?.ok !== false) {
        const rowNumber = upstreamData?.rowNumber
          ? Number(upstreamData.rowNumber)
          : row._rowNumber;
        void mutateSovereignServerRow(sheet.id, action, {
          ...row,
          _rowNumber: rowNumber,
        });
        return {
          syncedToSheet: true,
          rowNumber,
          message: `Data berhasil dikirim aman melalui Proxy Server (${envelope.latencyMs ?? 0} ms) ke Google Sheet "${sheet.judulDataset}" (${sheet.namaOpd}) + dicerminkan ke Server.`,
        };
      }
      if (upstreamData?.error) {
        return {
          syncedToSheet: false,
          message: `Google Sheet menolak permintaan: ${upstreamData.error}`,
        };
      }
    }
  } catch {
    // Fallback langsung jika proxy tidak terjangkau
  }

  try {
    const res = await fetch(sheet.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action,
        sheetName: sheet.sheetName,
        rowNumber: row._rowNumber,
        values: row.values,
      }),
    });

    if (res.ok) {
      let rowNumber = row._rowNumber;
      try {
        const json = await res.json();
        if (json?.rowNumber) rowNumber = Number(json.rowNumber);
      } catch {
        // Abaikan jika respons tidak bisa di-parse
      }
      void mutateSovereignServerRow(sheet.id, action, {
        ...row,
        _rowNumber: rowNumber,
      });
      return {
        syncedToSheet: true,
        rowNumber,
        message: `Data berhasil dikirim ke Google Sheet "${sheet.judulDataset}" (${sheet.namaOpd}).`,
      };
    }

    const mirrorFallback = await mutateSovereignServerRow(sheet.id, action, row);
    return {
      syncedToSheet: mirrorFallback.ok,
      message: mirrorFallback.ok
        ? `Webhook merespons HTTP ${res.status}. Data tetap tersimpan aman di Cadangan Server Sovereign.`
        : `Webhook merespons HTTP ${res.status}. Data tetap tersimpan di penyimpanan lokal.`,
    };
  } catch {
    const mirrorFallback = await mutateSovereignServerRow(sheet.id, action, row);
    return {
      syncedToSheet: mirrorFallback.ok,
      message: mirrorFallback.ok
        ? 'Webhook Google Sheet sedang tidak terjangkau. Data tetap tersimpan aman di Cadangan Server Sovereign.'
        : 'Webhook Google Sheet belum dapat dijangkau. Data tetap tersimpan di penyimpanan lokal.',
    };
  }
}

export function inferInputTypeFromHeader(
  header: string
): 'number' | 'date' | 'text' {
  const lower = header.toLowerCase();
  if (lower.includes('tanggal') || lower.includes('tgl')) {
    return 'date';
  }
  if (
    lower.includes('tahun') ||
    lower.includes('jumlah') ||
    lower.includes('total') ||
    lower.includes('nilai') ||
    lower.includes('luas') ||
    lower.includes('persen') ||
    lower.includes('anggaran') ||
    lower.includes('populasi') ||
    lower.includes('capaian') ||
    lower.includes('target')
  ) {
    return 'number';
  }
  return 'text';
}

export function exportDynamicRowsToCsv(
  headers: string[],
  rows: DynamicSheetRow[],
  filename: string
): void {
  const escapeCell = (val: string) => {
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`;
    }
    return val;
  };

  const csvContent = [
    headers.map(escapeCell).join(','),
    ...rows.map((r) =>
      headers.map((h) => escapeCell(r.values[h] ?? '')).join(',')
    ),
  ].join('\n');

  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
