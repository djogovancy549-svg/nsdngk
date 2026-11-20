import { DynamicSheetRow, OpdDynamicSheet } from '../types/satuData';

export interface BigQueryConfigStatus {
  ok: boolean;
  config: {
    configured: boolean;
    projectId: string;
    datasetId: string;
    location: string;
    authMode: 'service_account_json' | 'application_default' | 'unconfigured';
  };
  datasetExists: boolean;
  tables: Array<{
    tableId: string;
    numRows: number;
    numBytes: number;
    lastModifiedTime: string | null;
  }>;
  message: string;
}

export interface BigQuerySyncResult {
  ok: boolean;
  tableId?: string;
  fullTableName?: string;
  rowsInserted?: number;
  columns?: string[];
  message: string;
}

export interface BigQueryQueryResult {
  ok: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  latencyMs: number;
  message?: string;
}

export async function fetchBigQueryStatus(
  actorEmail: string
): Promise<BigQueryConfigStatus | null> {
  try {
    const res = await fetch('/api/bigquery/status', {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
    });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return (await res.json()) as BigQueryConfigStatus;
    }
  } catch {
    // Abaikan jika server tidak terjangkau
  }
  return null;
}

export async function pushOpdSheetToBigQuery(
  actorEmail: string,
  sheet: OpdDynamicSheet,
  rows: DynamicSheetRow[]
): Promise<BigQuerySyncResult> {
  try {
    const res = await fetch('/api/bigquery/sync-sheet', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({
        opdId: sheet.opdId,
        namaOpd: sheet.namaOpd,
        judulDataset: sheet.judulDataset,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        rows: rows.map((r) => ({
          _rowNumber: r._rowNumber,
          values: r.values,
        })),
      }),
    });
    const data = await res.json();
    return {
      ok: Boolean(res.ok && data?.ok),
      tableId: data?.tableId,
      fullTableName: data?.fullTableName,
      rowsInserted: data?.rowsInserted,
      columns: data?.columns,
      message: data?.message || 'Sinkronisasi BigQuery selesai.',
    };
  } catch (err) {
    return {
      ok: false,
      message: `Gagal menghubungi layanan BigQuery: ${
        err instanceof Error ? err.message : 'Network error'
      }`,
    };
  }
}

export async function executeBigQueryReadOnlySql(
  actorEmail: string,
  sql: string
): Promise<BigQueryQueryResult> {
  try {
    const res = await fetch('/api/bigquery/query', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'x-superadmin-email': actorEmail.trim().toLowerCase(),
      },
      body: JSON.stringify({ sql }),
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      return {
        ok: false,
        columns: [],
        rows: [],
        totalRows: 0,
        latencyMs: 0,
        message: data?.message || 'Gagal menjalankan query BigQuery.',
      };
    }
    return data as BigQueryQueryResult;
  } catch (err) {
    return {
      ok: false,
      columns: [],
      rows: [],
      totalRows: 0,
      latencyMs: 0,
      message: `Gagal menghubungi endpoint query BigQuery: ${
        err instanceof Error ? err.message : 'Network error'
      }`,
    };
  }
}
