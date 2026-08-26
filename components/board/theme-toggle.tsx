"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The board exists in two rooms: a lit one and a dim one. Both are the same
 * board, so this switches the fixture rather than inverting the design.
 *
 * Renders a fixed-size placeholder before mount. The theme is unknowable on
 * the server, and a control that changes width when it resolves shifts the
 * whole header rail.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const dark = resolvedTheme === "dark";

  // Every attribute derived from the theme has to wait for mount, the label
  // and the title included. The server cannot know which room this is.
  const label = !mounted
    ? "Switch room lighting"
    : dark
      ? "Switch to the lit room"
      : "Switch to the dim room";

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
    >
      {mounted ? (
        dark ? (
          <SunIcon aria-hidden />
        ) : (
          <MoonIcon aria-hidden />
        )
      ) : (
        <span className="size-3.5" />
      )}
    </Button>
  );
}
