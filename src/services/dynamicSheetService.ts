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
  source: SyncSource;
  syncedAt: string;
  message: string;
}

/**
 * Mengambil header baris 1 dan seluruh baris data dinamis dari Google Sheet milik OPD:
 * 1. Melalui Webhook doGet/doPost yang telah dicangkokkan Super Admin
 * 2. Fallback melalui Google Sheet GViz CSV (bila Sheet dibagikan publik/anyone with link)
 * 3. Fallback ke cache lokal bila sheet belum publik / belum dicangkokkan.
 */
export async function fetchDynamicSheetData(
  sheet: OpdDynamicSheet
): Promise<FetchDynamicSheetResult> {
  const now = new Date().toISOString();

  // 1. Coba dari Webhook Apps Script yang sudah dicangkokkan
  if (sheet.webhookUrl && sheet.webhookUrl.startsWith('https://script.google.com/')) {
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
          return {
            headers,
            rows,
            source: 'webhook',
            syncedAt: now,
            message: `Tersinkron langsung dari Webhook Sheet (${headers.length} kolom header, ${rows.length} baris).`,
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
      // Lanjut ke lokal
    }
  }

  // 3. Fallback ke cache lokal
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
  if (!sheet.webhookUrl || !sheet.webhookUrl.startsWith('https://script.google.com/')) {
    return {
      syncedToSheet: false,
      message:
        'Disimpan secara lokal. Webhook doPost belum dicangkokkan ke Google Sheet ini.',
    };
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
      return {
        syncedToSheet: true,
        rowNumber,
        message: `Data berhasil dikirim ke Google Sheet "${sheet.judulDataset}" (${sheet.namaOpd}).`,
      };
    }

    return {
      syncedToSheet: false,
      message: `Webhook merespons HTTP ${res.status}. Data tetap tersimpan di penyimpanan lokal.`,
    };
  } catch {
    return {
      syncedToSheet: false,
      message:
        'Webhook Google Sheet belum dapat dijangkau. Data tetap tersimpan di penyimpanan lokal.',
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
