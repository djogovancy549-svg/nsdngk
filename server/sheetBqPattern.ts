import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATE_FILE_PATH = path.resolve(__dirname, '..', 'data', 'sheet-bq-state.json');

export type SheetPartitionStrategy =
  | 'TIME_YEAR'
  | 'TIME_MONTH'
  | 'ROW_SHARD'
  | 'SINGLE';

export interface SheetBqPolicyConfig {
  partitionStrategy: SheetPartitionStrategy;
  maxRowsPerPartition: number;
  workbookCellBudgetPct: number;
  enableWriteAheadBatching: boolean;
  batchFlushIntervalSec: number;
  batchMaxSize: number;
  maxWritesPerMinuteQuota: number;
  retryMaxAttempts: number;
  updatedAt: string;
}

export interface QueuedSheetOp {
  opId: string;
  sheetId: string;
  judulDataset: string;
  webhookUrl: string;
  sheetName: string;
  partitionKey: string;
  action: 'create' | 'update' | 'delete';
  rowNumber?: number;
  values: Record<string, string>;
  queuedAt: string;
  attempts: number;
}

interface SheetBqStoreState {
  policy: SheetBqPolicyConfig;
  queue: QueuedSheetOp[];
  stats: {
    totalQueuedRows: number;
    totalFlushedBatches: number;
    totalFlushedRows: number;
    totalCoalescedRows: number;
    rateLimitHits: number;
    retriesSucceeded: number;
    lastFlushAt: string | null;
    lastError: string | null;
  };
}

const DEFAULT_POLICY: SheetBqPolicyConfig = {
  partitionStrategy: 'TIME_YEAR',
  maxRowsPerPartition: 25_000,
  workbookCellBudgetPct: 75,
  enableWriteAheadBatching: true,
  batchFlushIntervalSec: 4,
  batchMaxSize: 25,
  maxWritesPerMinuteQuota: 45,
  retryMaxAttempts: 4,
  updatedAt: '',
};

function sanitizePolicy(raw?: Partial<SheetBqPolicyConfig>): SheetBqPolicyConfig {
  const strategy =
    raw?.partitionStrategy &&
    ['TIME_YEAR', 'TIME_MONTH', 'ROW_SHARD', 'SINGLE'].includes(raw.partitionStrategy)
      ? raw.partitionStrategy
      : DEFAULT_POLICY.partitionStrategy;

  return {
    partitionStrategy: strategy,
    maxRowsPerPartition: Math.min(
      100_000,
      Math.max(1000, Number(raw?.maxRowsPerPartition || DEFAULT_POLICY.maxRowsPerPartition))
    ),
    workbookCellBudgetPct: Math.min(
      95,
      Math.max(25, Number(raw?.workbookCellBudgetPct || DEFAULT_POLICY.workbookCellBudgetPct))
    ),
    enableWriteAheadBatching:
      typeof raw?.enableWriteAheadBatching === 'boolean'
        ? raw.enableWriteAheadBatching
        : DEFAULT_POLICY.enableWriteAheadBatching,
    batchFlushIntervalSec: Math.min(
      60,
      Math.max(2, Number(raw?.batchFlushIntervalSec || DEFAULT_POLICY.batchFlushIntervalSec))
    ),
    batchMaxSize: Math.min(
      250,
      Math.max(5, Number(raw?.batchMaxSize || DEFAULT_POLICY.batchMaxSize))
    ),
    maxWritesPerMinuteQuota: Math.min(
      120,
      Math.max(10, Number(raw?.maxWritesPerMinuteQuota || DEFAULT_POLICY.maxWritesPerMinuteQuota))
    ),
    retryMaxAttempts: Math.min(
      6,
      Math.max(1, Number(raw?.retryMaxAttempts || DEFAULT_POLICY.retryMaxAttempts))
    ),
    updatedAt: String(raw?.updatedAt || new Date().toISOString()),
  };
}

function loadState(): SheetBqStoreState {
  const fallback: SheetBqStoreState = {
    policy: { ...DEFAULT_POLICY },
    queue: [],
    stats: {
      totalQueuedRows: 0,
      totalFlushedBatches: 0,
      totalFlushedRows: 0,
      totalCoalescedRows: 0,
      rateLimitHits: 0,
      retriesSucceeded: 0,
      lastFlushAt: null,
      lastError: null,
    },
  };

  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(STATE_FILE_PATH, 'utf8')
      ) as Partial<SheetBqStoreState>;
      return {
        policy: sanitizePolicy(parsed.policy),
        queue: Array.isArray(parsed.queue) ? parsed.queue.slice(0, 5000) : [],
        stats: {
          totalQueuedRows: Number(parsed.stats?.totalQueuedRows || 0),
          totalFlushedBatches: Number(parsed.stats?.totalFlushedBatches || 0),
          totalFlushedRows: Number(parsed.stats?.totalFlushedRows || 0),
          totalCoalescedRows: Number(parsed.stats?.totalCoalescedRows || 0),
          rateLimitHits: Number(parsed.stats?.rateLimitHits || 0),
          retriesSucceeded: Number(parsed.stats?.retriesSucceeded || 0),
          lastFlushAt: parsed.stats?.lastFlushAt || null,
          lastError: parsed.stats?.lastError || null,
        },
      };
    }
  } catch {
    // Fallback ke default
  }
  return fallback;
}

let bqSheetState: SheetBqStoreState = loadState();
const writeTimestampsLastMinute: number[] = [];
const activeWebhookLocks = new Set<string>();

function persistState() {
  try {
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(bqSheetState, null, 2), 'utf8');
  } catch {
    // Tetap aktif di memori jika filesystem read-only
  }
}

function isAllowedGoogleScriptUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'script.google.com' &&
      parsed.pathname.startsWith('/macros/s/')
    );
  } catch {
    return false;
  }
}

export function derivePartitionKey(
  strategy: SheetPartitionStrategy,
  values: Record<string, string>,
  fallbackDate?: string
): string {
  if (strategy === 'SINGLE') return 'DEFAULT';
  if (strategy === 'ROW_SHARD') return 'SHARD';

  const now = new Date();
  const fallbackYear =
    fallbackDate && /^\d{4}/.test(fallbackDate)
      ? fallbackDate.slice(0, 4)
      : String(now.getFullYear());
  const fallbackMonth =
    fallbackDate && /^\d{4}-\d{2}/.test(fallbackDate)
      ? fallbackDate.slice(0, 7).replace('-', '_')
      : `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

  const entries = Object.entries(values || {});

  // Cari kolom tahun atau tanggal eksplisit terlebih dahulu
  for (const [key, rawVal] of entries) {
    const lowerKey = key.toLowerCase();
    const val = String(rawVal || '').trim();
    if (!val) continue;

    if (lowerKey.includes('tahun') || lowerKey === 'year' || lowerKey === 'periode') {
      const yearMatch = val.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        return strategy === 'TIME_YEAR'
          ? yearMatch[0]
          : `${yearMatch[0]}_${String(now.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    if (lowerKey.includes('tanggal') || lowerKey.includes('tgl') || lowerKey.includes('date')) {
      const isoMatch = val.match(/\b((?:19|20)\d{2})[-/](\d{1,2})/);
      if (isoMatch) {
        const y = isoMatch[1];
        const m = isoMatch[2].padStart(2, '0');
        return strategy === 'TIME_YEAR' ? y : `${y}_${m}`;
      }
      const dmyMatch = val.match(/\b\d{1,2}[-/](\d{1,2})[-/]((?:19|20)\d{2})\b/);
      if (dmyMatch) {
        const m = dmyMatch[1].padStart(2, '0');
        const y = dmyMatch[2];
        return strategy === 'TIME_YEAR' ? y : `${y}_${m}`;
      }
    }
  }

  return strategy === 'TIME_YEAR' ? fallbackYear : fallbackMonth;
}

function pruneRollingMinuteWindow(): number {
  const cutoff = Date.now() - 60_000;
  while (writeTimestampsLastMinute.length > 0 && writeTimestampsLastMinute[0] < cutoff) {
    writeTimestampsLastMinute.shift();
  }
  return writeTimestampsLastMinute.length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaOrTransientError(status: number, errorText?: string): boolean {
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const lower = String(errorText || '').toLowerCase();
  return (
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many') ||
    lower.includes('service invoked too many times') ||
    lower.includes('lock timeout') ||
    lower.includes('exception: service')
  );
}

export async function postWebhookWithRetry(
  webhookUrl: string,
  payload: Record<string, unknown>,
  secret: string
): Promise<{ ok: boolean; status: number; data: Record<string, unknown>; latencyMs: number }> {
  const maxAttempts = bqSheetState.policy.retryMaxAttempts;
  let lastStatus = 500;
  let lastData: Record<string, unknown> = { ok: false, error: 'Gagal menghubungi webhook.' };
  const overallStart = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const usedQuota = pruneRollingMinuteWindow();
    if (usedQuota >= bqSheetState.policy.maxWritesPerMinuteQuota) {
      bqSheetState.stats.rateLimitHits++;
      persistState();
      // Tunggu slot kuota tersedia (jeda adaptif aman)
      await sleep(1600);
    }

    writeTimestampsLastMinute.push(Date.now());
    try {
      const upstream = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        body: JSON.stringify({
          ...payload,
          secret,
        }),
      });
      lastStatus = upstream.status;
      const text = await upstream.text();
      try {
        lastData = JSON.parse(text) as Record<string, unknown>;
      } catch {
        lastData = { ok: upstream.ok, raw: text.slice(0, 200) };
      }

      const errMsg = typeof lastData?.error === 'string' ? lastData.error : '';
      if (upstream.ok && lastData?.ok !== false) {
        if (attempt > 1) {
          bqSheetState.stats.retriesSucceeded++;
          persistState();
        }
        return {
          ok: true,
          status: upstream.status,
          data: lastData,
          latencyMs: Date.now() - overallStart,
        };
      }

      if (!isQuotaOrTransientError(upstream.status, errMsg) || attempt === maxAttempts) {
        return {
          ok: false,
          status: upstream.status,
          data: lastData,
          latencyMs: Date.now() - overallStart,
        };
      }
    } catch (err) {
      lastData = {
        ok: false,
        error: err instanceof Error ? err.message : 'Network error',
      };
      if (attempt === maxAttempts) {
        return {
          ok: false,
          status: 502,
          data: lastData,
          latencyMs: Date.now() - overallStart,
        };
      }
    }

    // Exponential backoff with jitter (ala BigQuery client retry)
    const baseMs = 700 * Math.pow(2, attempt - 1);
    const jitterMs = Math.floor(Math.random() * 350);
    await sleep(baseMs + jitterMs);
  }

  return {
    ok: false,
    status: lastStatus,
    data: lastData,
    latencyMs: Date.now() - overallStart,
  };
}

export async function fetchSheetWithChunkedPagination(params: {
  webhookUrl: string;
  sheetName: string;
  action: string;
  secret: string;
  partition?: string;
  fields?: string;
  chunkLimit?: number;
}): Promise<{ status: number; data: Record<string, unknown>; latencyMs: number; pagesFetched: number }> {
  const startMs = Date.now();
  const limit = Math.min(2500, Math.max(200, params.chunkLimit || 1500));
  let offset = 0;
  let pagesFetched = 0;
  let mergedRows: unknown[] = [];
  let baseEnvelope: Record<string, unknown> = {};

  while (pagesFetched < 25) {
    const targetUrl = new URL(params.webhookUrl);
    targetUrl.searchParams.set('action', params.action || 'list');
    if (params.sheetName) targetUrl.searchParams.set('sheet', params.sheetName);
    if (params.partition) targetUrl.searchParams.set('partition', params.partition);
    if (params.fields) targetUrl.searchParams.set('fields', params.fields);
    if ((params.action || 'list') === 'list') {
      targetUrl.searchParams.set('offset', String(offset));
      targetUrl.searchParams.set('limit', String(limit));
    }
    targetUrl.searchParams.set('secret', params.secret);

    const upstream = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    });

    const text = await upstream.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {
        status: upstream.status,
        data: { ok: false, error: 'Respons Google Apps Script bukan JSON valid.' },
        latencyMs: Date.now() - startMs,
        pagesFetched: pagesFetched + 1,
      };
    }

    pagesFetched++;
    if (!upstream.ok || parsed.ok === false) {
      return {
        status: upstream.status,
        data: parsed,
        latencyMs: Date.now() - startMs,
        pagesFetched,
      };
    }

    if ((params.action || 'list') !== 'list') {
      return {
        status: upstream.status,
        data: parsed,
        latencyMs: Date.now() - startMs,
        pagesFetched,
      };
    }

    baseEnvelope = parsed;
    const pageRows = Array.isArray(parsed.data) ? parsed.data : [];
    mergedRows = mergedRows.concat(pageRows);

    const hasMore = Boolean(parsed.hasMore);
    const nextOffset = Number(parsed.nextOffset || offset + pageRows.length);
    if (!hasMore || pageRows.length === 0 || nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
    // Jeda kecil antar chunk agar tidak memicu throttling Apps Script
    await sleep(180);
  }

  return {
    status: 200,
    data: {
      ...baseEnvelope,
      data: mergedRows,
      hasMore: false,
      pagesFetched,
    },
    latencyMs: Date.now() - startMs,
    pagesFetched,
  };
}

export function getSheetBqPolicy(): SheetBqPolicyConfig {
  return { ...bqSheetState.policy };
}

export function updateSheetBqPolicy(
  partial: Partial<SheetBqPolicyConfig>
): SheetBqPolicyConfig {
  bqSheetState = {
    ...bqSheetState,
    policy: sanitizePolicy({
      ...bqSheetState.policy,
      ...partial,
      updatedAt: new Date().toISOString(),
    }),
  };
  persistState();
  return getSheetBqPolicy();
}

export function enqueueSheetMutationOp(input: {
  sheetId: string;
  judulDataset: string;
  webhookUrl: string;
  sheetName: string;
  action: 'create' | 'update' | 'delete';
  rowNumber?: number;
  values: Record<string, string>;
  partitionKey?: string;
}): { op: QueuedSheetOp; queueDepth: number; shouldFlushNow: boolean } {
  const partitionKey =
    input.partitionKey?.trim() ||
    derivePartitionKey(bqSheetState.policy.partitionStrategy, input.values);

  const op: QueuedSheetOp = {
    opId: `bqop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    sheetId: input.sheetId,
    judulDataset: input.judulDataset,
    webhookUrl: input.webhookUrl,
    sheetName: input.sheetName || 'Sheet1',
    partitionKey,
    action: input.action,
    rowNumber: input.rowNumber,
    values: input.values || {},
    queuedAt: new Date().toISOString(),
    attempts: 0,
  };

  bqSheetState.queue.push(op);
  bqSheetState.stats.totalQueuedRows++;
  persistState();

  const shouldFlushNow =
    !bqSheetState.policy.enableWriteAheadBatching ||
    bqSheetState.queue.length >= bqSheetState.policy.batchMaxSize;

  return {
    op,
    queueDepth: bqSheetState.queue.length,
    shouldFlushNow,
  };
}

export async function flushSheetBqQueue(options: {
  secret: string;
  onlySheetId?: string;
  onWebhookMutated?: (webhookUrl: string) => void;
}): Promise<{
  flushedBatches: number;
  flushedRows: number;
  remainingQueue: number;
  errors: string[];
}> {
  if (bqSheetState.queue.length === 0) {
    return {
      flushedBatches: 0,
      flushedRows: 0,
      remainingQueue: 0,
      errors: [],
    };
  }

  // Kelompokkan antrean berdasarkan (webhookUrl + sheetName) agar 1 eksekusi Apps Script menulis banyak baris sekaligus
  const groups = new Map<string, QueuedSheetOp[]>();
  const deferred: QueuedSheetOp[] = [];

  for (const op of bqSheetState.queue) {
    if (options.onlySheetId && op.sheetId !== options.onlySheetId) {
      deferred.push(op);
      continue;
    }
    if (!isAllowedGoogleScriptUrl(op.webhookUrl)) {
      continue;
    }
    const gKey = `${op.webhookUrl}::${op.sheetName}`;
    const list = groups.get(gKey) ?? [];
    list.push(op);
    groups.set(gKey, list);
  }

  let flushedBatches = 0;
  let flushedRows = 0;
  const errors: string[] = [];
  const requeue: QueuedSheetOp[] = [...deferred];

  for (const [, ops] of groups.entries()) {
    const webhookUrl = ops[0].webhookUrl;
    const sheetName = ops[0].sheetName;

    if (activeWebhookLocks.has(webhookUrl)) {
      requeue.push(...ops);
      continue;
    }

    activeWebhookLocks.add(webhookUrl);
    try {
      // Pecah per ukuran batchMaxSize
      const chunkSize = bqSheetState.policy.batchMaxSize;
      for (let i = 0; i < ops.length; i += chunkSize) {
        const chunk = ops.slice(i, i + chunkSize);
        const result = await postWebhookWithRetry(
          webhookUrl,
          {
            action: 'batchMutate',
            sheetName,
            partitionMode: bqSheetState.policy.partitionStrategy,
            maxRowsPerPartition: bqSheetState.policy.maxRowsPerPartition,
            ops: chunk.map((c) => ({
              action: c.action,
              partitionKey: c.partitionKey,
              rowNumber: c.rowNumber,
              values: c.values,
            })),
          },
          options.secret
        );

        if (result.ok) {
          flushedBatches++;
          flushedRows += chunk.length;
          if (chunk.length > 1) {
            bqSheetState.stats.totalCoalescedRows += chunk.length - 1;
          }
          options.onWebhookMutated?.(webhookUrl);
        } else {
          // Fallback kompatibilitas jika sheet OPD masih memakai Code.gs v1 tanpa batchMutate
          const errStr = String(result.data?.error || '');
          if (errStr.includes('Action tidak dikenal: batchMutate')) {
            for (const singleOp of chunk) {
              const singleRes = await postWebhookWithRetry(
                webhookUrl,
                {
                  action: singleOp.action,
                  sheetName: singleOp.sheetName,
                  rowNumber: singleOp.rowNumber,
                  values: singleOp.values,
                },
                options.secret
              );
              if (singleRes.ok) {
                flushedBatches++;
                flushedRows++;
                options.onWebhookMutated?.(webhookUrl);
              } else {
                const msg = String(singleRes.data?.error || `HTTP ${singleRes.status}`);
                errors.push(`${singleOp.judulDataset}: ${msg}`);
                if (singleOp.attempts < 5) {
                  requeue.push({ ...singleOp, attempts: singleOp.attempts + 1 });
                }
              }
            }
          } else {
            const msg = errStr || `HTTP ${result.status}`;
            errors.push(`${chunk[0].judulDataset}: ${msg}`);
            for (const c of chunk) {
              if (c.attempts < 5) {
                requeue.push({ ...c, attempts: c.attempts + 1 });
              }
            }
          }
        }
      }
    } finally {
      activeWebhookLocks.delete(webhookUrl);
    }
  }

  bqSheetState.queue = requeue;
  if (flushedBatches > 0) {
    bqSheetState.stats.totalFlushedBatches += flushedBatches;
    bqSheetState.stats.totalFlushedRows += flushedRows;
    bqSheetState.stats.lastFlushAt = new Date().toISOString();
  }
  bqSheetState.stats.lastError = errors.length > 0 ? errors[0] : null;
  persistState();

  return {
    flushedBatches,
    flushedRows,
    remainingQueue: bqSheetState.queue.length,
    errors,
  };
}

export function getSheetBqTelemetry() {
  const writesLastMinute = pruneRollingMinuteWindow();
  const pendingMap = new Map<
    string,
    {
      sheetId: string;
      judulDataset: string;
      partitionKey: string;
      pendingCount: number;
      oldestQueuedAt: string;
    }
  >();

  for (const op of bqSheetState.queue) {
    const key = `${op.sheetId}::${op.partitionKey}`;
    const existing = pendingMap.get(key);
    if (!existing) {
      pendingMap.set(key, {
        sheetId: op.sheetId,
        judulDataset: op.judulDataset,
        partitionKey: op.partitionKey,
        pendingCount: 1,
        oldestQueuedAt: op.queuedAt,
      });
    } else {
      existing.pendingCount++;
    }
  }

  const totalProcessed = bqSheetState.stats.totalFlushedRows;
  const totalBatches = bqSheetState.stats.totalFlushedBatches;
  const quotaCallsSavedPct =
    totalProcessed > 0
      ? Math.max(
          0,
          Math.min(
            99,
            Math.round(((totalProcessed - totalBatches) / totalProcessed) * 100)
          )
        )
      : 0;

  return {
    policy: getSheetBqPolicy(),
    queueDepth: bqSheetState.queue.length,
    writesLastMinute,
    totalQueuedRows: bqSheetState.stats.totalQueuedRows,
    totalFlushedBatches: totalBatches,
    totalFlushedRows: totalProcessed,
    totalCoalescedRows: bqSheetState.stats.totalCoalescedRows,
    quotaCallsSavedPct,
    rateLimitHits: bqSheetState.stats.rateLimitHits,
    retriesSucceeded: bqSheetState.stats.retriesSucceeded,
    pendingBySheet: Array.from(pendingMap.values()),
    lastFlushAt: bqSheetState.stats.lastFlushAt,
    lastError: bqSheetState.stats.lastError,
  };
}
