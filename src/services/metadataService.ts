import {
  DatasetMetadata,
  MetadataVariableDataType,
  MetadataVariableItem,
  OpdDynamicSheet,
} from '../types/satuData';

const METADATA_STORAGE_KEY = 'satu_data_sektoral_metadata_v1';

export function inferMetadataVarType(header: string): MetadataVariableDataType {
  const h = header.toLowerCase();
  if (/(tgl|tanggal|date|waktu|tahun|bulan|periode)/.test(h)) return 'Tanggal';
  if (/(persen|%|rasio|indeks|tingkat)/.test(h)) return 'Persentase';
  if (/(kode|wilayah|kecamatan|desa|kelurahan|kabupaten|bps)/.test(h)) {
    return 'Kode Wilayah';
  }
  if (/(lat|lng|long|koordinat|gps)/.test(h)) return 'Koordinat';
  if (
    /(jumlah|total|panjang|luas|nilai|anggaran|rupiah|rp|volume|berat|kg|ton|km|unit|jiwa|orang|kapasitas|skor|umur|usia|baik|sedang|rusak)/.test(
      h
    )
  ) {
    return 'Angka';
  }
  return 'Teks';
}

export function createDefaultDatasetMetadata(
  sheet: OpdDynamicSheet,
  defaultWalidata = 'Walidata Daerah'
): DatasetMetadata {
  const shortCode = sheet.namaOpd
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('');

  const variabel: MetadataVariableItem[] = (sheet.headers || []).map((col) => ({
    namaKolom: col,
    definisi: '',
    tipeData: inferMetadataVarType(col),
    satuan: '',
    wajibDiisi: true,
  }));

  return {
    sheetId: sheet.id,
    kodeReferensi: `SDI-${shortCode || 'OPD'}-${sheet.id.slice(-4).toUpperCase()}`,
    urusanPemerintahan: '',
    produsenData: sheet.namaOpd,
    walidata: defaultWalidata,
    tahunData: String(new Date().getFullYear()),
    frekuensiPemutakhiran: 'Tahunan',
    cakupanWilayah: 'Kabupaten',
    tingkatAkses: 'Terbuka (Publik)',
    metodologiPengumpulan: 'Kompilasi Administrasi',
    satuanPengukuran: '',
    konsepDefinisi: sheet.deskripsi || '',
    kontakPic: sheet.emailOpd || '',
    statusValidasi: 'Belum Diverifikasi',
    catatanWalidata: '',
    variabel,
    diperbaruiPada: '',
    diperbaruiOleh: '',
  };
}

/**
 * Sinkronkan daftar variabel metadata dengan header baris 1 sheet terbaru tanpa
 * menghilangkan definisi yang sudah pernah diisi oleh OPD/Super Admin.
 */
export function syncMetadataVariablesWithHeaders(
  metadata: DatasetMetadata,
  headers: string[]
): DatasetMetadata {
  const existingMap = new Map<string, MetadataVariableItem>();
  for (const item of metadata.variabel || []) {
    existingMap.set(item.namaKolom.trim().toLowerCase(), item);
  }

  const synced: MetadataVariableItem[] = (headers || []).map((col) => {
    const found = existingMap.get(col.trim().toLowerCase());
    if (found) {
      return { ...found, namaKolom: col };
    }
    return {
      namaKolom: col,
      definisi: '',
      tipeData: inferMetadataVarType(col),
      satuan: '',
      wajibDiisi: true,
    };
  });

  return {
    ...metadata,
    variabel: synced,
  };
}

export function computeMetadataCompleteness(
  metadata: DatasetMetadata | undefined,
  headersCount: number
): { score: number; filledFields: number; totalFields: number } {
  if (!metadata) {
    return { score: 0, filledFields: 0, totalFields: 9 };
  }

  const coreChecks = [
    Boolean(metadata.kodeReferensi?.trim()),
    Boolean(metadata.urusanPemerintahan?.trim()),
    Boolean(metadata.produsenData?.trim()),
    Boolean(metadata.tahunData?.trim()),
    Boolean(metadata.frekuensiPemutakhiran?.trim()),
    Boolean(metadata.cakupanWilayah?.trim()),
    Boolean(metadata.satuanPengukuran?.trim()),
    Boolean(metadata.konsepDefinisi?.trim()),
    Boolean(metadata.kontakPic?.trim()),
  ];

  const varDefined = (metadata.variabel || []).filter(
    (v) => v.definisi && v.definisi.trim().length > 0
  ).length;
  const hasVarTarget = headersCount > 0 ? 1 : 0;
  const varScore =
    headersCount > 0 ? Math.min(1, varDefined / headersCount) : 0;

  const coreFilled = coreChecks.filter(Boolean).length;
  const totalUnits = coreChecks.length + hasVarTarget;
  const score = Math.round(((coreFilled + varScore) / totalUnits) * 100);

  return {
    score,
    filledFields: coreFilled,
    totalFields: coreChecks.length,
  };
}

export function loadCachedMetadataMap(): Record<string, DatasetMetadata> {
  try {
    const raw = localStorage.getItem(METADATA_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, DatasetMetadata>;
      }
    }
  } catch {
    // Abaikan cache rusak
  }
  return {};
}

export function saveCachedMetadataMap(
  map: Record<string, DatasetMetadata>
): void {
  try {
    localStorage.setItem(METADATA_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Abaikan jika quota penuh
  }
}

export async function fetchAllDatasetMetadata(): Promise<
  Record<string, DatasetMetadata>
> {
  const cached = loadCachedMetadataMap();
  try {
    const res = await fetch('/api/metadata', {
      method: 'GET',
      cache: 'no-store',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.includes('application/json')) {
      const data = await res.json();
      if (data?.ok && data.metadataBySheet && typeof data.metadataBySheet === 'object') {
        const merged = {
          ...cached,
          ...(data.metadataBySheet as Record<string, DatasetMetadata>),
        };
        saveCachedMetadataMap(merged);
        return merged;
      }
    }
  } catch {
    // Fallback ke cache lokal
  }
  return cached;
}

export async function saveDatasetMetadata(
  sheetId: string,
  metadata: DatasetMetadata,
  actorEmail: string,
  actorRole: 'super_admin' | 'opd'
): Promise<{ ok: boolean; metadata: DatasetMetadata; message: string }> {
  const payload: DatasetMetadata = {
    ...metadata,
    sheetId,
    diperbaruiPada: new Date().toISOString(),
    diperbaruiOleh: actorEmail.trim().toLowerCase(),
  };

  try {
    const res = await fetch(`/api/metadata/${encodeURIComponent(sheetId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(actorRole === 'super_admin'
          ? { 'x-superadmin-email': actorEmail.trim().toLowerCase() }
          : { 'x-actor-email': actorEmail.trim().toLowerCase() }),
      },
      body: JSON.stringify({ metadata: payload, actorRole }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      if (res.ok && data?.ok && data.metadata) {
        const current = loadCachedMetadataMap();
        const next = { ...current, [sheetId]: data.metadata as DatasetMetadata };
        saveCachedMetadataMap(next);
        return {
          ok: true,
          metadata: data.metadata as DatasetMetadata,
          message:
            data.message || 'Metadata dataset berhasil disimpan di server.',
        };
      }
      return {
        ok: false,
        metadata: payload,
        message: data?.message || 'Gagal menyimpan metadata dataset.',
      };
    }
  } catch {
    // Fallback simpan lokal
  }

  const current = loadCachedMetadataMap();
  saveCachedMetadataMap({ ...current, [sheetId]: payload });
  return {
    ok: true,
    metadata: payload,
    message: 'Metadata dataset tersimpan di penyimpanan lokal.',
  };
}

export function exportMetadataCatalogToJson(
  sheets: OpdDynamicSheet[],
  metadataMap: Record<string, DatasetMetadata>,
  filename = 'katalog-metadata-satu-data.json'
): void {
  const catalog = {
    standar: 'Satu Data Indonesia (Perpres 39/2019)',
    dieksportPada: new Date().toISOString(),
    totalDataset: sheets.length,
    datasets: sheets.map((sheet) => {
      const meta = syncMetadataVariablesWithHeaders(
        metadataMap[sheet.id] || createDefaultDatasetMetadata(sheet),
        sheet.headers
      );
      return {
        id: sheet.id,
        judulDataset: sheet.judulDataset,
        namaTabSheet: sheet.sheetName,
        statusIntegrasi: sheet.status,
        metadata: meta,
      };
    }),
  };

  const blob = new Blob([JSON.stringify(catalog, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportMetadataCatalogToCsv(
  sheets: OpdDynamicSheet[],
  metadataMap: Record<string, DatasetMetadata>,
  filename = 'katalog-metadata-satu-data.csv'
): void {
  const cols = [
    'Kode Referensi',
    'Judul Dataset',
    'Produsen Data (OPD)',
    'Urusan Pemerintahan',
    'Tahun Data',
    'Frekuensi Pemutakhiran',
    'Cakupan Wilayah',
    'Tingkat Akses',
    'Metodologi Pengumpulan',
    'Satuan Pengukuran',
    'Konsep & Definisi',
    'Kontak PIC',
    'Jumlah Variabel',
    'Status Validasi',
    'Diperbarui Pada',
  ];

  const escapeCsv = (val: unknown) => {
    const s = String(val ?? '').replace(/\r?\n/g, ' ');
    return `"${s.replace(/"/g, '""')}"`;
  };

  const rows = sheets.map((sheet) => {
    const meta = metadataMap[sheet.id] || createDefaultDatasetMetadata(sheet);
    return [
      meta.kodeReferensi,
      sheet.judulDataset,
      meta.produsenData || sheet.namaOpd,
      meta.urusanPemerintahan,
      meta.tahunData,
      meta.frekuensiPemutakhiran,
      meta.cakupanWilayah,
      meta.tingkatAkses,
      meta.metodologiPengumpulan,
      meta.satuanPengukuran,
      meta.konsepDefinisi,
      meta.kontakPic,
      sheet.headers.length,
      meta.statusValidasi,
      meta.diperbaruiPada,
    ]
      .map(escapeCsv)
      .join(',');
  });

  const csvContent = `\uFEFF${[cols.map(escapeCsv).join(','), ...rows].join('\n')}`;
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
