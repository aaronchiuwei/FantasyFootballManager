"use client";

import { useState } from "react";
import { ChevronDown, RotateCcw, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_TRADE_PARAMS,
  PARAM_LIMITS,
  type TradeParams,
} from "@/lib/trades/analyze";
import { cn } from "@/lib/utils";

const KNOBS: {
  key: keyof TradeParams;
  symbol: string;
  label: string;
  description: string;
}[] = [
  {
    key: "alpha",
    symbol: "α",
    label: "Best player bonus",
    description:
      "A share of the best asset on each side. FantasyCalc's curve already prices stars steeply, so §6 starts this low. At 0.15 the analyzer approves every 2-for-1.",
  },
  {
    key: "beta",
    symbol: "β",
    label: "Roster spot cost",
    description:
      "Charged only on the bodies one side sends beyond the other's count, against that side's median. A 3-for-3 costs nobody anything; without it the calculator happily approves 4-for-1s that no real manager would accept.",
  },
  {
    key: "gamma",
    symbol: "γ",
    label: "Top asset in the deal",
    description:
      "Paid on how much the deal's best player outclasses the other side's best. Zero between comparable headliners.",
  },
];

/**
 * §6's three knobs, exposed. "Let the user's league norms calibrate them" — a
 * league that trades in packages every week does not price depth the way one
 * that never trades does.
 *
 * Moving a slider re-prices the open trade instantly, because the math is pure
 * and local (§2). The value is only *persisted* on release, so a drag is one
 * write rather than forty.
 */
export function TuningPanel({
  params,
  onChange,
  onCommit,
}: {
  params: TradeParams;
  onChange: (params: TradeParams) => void;
  /**
   * Where a released slider is persisted. Optional: the open analyzer has no
   * league to calibrate, so its knobs live and die with the tab, and the
   * control is the same control either way.
   */
  onCommit?: (params: TradeParams) => void;
}) {
  const [open, setOpen] = useState(false);
  const modified = KNOBS.some(
    (knob) => params[knob.key] !== DEFAULT_TRADE_PARAMS[knob.key],
  );

  return (
    <Card className="gap-0 py-3">
      <CardContent className="px-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="flex items-center gap-2 text-sm font-medium"
          >
            <SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden />
            Trade math
            <span className="font-mono text-xs text-muted-foreground">
              α {params.alpha.toFixed(2)} · β {params.beta.toFixed(3)} · γ{" "}
              {params.gamma.toFixed(2)}
            </span>
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {modified ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                onChange(DEFAULT_TRADE_PARAMS);
                onCommit?.(DEFAULT_TRADE_PARAMS);
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              Defaults
            </Button>
          ) : null}
        </div>

        {open ? (
          <div className="mt-4 space-y-5">
            {KNOBS.map((knob) => {
              const limits = PARAM_LIMITS[knob.key];

              return (
                <div key={knob.key} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <label
                      htmlFor={`knob-${knob.key}`}
                      className="text-sm font-medium"
                    >
                      <span className="font-mono text-muted-foreground">
                        {knob.symbol}
                      </span>{" "}
                      {knob.label}
                    </label>
                    <span className="font-mono text-sm tabular-nums">
                      {params[knob.key].toFixed(3)}
                    </span>
                  </div>

                  <Slider
                    id={`knob-${knob.key}`}
                    min={limits.min}
                    max={limits.max}
                    step={limits.step}
                    value={[params[knob.key]]}
                    onValueChange={([next]) =>
                      onChange({ ...params, [knob.key]: next })
                    }
                    onValueCommit={([next]) =>
                      onCommit?.({ ...params, [knob.key]: next })
                    }
                  />

                  <p className="text-xs text-muted-foreground">
                    {knob.description}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
