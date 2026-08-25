import {
  NEED_POSITIONS,
  radarRadius,
  type NeedPosition,
  type TeamNeed,
} from "@/lib/needs/needs";

/**
 * §10's "positional strength radar per team".
 *
 * The axes are z-scores, not points, and that is the whole reason the shape
 * says anything: 300 projected quarterback points and 300 projected tight-end
 * points are not the same claim, but "one standard deviation above this
 * league" and "one standard deviation above this league" are. The ring through
 * the middle is the league average, so a vertex inside it is a need and a
 * vertex outside it is depth — which is exactly the pair of numbers the card
 * lists underneath.
 *
 * Plain SVG, no chart library, no client component: this is a fixed number of
 * points computed from data the page already has, and §10's performance
 * guardrail is to keep heavy visual dependencies off the data-dense pages.
 */

/** Position colors are tokens, never literals — one of the app's conventions. */
const AXIS_COLOR: Record<NeedPosition, string> = {
  QB: "var(--pos-qb)",
  RB: "var(--pos-rb)",
  WR: "var(--pos-wr)",
  TE: "var(--pos-te)",
  K: "var(--pos-k)",
  DEF: "var(--pos-def)",
};

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 62;
const LABEL_RADIUS = RADIUS + 22;

/** Concentric guides, as a share of the full radius. */
const RINGS = [1 / 3, 2 / 3, 1];

/** Where the league average sits once a z-score becomes a radius. */
const AVERAGE_RING = radarRadius(0);

function point(index: number, radius: number): [number, number] {
  // Straight up first, then clockwise — a hexagon with a vertex at the top
  // reads as a shape rather than as a tilted box.
  const angle = (Math.PI * 2 * index) / NEED_POSITIONS.length - Math.PI / 2;
  return [
    CENTER + Math.cos(angle) * RADIUS * radius,
    CENTER + Math.sin(angle) * RADIUS * radius,
  ];
}

function polygon(radii: number[]): string {
  return radii
    .map((radius, index) => point(index, radius).join(","))
    .join(" ");
}

export function NeedsRadar({
  needs,
  label,
}: {
  needs: TeamNeed[];
  label: string;
}) {
  const byPosition = new Map(needs.map((row) => [row.position, row]));
  const radii = NEED_POSITIONS.map((position) =>
    radarRadius(byPosition.get(position)?.zScore ?? 0),
  );

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`Positional strength for ${label}, against the league average`}
      className="h-auto w-full max-w-[13rem]"
    >
      {RINGS.map((ring) => (
        <polygon
          key={ring}
          points={polygon(NEED_POSITIONS.map(() => ring))}
          fill="none"
          stroke="var(--border)"
          strokeWidth={1}
        />
      ))}

      {/* The league average, drawn heavier than the guides: it is the only
          ring that means anything, and it is what a vertex is judged against. */}
      <polygon
        points={polygon(NEED_POSITIONS.map(() => AVERAGE_RING))}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />

      {NEED_POSITIONS.map((position, index) => {
        const [x, y] = point(index, 1);
        return (
          <line
            key={position}
            x1={CENTER}
            y1={CENTER}
            x2={x}
            y2={y}
            stroke="var(--border)"
            strokeWidth={1}
          />
        );
      })}

      <polygon
        points={polygon(radii)}
        fill="var(--primary)"
        fillOpacity={0.18}
        stroke="var(--primary)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />

      {NEED_POSITIONS.map((position, index) => {
        const [x, y] = point(index, radii[index]);
        return (
          <circle
            key={position}
            cx={x}
            cy={y}
            r={2.5}
            fill={AXIS_COLOR[position]}
          />
        );
      })}

      {NEED_POSITIONS.map((position, index) => {
        const angle =
          (Math.PI * 2 * index) / NEED_POSITIONS.length - Math.PI / 2;
        return (
          <text
            key={position}
            x={CENTER + Math.cos(angle) * LABEL_RADIUS}
            y={CENTER + Math.sin(angle) * LABEL_RADIUS}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={AXIS_COLOR[position]}
            fontSize={11}
            fontWeight={600}
          >
            {position}
          </text>
        );
      })}
    </svg>
  );
}
