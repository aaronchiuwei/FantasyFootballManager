import type { Metadata } from "next";
import { Archivo, Archivo_Narrow } from "next/font/google";

import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/**
 * Two faces, both from the same signage-and-equipment lineage.
 *
 * Archivo is the board's speaking voice: a sturdy, high-x-height grotesque
 * with real tabular figures, which is the whole requirement for a product
 * whose substance is columns of numbers.
 *
 * Archivo Narrow is the engraving voice. Every stencilled rail label, plate
 * name and stamped code is set in it, tracked out, in caps, the way a name
 * plate comes off an engraving machine.
 */
const archivo = Archivo({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const archivoNarrow = Archivo_Narrow({
  variable: "--font-plate",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Fantasy Football Manager",
    template: "%s · Fantasy Football Manager",
  },
  description:
    "Yahoo fantasy football league companion: real player values, trade analysis, and waiver recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${archivo.variable} ${archivoNarrow.variable} antialiased`}
        style={{ "--font-mono": "var(--font-plate)" } as React.CSSProperties}
      >
        {/*
          THESIS: This product is about moving players between teams, so the
          interface is the draft-day war room board where that physically
          happens. It refuses the arrangement this category always ships: a
          dark dashboard of rounded cards, a neon accent, and a sidebar.

          OWN-WORLD: A dim room and a lit enamelled steel board, ruled into
          extruded aluminium channel rails. Players are engraved bone laminate
          plates with a position-coloured core, seated in those rails. Grease
          pencil amber is the only accent and the whole annotation layer. Every
          corner is a 2px machined chamfer. Archivo speaks, Archivo Narrow
          engraves.

          STORY: The manager sees their board, reads a value off a drawn scale
          without hovering anything, and gets one imperative sentence back
          about whether a trade is worth taking.

          FIRST VIEWPORT: A stencilled rail across the top carrying league,
          team and week; content banded edge to edge below it on one column
          grid; no floating cards. Bone means a player you can move, and
          nothing else on the board is bone.

          FORM: The War Room Board, rank 1 of 7 grounded candidates, taken as
          the pick card over the assigned roll. Seed key 6856a5d2.

          FINISH: unreviewed and undocumented is unfinished; this build ends
          with the finish review, the verdict, DESIGN.md, and every shipping
          raster carrying its provenance.
        */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
