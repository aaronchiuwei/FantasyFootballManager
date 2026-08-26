import { initials } from "@/lib/players/headshot";
import { cn } from "@/lib/utils";

/**
 * PORTRAIT — the player's face, set into the board's own materials.
 *
 * The design language's one rule is that bone means a player, so a photograph
 * of a player belongs on the plate rather than floating beside it. It is cut
 * square to the same 2px corner as everything else: this world has no pills,
 * and a circular avatar would be the only round object on the wall. Read it as
 * the ID photo laminated into the plate, which is exactly what it is.
 *
 * **No JavaScript.** A picture that needed a client component would put two
 * hundred of them on the values board to do nothing but catch a 404. Instead
 * the fallback mark is rendered underneath and the image sits on top of it: a
 * portrait Sleeper does not have fails to paint, `alt=""` keeps the browser
 * from drawing a broken-image glyph in its place, and the initials that were
 * always there show through. Nothing has to notice the failure for the right
 * thing to be on screen.
 */

const SIZES = {
  sm: "size-6 text-[0.5rem]",
  md: "size-8 text-[0.625rem]",
  lg: "size-16 text-lg",
} as const;

export type HeadshotSize = keyof typeof SIZES;

export function PlayerHeadshot({
  src,
  name,
  size = "md",
  tone = "board",
  className,
}: {
  /** `players.headshot_url`, or null when the master has no picture. */
  src?: string | null;
  /** Only for the fallback mark: the image itself is decorative (`alt=""`). */
  name: string;
  size?: HeadshotSize;
  /** Which material the portrait is set into, so its edge reads correctly. */
  tone?: "board" | "plate";
  className?: string;
}) {
  return (
    <span
      data-slot="player-headshot"
      aria-hidden
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xs",
        // Sleeper's headshots are cut out onto a white field, so the tile is
        // bone in both rooms whether or not the picture ever arrives -- the
        // photo's own background and the fallback are then the same material.
        "bg-plate",
        tone === "plate"
          ? "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--plate-edge)_70%,transparent)]"
          : "shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--plate-edge)_45%,transparent)]",
        SIZES[size],
        className,
      )}
    >
      <span className="stencil absolute inset-0 grid place-items-center text-plate-ink/45">
        {initials(name)}
      </span>

      {src ? (
        // A remote CDN portrait at 24-64px gains nothing from the optimizer,
        // and routing it through one would cost a `remotePatterns` allowance
        // plus a server round trip per player on a two-hundred-row board.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="relative size-full object-cover"
        />
      ) : null}
    </span>
  );
}
