/** Spreadsheet formats supported by crop import and export. */
export type SpreadsheetFormat = 'xlsx' | 'ods' | 'csv';

/** A scalar value that can be represented in a spreadsheet cell. */
export type SpreadsheetCell = string | number | boolean | null;

/** Tabular spreadsheet content, represented as rows of scalar cells. */
export type SpreadsheetRows = SpreadsheetCell[][];
