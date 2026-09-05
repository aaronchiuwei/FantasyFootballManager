/**
 * Minimal RFC-4180 CSV parser — quoted fields, escaped quotes, embedded
 * commas/newlines. Two entry points over one scanner:
 *
 * - `parseCsv` materializes every row as an object, which is what a small file
 *   read whole wants (DynastyProcess's crosswalk, 12k rows of ten columns).
 * - `forEachCsvRow` hands each row to a visitor as a raw cell array and keeps
 *   nothing, which is what a large file read for six of its columns wants
 *   (nflverse's weekly stats: 19k rows of 150 columns, 8.6 MB). Building
 *   19,000 objects with 150 keys each to read six of them is most of a
 *   serverless function's heap spent on fields nobody looks at.
 */

/** Scans `text` once, calling `visit(cells)` per row. The header is row zero. */
export function forEachCsvRow(
  text: string,
  visit: (cells: string[], index: number) => void,
): void {
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let index = 0;

  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0] !== "") {
      visit(row, index);
      index += 1;
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) endRow();
}

export function parseCsv(text: string): Record<string, string>[] {
  let header: string[] | null = null;
  const out: Record<string, string>[] = [];

  forEachCsvRow(text, (cells) => {
    if (header === null) {
      header = cells;
      return;
    }
    const columns = header;
    out.push(
      Object.fromEntries(columns.map((key, index) => [key, cells[index] ?? ""])),
    );
  });

  return out;
}
