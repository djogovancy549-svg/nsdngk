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
 * TEMPLATE UNIVERSAL DINAMIS GOOGLE APPS SCRIPT (Code.gs)
 * -------------------------------------------------------
 * Dicangkokkan oleh Super Admin ke Extensions > Apps Script pada Google Sheet
 * milik masing-masing OPD. Skrip ini otomatis membaca HEADER BARIS 1 yang dibuat
 * sendiri oleh OPD, sehingga formulir dan tabel web terbentuk secara dinamis.
 */
export const APPS_SCRIPT_DYNAMIC_SHEET_TEMPLATE = `/**
 * Webhook Universal Dinamis — Satu Data Kabupaten Nagekeo (Code.gs)
 * Dicangkokkan pada Google Spreadsheet milik OPD (Extensions > Apps Script).
 * Otomatis mengikuti header baris 1 yang dibuat oleh OPD itu sendiri.
 */

function getTargetSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (sheetName) {
    const named = ss.getSheetByName(sheetName);
    if (named) return named;
  }
  return ss.getSheets()[0];
}

function jsonOut(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function readHeaders(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h).trim(); })
    .filter(function(h) { return h !== ''; });
}

function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = (e && e.parameter && e.parameter.action) || 'list';
    const sheetName = (e && e.parameter && e.parameter.sheet) || '';
    const availableSheets = ss.getSheets().map(function(s) { return s.getName(); });
    const sheet = getTargetSheet(sheetName);
    const headers = readHeaders(sheet);

    if (action === 'ping' || action === 'schema' || action === 'listSheets') {
      return jsonOut({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: sheet.getName(),
        availableSheets: availableSheets,
        headers: headers,
        rows: Math.max(0, sheet.getLastRow() - 1)
      });
    }

    const lastRow = sheet.getLastRow();
    const lastCol = headers.length;
    if (lastRow <= 1 || lastCol === 0) {
      return jsonOut({
        ok: true,
        spreadsheet: ss.getName(),
        sheet: sheet.getName(),
        availableSheets: availableSheets,
        headers: headers,
        data: []
      });
    }

    const rawValues = sheet.getRange(2, 1, lastRow - 1, lastCol).getDisplayValues();
    const rows = [];

    for (let i = 0; i < rawValues.length; i++) {
      const rowArr = rawValues[i];
      const hasContent = rowArr.some(function(cell) { return cell !== '' && cell !== null; });
      if (!hasContent) continue;

      const valuesObj = {};
      for (let c = 0; c < headers.length; c++) {
        valuesObj[headers[c]] = rowArr[c] !== undefined && rowArr[c] !== null ? String(rowArr[c]) : '';
      }

      rows.push({
        _rowNumber: i + 2,
        values: valuesObj
      });
    }

    return jsonOut({
      ok: true,
      spreadsheet: ss.getName(),
      sheet: sheet.getName(),
      availableSheets: availableSheets,
      headers: headers,
      data: rows
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet = getTargetSheet(body.sheetName || '');
    const headers = readHeaders(sheet);

    if (headers.length === 0) {
      return jsonOut({ ok: false, error: 'Baris 1 (Header) pada Google Sheet masih kosong.' });
    }

    if (action === 'create') {
      const rowData = body.values || {};
      const newRow = headers.map(function(h) {
        return rowData[h] !== undefined ? rowData[h] : '';
      });
      sheet.appendRow(newRow);
      return jsonOut({
        ok: true,
        action: 'create',
        rowNumber: sheet.getLastRow(),
        headers: headers
      });
    }

    if (action === 'update') {
      const rowNumber = Number(body.rowNumber);
      if (!rowNumber || rowNumber < 2) {
        return jsonOut({ ok: false, error: 'Nomor baris tidak valid untuk pembaruan.' });
      }
      const rowData = body.values || {};
      const updatedRow = headers.map(function(h) {
        return rowData[h] !== undefined ? rowData[h] : '';
      });
      sheet.getRange(rowNumber, 1, 1, headers.length).setValues([updatedRow]);
      return jsonOut({ ok: true, action: 'update', rowNumber: rowNumber });
    }

    if (action === 'delete') {
      const rowNumber = Number(body.rowNumber);
      if (!rowNumber || rowNumber < 2) {
        return jsonOut({ ok: false, error: 'Nomor baris tidak valid untuk penghapusan.' });
      }
      sheet.deleteRow(rowNumber);
      return jsonOut({ ok: true, action: 'delete', rowNumber: rowNumber });
    }

    return jsonOut({ ok: false, error: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}`;

/**
 * TEMPLATE GOOGLE APPS SCRIPT (Code_Akun_OPD.gs) UNTUK GOOGLE SHEET AKUN DINAS
 */
export const APPS_SCRIPT_AUTH_TEMPLATE = `/**
 * Webhook Akun Dinas/OPD Satu Data Kabupaten Nagekeo (Code_Akun_OPD.gs)
 * Header baris 1 otomatis:
 * id | opdId | namaOpd | namaLengkap | email | username | passwordHash | driveFolderUrl | role | status | dibuatPada
 */

const AUTH_SHEET_NAME = 'Akun_OPD';
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

function getAuthSheet(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(sheetName || AUTH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName || AUTH_SHEET_NAME);
    sheet.appendRow(AUTH_HEADERS);
  }
  return sheet;
}

function authJson(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const sheetName = (e && e.parameter && e.parameter.sheet) || AUTH_SHEET_NAME;
    const sheet = getAuthSheet(sheetName);
    const values = sheet.getDataRange().getValues();
    if (values.length <= 1) return authJson({ ok: true, data: [] });

    const headers = values[0];
    const rows = values.slice(1)
      .filter(function(row) { return row.some(function(c) { return c !== ''; }); })
      .map(function(row) {
        const obj = {};
        headers.forEach(function(h, idx) {
          obj[String(h).trim()] = row[idx];
        });
        return obj;
      });
    return authJson({ ok: true, data: rows });
  } catch (err) {
    return authJson({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    const sheet = getAuthSheet(body.sheetName);

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
