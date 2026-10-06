/**
 * Minimal CSV writing for "export what I can see" features. Values are quoted
 * only when they need it, and a BOM is prepended so Excel reads the file as
 * UTF-8 rather than mangling accented names.
 */

export interface CsvColumn<T> {
  key: string;
  label: string;
  value: (row: T) => unknown;
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => cell(c.value(row))).join(","));
  return [header, ...body].join("\r\n");
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "2026-10-06" — a stamp that sorts correctly inside a spreadsheet. */
export function fileStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
