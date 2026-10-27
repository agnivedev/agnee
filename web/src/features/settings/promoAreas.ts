export type PromoArea = { province: string; city: string; district: string };

/**
 * Daftar wilayah yang diketik per baris:
 *   Banten / Tangerang Selatan: Ciputat, Setu, Pamulang
 *   Tangerang: Alam Sutera
 *   Gunung Sindur, Bogor, Jawa Barat
 * Baris bertitik dua = satu kota dengan banyak kecamatan (provinsi di depan
 * garis miring, boleh kosong). Baris tanpa titik dua = "Kecamatan, Kota, Provinsi".
 */
export function parseAreas(text: string): PromoArea[] {
  const out: PromoArea[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon > 0) {
      const head = line.slice(0, colon).split('/').map((s) => s.trim());
      const city = head.length > 1 ? head[1] : head[0];
      const province = head.length > 1 ? head[0] : '';
      const districts = line.slice(colon + 1).split(',').map((s) => s.trim()).filter(Boolean);
      if (!districts.length) out.push({ province, city, district: '' });
      for (const district of districts) out.push({ province, city, district });
      continue;
    }
    const [district = '', city = '', province = ''] = line.split(',').map((s) => s.trim());
    out.push({ province, city, district });
  }
  return out;
}

/** Kebalikan parseAreas, dikelompokkan per kota supaya enak dibaca dan disunting. */
export function formatAreas(areas: PromoArea[]): string {
  const groups = new Map<string, { head: string; districts: string[] }>();
  const lines: string[] = [];
  for (const area of areas) {
    if (!area.city) {
      lines.push(area.province ? `${area.district}, , ${area.province}` : area.district);
      continue;
    }
    const key = `${area.province}/${area.city}`;
    const head = area.province ? `${area.province} / ${area.city}` : area.city;
    const group = groups.get(key) ?? { head, districts: [] };
    if (area.district) group.districts.push(area.district);
    groups.set(key, group);
  }
  return [...Array.from(groups.values(), (g) => `${g.head}:${g.districts.length ? ` ${g.districts.join(', ')}` : ''}`), ...lines].join('\n');
}
