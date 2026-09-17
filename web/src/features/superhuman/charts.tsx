/**
 * Grafik untuk konsol platform.
 *
 * Ditulis sebagai SVG biasa, bukan lewat pustaka grafik: yang dibutuhkan di sini
 * tiga bentuk saja, sementara pustaka mana pun menambah ratusan kilobyte ke
 * bundel yang dimuat paling banyak justru oleh pelanggan — bukan oleh kita.
 *
 * Satu warna mark untuk semua: #087d4c. Tidak ada satu pun grafik di halaman ini
 * yang berisi lebih dari satu seri, jadi warna tidak sedang dipakai untuk
 * membedakan identitas; ia cuma menandai "ini datanya". Mewarnai batang menurut
 * nilainya justru membuang kanal warna untuk mengulang apa yang sudah dikatakan
 * panjang batang.
 *
 * Warnanya lolos keenam pemeriksaan palet (rentang lightness, chroma, kontras
 * >= 3:1 terhadap permukaan #fcfcf8). Hijau terang brand (#19c666) tidak: kontras
 * 2,19:1, terlalu pucat untuk jadi mark di atas panel.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

const MARK = '#087d4c';
/** Sama dengan --color-line: satu langkah dari permukaan, sengaja mundur ke belakang. */
const GRID = 'rgba(20, 36, 31, 0.11)';
const SURFACE = '#fcfcf8';

/** Lebar kolom maksimum. Sisa ruang slot dibiarkan jadi udara, bukan diisi. */
const MAX_COLUMN = 24;
/** Jarak antar mark yang bersentuhan, diisi warna permukaan. */
const GAP = 2;

/**
 * Lebar sebenarnya dari elemen, supaya SVG digambar dalam piksel nyata.
 *
 * Alternatifnya adalah viewBox yang diregangkan CSS — dan itu ikut meregangkan
 * ketebalan garis, sehingga "garis 2px" berubah-ubah menurut lebar layar.
 */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

type Point = { label: string; value: number };

function ChartShell({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip: { x: number; y: number; body: ReactNode } | null;
}) {
  return (
    <div className="relative">
      {children}
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-ink px-2.5 py-1.5 text-[11px] leading-[1.5] whitespace-nowrap text-white shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y - 8 }}
        >
          {tooltip.body}
        </div>
      ) : null}
    </div>
  );
}

function EmptyPlot({ height, message }: { height: number; message: string }) {
  return (
    <div
      className="grid place-items-center rounded-xl border border-dashed border-border text-[12px] text-muted"
      style={{ height }}
    >
      {message}
    </div>
  );
}

/**
 * Kolom harian. Satu seri, jadi tidak ada legenda — judul kartunya yang
 * mengatakan apa yang sedang digambar.
 */
export function ColumnChart({
  points,
  height = 170,
  formatValue,
  emptyMessage,
}: {
  points: Point[];
  height?: number;
  formatValue: (value: number) => string;
  emptyMessage: string;
}) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((point) => point.value), 0);
  const padTop = 8;
  const padBottom = 18;
  const plot = height - padTop - padBottom;

  const slot = points.length && width ? width / points.length : 0;
  const barWidth = Math.max(1, Math.min(MAX_COLUMN, slot - GAP));

  const hasData = max > 0;

  return (
    <div ref={ref}>
      {!hasData ? (
        <EmptyPlot height={height} message={emptyMessage} />
      ) : width === 0 ? (
        <div style={{ height }} />
      ) : (
        <ChartShell
          tooltip={
            active === null
              ? null
              : {
                  x: slot * (active + 0.5),
                  y: padTop + plot - (points[active].value / max) * plot,
                  body: (
                    <>
                      <span className="block font-mono text-white/60">{points[active].label}</span>
                      <span className="block font-semibold">{formatValue(points[active].value)}</span>
                    </>
                  ),
                }
          }
        >
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Grafik kolom, ${points.length} titik, tertinggi ${formatValue(max)}`}
            onMouseLeave={() => setActive(null)}
          >
            {/* Garis dasar dan garis puncak saja: dua acuan cukup untuk membaca
                tinggi kolom, lebih dari itu cuma tinta yang bukan data. */}
            <line x1={0} y1={padTop} x2={width} y2={padTop} stroke={GRID} strokeWidth={1} />
            <line x1={0} y1={padTop + plot} x2={width} y2={padTop + plot} stroke={GRID} strokeWidth={1} />
            {points.map((point, index) => {
              const barHeight = point.value > 0 ? Math.max(2, (point.value / max) * plot) : 0;
              const x = slot * index + (slot - barWidth) / 2;
              return (
                <g key={point.label}>
                  {barHeight > 0 ? (
                    // rx membulatkan keempat sudut; tinggi ditambah agar sudut
                    // bawah terpotong garis dasar dan ujung yang menempel tetap
                    // bersiku, sesuai bentuk kolom yang tumbuh dari baseline.
                    <rect
                      x={x}
                      y={padTop + plot - barHeight}
                      width={barWidth}
                      height={barHeight + 4}
                      rx={4}
                      fill={MARK}
                      opacity={active === null || active === index ? 1 : 0.35}
                    />
                  ) : null}
                  {/* Sasaran hover setinggi plot: kolom sehari yang nilainya kecil
                      hampir mustahil dikenai kalau area sentuhnya setinggi marknya. */}
                  <rect
                    x={slot * index}
                    y={padTop}
                    width={Math.max(slot, 1)}
                    height={plot}
                    fill="transparent"
                    onMouseEnter={() => setActive(index)}
                  />
                </g>
              );
            })}
            <text x={0} y={height - 4} fontSize={10} fill="#66736e" fontFamily="ui-monospace, monospace">
              {points[0]?.label}
            </text>
            <text
              x={width}
              y={height - 4}
              fontSize={10}
              fill="#66736e"
              textAnchor="end"
              fontFamily="ui-monospace, monospace"
            >
              {points.at(-1)?.label}
            </text>
          </svg>
        </ChartShell>
      )}
    </div>
  );
}

/**
 * Garis + area untuk deret kumulatif. Nilai terakhir diberi label langsung;
 * sisanya lewat tooltip — angka di setiap titik tidak terbaca siapa pun.
 */
export function AreaChart({
  points,
  height = 190,
  formatValue,
  emptyMessage,
}: {
  points: Point[];
  height?: number;
  formatValue: (value: number) => string;
  emptyMessage: string;
}) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((point) => point.value), 0);
  const padTop = 14;
  const padBottom = 18;
  const padRight = 44; // ruang untuk label ujung, supaya tidak terpotong
  const plot = height - padTop - padBottom;
  const innerWidth = Math.max(0, width - padRight);
  const hasData = max > 0;

  const x = (index: number) => (points.length > 1 ? (innerWidth / (points.length - 1)) * index : 0);
  const y = (value: number) => padTop + plot - (max > 0 ? (value / max) * plot : 0);

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${padTop + plot} L0,${padTop + plot} Z`;
  const last = points.length - 1;

  return (
    <div ref={ref}>
      {!hasData ? (
        <EmptyPlot height={height} message={emptyMessage} />
      ) : width === 0 ? (
        <div style={{ height }} />
      ) : (
        <ChartShell
          tooltip={
            active === null
              ? null
              : {
                  x: x(active),
                  y: y(points[active].value),
                  body: (
                    <>
                      <span className="block font-mono text-white/60">{points[active].label}</span>
                      <span className="block font-semibold">{formatValue(points[active].value)}</span>
                    </>
                  ),
                }
          }
        >
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Grafik garis, ${points.length} titik, terakhir ${formatValue(points[last].value)}`}
            onMouseLeave={() => setActive(null)}
          >
            <line x1={0} y1={padTop} x2={innerWidth} y2={padTop} stroke={GRID} strokeWidth={1} />
            <line x1={0} y1={padTop + plot} x2={innerWidth} y2={padTop + plot} stroke={GRID} strokeWidth={1} />
            <path d={area} fill={MARK} opacity={0.1} />
            <path d={line} fill="none" stroke={MARK} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {active !== null ? (
              <line x1={x(active)} y1={padTop} x2={x(active)} y2={padTop + plot} stroke={GRID} strokeWidth={1} />
            ) : null}

            {/* Cincin selebar 2px dalam warna permukaan: titik ujung harus tetap
                terbaca justru di tempat ia menimpa garisnya sendiri. */}
            <circle cx={x(last)} cy={y(points[last].value)} r={5} fill={MARK} stroke={SURFACE} strokeWidth={2} />
            {active !== null && active !== last ? (
              <circle
                cx={x(active)}
                cy={y(points[active].value)}
                r={5}
                fill={MARK}
                stroke={SURFACE}
                strokeWidth={2}
              />
            ) : null}

            <text
              x={x(last) + 10}
              y={y(points[last].value) + 4}
              fontSize={12}
              fontWeight={600}
              fill="#14241f"
              fontFamily="inherit"
            >
              {formatValue(points[last].value)}
            </text>
            <text x={0} y={height - 4} fontSize={10} fill="#66736e" fontFamily="ui-monospace, monospace">
              {points[0]?.label}
            </text>
            <text
              x={innerWidth}
              y={height - 4}
              fontSize={10}
              fill="#66736e"
              textAnchor="end"
              fontFamily="ui-monospace, monospace"
            >
              {points[last]?.label}
            </text>

            {points.map((point, index) => (
              <rect
                key={point.label}
                x={index === 0 ? 0 : x(index) - innerWidth / (points.length - 1) / 2}
                y={padTop}
                width={innerWidth / Math.max(1, points.length - 1)}
                height={plot}
                fill="transparent"
                onMouseEnter={() => setActive(index)}
              />
            ))}
          </svg>
        </ChartShell>
      )}
    </div>
  );
}

/**
 * Batang mendatar berlabel. Nama kategori bisa panjang, jadi arahnya mendatar;
 * nilainya selalu tertulis, bukan hanya tergambar.
 */
export function BarList({
  rows,
  formatValue,
  emptyMessage,
  onSelect,
}: {
  rows: { label: string; sub?: string; value: number }[];
  formatValue: (value: number) => string;
  emptyMessage: string;
  onSelect?: (index: number) => void;
}) {
  const max = Math.max(...rows.map((row) => row.value), 0);
  if (!rows.length || max <= 0) {
    return <EmptyPlot height={120} message={emptyMessage} />;
  }
  return (
    <ul className="m-0 grid list-none gap-3 p-0">
      {rows.map((row, index) => (
        <li key={row.label} className="grid gap-1">
          <span className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-green-dark hover:underline"
                >
                  {row.label}
                </button>
              ) : (
                row.label
              )}
              {row.sub ? <span className="ml-2 font-mono text-[11px] text-muted">{row.sub}</span> : null}
            </span>
            <span className="shrink-0 font-mono text-[12px] tabular-nums">{formatValue(row.value)}</span>
          </span>
          <span className="block h-2 w-full overflow-hidden rounded-full bg-ink/8">
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: MARK }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
