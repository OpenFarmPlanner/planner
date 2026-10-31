import { strToU8, unzipSync, zipSync } from 'fflate';
import type { SpreadsheetCell, SpreadsheetFormat, SpreadsheetRows } from './spreadsheetTypes';

export type { SpreadsheetCell, SpreadsheetRows } from './spreadsheetTypes';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function encodeUtf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseXml(xml: string): Document {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid spreadsheet XML.');
  }
  return document;
}

function getAttr(element: Element, name: string, namespace?: string): string | null {
  return namespace ? element.getAttributeNS(namespace, name) : element.getAttribute(name);
}

function getElements(element: Document | Element, localName: string): Element[] {
  return Array.from(element.getElementsByTagNameNS('*', localName));
}

function columnNameToIndex(columnName: string): number {
  return columnName
    .toUpperCase()
    .split('')
    .reduce((result, char) => result * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function columnIndexToName(index: number): string {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellRefToColumnIndex(cellRef: string | null): number | null {
  if (!cellRef) {
    return null;
  }
  const match = /^([A-Za-z]+)/.exec(cellRef);
  return match ? columnNameToIndex(match[1]) : null;
}

function normalizeZipPath(basePath: string, targetPath: string): string {
  if (targetPath.startsWith('/')) {
    return targetPath.slice(1);
  }
  const parts = `${basePath}/${targetPath}`.split('/');
  const normalized: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
}

// One pass over the whole text, not line by line: a quoted cell may contain
// line breaks (multi-line notes, one neighbour per line).
function parseCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      record.push(value);
      value = '';
      continue;
    }
    if (char === '\n' && !quoted) {
      record.push(value);
      records.push(record);
      record = [];
      value = '';
      continue;
    }
    value += char;
  }

  record.push(value);
  records.push(record);
  return records;
}

function parseCsv(text: string): SpreadsheetRows {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = normalized.split('\n', 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  return parseCsvRecords(normalized, delimiter)
    .filter((record) => record.some((cell) => cell.trim().length > 0));
}

function formatCsvValue(value: SpreadsheetCell): string {
  if (value === null) {
    return '';
  }
  const text = typeof value === 'boolean' ? (value ? 'ja' : 'nein') : String(value);
  return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(rows: SpreadsheetRows): string {
  return rows.map((row) => row.map(formatCsvValue).join(',')).join('\r\n');
}

function parseSharedStrings(files: Record<string, Uint8Array>): string[] {
  const sharedStringsFile = files['xl/sharedStrings.xml'];
  if (!sharedStringsFile) {
    return [];
  }
  const document = parseXml(decodeUtf8(sharedStringsFile));
  return getElements(document, 'si').map((item) => (
    getElements(item, 't').map((textNode) => textNode.textContent ?? '').join('')
  ));
}

function resolveFirstWorksheetPath(files: Record<string, Uint8Array>): string {
  const workbookFile = files['xl/workbook.xml'];
  const relsFile = files['xl/_rels/workbook.xml.rels'];
  if (!workbookFile || !relsFile) {
    return 'xl/worksheets/sheet1.xml';
  }

  const workbook = parseXml(decodeUtf8(workbookFile));
  const rels = parseXml(decodeUtf8(relsFile));
  const firstSheet = getElements(workbook, 'sheet')[0];
  const relationId = firstSheet?.getAttribute('r:id') ?? firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  if (!relationId) {
    return 'xl/worksheets/sheet1.xml';
  }

  const relationship = getElements(rels, 'Relationship').find((entry) => entry.getAttribute('Id') === relationId);
  const target = relationship?.getAttribute('Target');
  return target ? normalizeZipPath('xl', target) : 'xl/worksheets/sheet1.xml';
}

function parseXlsxCell(cell: Element, sharedStrings: string[]): SpreadsheetCell {
  const type = cell.getAttribute('t');
  if (type === 'inlineStr') {
    return getElements(cell, 't').map((textNode) => textNode.textContent ?? '').join('');
  }

  const rawValue = getElements(cell, 'v')[0]?.textContent ?? '';
  if (rawValue === '') {
    return null;
  }
  if (type === 's') {
    return sharedStrings[Number(rawValue)] ?? '';
  }
  if (type === 'b') {
    return rawValue === '1';
  }
  const numericValue = Number(rawValue);
  return Number.isFinite(numericValue) ? numericValue : rawValue;
}

function parseXlsx(buffer: ArrayBuffer): SpreadsheetRows {
  const files = unzipSync(new Uint8Array(buffer));
  const worksheetFile = files[resolveFirstWorksheetPath(files)];
  if (!worksheetFile) {
    return [];
  }

  const sharedStrings = parseSharedStrings(files);
  const worksheet = parseXml(decodeUtf8(worksheetFile));
  return getElements(worksheet, 'row').map((rowElement) => {
    const row: SpreadsheetCell[] = [];
    let fallbackColumnIndex = 0;
    for (const cell of getElements(rowElement, 'c')) {
      const columnIndex = cellRefToColumnIndex(cell.getAttribute('r')) ?? fallbackColumnIndex;
      while (row.length < columnIndex) {
        row.push(null);
      }
      row[columnIndex] = parseXlsxCell(cell, sharedStrings);
      fallbackColumnIndex = columnIndex + 1;
    }
    return row;
  });
}

function getRepeatedCount(element: Element, localName: string): number {
  const value = getAttr(element, localName, 'urn:oasis:names:tc:opendocument:xmlns:table:1.0')
    ?? element.getAttribute(`table:${localName}`);
  const count = value ? Number.parseInt(value, 10) : 1;
  return Number.isFinite(count) && count > 0 ? Math.min(count, 10_000) : 1;
}

function parseOdsCell(cell: Element): SpreadsheetCell {
  const valueType = getAttr(cell, 'value-type', 'urn:oasis:names:tc:opendocument:xmlns:office:1.0')
    ?? cell.getAttribute('office:value-type');
  if (valueType === 'float' || valueType === 'currency' || valueType === 'percentage') {
    const raw = getAttr(cell, 'value', 'urn:oasis:names:tc:opendocument:xmlns:office:1.0') ?? cell.getAttribute('office:value');
    const numericValue = raw === null ? NaN : Number(raw);
    return Number.isFinite(numericValue) ? numericValue : null;
  }
  if (valueType === 'boolean') {
    const raw = getAttr(cell, 'boolean-value', 'urn:oasis:names:tc:opendocument:xmlns:office:1.0') ?? cell.getAttribute('office:boolean-value');
    return raw === 'true';
  }
  return getElements(cell, 'p').map((paragraph) => paragraph.textContent ?? '').join('\n') || null;
}

function parseOds(buffer: ArrayBuffer): SpreadsheetRows {
  const files = unzipSync(new Uint8Array(buffer));
  const contentFile = files['content.xml'];
  if (!contentFile) {
    return [];
  }

  const document = parseXml(decodeUtf8(contentFile));
  const table = getElements(document, 'table')[0];
  if (!table) {
    return [];
  }

  const rows: SpreadsheetRows = [];
  for (const rowElement of getElements(table, 'table-row')) {
    const row: SpreadsheetCell[] = [];
    for (const cell of getElements(rowElement, 'table-cell')) {
      const repeatedCells = getRepeatedCount(cell, 'number-columns-repeated');
      const value = parseOdsCell(cell);
      for (let index = 0; index < repeatedCells; index++) {
        row.push(value);
      }
    }
    const repeatedRows = getRepeatedCount(rowElement, 'number-rows-repeated');
    for (let index = 0; index < repeatedRows; index++) {
      rows.push([...row]);
    }
  }
  return rows.filter((row) => row.some((cell) => cell !== null && cell !== ''));
}

// Column widths in characters: fitted to the longest cell (header included),
// but capped so one long note does not make a column screen-wide.
const MIN_COLUMN_WIDTH = 6;
const MAX_COLUMN_WIDTH = 50;
const COLUMN_PADDING = 2;
// An average character at the default 11pt font, for ODS lengths.
const CENTIMETERS_PER_CHARACTER = 0.2;

function cellDisplayLength(value: SpreadsheetCell): number {
  if (value === null) {
    return 0;
  }
  const text = typeof value === 'boolean' ? (value ? 'ja' : 'nein') : String(value);
  return Math.max(...text.split('\n').map((line) => line.length));
}

export function computeColumnWidths(rows: SpreadsheetRows): number[] {
  const columnCount = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: columnCount }, (_, columnIndex) => {
    const longest = Math.max(0, ...rows.map((row) => cellDisplayLength(row[columnIndex] ?? null)));
    return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, longest + COLUMN_PADDING));
  });
}

function xlsxColumnsXml(rows: SpreadsheetRows): string {
  const columns = computeColumnWidths(rows).map((width, index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`
  )).join('');
  return columns ? `<cols>${columns}</cols>` : '';
}

function xlsxCellXml(value: SpreadsheetCell, rowIndex: number, columnIndex: number): string {
  if (value === null) {
    return '';
  }
  const reference = `${columnIndexToName(columnIndex)}${rowIndex + 1}`;
  if (typeof value === 'number') {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  }
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function buildXlsx(rows: SpreadsheetRows): Uint8Array {
  const sheetRows = rows.map((row, rowIndex) => (
    `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => xlsxCellXml(value, rowIndex, columnIndex)).join('')}</row>`
  )).join('');
  const sheetXml = `${XML_DECLARATION}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${xlsxColumnsXml(rows)}<sheetData>${sheetRows}</sheetData></worksheet>`;

  return zipSync({
    '[Content_Types].xml': encodeUtf8(`${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    '_rels/.rels': encodeUtf8(`${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': encodeUtf8(`${XML_DECLARATION}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Kulturen" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': encodeUtf8(`${XML_DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    'xl/worksheets/sheet1.xml': encodeUtf8(sheetXml),
  });
}

function odsCellXml(value: SpreadsheetCell): string {
  if (value === null) {
    return '<table:table-cell/>';
  }
  if (typeof value === 'number') {
    return `<table:table-cell office:value-type="float" office:value="${value}"><text:p>${value}</text:p></table:table-cell>`;
  }
  if (typeof value === 'boolean') {
    return `<table:table-cell office:value-type="boolean" office:boolean-value="${value ? 'true' : 'false'}"><text:p>${value ? 'ja' : 'nein'}</text:p></table:table-cell>`;
  }
  return `<table:table-cell office:value-type="string"><text:p>${escapeXml(value)}</text:p></table:table-cell>`;
}

function odsColumnsXml(rows: SpreadsheetRows): { styles: string; columns: string } {
  const widths = computeColumnWidths(rows);
  const styles = widths.map((width, index) => (
    `<style:style style:name="co${index + 1}" style:family="table-column">`
    + `<style:table-column-properties style:column-width="${(width * CENTIMETERS_PER_CHARACTER).toFixed(2)}cm"/>`
    + '</style:style>'
  )).join('');
  const columns = widths.map((_, index) => `<table:table-column table:style-name="co${index + 1}"/>`).join('');
  return { styles, columns };
}

function buildOds(rows: SpreadsheetRows): Uint8Array {
  const { styles: columnStyles, columns: tableColumns } = odsColumnsXml(rows);
  const tableRows = rows.map((row) => (
    `<table:table-row>${row.map(odsCellXml).join('')}</table:table-row>`
  )).join('');
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2"><office:automatic-styles>${columnStyles}</office:automatic-styles><office:body><office:spreadsheet><table:table table:name="Kulturen">${tableColumns}${tableRows}</table:table></office:spreadsheet></office:body></office:document-content>`;
  return zipSync({
    mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
    'META-INF/manifest.xml': encodeUtf8('<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
    'content.xml': encodeUtf8(contentXml),
  });
}

export function parseSpreadsheetRows(buffer: ArrayBuffer, format: SpreadsheetFormat): SpreadsheetRows {
  if (format === 'csv') {
    return parseCsv(decodeUtf8(new Uint8Array(buffer)));
  }
  if (format === 'ods') {
    return parseOds(buffer);
  }
  return parseXlsx(buffer);
}

export function buildSpreadsheetFile(rows: SpreadsheetRows, format: SpreadsheetFormat): Uint8Array | string {
  if (format === 'csv') {
    return buildCsv(rows);
  }
  if (format === 'ods') {
    return buildOds(rows);
  }
  return buildXlsx(rows);
}
