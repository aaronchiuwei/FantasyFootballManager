import { cn } from "@/lib/utils";

/**
 * Provenance is a first-class field. A trade built on modelled values is a
 * fuzzier trade, and this stamp is where the user finds that out before they
 * send the offer rather than after.
 *
 * Colour alone never carries it: the stamp always prints its word, because the
 * distinction between a market price and an estimate is exactly the kind of
 * thing that must survive a colour-blind reader and a greyscale screenshot.
 */
export type ValueSource = "market" | "model" | "model_capped" | "floor";

const LABELS: Record<ValueSource, { short: string; title: string }> = {
  market: {
    short: "Market",
    title: "FantasyCalc: priced by real completed redraft trades",
  },
  model: {
    short: "Model",
    title:
      "Value over replacement, calibrated onto FantasyCalc's scale. An estimate, not a market price",
  },
  model_capped: {
    short: "Capped",
    title:
      "Modelled and held under the QB2/TE2 ceiling: kickers and defenses are streamed, not traded",
  },
  floor: {
    short: "Unvalued",
    title:
      "No market price and no projection to model from. Nominal value only",
  },
};

const STYLES: Record<ValueSource, string> = {
  market: "bg-source-market/14 text-source-market",
  model: "bg-source-model/14 text-source-model",
  model_capped: "bg-source-model/8 text-source-model/85",
  floor: "bg-source-unvalued/14 text-source-unvalued",
};

export function isValueSource(value: string): value is ValueSource {
  return value in LABELS;
}

export function ValueBadge({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const key: ValueSource = isValueSource(source) ? source : "floor";
  const { short, title } = LABELS[key];

  return (
    <span
      title={title}
      data-slot="value-stamp"
      data-source={key}
      className={cn(
        "stencil inline-flex h-5 shrink-0 items-center rounded-xs px-1.5",
        "text-[0.5625rem]",
        STYLES[key],
        className,
      )}
    >
      {short}
    </span>
  );
}
