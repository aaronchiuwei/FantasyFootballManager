import { cn } from "@/lib/utils";

/**
 * §5: "provenance is a first-class field." A trade built on modelled values is
 * a fuzzier trade, and the badge is where the user finds that out — before
 * they send the offer, not after.
 */
export type ValueSource = "market" | "model" | "model_capped" | "floor";

const LABELS: Record<ValueSource, { short: string; title: string }> = {
  market: {
    short: "Market",
    title: "FantasyCalc — priced by real completed redraft trades",
  },
  model: {
    short: "Model",
    title:
      "Value over replacement, calibrated onto FantasyCalc's scale — an estimate, not a market price",
  },
  model_capped: {
    short: "Capped",
    title:
      "Modelled and held under the QB2/TE2 ceiling: kickers and defenses are streamed, not traded",
  },
  floor: {
    short: "Unvalued",
    title: "No market price and no projection to model from — nominal value only",
  },
};

const STYLES: Record<ValueSource, string> = {
  market: "border-source-market/40 bg-source-market/10 text-source-market",
  model: "border-source-model/40 bg-source-model/10 text-source-model",
  model_capped: "border-source-model/30 bg-source-model/5 text-source-model/90",
  floor:
    "border-source-unvalued/40 bg-source-unvalued/10 text-source-unvalued",
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
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-4xl border px-2 text-[0.6875rem] font-medium",
        STYLES[key],
        className,
      )}
    >
      {short}
    </span>
  );
}
