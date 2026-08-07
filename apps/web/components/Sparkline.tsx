/**
 * A coin's recent price shape, drawn across the bottom of its card banner.
 *
 * Deliberately not a chart: no axes, no grid, no numbers. It answers one
 * question at a glance — is this thing going up or down right now — and the
 * market cap next to it answers the other. Anything more belongs on the round
 * page, where there is room for it.
 *
 * Colour comes from the move over the window shown, so a rail of cards reads
 * as a rail of directions without anyone having to compare numbers.
 */
export function Sparkline({
  points,
  className = "",
}: {
  points: number[];
  className?: string;
}) {
  if (points.length < 2) return null;

  const W = 100;
  const H = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  // A dead-flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * (H - 2) - 1;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p).toFixed(2)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  const up = points[points.length - 1]! >= points[0]!;
  const stroke = up ? "#a3e635" : "#f87171";
  const id = `spark-${up ? "u" : "d"}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={`pointer-events-none ${className}`}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
