import {
  AuthSheetConfig,
  OpdDirectoryItem,
  PublishSheetConfig,
} from '../types/satuData';

/**
 * KONFIGURASI GOOGLE SHEET & WEBHOOK PENYIMPANAN AKUN & REGISTRASI SHEET OPD
 * ---------------------------------------------------------------------------
 * URL Google Sheet dan Webhook Apps Script tertanam langsung dalam kode.
 * Menyimpan daftar akun dinas (email, username, passwordHash, folder Drive OPD)
 * agar tersinkronisasi terpusat untuk Super Admin Walidata Kabupaten Nagekeo.
 */
export const AUTH_SHEET_CONFIG: AuthSheetConfig = {
  sheetId: '1NagekeoAkunOpdSheetID_GantiDenganIDAsli00',
  sheetName: 'Akun_OPD',
  gid: '0',
  sheetUrl:
    'https://docs.google.com/spreadsheets/d/1NagekeoAkunOpdSheetID_GantiDenganIDAsli00/edit#gid=0',
  webhookUrl:
    'https://script.google.com/macros/s/AKfycbx_NAGEKEO_AKUN_OPD_WEBHOOK_GANTI_ASLI_00/exec',
};

/**
 * KONFIGURASI GOOGLE SHEET PUBLIKASI MILIK SUPER ADMIN (DINAS KOMINFO)
 * Menyimpan hasil cloning data terpilih dari OPD yang siap dipublikasikan.
 */
export const PUBLISH_SHEET_CONFIG: PublishSheetConfig = {
  sheetId: '1NagekeoPublikasiKominfoID_GantiDenganIDAsli00',
  sheetName: 'Katalog_Publikasi',
  sheetUrl:
    'https://docs.google.com/spreadsheets/d/1NagekeoPublikasiKominfoID_GantiDenganIDAsli00/edit#gid=0',
  webhookUrl:
    'https://script.google.com/macros/s/AKfycbx_NAGEKEO_PUBLIKASI_KOMINFO_WEBHOOK_GANTI_ASLI_00/exec',
};

/**
 * IDENTITAS PUBLIK WALIDATA (Kredensial Super Admin diverifikasi ketat di server)
 */
export const SUPER_ADMIN_RESERVED_IDENTIFIERS = {
  username: 'superadmin',
  email: 'walidata@nagekeokab.go.id',
};

/**
 * REFERENSI DAFTAR DINAS / OPD KABUPATEN NAGEKEO
 * OPD juga dapat mendaftarkan nama dinas/badan/bagian lain secara dinamis.
 */
export const OPD_DIRECTORY: OpdDirectoryItem[] = [
  {
    id: 'dinkes',
    kode: 'OPD-01',
    nama: 'Dinas Kesehatan',
    singkatan: 'Dinkes',
    urusan: 'Kesehatan',
  },
  {
    id: 'disdikbud',
    kode: 'OPD-02',
    nama: 'Dinas Pendidikan dan Kebudayaan',
    singkatan: 'Disdikbud',
    urusan: 'Pendidikan & Kebudayaan',
  },
  {
    id: 'distan',
    kode: 'OPD-03',
    nama: 'Dinas Pertanian',
    singkatan: 'Distan',
    urusan: 'Pertanian & Ketahanan Pangan',
  },
  {
    id: 'dpupr',
    kode: 'OPD-04',
    nama: 'Dinas Pekerjaan Umum dan Penataan Ruang',
    singkatan: 'DPUPR',
    urusan: 'Infrastruktur & Penataan Ruang',
  },
  {
    id: 'disdukcapil',
    kode: 'OPD-05',
    nama: 'Dinas Kependudukan dan Pencatatan Sipil',
    singkatan: 'Disdukcapil',
    urusan: 'Administrasi Kependudukan',
  },
  {
    id: 'dkp',
    kode: 'OPD-06',
    nama: 'Dinas Kelautan dan Perikanan',
    singkatan: 'DKP',
    urusan: 'Kelautan & Perikanan',
  },
  {
    id: 'dispar',
    kode: 'OPD-07',
    nama: 'Dinas Pariwisata',
    singkatan: 'Dispar',
    urusan: 'Pariwisata & Ekonomi Kreatif',
  },
  {
    id: 'dinsos',
    kode: 'OPD-08',
    nama: 'Dinas Sosial',
    singkatan: 'Dinsos',
    urusan: 'Sosial & Kesejahteraan',
  },
  {
    id: 'bappelitbangda',
    kode: 'OPD-09',
    nama: 'Bappelitbangda',
    singkatan: 'Bappelitbangda',
    urusan: 'Perencanaan Pembangunan Daerah',
  },
  {
    id: 'diskominfo',
    kode: 'OPD-10',
    nama: 'Dinas Komunikasi dan Informatika',
    singkatan: 'Diskominfo',
    urusan: 'Komunikasi, Informatika & Statistik',
  },
];

export function isPlaceholderEndpoint(url: string): boolean {
  return (
    !url ||
    url.includes('GantiDenganIDAsli') ||
    url.includes('WEBHOOK_GANTI_ASLI')
  );
}

/**
 * TEMPLATE UNIVERSAL DINAMIS GOOGLE APPS SCRIPT (Code.gs v2 — Pola BigQuery)
 * ---------------------------------------------------------------------------
 * Dicangkokkan oleh Super Admin ke Extensions > Apps Script pada Google Sheet
 * milik masing-masing OPD. Mendukung:
 * - Auto-Partitioning per Tahun / Bulan / Shard Baris (menghindari tab raksasa)
 * - Registry Manifest (_BQ_MANIFEST) + Penjaga Batas 10 Juta Sel Google Sheet
 * - Batch Append via setValues() + LockService (hemat kuota & anti-timeout)
 * - Chunked Pagination Scan (offset/limit) & Column Projection (fields)
 */
export const APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE = `/**
 * Webhook Universal Dinamis Pola BigQuery — Satu Data Sektoral (Code.gs v2)
 * Dicangkokkan pada Google Spreadsheet milik OPD (Extensions > Apps Script).
 *
 * KEAMANAN KETAT (DISARANKAN):
 * Salin Kunci Rahasia Webhook (API_SECRET) dari menu Konfigurasi > Proxy Aman
 * lalu tempel di konstanta API_SECRET di bawah ini.
 */
const API_SECRET = '';
const MANIFEST_SHEET_NAME = '_BQ_MANIFEST';
const MAX_ROWS_PER_PARTITION = 25000;
const SAFE_WORKBOOK_CELL_LIMIT = 8000000; // Batas aman 80% dari 10.000.000 sel Google Sheet
const DEFAULT_CHUNK_LIMIT = 1500;

function isSecretValid(provided) {
  if (!API_SECRET) return true;
  return String(provided || '') === String(API_SECRET);
}

function getBaseSheet(ss, sheetName) {
  if (sheetName) {
    const named = ss.getSheetByName(sheetName);
    if (named) return named;
  }
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    if (sheets[i].getName() !== MANIFEST_SHEET_NAME) return sheets[i];
  }
  return sheets[0];
}

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readHeaders(sheet) {
  if (!sheet) return [];
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h).trim(); })
    .filter(function(h) { return h !== ''; });
}

function countWorkbookCells(ss) {
  const sheets = ss.getSheets();
  let total = 0;
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    total += Math.max(1, s.getLastRow()) * Math.max(1, s.getLastColumn());
  }
  return total;
}

function ensureManifestSheet(ss) {
  let m = ss.getSheetByName(MANIFEST_SHEET_NAME);
  if (!m) {
    m = ss.insertSheet(MANIFEST_SHEET_NAME);
    m.appendRow([
      'base_sheet',
      'partition_key',
      'tab_name',
      'row_count',
      'cell_count',
      'tier',
      'last_ingested_at'
    ]);
    m.setFrozenRows(1);
    try { m.hideSheet(); } catch (e) {}
  }
  return m;
}

function upsertManifestRow(ss, baseSheetName, partitionKey, tabName, rowCount, colCount, tier) {
  const m = ensureManifestSheet(ss);
  const lastRow = m.getLastRow();
  const nowIso = new Date().toISOString();
  const cellCount = (rowCount + 1) * Math.max(1, colCount);
  const record = [baseSheetName, partitionKey, tabName, rowCount, cellCount, tier || 'HOT', nowIso];

  if (lastRow > 1) {
    const existing = m.getRange(2, 1, lastRow - 1, 7).getValues();
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i][2]) === tabName) {
        m.getRange(i + 2, 1, 1, 7).setValues([record]);
        return;
      }
    }
  }
  m.appendRow(record);
}

function listWorkbookPartitions(ss, baseSheetName) {
  const sheets = ss.getSheets();
  const prefix = baseSheetName + '__';
  const partitions = [];

  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i];
    const name = s.getName();
    if (name === MANIFEST_SHEET_NAME) continue;
    if (name === baseSheetName || name.indexOf(prefix) === 0) {
      const rCount = Math.max(0, s.getLastRow() - 1);
      const cCount = Math.max(1, s.getLastColumn());
      const pKey = name === baseSheetName ? 'DEFAULT' : name.slice(prefix.length);
      partitions.push({
        partitionKey: pKey,
        tabName: name,
        rowCount: rCount,
        cellCount: (rCount + 1) * cCount,
        tier: 'HOT'
      });
    }
  }
  return partitions;
}

function resolveWritePartitionSheet(ss, baseSheet, baseHeaders, partitionMode, partitionKey, maxRowsLimit) {
  const limit = Number(maxRowsLimit) > 0 ? Number(maxRowsLimit) : MAX_ROWS_PER_PARTITION;
  const cleanKey = String(partitionKey || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);

  // Jika mode SINGLE atau tidak ada partitionKey, gunakan baseSheet dengan guard shard rollover
  if (!cleanKey || partitionMode === 'SINGLE') {
    const currentRows = Math.max(0, baseSheet.getLastRow() - 1);
    if (currentRows < limit) {
      return { sheet: baseSheet, partitionKey: 'DEFAULT', headers: baseHeaders };
    }
  }

  const baseName = baseSheet.getName();
  const desiredKey = cleanKey || String(new Date().getFullYear());
  let shardIndex = 1;
  let candidateName = baseName + '__' + desiredKey;

  while (shardIndex <= 20) {
    let target = ss.getSheetByName(candidateName);
    if (!target) {
      const totalCells = countWorkbookCells(ss);
      if (totalCells >= SAFE_WORKBOOK_CELL_LIMIT) {
        throw new Error('Kapasitas aman Google Sheet (8.000.000 sel) tercapai. Arsipkan partisi lama ke BigQuery/Server terlebih dahulu.');
      }
      target = ss.insertSheet(candidateName);
      if (baseHeaders.length > 0) {
        target.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders]);
        target.setFrozenRows(1);
      }
      upsertManifestRow(ss, baseName, shardIndex === 1 ? desiredKey : desiredKey + '_P' + shardIndex, candidateName, 0, baseHeaders.length, 'HOT');
      return {
        sheet: target,
        partitionKey: shardIndex === 1 ? desiredKey : desiredKey + '_P' + shardIndex,
        headers: baseHeaders
      };
    }

    const rowCount = Math.max(0, target.getLastRow() - 1);
    if (rowCount < limit) {
      let targetHeaders = readHeaders(target);
      if (targetHeaders.length === 0 && baseHeaders.length > 0) {
        target.getRange(1, 1, 1, baseHeaders.length).setValues([baseHeaders]);
        targetHeaders = baseHeaders;
      }
      return {
        sheet: target,
        partitionKey: shardIndex === 1 ? desiredKey : desiredKey + '_P' + shardIndex,
        headers: targetHeaders
      };
    }

    shardIndex++;
    candidateName = baseName + '__' + desiredKey + '_P' + shardIndex;
  }

  throw new Error('Melebihi batas shard partisi maksimum untuk key: ' + desiredKey);
}

function readSheetChunk(sheet, headers, offset, limit, selectedFields, partitionKey) {
  const lastRow = sheet.getLastRow();
  const lastCol = headers.length;
  if (lastRow <= 1 || lastCol === 0) {
    return { rows: [], totalRows: 0, hasMore: false, nextOffset: 0 };
  }

  const totalRows = lastRow - 1;
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeLimit = Math.min(3000, Math.max(1, Number(limit) || DEFAULT_CHUNK_LIMIT));
  if (safeOffset >= totalRows) {
    return { rows: [], totalRows: totalRows, hasMore: false, nextOffset: totalRows };
  }

  const count = Math.min(safeLimit, totalRows - safeOffset);
  const rawValues = sheet.getRange(2 + safeOffset, 1, count, lastCol).getDisplayValues();
  const activeFields = selectedFields && selectedFields.length > 0 ? selectedFields : headers;
  const fieldIndexMap = {};
  for (let c = 0; c < headers.length; c++) {
    fieldIndexMap[headers[c]] = c;
  }

  const rows = [];
  for (let i = 0; i < rawValues.length; i++) {
    const rowArr = rawValues[i];
    const hasContent = rowArr.some(function(cell) { return cell !== '' && cell !== null; });
    if (!hasContent) continue;

    const valuesObj = {};
    for (let f = 0; f < activeFields.length; f++) {
      const colName = activeFields[f];
      const idx = fieldIndexMap[colName];
      if (idx !== undefined) {
        valuesObj[colName] = rowArr[idx] !== undefined && rowArr[idx] !== null ? String(rowArr[idx]) : '';
      }
    }

    rows.push({
      _rowNumber: 2 + safeOffset + i,
      _partitionKey: partitionKey || 'DEFAULT',
      values: valuesObj
    });
  }

  const nextOffset = safeOffset + count;
  return {
    rows: rows,
    totalRows: totalRows,
    hasMore: nextOffset < totalRows,
    nextOffset: nextOffset
  };
}

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (!isSecretValid(params.secret || '')) {
      return jsonOut({ ok: false, error: 'Akses ditolak: API_SECRET tidak valid.' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = params.action || 'list';
    const sheetName = params.sheet || '';
    const availableSheets = ss.getSheets()
      .map(function(s) { return s.getName(); })
      .filter(function(n) { return n !== MANIFEST_SHEET_NAME && n.indexOf('__') === -1; });
    const baseSheet = getBaseSheet(ss, sheetName);
    const headers = readHeaders(baseSheet);
    const partitions = listWorkbookPartitions(ss, baseSheet.getName());
    const totalWorkbookCells = countWorkbookCells(ss);

    if (action === 'ping' || action === 'schema' || action === 'listSheets' || action === 'manifest') {
      const totalPartitionRows = partitions.reduce(function(acc, p) { return acc + p.rowCount; }, 0);
      return jsonOut({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: baseSheet.getName(),
        availableSheets: availableSheets,
        headers: headers,
        rows: totalPartitionRows,
        partitions: partitions,
        totalWorkbookCells: totalWorkbookCells,
        safeCellLimit: SAFE_WORKBOOK_CELL_LIMIT
      });
    }

    const requestedPartition = String(params.partition || '').trim();
    const offset = Number(params.offset || 0);
    const limit = Number(params.limit || DEFAULT_CHUNK_LIMIT);
    const fieldsParam = String(params.fields || '').trim();
    const selectedFields = fieldsParam
      ? fieldsParam.split(',').map(function(f) { return f.trim(); }).filter(Boolean)
      : [];

    // Jika meminta partisi spesifik (Partition Pruning)
    if (requestedPartition && requestedPartition.toUpperCase() !== 'ALL') {
      const prefix = baseSheet.getName() + '__';
      const targetTabName = requestedPartition === 'DEFAULT'
        ? baseSheet.getName()
        : (requestedPartition.indexOf(prefix) === 0 ? requestedPartition : prefix + requestedPartition);
      const partSheet = ss.getSheetByName(targetTabName);
      if (!partSheet) {
        return jsonOut({
          ok: true,
          spreadsheet: ss.getName(),
          sheet: baseSheet.getName(),
          availableSheets: availableSheets,
          headers: headers,
          data: [],
          totalRows: 0,
          hasMore: false,
          nextOffset: 0,
          partitions: partitions,
          totalWorkbookCells: totalWorkbookCells
        });
      }
      const pHeaders = readHeaders(partSheet);
      const effectiveHeaders = pHeaders.length > 0 ? pHeaders : headers;
      const chunk = readSheetChunk(partSheet, effectiveHeaders, offset, limit, selectedFields, requestedPartition);
      return jsonOut({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: baseSheet.getName(),
        activePartition: requestedPartition,
        availableSheets: availableSheets,
        headers: effectiveHeaders,
        data: chunk.rows,
        totalRows: chunk.totalRows,
        hasMore: chunk.hasMore,
        nextOffset: chunk.nextOffset,
        partitions: partitions,
        totalWorkbookCells: totalWorkbookCells
      });
    }

    // Jika meminta gabungan partisi ('all') atau default sheet dengan fallback otomatis ke partisi aktif terbaru
    const nonEmptyPartitions = partitions.filter(function(p) { return p.rowCount > 0; });
    if (requestedPartition.toUpperCase() === 'ALL' && nonEmptyPartitions.length > 0) {
      let mergedRows = [];
      let totalAllRows = 0;
      for (let p = 0; p < nonEmptyPartitions.length; p++) {
        const pInfo = nonEmptyPartitions[p];
        const pSheet = ss.getSheetByName(pInfo.tabName);
        if (!pSheet) continue;
        const pHeaders = readHeaders(pSheet);
        const effHeaders = pHeaders.length > 0 ? pHeaders : headers;
        const pChunk = readSheetChunk(pSheet, effHeaders, 0, Math.min(limit, 3000), selectedFields, pInfo.partitionKey);
        totalAllRows += pChunk.totalRows;
        mergedRows = mergedRows.concat(pChunk.rows);
      }
      return jsonOut({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: baseSheet.getName(),
        availableSheets: availableSheets,
        headers: headers,
        data: mergedRows,
        totalRows: totalAllRows,
        hasMore: false,
        nextOffset: totalAllRows,
        partitions: partitions,
        totalWorkbookCells: totalWorkbookCells
      });
    }

    // Default single/chunked read pada baseSheet (atau partisi terbaru jika baseSheet kosong)
    let readTarget = baseSheet;
    let activePartKey = 'DEFAULT';
    if (baseSheet.getLastRow() <= 1 && nonEmptyPartitions.length > 0) {
      const latestPart = nonEmptyPartitions[nonEmptyPartitions.length - 1];
      const latestSheet = ss.getSheetByName(latestPart.tabName);
      if (latestSheet) {
        readTarget = latestSheet;
        activePartKey = latestPart.partitionKey;
      }
    }

    const effHeaders = readHeaders(readTarget);
    const chunk = readSheetChunk(
      readTarget,
      effHeaders.length > 0 ? effHeaders : headers,
      offset,
      limit,
      selectedFields,
      activePartKey
    );

    return jsonOut({
      ok: true,
      spreadsheet: ss.getName(),
      sheet: baseSheet.getName(),
      activePartition: activePartKey,
      availableSheets: availableSheets,
      headers: headers.length > 0 ? headers : effHeaders,
      data: chunk.rows,
      totalRows: chunk.totalRows,
      hasMore: chunk.hasMore,
      nextOffset: chunk.nextOffset,
      partitions: partitions,
      totalWorkbookCells: totalWorkbookCells
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
    const body = JSON.parse(e.postData.contents);
    if (!isSecretValid(body.secret)) {
      return jsonOut({ ok: false, error: 'Akses ditolak: API_SECRET tidak valid.' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = body.action;
    const baseSheet = getBaseSheet(ss, body.sheetName || '');
    const baseHeaders = readHeaders(baseSheet);

    if (baseHeaders.length === 0) {
      return jsonOut({ ok: false, error: 'Baris 1 (Header) pada Google Sheet masih kosong.' });
    }

    const partitionMode = body.partitionMode || 'SINGLE';
    const maxRowsPerPartition = Number(body.maxRowsPerPartition || MAX_ROWS_PER_PARTITION);

    // 1. MICRO-BATCH MUTATE (Pola BigQuery Streaming Insert — 1x setValues untuk banyak baris)
    if (action === 'batchMutate' && Array.isArray(body.ops)) {
      const ops = body.ops;
      const createsByPartition = {};
      let createdCount = 0;
      let updatedCount = 0;
      let deletedCount = 0;
      const assignedRowNumbers = [];

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const opAction = op.action || 'create';
        const pKey = String(op.partitionKey || body.partitionKey || '').trim();

        if (opAction === 'create') {
          const groupKey = partitionMode === 'SINGLE' ? 'SINGLE' : (pKey || String(new Date().getFullYear()));
          if (!createsByPartition[groupKey]) createsByPartition[groupKey] = [];
          createsByPartition[groupKey].push(op);
        } else if (opAction === 'update') {
          const targetInfo = partitionMode === 'SINGLE'
            ? { sheet: baseSheet, partitionKey: 'DEFAULT', headers: baseHeaders }
            : resolveWritePartitionSheet(ss, baseSheet, baseHeaders, partitionMode, pKey, maxRowsPerPartition);
          const rowNumber = Number(op.rowNumber);
          if (rowNumber >= 2 && rowNumber <= targetInfo.sheet.getLastRow()) {
            const rowData = op.values || {};
            const updatedRow = targetInfo.headers.map(function(h) {
              return rowData[h] !== undefined ? rowData[h] : '';
            });
            targetInfo.sheet.getRange(rowNumber, 1, 1, targetInfo.headers.length).setValues([updatedRow]);
            updatedCount++;
          }
        } else if (opAction === 'delete') {
          const targetInfo = partitionMode === 'SINGLE'
            ? { sheet: baseSheet, partitionKey: 'DEFAULT', headers: baseHeaders }
            : resolveWritePartitionSheet(ss, baseSheet, baseHeaders, partitionMode, pKey, maxRowsPerPartition);
          const rowNumber = Number(op.rowNumber);
          if (rowNumber >= 2 && rowNumber <= targetInfo.sheet.getLastRow()) {
            targetInfo.sheet.deleteRow(rowNumber);
            deletedCount++;
          }
        }
      }

      const partKeys = Object.keys(createsByPartition);
      for (let k = 0; k < partKeys.length; k++) {
        const groupKey = partKeys[k];
        const groupOps = createsByPartition[groupKey];
        const resolved = resolveWritePartitionSheet(
          ss,
          baseSheet,
          baseHeaders,
          partitionMode,
          groupKey === 'SINGLE' ? '' : groupKey,
          maxRowsPerPartition
        );
        const startRow = Math.max(2, resolved.sheet.getLastRow() + 1);
        const matrix = groupOps.map(function(op) {
          const rowData = op.values || {};
          return resolved.headers.map(function(h) {
            return rowData[h] !== undefined ? rowData[h] : '';
          });
        });

        resolved.sheet.getRange(startRow, 1, matrix.length, resolved.headers.length).setValues(matrix);
        createdCount += matrix.length;
        for (let r = 0; r < matrix.length; r++) {
          assignedRowNumbers.push({ partitionKey: resolved.partitionKey, rowNumber: startRow + r });
        }

        upsertManifestRow(
          ss,
          baseSheet.getName(),
          resolved.partitionKey,
          resolved.sheet.getName(),
          Math.max(0, resolved.sheet.getLastRow() - 1),
          resolved.headers.length,
          'HOT'
        );
      }

      return jsonOut({
        ok: true,
        action: 'batchMutate',
        createdCount: createdCount,
        updatedCount: updatedCount,
        deletedCount: deletedCount,
        assignedRowNumbers: assignedRowNumbers,
        totalWorkbookCells: countWorkbookCells(ss)
      });
    }

    // 2. SINGLE CREATE (Partition-aware)
    if (action === 'create') {
      const resolved = resolveWritePartitionSheet(
        ss,
        baseSheet,
        baseHeaders,
        partitionMode,
        body.partitionKey || '',
        maxRowsPerPartition
      );
      const rowData = body.values || {};
      const newRow = resolved.headers.map(function(h) {
        return rowData[h] !== undefined ? rowData[h] : '';
      });
      const targetRow = Math.max(2, resolved.sheet.getLastRow() + 1);
      resolved.sheet.getRange(targetRow, 1, 1, resolved.headers.length).setValues([newRow]);
      upsertManifestRow(
        ss,
        baseSheet.getName(),
        resolved.partitionKey,
        resolved.sheet.getName(),
        Math.max(0, resolved.sheet.getLastRow() - 1),
        resolved.headers.length,
        'HOT'
      );
      return jsonOut({
        ok: true,
        action: 'create',
        partitionKey: resolved.partitionKey,
        tabName: resolved.sheet.getName(),
        rowNumber: targetRow,
        headers: resolved.headers
      });
    }

    if (action === 'update') {
      const resolved = resolveWritePartitionSheet(
        ss,
        baseSheet,
        baseHeaders,
        partitionMode,
        body.partitionKey || '',
        maxRowsPerPartition
      );
      const rowNumber = Number(body.rowNumber);
      if (!rowNumber || rowNumber < 2) {
        return jsonOut({ ok: false, error: 'Nomor baris tidak valid untuk pembaruan.' });
      }
      const rowData = body.values || {};
      const updatedRow = resolved.headers.map(function(h) {
        return rowData[h] !== undefined ? rowData[h] : '';
      });
      resolved.sheet.getRange(rowNumber, 1, 1, resolved.headers.length).setValues([updatedRow]);
      return jsonOut({
        ok: true,
        action: 'update',
        partitionKey: resolved.partitionKey,
        rowNumber: rowNumber
      });
    }

    if (action === 'delete') {
      const resolved = resolveWritePartitionSheet(
        ss,
        baseSheet,
        baseHeaders,
        partitionMode,
        body.partitionKey || '',
        maxRowsPerPartition
      );
      const rowNumber = Number(body.rowNumber);
      if (!rowNumber || rowNumber < 2) {
        return jsonOut({ ok: false, error: 'Nomor baris tidak valid untuk penghapusan.' });
      }
      resolved.sheet.deleteRow(rowNumber);
      upsertManifestRow(
        ss,
        baseSheet.getName(),
        resolved.partitionKey,
        resolved.sheet.getName(),
        Math.max(0, resolved.sheet.getLastRow() - 1),
        resolved.headers.length,
        'HOT'
      );
      return jsonOut({
        ok: true,
        action: 'delete',
        partitionKey: resolved.partitionKey,
        rowNumber: rowNumber
      });
    }

    return jsonOut({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}`;

/**
 * TEMPLATE GOOGLE APPS SCRIPT (Code_Akun_OPD.gs) UNTUK GOOGLE SHEET AKUN & PIN DINAS
 */
export const APPS_SCRIPT_AUTH_TEMPLATE = `/**
 * Webhook Akun Dinas/OPD & PIN Sekali Pakai Satu Data (Code_Akun_OPD.gs)
 * Otomatis membuat 2 tab pada Spreadsheet Super Admin:
 * 1) Akun_OPD: id | opdId | namaOpd | namaLengkap | email | username | passwordHash | driveFolderUrl | role | status | dibuatPada
 * 2) Permohonan_PIN_OPD: id | opdId | namaOpd | namaPemohon | jabatan | emailPemohon | nomorKontak | alasanPengajuan | status | pinHint | pinHash | pinSalt | pinFailedAttempts | pinIssuedAt | pinExpiresAt | approvedBy | catatanAdmin | dibuatPada | digunakanPada
 */

const API_SECRET = '';
const AUTH_SHEET_NAME = 'Akun_OPD';
const PIN_SHEET_NAME = 'Permohonan_PIN_OPD';

const AUTH_HEADERS = [
  'id',
  'opdId',
  'namaOpd',
  'namaLengkap',
  'email',
  'username',
  'passwordHash',
  'driveFolderUrl',
  'role',
  'status',
  'dibuatPada'
];

const PIN_HEADERS = [
  'id',
  'opdId',
  'namaOpd',
  'namaPemohon',
  'jabatan',
  'emailPemohon',
  'nomorKontak',
  'alasanPengajuan',
  'status',
  'pinHint',
  'pinHash',
  'pinSalt',
  'pinFailedAttempts',
  'pinIssuedAt',
  'pinExpiresAt',
  'approvedBy',
  'catatanAdmin',
  'dibuatPada',
  'digunakanPada'
];

function isAuthSecretValid(provided) {
  if (!API_SECRET) return true;
  return String(provided || '') === String(API_SECRET);
}

function getManagedSheet(sheetName, defaultHeaders) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(defaultHeaders);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(defaultHeaders);
  }
  return sheet;
}

function authJson(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readSheetObjects(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
    .map(function(row) {
      const obj = {};
      headers.forEach(function(h, idx) {
        obj[String(h).trim()] = row[idx];
      });
      return obj;
    });
}

function upsertPinRow(sheet, reqObj) {
  const values = sheet.getDataRange().getValues();
  const headers = values.length > 0 ? values[0] : PIN_HEADERS;
  const idIdx = headers.indexOf('id');
  const rowArr = headers.map(function(h) {
    const key = String(h).trim();
    const val = reqObj[key];
    return val !== undefined && val !== null ? String(val) : '';
  });

  if (idIdx >= 0) {
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][idIdx]) === String(reqObj.id)) {
        sheet.getRange(i + 1, 1, 1, headers.length).setValues([rowArr]);
        return 'updated';
      }
    }
  }
  sheet.appendRow(rowArr);
  return 'inserted';
}

function doGet(e) {
  try {
    const providedSecret = (e && e.parameter && e.parameter.secret) || '';
    if (!isAuthSecretValid(providedSecret)) {
      return authJson({ ok: false, error: 'Akses ditolak: API_SECRET tidak valid.' });
    }
    const action = (e && e.parameter && e.parameter.action) || 'list';
    if (action === 'listPinRequests' || (e && e.parameter && e.parameter.sheet === PIN_SHEET_NAME)) {
      const pinSheet = getManagedSheet(PIN_SHEET_NAME, PIN_HEADERS);
      return authJson({ ok: true, sheet: pinSheet.getName(), data: readSheetObjects(pinSheet) });
    }

    const sheetName = (e && e.parameter && e.parameter.sheet) || AUTH_SHEET_NAME;
    const sheet = getManagedSheet(sheetName, AUTH_HEADERS);
    return authJson({ ok: true, sheet: sheet.getName(), data: readSheetObjects(sheet) });
  } catch (err) {
    return authJson({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!isAuthSecretValid(body.secret)) {
      return authJson({ ok: false, error: 'Akses ditolak: API_SECRET tidak valid.' });
    }
    const action = body.action;

    if (action === 'upsertPinRequest' && body.request) {
      const pinSheet = getManagedSheet(body.pinSheetName || PIN_SHEET_NAME, PIN_HEADERS);
      const mode = upsertPinRow(pinSheet, body.request);
      return authJson({ ok: true, action: 'upsertPinRequest', mode: mode, id: body.request.id });
    }

    if (action === 'syncPinRequests' && Array.isArray(body.requests)) {
      const pinSheet = getManagedSheet(body.pinSheetName || PIN_SHEET_NAME, PIN_HEADERS);
      let count = 0;
      body.requests.forEach(function(item) {
        if (item && item.id) {
          upsertPinRow(pinSheet, item);
          count++;
        }
      });
      return authJson({ ok: true, action: 'syncPinRequests', count: count });
    }

    const sheet = getManagedSheet(body.sheetName || AUTH_SHEET_NAME, AUTH_HEADERS);

    if (action === 'register' && body.account) {
      const row = AUTH_HEADERS.map(function(k) {
        return body.account[k] !== undefined ? body.account[k] : '';
      });
      sheet.appendRow(row);
      return authJson({ ok: true, action: 'register', id: body.account.id });
    }

    const values = sheet.getDataRange().getValues();
    const idIdx = values[0].indexOf('id');
    const statusIdx = values[0].indexOf('status');

    if (action === 'updateStatus') {
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(body.id)) {
          sheet.getRange(i + 1, statusIdx + 1).setValue(body.status);
          return authJson({ ok: true, action: 'updateStatus', id: body.id });
        }
      }
      return authJson({ ok: false, error: 'Akun tidak ditemukan' });
    }

    if (action === 'delete') {
      for (let i = 1; i < values.length; i++) {
        if (String(values[i][idIdx]) === String(body.id)) {
          sheet.deleteRow(i + 1);
          return authJson({ ok: true, action: 'delete', id: body.id });
        }
      }
      return authJson({ ok: false, error: 'Akun tidak ditemukan' });
    }

    return authJson({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return authJson({ ok: false, error: String(err) });
  }
}`;

/**
 * TEMPLATE GOOGLE APPS SCRIPT (Code_Publikasi_Kominfo.gs)
 * -------------------------------------------------------
 * Dipasang di Google Sheet Publikasi milik Super Admin (Dinas Kominfo).
 * Menerima hasil cloning dataset (kolom & baris pilihan), membuat/memperbarui
 * tab khusus data publikasi, dan mencatatnya pada tab Katalog_Publikasi.
 */
export const APPS_SCRIPT_PUBLISH_TEMPLATE = `/**
 * Webhook Publikasi & Cloning Data — Dinas Kominfo Kabupaten Nagekeo
 * (Code_Publikasi_Kominfo.gs)
 * Pasang pada Google Spreadsheet Publikasi milik Super Admin / Diskominfo.
 */

const CATALOG_SHEET_NAME = 'Katalog_Publikasi';
const CATALOG_HEADERS = [
  'id',
  'judulPublikasi',
  'sourceOpdNama',
  'kategori',
  'targetTabName',
  'jumlahKolom',
  'jumlahBaris',
  'statusPublikasi',
  'ringkasan',
  'dipublikasikanPada'
];

function pubJson(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function getCatalogSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName || CATALOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName || CATALOG_SHEET_NAME);
    sheet.appendRow(CATALOG_HEADERS);
  }
  return sheet;
}

function sanitizeTabName(name) {
  return String(name || 'Publikasi_Data')
    .replace(/[\\\\/?*\\[\\]:]/g, '_')
    .trim()
    .slice(0, 90) || 'Publikasi_Data';
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = (e && e.parameter && e.parameter.action) || 'list';
    const catalogName = (e && e.parameter && e.parameter.sheet) || CATALOG_SHEET_NAME;
    const sheet = getCatalogSheet(catalogName);

    if (action === 'ping') {
      return pubJson({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: sheet.getName(),
        rows: Math.max(0, sheet.getLastRow() - 1)
      });
    }

    const values = sheet.getDataRange().getDisplayValues();
    if (values.length <= 1) {
      return pubJson({ ok: true, spreadsheet: ss.getName(), data: [] });
    }

    const headers = values[0];
    const rows = values.slice(1).map(function(row) {
      const obj = {};
      headers.forEach(function(h, i) { obj[String(h).trim()] = row[i]; });
      return obj;
    });
    return pubJson({ ok: true, spreadsheet: ss.getName(), data: rows });
  } catch (err) {
    return pubJson({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const catalog = getCatalogSheet(body.catalogSheetName || CATALOG_SHEET_NAME);

    if (action === 'publishClone' && body.clone) {
      const clone = body.clone;
      const tabName = sanitizeTabName(clone.targetTabName || clone.judulPublikasi);
      let dataSheet = ss.getSheetByName(tabName);
      if (!dataSheet) {
        dataSheet = ss.insertSheet(tabName);
      } else {
        dataSheet.clearContents();
      }

      const headers = Array.isArray(clone.selectedHeaders) ? clone.selectedHeaders : [];
      const rows = Array.isArray(clone.rows) ? clone.rows : [];

      if (headers.length > 0) {
        const matrix = [headers];
        rows.forEach(function(r) {
          const vals = r.values || {};
          matrix.push(headers.map(function(h) {
            return vals[h] !== undefined ? String(vals[h]) : '';
          }));
        });
        dataSheet.getRange(1, 1, matrix.length, headers.length).setValues(matrix);
      }

      // Upsert ke Katalog_Publikasi
      const catValues = catalog.getDataRange().getValues();
      const idIdx = catValues[0].indexOf('id');
      const catalogRow = [
        clone.id,
        clone.judulPublikasi,
        clone.sourceOpdNama,
        clone.kategori || 'Sektoral',
        tabName,
        headers.length,
        rows.length,
        clone.statusPublikasi || 'Dipublikasikan',
        clone.ringkasan || '',
        clone.dipublikasikanPada || new Date().toISOString().slice(0, 10)
      ];

      let updated = false;
      for (let i = 1; i < catValues.length; i++) {
        if (String(catValues[i][idIdx]) === String(clone.id)) {
          catalog.getRange(i + 1, 1, 1, CATALOG_HEADERS.length).setValues([catalogRow]);
          updated = true;
          break;
        }
      }
      if (!updated) {
        catalog.appendRow(catalogRow);
      }

      return pubJson({
        ok: true,
        action: 'publishClone',
        tabName: tabName,
        rowsWritten: rows.length
      });
    }

    if (action === 'updateStatus') {
      const catValues = catalog.getDataRange().getValues();
      const idIdx = catValues[0].indexOf('id');
      const statusIdx = catValues[0].indexOf('statusPublikasi');
      for (let i = 1; i < catValues.length; i++) {
        if (String(catValues[i][idIdx]) === String(body.id)) {
          catalog.getRange(i + 1, statusIdx + 1).setValue(body.statusPublikasi);
          return pubJson({ ok: true, action: 'updateStatus', id: body.id });
        }
      }
      return pubJson({ ok: false, error: 'Dataset publikasi tidak ditemukan.' });
    }

    if (action === 'deleteClone') {
      const catValues = catalog.getDataRange().getValues();
      const idIdx = catValues[0].indexOf('id');
      for (let i = 1; i < catValues.length; i++) {
        if (String(catValues[i][idIdx]) === String(body.id)) {
          catalog.deleteRow(i + 1);
          break;
        }
      }
      if (body.targetTabName) {
        const targetSheet = ss.getSheetByName(sanitizeTabName(body.targetTabName));
        if (targetSheet && ss.getSheets().length > 1) {
          ss.deleteSheet(targetSheet);
        }
      }
      return pubJson({ ok: true, action: 'deleteClone', id: body.id });
    }

    return pubJson({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return pubJson({ ok: false, error: String(err) });
  }
}`;
