import { initials, isTeamLogo } from "@/lib/players/headshot";
import { cn } from "@/lib/utils";

/**
 * PORTRAIT — the player's face, set into the board's own materials.
 *
 * The design language's one rule is that bone means a player, so a photograph
 * of a player belongs on the plate rather than floating beside it. It is cut
 * square to the same 2px corner as everything else: this world has no pills,
 * and a circular avatar would be the only round object on the wall.
 *
 * **The white field.** Sleeper serves a 350x254 photograph of a cut-out player
 * standing on solid white. On a plate that white reads as a second material
 * laid over the laminate, which is the one thing this world does not do. So on
 * a plate the portrait is composited with `multiply`: white is the identity
 * for that operation, so the field disappears into the bone exactly and the
 * face is left printed on the plate with no tile and no frame around it. On
 * the board there is no light material to multiply into, so the portrait keeps
 * its bone tile and reads as the ID photo laminated onto the wall — which is
 * what it is. A team logo is a transparent PNG rather than a cut-out on white,
 * so it is never blended: multiply would eat the white in the mark itself.
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
  sm: "size-8 text-[0.625rem]",
  md: "size-10 text-xs",
  lg: "size-20 text-2xl",
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
  const onPlate = tone === "plate";
  const blend = onPlate && !isTeamLogo(src);

  return (
    <span
      data-slot="player-headshot"
      aria-hidden
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xs",
        // On the board the tile is bone in both rooms whether or not the
        // picture ever arrives, so the photo's own white field and the
        // fallback mark are the same material. On a plate the laminate is
        // already that material, so there is no tile to cut.
        onPlate
          ? "bg-transparent"
          : "bg-plate shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--plate-edge)_45%,transparent)]",
        SIZES[size],
        className,
      )}
    >
      <span className="stencil absolute inset-0 grid place-items-center text-plate-ink/45">
        {initials(name)}
      </span>

      {src ? (
        // A remote CDN portrait at 32-80px gains nothing from the optimizer,
        // and routing it through one would cost a `remotePatterns` allowance
        // plus a server round trip per player on a two-hundred-row board.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "relative size-full object-cover",
            // The head sits in the top half of Sleeper's frame, so a square
            // crop taken from the centre cuts the crown off.
            "object-top",
            blend && "mix-blend-multiply",
          )}
        />
      ) : null}
    </span>
  );
}
