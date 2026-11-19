import {
  PUBLISH_SHEET_CONFIG,
  isPlaceholderEndpoint,
} from '../config/opdSheets';
import {
  PublishSheetConfig,
  PublishStatus,
  PublishedDatasetClone,
} from '../types/satuData';

const PUBLISH_CONFIG_STORAGE_KEY = 'satu_data_nagekeo_publish_sheet_cfg_v1';
const PUBLISHED_CLONES_STORAGE_KEY = 'satu_data_nagekeo_published_clones_v1';

export function extractSheetIdFromUrl(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : '';
}

export function getActivePublishSheetConfig(): PublishSheetConfig {
  try {
    const raw = localStorage.getItem(PUBLISH_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PublishSheetConfig>;
      if (parsed && (parsed.sheetUrl || parsed.webhookUrl)) {
        const sheetUrl = (parsed.sheetUrl ?? '').trim();
        const sheetId =
          extractSheetIdFromUrl(sheetUrl) ||
          (parsed.sheetId ?? '').trim() ||
          PUBLISH_SHEET_CONFIG.sheetId;
        return {
          sheetId,
          sheetName:
            (parsed.sheetName ?? '').trim() || PUBLISH_SHEET_CONFIG.sheetName,
          sheetUrl: sheetUrl || PUBLISH_SHEET_CONFIG.sheetUrl,
          webhookUrl:
            (parsed.webhookUrl ?? '').trim() || PUBLISH_SHEET_CONFIG.webhookUrl,
        };
      }
    }
  } catch {
    // Gunakan default
  }
  return PUBLISH_SHEET_CONFIG;
}

export function hasCustomPublishSheetConfig(): boolean {
  try {
    return Boolean(localStorage.getItem(PUBLISH_CONFIG_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function saveCustomPublishSheetConfig(input: {
  sheetUrl: string;
  sheetName: string;
  webhookUrl: string;
}): PublishSheetConfig {
  const sheetUrl = input.sheetUrl.trim();
  const sheetName = input.sheetName.trim() || 'Katalog_Publikasi';
  const webhookUrl = input.webhookUrl.trim();
  const sheetId = extractSheetIdFromUrl(sheetUrl);

  const next: PublishSheetConfig = {
    sheetId: sheetId || PUBLISH_SHEET_CONFIG.sheetId,
    sheetName,
    sheetUrl: sheetUrl || PUBLISH_SHEET_CONFIG.sheetUrl,
    webhookUrl: webhookUrl || PUBLISH_SHEET_CONFIG.webhookUrl,
  };

  try {
    localStorage.setItem(PUBLISH_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Abaikan
  }
  return next;
}

export function resetCustomPublishSheetConfig(): PublishSheetConfig {
  try {
    localStorage.removeItem(PUBLISH_CONFIG_STORAGE_KEY);
  } catch {
    // Abaikan
  }
  return PUBLISH_SHEET_CONFIG;
}

export async function testPublishSheetConnection(
  webhookUrl: string,
  sheetName: string
): Promise<{ ok: boolean; message: string }> {
  const cleanUrl = webhookUrl.trim();
  if (!cleanUrl || isPlaceholderEndpoint(cleanUrl)) {
    return {
      ok: false,
      message:
        'Masukkan URL Webhook Apps Script (/exec) dari Google Sheet Publikasi Dinas Kominfo terlebih dahulu.',
    };
  }

  try {
    const url = new URL(cleanUrl);
    url.searchParams.set('action', 'ping');
    url.searchParams.set('sheet', sheetName.trim() || 'Katalog_Publikasi');

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      return {
        ok: false,
        message: `Webhook Publikasi merespons HTTP ${res.status}. Pastikan Deploy Web App diatur "Who has access: Anyone".`,
      };
    }

    const json = await res.json();
    if (json && json.ok) {
      return {
        ok: true,
        message: `Terhubung ke Google Sheet "${
          json.spreadsheet || 'Publikasi Kominfo'
        }" (tab ${json.sheet || sheetName}, ${json.rows ?? 0} katalog tercatat).`,
      };
    }

    return {
      ok: false,
      message: `Webhook merespons galat: ${json?.error ?? 'Format respons tidak sesuai.'}`,
    };
  } catch {
    return {
      ok: false,
      message:
        'Gagal menjangkau URL Webhook Publikasi. Periksa kembali URL /exec dan izin akses deployment.',
    };
  }
}

export function loadPublishedClones(): PublishedDatasetClone[] {
  try {
    const raw = localStorage.getItem(PUBLISHED_CLONES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as PublishedDatasetClone[];
    }
  } catch {
    // Abaikan
  }
  return [];
}

export function savePublishedClones(clones: PublishedDatasetClone[]): void {
  try {
    localStorage.setItem(PUBLISHED_CLONES_STORAGE_KEY, JSON.stringify(clones));
  } catch {
    // Abaikan
  }
}

export async function pushCloneToKominfoSheet(
  clone: PublishedDatasetClone
): Promise<{ syncedToSheet: boolean; message: string }> {
  const cfg = getActivePublishSheetConfig();
  if (isPlaceholderEndpoint(cfg.webhookUrl)) {
    return {
      syncedToSheet: false,
      message: `Data clone "${clone.judulPublikasi}" tersimpan lokal. Hubungkan URL Webhook Google Sheet Publikasi Dinas Kominfo untuk menyimpannya langsung ke Spreadsheet Kominfo.`,
    };
  }

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'publishClone',
        catalogSheetName: cfg.sheetName,
        clone,
      }),
    });

    if (res.ok) {
      return {
        syncedToSheet: true,
        message: `Clone "${clone.judulPublikasi}" (${clone.rows.length} baris, ${clone.selectedHeaders.length} kolom) berhasil disimpan ke tab "${clone.targetTabName}" di Google Sheet Publikasi Dinas Kominfo.`,
      };
    }

    return {
      syncedToSheet: false,
      message: `Webhook Publikasi Kominfo merespons HTTP ${res.status}. Clone tetap tersimpan lokal.`,
    };
  } catch {
    return {
      syncedToSheet: false,
      message:
        'Gagal menghubungi Webhook Google Sheet Publikasi Kominfo. Clone tetap tersimpan lokal.',
    };
  }
}

export async function updateCloneStatusOnKominfoSheet(
  clone: PublishedDatasetClone,
  statusPublikasi: PublishStatus
): Promise<{ syncedToSheet: boolean; message: string }> {
  const cfg = getActivePublishSheetConfig();
  if (isPlaceholderEndpoint(cfg.webhookUrl)) {
    return {
      syncedToSheet: false,
      message: `Status "${clone.judulPublikasi}" diubah menjadi ${statusPublikasi}.`,
    };
  }

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateStatus',
        catalogSheetName: cfg.sheetName,
        id: clone.id,
        statusPublikasi,
      }),
    });

    return {
      syncedToSheet: res.ok,
      message: res.ok
        ? `Status "${clone.judulPublikasi}" diperbarui menjadi ${statusPublikasi} di Google Sheet Kominfo.`
        : `Status diubah lokal (HTTP ${res.status} dari Webhook Kominfo).`,
    };
  } catch {
    return {
      syncedToSheet: false,
      message: `Status "${clone.judulPublikasi}" diubah lokal menjadi ${statusPublikasi}.`,
    };
  }
}

export async function deleteCloneOnKominfoSheet(
  clone: PublishedDatasetClone
): Promise<{ syncedToSheet: boolean; message: string }> {
  const cfg = getActivePublishSheetConfig();
  if (isPlaceholderEndpoint(cfg.webhookUrl)) {
    return {
      syncedToSheet: false,
      message: `Dataset publikasi "${clone.judulPublikasi}" dihapus.`,
    };
  }

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'deleteClone',
        catalogSheetName: cfg.sheetName,
        id: clone.id,
        targetTabName: clone.targetTabName,
      }),
    });

    return {
      syncedToSheet: res.ok,
      message: res.ok
        ? `Dataset publikasi "${clone.judulPublikasi}" dihapus dari katalog & tab Google Sheet Kominfo.`
        : `Dihapus lokal (HTTP ${res.status} dari Webhook Kominfo).`,
    };
  } catch {
    return {
      syncedToSheet: false,
      message: `Dataset publikasi "${clone.judulPublikasi}" dihapus secara lokal.`,
    };
  }
}
