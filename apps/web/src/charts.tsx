import { type PointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, daysBetween, parseDecimal, toChartNumber, type LocalDateTime, type TestSummary } from "@clearcare/domain";
import { fmtShort } from "./format";

/**
 * Two small charts, drawn as SVG: thin 2px lines, 8px markers with a surface ring, hairline grid, one axis, a legend
 * for two series, direct end labels only when they don't collide, and a crosshair tooltip. The check-in list and the
 * result table are the table views, so the tooltip never gates a value.
 */

/** The rendered width of a container, so a chart draws at 1:1 and its text stays at its real size. */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setWidth(Math.max(260, Math.round(w)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** One weight series over time, with the goal as a labeled line. A single series needs no legend. */
export function WeightChart({ points, goal }: { readonly points: readonly { readonly at: LocalDateTime; readonly lb: string; readonly n: number; readonly id: string }[]; readonly goal: number | null }) {
  const { ref: box, width: W } = useWidth(560);
  const H = 240;
  const pad = { l: 40, r: 64, t: 14, b: 28 };
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement>(null);
  if (points.length === 0) {
    return (
      <div ref={box}>
        <p className="empty">No weight logged yet.</p>
      </div>
    );
  }
  const first = points[0]!.at.slice(0, 10);
  const last = points.at(-1)!.at.slice(0, 10);
  const span = Math.max(1, daysBetween(first, last));
  const values = [...points.map((p) => p.n), ...(goal === null ? [] : [goal])];
  let min = Math.floor(Math.min(...values) - 2);
  let max = Math.ceil(Math.max(...values) + 2);
  if (max - min < 6) {
    min -= 3;
    max += 3;
  }
  const x = (at: LocalDateTime) => pad.l + (points.length === 1 ? 0.5 : daysBetween(first, at.slice(0, 10)) / span) * (W - pad.l - pad.r);
  const y = (n: number) => pad.t + ((max - n) / (max - min)) * (H - pad.t - pad.b);
  const step = Math.max(1, Math.round((max - min) / 4));
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
  const months: string[] = [];
  for (let i = 0; i <= 3; i++) months.push(addDays(first, Math.round((span * i) / 3)));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.n).toFixed(1)}`).join("");
  const h = hover === null ? null : points[hover]!;
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const svg = ref.current;
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.at) - px) < Math.abs(x(points[best]!.at) - px)) best = i;
    });
    setHover(best);
  };
  return (
    <div className="chart-wrap" ref={box}>
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ width: W }} role="img" aria-label={`Weight from ${points[0]!.lb} to ${points.at(-1)!.lb} pounds`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
              {v}
            </text>
          </g>
        ))}
        {months.map((m, i) => (
          <text key={i} x={x(`${m}T12:00`)} y={H - 8} textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"} fontSize={11} fill="var(--muted)">
            {fmtShort(m)}
          </text>
        ))}
        {goal === null ? null : (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(goal)} y2={y(goal)} stroke="var(--ok)" strokeWidth={1.5} />
            <text x={W - pad.r + 6} y={y(goal) + 4} fontSize={12} fill="var(--ink-2)">
              Goal {goal}
            </text>
          </g>
        )}
        {h === null ? null : <line x1={x(h.at)} x2={x(h.at)} y1={pad.t} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth={1} />}
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={p.id} cx={x(p.at)} cy={y(p.n)} r={hover === i ? 5.5 : 4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        <text x={x(points.at(-1)!.at) + 8} y={y(points.at(-1)!.n) - 8} fontSize={12} fill="var(--ink-2)">
          {points.at(-1)!.lb}
        </text>
        <rect x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {h === null ? null : (
        <div className="tooltip" style={{ left: `${Math.min(75, (x(h.at) / W) * 100)}%`, top: 8 }}>
          <b className="num">{h.lb} lb</b> <span className="muted">{fmtShort(h.at.slice(0, 10))}</span>
        </div>
      )}
    </div>
  );
}

/** A result trend for one test: the normal range as a band, the latest value as a dot. */
export function Sparkline({ summary }: { readonly summary: TestSummary }) {
  const W = 150;
  const H = 40;
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(
    () =>
      summary.results
        .slice()
        .reverse()
        .map((r) => ({ r, v: parseDecimal(r.value) }))
        .filter((d) => d.v !== null && d.v.comparator === null)
        .map((d) => ({ r: d.r, n: toChartNumber(d.v!.value) })),
    [summary.results],
  );
  if (data.length < 2) return null;
  const low = summary.test.refLow === null ? null : toChartNumber(parseDecimal(summary.test.refLow)!.value);
  const high = summary.test.refHigh === null ? null : toChartNumber(parseDecimal(summary.test.refHigh)!.value);
  const values = [...data.map((d) => d.n), ...(low === null ? [] : [low]), ...(high === null ? [] : [high])];
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || 1;
  min -= span * 0.12;
  max += span * 0.12;
  const first = data[0]!.r.date;
  const total = Math.max(1, daysBetween(first, data.at(-1)!.r.date));
  const x = (date: string) => 5 + (daysBetween(first, date) / total) * (W - 10);
  const y = (n: number) => 4 + ((max - n) / (max - min)) * (H - 8);
  const bandTop = y(high ?? max);
  const bandBottom = y(low ?? min);
  const d = data.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.r.date).toFixed(1)},${y(p.n).toFixed(1)}`).join("");
  const last = data.at(-1)!;
  const shown = hover === null ? null : data[hover]!;
  return (
    <span className="chart-wrap" style={{ display: "inline-block", width: W }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${summary.test.name}: ${data.map((p) => `${p.r.value} on ${p.r.date}`).join(", ")}`}>
        {low === null && high === null ? null : <rect x={0} y={bandTop} width={W} height={Math.max(0, bandBottom - bandTop)} fill="var(--band)" />}
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last.r.date)} cy={y(last.n)} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />
        {data.map((p, i) => (
          <circle key={p.r.id} cx={x(p.r.date)} cy={y(p.n)} r={9} fill="transparent" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} />
        ))}
      </svg>
      {shown === null ? null : (
        <span className="tooltip" style={{ left: Math.min(W - 90, x(shown.r.date)), top: -34 }}>
          <b className="num">
            {shown.r.value} {summary.test.unit}
          </b>{" "}
          <span className="muted">{fmtShort(shown.r.date)}</span>
        </span>
      )}
    </span>
  );
}
