# Design

<!-- impeccable:design-schema 1 -->

The visual world is **The War Room Board**: a draft-day board wall, ruled into
aluminium channel rails, holding engraved laminate name plates that get moved by
hand, annotated in grease pencil. It was chosen over six other grounded
candidates and over the roll's assignment, and it replaced the previous
emerald-shadcn theme outright.

This file describes what is in the code, not what was intended.

## The four materials

Everything on screen is exactly one of these. The rule that keeps it legible:
**bone means a player, and nothing else is bone.**

| Material | What it is | Tokens |
|---|---|---|
| **Board** | The enamelled steel wall. The ground, always recessive. | `--board`, `--board-deep`, `--board-panel` |
| **Channel** | The extruded aluminium rail a row of plates seats into. | `--channel`, `--channel-lip` |
| **Plate** | An engraved laminate name plate. **A player.** | `--plate`, `--plate-ink`, `--plate-edge` |
| **Grease** | The grease pencil: the single accent and the whole annotation layer. | `--grease`, `--grease-ink` |

Plus `--chalk` / `--chalk-dim` for text written on the board, and `--strike` for
the one red the system has.

## Two rooms, not an inversion

Dark is the primary scene (a dim room, the board lit from a fixture above it);
light is the same board in daylight. The board stays the recessive plane and the
plate stays the advancing one in **both**, so hierarchy reads identically. The
light values are not a washed inversion of the dark ones; both are authored.

`--pos-ink` and the `--source-*-plate` tokens exist because a plate is bone in
both rooms: anything struck into a plate keeps its dark-ink pairing regardless
of theme, while the same information written on the board follows the theme.

## Shape and type

- **One corner language.** `--radius: 2px`, and the whole radius scale collapses
  to 1 to 4px. Everything is machined aluminium or cut laminate; there are no
  pills and no soft cards anywhere.
- **Archivo** is the speaking voice (grotesque, real tabular figures).
- **Archivo Narrow** is `--font-plate`: every stencilled label, plate name,
  button, badge and chip. Caps, tracked out, the way an engraving machine cuts.
- Numbers are measurements: `table` and `[data-numeric]` get `tabular-nums`
  globally.

## Components

`components/board/` holds the world's primitives:

- **`Rail` / `RailLine` / `EmptySeat`** (`rail.tsx`) - the containing device.
  A rail always names itself on its end cap. `EmptySeat` is a real state: the
  board shows the gap where a plate is not.
- **`Plate` / `PlateCore` / `PlateName` / `PlateMeta` / `PlateValue` /
  `PlateBody`** (`plate.tsx`) - the player. `PlateCore` is the cut-through
  position field, deliberately a filled colour block rather than an accent edge
  stripe.
- **`Panel` / `Stencil` / `GreaseNote`** (`panel.tsx`) - a region of the board:
  stencilled head, ruled hairline, space. No box. `inset` is the one exception,
  for something that genuinely reads as recessed.
- **`ScaleBar` / `DeltaScale`** (`scale.tsx`) - every bar in the app sits on a
  drawn, divided, labelled scale with its unit stated, so magnitude is readable
  by counting rather than hovering.
- **`BoardNav`**, **`ThemeToggle`**.

`components/ui/` keeps the shadcn API and replaces what it renders. `Card` is
now a **recessed region of the board**, not a floating card, which is what makes
nesting one inside another visibly wrong.

CSS component classes in `globals.css`: `.rail`, `.rail-line`, `.plate`,
`.plate-liftable`, `.engraved`, `.stencil`, `.grease-mark`, `.grease-underline`,
`.chip` / `.chip-on` / `.chip-off`, `.thead-rail`, `.graticule`.

## Motion

Three speeds and three curves, all in `globals.css`. Nothing uses a bare CSS
easing keyword.

| Token | Value | For |
|---|---|---|
| `--motion-fast` | 140ms | State feedback: hover, a plate lifting under a press. |
| `--motion-base` | 240ms | An element arriving or being replaced. |
| `--motion-slow` | 680ms | The two animations that **are** information: the beam tipping to its verdict, and a bar filling to a value. |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Entrances and exits. |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Something on screen moving. |
| `--ease-seat` | `cubic-bezier(0.32, 0.72, 0, 1)` | The signature: a plate dropping into its channel. |

The signature interaction is **the seat**: `.plate-liftable` raises 2px on
hover (gated behind `(hover: hover) and (pointer: fine)`, so a tap on a phone
does not leave a plate stuck up) and drops back on press, with the shadow
tracking the lift. `.animate-seat` and `.stagger-seat` give a surface one
authored entrance, not one per section.

`prefers-reduced-motion` is honoured globally, with a single documented
exemption for spinners: a frozen progress indicator is a lie about whether work
is still happening.

## The beam

`components/trade/balance-beam.tsx` is the product's signature reading. It is a
machined instrument: an aluminium bar with a lit top edge on a milled fulcrum,
with trays that are short sections of the same channel every rail uses. The
heavier side goes down; the trays hang level.

Under it is the **band ruler**, which is new information rather than decoration:
the app's own fairness thresholds converted from margin into beam travel, so the
reader can see how much room is left before the verdict changes its mind. "Clear
winner, nearly lopsided" and "clear winner, barely" print the same word without
it.

## Standing rules

- Colour never carries meaning alone. The provenance stamp always prints its
  word; the needs chip always prints its sign.
- Every region of the board carries an always-on stencilled identifier.
  Wayfinding is reading, not inference.
- Browser surfaces are themed from the palette: selection, caret, scrollbar,
  focus ring, underline offset.
- No `background-attachment: fixed`. It repaints the whole background on every
  scroll frame, which the values board and waiver wire cannot afford on a phone.
- No em-dash in any user-visible string.
