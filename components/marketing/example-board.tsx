import { Plate, PlateBody, PlateCore, PlateName, PlateMeta, PlateValue } from "@/components/board/plate";
import { Rail } from "@/components/board/rail";
import { DeltaScale } from "@/components/board/scale";
import { Stencil } from "@/components/board/panel";

/**
 * A working fragment of the real board, built from the same Plate, Rail and
 * DeltaScale components the app itself ships. It is not a picture of the
 * product and not a div dressed up as a screenshot.
 *
 * The rosters are invented and labelled as such. Real values arrive from real
 * market sources at runtime, and a marketing page is not allowed to imply a
 * number it did not fetch.
 */

const YOURS = [
  { position: "RB", name: "D. Whitfield", meta: "Rec 6.1 · 14 gp", value: 4180 },
  { position: "WR", name: "M. Okonkwo", meta: "Rec 4.4 · 15 gp", value: 2640 },
];

const THEIRS = [
  { position: "WR", name: "T. Lindqvist", meta: "Rec 5.8 · 15 gp", value: 5310 },
  { position: "TE", name: "R. Battaglia", meta: "Rec 3.2 · 12 gp", value: 2140 },
];

function Side({
  label,
  players,
  total,
}: {
  label: string;
  players: typeof YOURS;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Rail label={label} meta={total.toLocaleString("en-US")}>
        <span className="stencil text-chalk-dim/70">
          {players.length} plates
        </span>
      </Rail>
      {players.map((p) => (
        <Plate key={p.name} className="h-11">
          <PlateCore position={p.position} />
          <PlateBody>
            <PlateName>{p.name}</PlateName>
            <PlateMeta>{p.meta}</PlateMeta>
          </PlateBody>
          <div className="flex items-center pr-2.5">
            <PlateValue>{p.value.toLocaleString("en-US")}</PlateValue>
          </div>
        </Plate>
      ))}
    </div>
  );
}

export function ExampleBoard() {
  const yoursTotal = YOURS.reduce((n, p) => n + p.value, 0);
  const theirsTotal = THEIRS.reduce((n, p) => n + p.value, 0);
  const delta = theirsTotal - yoursTotal;

  return (
    <figure className="m-0 flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Side label="You give" players={YOURS} total={yoursTotal} />
        <Side label="You get" players={THEIRS} total={theirsTotal} />
      </div>

      <DeltaScale
        label="Your net value"
        value={delta}
        range={3000}
        unit="pts"
      />

      <figcaption className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Stencil tone="grease">Verdict</Stencil>
        <span className="font-plate text-sm text-foreground">
          {delta >= 0
            ? `Take it. You gain ${delta.toLocaleString("en-US")} and still start two receivers.`
            : `Decline. You lose ${Math.abs(delta).toLocaleString("en-US")} and thin out your flex.`}
        </span>
        <span className="stencil w-full text-chalk-dim/70">
          Example rosters. Live boards use real market values.
        </span>
      </figcaption>
    </figure>
  );
}
