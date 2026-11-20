import { BigQuery } from '@google-cloud/bigquery';

export interface BigQueryConfigSummary {
  configured: boolean;
  projectId: string;
  datasetId: string;
  location: string;
  authMode: 'service_account_json' | 'application_default' | 'unconfigured';
}

export interface BigQueryTableSummary {
  tableId: string;
  numRows: number;
  numBytes: number;
  lastModifiedTime: string | null;
}

export interface SyncSheetToBigQueryInput {
  opdId: string;
  namaOpd: string;
  judulDataset: string;
  sheetName: string;
  headers: string[];
  rows: Array<{ _rowNumber?: number; values: Record<string, string> }>;
}

const DEFAULT_DATASET_ID = 'satu_data_sektoral';
const DEFAULT_LOCATION = 'asia-southeast2'; // Jakarta (Kedaulatan Data Indonesia)

export function getBigQueryConfigSummary(): BigQueryConfigSummary {
  const projectId = (process.env.BIGQUERY_PROJECT_ID || '').trim();
  const datasetId = (
    process.env.BIGQUERY_DATASET_ID || DEFAULT_DATASET_ID
  ).trim();
  const location = (process.env.BIGQUERY_LOCATION || DEFAULT_LOCATION).trim();
  const rawJson = (process.env.BIGQUERY_SERVICE_ACCOUNT_JSON || '').trim();
  const gacPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();

  if (!projectId) {
    return {
      configured: false,
      projectId: '',
      datasetId,
      location,
      authMode: 'unconfigured',
    };
  }

  if (rawJson) {
    return {
      configured: true,
      projectId,
      datasetId,
      location,
      authMode: 'service_account_json',
    };
  }

  if (gacPath) {
    return {
      configured: true,
      projectId,
      datasetId,
      location,
      authMode: 'application_default',
    };
  }

  return {
    configured: false,
    projectId,
    datasetId,
    location,
    authMode: 'unconfigured',
  };
}

function createBigQueryClient(): {
  client: BigQuery;
  config: BigQueryConfigSummary;
} {
  const config = getBigQueryConfigSummary();
  if (!config.configured) {
    throw new Error(
      'BigQuery belum dikonfigurasi di server. Isi variabel lingkungan BIGQUERY_PROJECT_ID dan BIGQUERY_SERVICE_ACCOUNT_JSON (atau GOOGLE_APPLICATION_CREDENTIALS).'
    );
  }

  const rawJson = (process.env.BIGQUERY_SERVICE_ACCOUNT_JSON || '').trim();
  if (rawJson) {
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(rawJson);
    } catch {
      throw new Error(
        'Format BIGQUERY_SERVICE_ACCOUNT_JSON tidak valid (harus berupa JSON Service Account Google Cloud yang utuh).'
      );
    }
    return {
      client: new BigQuery({
        projectId: config.projectId,
        credentials,
        location: config.location,
      }),
      config,
    };
  }

  return {
    client: new BigQuery({
      projectId: config.projectId,
      location: config.location,
    }),
    config,
  };
}

export function sanitizeBigQueryIdentifier(
  raw: string,
  prefix = 'col'
): string {
  const cleaned = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

  if (!cleaned) return `${prefix}_unnamed`;
  if (/^[0-9]/.test(cleaned)) return `${prefix}_${cleaned}`;
  return cleaned;
}

export function buildBigQueryTableName(
  opdId: string,
  sheetName: string
): string {
  const opdPart = sanitizeBigQueryIdentifier(opdId, 'opd').slice(0, 28);
  const sheetPart = sanitizeBigQueryIdentifier(sheetName, 'sheet').slice(0, 32);
  return `opd_${opdPart}_${sheetPart}`;
}

export async function testBigQueryConnection(): Promise<{
  ok: boolean;
  config: BigQueryConfigSummary;
  datasetExists: boolean;
  tables: BigQueryTableSummary[];
  message: string;
}> {
  const config = getBigQueryConfigSummary();
  if (!config.configured) {
    return {
      ok: false,
      config,
      datasetExists: false,
      tables: [],
      message:
        'BigQuery siap diaktifkan. Tambahkan BIGQUERY_PROJECT_ID dan BIGQUERY_SERVICE_ACCOUNT_JSON di variabel lingkungan server (region default: asia-southeast2 Jakarta).',
    };
  }

  const { client } = createBigQueryClient();
  const dataset = client.dataset(config.datasetId);
  const [exists] = await dataset.exists();

  if (!exists) {
    return {
      ok: true,
      config,
      datasetExists: false,
      tables: [],
      message: `Terhubung ke proyek Google Cloud "${config.projectId}". Dataset "${config.datasetId}" belum dibuat — akan dibuat otomatis saat sinkronisasi pertama.`,
    };
  }

  const tables = await listBigQueryTables();
  return {
    ok: true,
    config,
    datasetExists: true,
    tables,
    message: `Terhubung ke BigQuery (${config.projectId}.${config.datasetId}, region ${config.location}) dengan ${tables.length} tabel aktif.`,
  };
}

export async function listBigQueryTables(): Promise<BigQueryTableSummary[]> {
  const { client, config } = createBigQueryClient();
  const dataset = client.dataset(config.datasetId);
  const [exists] = await dataset.exists();
  if (!exists) return [];

  const [tables] = await dataset.getTables();
  const results: BigQueryTableSummary[] = [];

  for (const tbl of tables.slice(0, 50)) {
    try {
      const [meta] = await tbl.getMetadata();
      results.push({
        tableId: tbl.id || meta.tableReference?.tableId || 'unknown',
        numRows: Number(meta.numRows || 0),
        numBytes: Number(meta.numBytes || 0),
        lastModifiedTime: meta.lastModifiedTime
          ? new Date(Number(meta.lastModifiedTime)).toISOString()
          : null,
      });
    } catch {
      results.push({
        tableId: tbl.id || 'unknown',
        numRows: 0,
        numBytes: 0,
        lastModifiedTime: null,
      });
    }
  }

  return results;
}

export async function syncOpdSheetToBigQuery(
  input: SyncSheetToBigQueryInput
): Promise<{
  ok: boolean;
  tableId: string;
  fullTableName: string;
  rowsInserted: number;
  columns: string[];
  message: string;
}> {
  const { client, config } = createBigQueryClient();
  const dataset = client.dataset(config.datasetId);

  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await client.createDataset(config.datasetId, {
      location: config.location,
      description:
        'Data Warehouse Satu Data Sektoral — Sinkronisasi Google Sheet OPD',
    });
  }

  const tableId = buildBigQueryTableName(input.opdId, input.sheetName);
  const table = dataset.table(tableId);

  // Petakan header dinamis OPD ke nama kolom BigQuery yang valid & unik
  const usedNames = new Set<string>([
    '_opd_id',
    '_nama_opd',
    '_judul_dataset',
    '_sheet_name',
    '_row_number',
    '_synced_at',
  ]);
  const headerMap: Array<{ original: string; bqCol: string }> = [];

  for (const h of input.headers) {
    let candidate = sanitizeBigQueryIdentifier(h, 'kolom');
    let suffix = 2;
    while (usedNames.has(candidate)) {
      candidate = `${sanitizeBigQueryIdentifier(h, 'kolom')}_${suffix++}`;
    }
    usedNames.add(candidate);
    headerMap.push({ original: h, bqCol: candidate });
  }

  const schemaFields = [
    { name: '_opd_id', type: 'STRING', mode: 'NULLABLE' },
    { name: '_nama_opd', type: 'STRING', mode: 'NULLABLE' },
    { name: '_judul_dataset', type: 'STRING', mode: 'NULLABLE' },
    { name: '_sheet_name', type: 'STRING', mode: 'NULLABLE' },
    { name: '_row_number', type: 'INTEGER', mode: 'NULLABLE' },
    { name: '_synced_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    ...headerMap.map((m) => ({
      name: m.bqCol,
      type: 'STRING',
      mode: 'NULLABLE',
    })),
  ];

  // Re-create table untuk snapshot bersih (menghindari duplikasi baris saat re-sync)
  const [tableExists] = await table.exists();
  if (tableExists) {
    await table.delete();
  }

  await dataset.createTable(tableId, {
    location: config.location,
    schema: { fields: schemaFields },
    description: `${input.namaOpd} — ${input.judulDataset} (Tab: ${input.sheetName})`,
  });

  const syncedAt = new Date().toISOString();
  const payloadRows = input.rows.map((r, idx) => {
    const obj: Record<string, unknown> = {
      _opd_id: input.opdId,
      _nama_opd: input.namaOpd,
      _judul_dataset: input.judulDataset,
      _sheet_name: input.sheetName,
      _row_number: Number(r._rowNumber ?? idx + 2),
      _synced_at: syncedAt,
    };
    for (const m of headerMap) {
      obj[m.bqCol] = String(r.values?.[m.original] ?? '');
    }
    return obj;
  });

  if (payloadRows.length > 0) {
    // Sisipkan per batch 500 baris agar stabil untuk tabel besar
    const BATCH_SIZE = 500;
    for (let i = 0; i < payloadRows.length; i += BATCH_SIZE) {
      await table.insert(payloadRows.slice(i, i + BATCH_SIZE));
    }
  }

  const fullTableName = `\`${config.projectId}.${config.datasetId}.${tableId}\``;
  return {
    ok: true,
    tableId,
    fullTableName,
    rowsInserted: payloadRows.length,
    columns: headerMap.map((m) => m.bqCol),
    message: `Berhasil menyinkronkan ${payloadRows.length} baris ke BigQuery tabel ${tableId} (${config.location}).`,
  };
}

const FORBIDDEN_SQL_PATTERN =
  /\b(DROP|DELETE|UPDATE|INSERT|MERGE|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|CALL|EXECUTE)\b/i;

export async function runReadOnlyBigQuerySql(
  sql: string
): Promise<{
  ok: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  latencyMs: number;
}> {
  const cleanSql = sql.trim();
  if (!cleanSql) {
    throw new Error('Query SQL tidak boleh kosong.');
  }
  if (!/^(SELECT|WITH)\b/i.test(cleanSql)) {
    throw new Error(
      'Hanya query analitik baca (SELECT / WITH) yang diizinkan demi keamanan data.'
    );
  }
  if (FORBIDDEN_SQL_PATTERN.test(cleanSql)) {
    throw new Error(
      'Perintah modifikasi/DDL (DROP, DELETE, UPDATE, INSERT, ALTER, dll.) diblokir oleh guard keamanan BigQuery.'
    );
  }

  const { client, config } = createBigQueryClient();
  const start = Date.now();
  const [rows] = await client.query({
    query: cleanSql,
    location: config.location,
    maximumBytesBilled: String(100 * 1024 * 1024), // Batas aman 100 MB per query (anti tagihan membengkak)
    maxResults: 200,
  });

  const normalized = (rows as Array<Record<string, unknown>>).slice(0, 200);
  const columns =
    normalized.length > 0 ? Object.keys(normalized[0]) : [];

  return {
    ok: true,
    columns,
    rows: normalized,
    totalRows: normalized.length,
    latencyMs: Date.now() - start,
  };
}
