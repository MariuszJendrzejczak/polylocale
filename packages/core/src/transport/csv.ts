/**
 * CSV transport for translator handoff.
 *
 * CSV is *not* a `SupportedFormat` — it's a transport over the existing
 * `LocalizationProject` model used when a project leaves the app for a
 * human translator and comes back. Round-trip is defined on rendered cell
 * text, not on IR.
 *
 * Sheet shape: `key | description | <locale 1> | <locale 2> | …`. The
 * service layer in `apps/app` decides which CSV columns map to which
 * project locale; this module is format-agnostic and stays pure.
 *
 * Line endings: CRLF on export (RFC 4180). Both CRLF and bare LF are
 * accepted on import.
 */

import { renderICU } from '../icu/render.js';
import type { LocalizationProject } from '../model/types.js';

export interface CsvRow {
  readonly key: string;
  readonly description?: string;
  /**
   * Header text → cell text. The verbatim header is preserved as the map
   * key; the service decides which columns are project locales and which
   * are extras.
   */
  readonly values: Readonly<Record<string, string>>;
}

const CRLF = '\r\n';

export function exportProjectToCsv(project: LocalizationProject): string {
  const locales = project.locales;
  const header = ['key', 'description', ...locales].map(quoteIfNeeded).join(',');

  const lines: string[] = [header];
  for (const key of project.keys) {
    const cells: string[] = [key.path, key.description ?? ''];
    for (const locale of locales) {
      const value = key.values[locale];
      if (value === undefined) {
        cells.push('');
      } else {
        cells.push(value.raw ?? renderICU(value.ir));
      }
    }
    lines.push(cells.map(quoteIfNeeded).join(','));
  }
  return lines.join(CRLF) + CRLF;
}

export function parseCsvRows(text: string): readonly CsvRow[] {
  if (text === '') throw new CsvParseError('empty CSV input');
  const records = tokenize(text);
  if (records.length === 0) throw new CsvParseError('CSV has no header row');

  const header = records[0]!;
  validateHeader(header);

  const keyIndex = header.indexOf('key');
  const descriptionIndex = header.indexOf('description');

  // Trailing blank records (the file ends in one or more lone `\r\n`s) are
  // tolerated; a blank record in the *middle* of the body is malformed.
  let end = records.length;
  while (end > 1 && isBlankRecord(records[end - 1]!)) end--;

  const rows: CsvRow[] = [];
  for (let r = 1; r < end; r++) {
    const record = records[r]!;
    if (isBlankRecord(record)) {
      throw new CsvParseError(`row ${r + 1}: blank line inside CSV body`);
    }
    const key = record[keyIndex] ?? '';
    if (key === '') {
      throw new CsvParseError(`row ${r + 1}: empty key column`);
    }
    const values: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      if (c === keyIndex || c === descriptionIndex) continue;
      const column = header[c]!;
      values[column] = record[c] ?? '';
    }
    const row: CsvRow = {
      key,
      values,
      ...(descriptionIndex !== -1 && (record[descriptionIndex] ?? '') !== ''
        ? { description: record[descriptionIndex]! }
        : {}),
    };
    rows.push(row);
  }
  return rows;
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvParseError';
  }
}

function isBlankRecord(record: readonly string[]): boolean {
  return record.length === 0 || record.every((c) => c === '');
}

function validateHeader(header: readonly string[]): void {
  const seen = new Set<string>();
  for (const col of header) {
    if (col === '') throw new CsvParseError('header has an empty column');
    if (seen.has(col)) throw new CsvParseError(`header has duplicate column "${col}"`);
    seen.add(col);
  }
  if (!header.includes('key')) {
    throw new CsvParseError('header is missing the required "key" column');
  }
}

/**
 * RFC 4180 tokenizer. Walks the input character-by-character; tracks
 * whether we're inside a quoted field. A double quote inside a quoted
 * field escapes itself (`""` → `"`). CR, LF, and CRLF all end a record
 * when seen outside a quoted field.
 */
function tokenize(text: string): readonly (readonly string[])[] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let fieldHasContent = false;

  while (i < text.length) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (fieldHasContent) {
        throw new CsvParseError(`unexpected quote in unquoted field at position ${i}`);
      }
      inQuotes = true;
      fieldHasContent = true;
      i++;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      fieldHasContent = false;
      i++;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      fieldHasContent = false;
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i++;
      continue;
    }
    field += ch;
    fieldHasContent = true;
    i++;
  }

  if (inQuotes) {
    throw new CsvParseError('unterminated quoted field');
  }

  // Flush trailing field — even an empty one, because `a,` ends in an
  // empty cell. We only skip the flush when the file ends cleanly on a
  // newline (record was already pushed and the next record hasn't started).
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records;
}

function quoteIfNeeded(value: string): string {
  if (value === '') return '';
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
