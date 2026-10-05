/**
 * A tiny stand-in for Google Sheets, enough to run the Apps Script files in Node.
 * Every write is recorded in `writes` as "Tab!R<row>C<col>".
 */
function makeSheet(name, rows, ss, writes) {
  const data = rows.map((r) => r.slice());
  const formats = {};
  const ensure = (r) => { while (data.length < r) data.push([]); };
  const get = (r, c) => (data[r - 1] ? data[r - 1][c - 1] : undefined);
  const isFormula = (v) => typeof v === 'string' && v.startsWith('=');
  // What a formula shows: =HYPERLINK("url","label") shows its label; other formulas show nothing.
  const result = (v) => { const m = /^=HYPERLINK\(".*","(.*)"\)$/i.exec(v); return m ? m[1].replace(/""/g, '"') : ''; };
  const shown = (v) => {
    if (v === undefined || v === null) return '';
    if (isFormula(v)) return result(v);
    if (v instanceof Date) { // like Sheets showing a dd-mmm-yyyy date (in IST)
      const d = new Date(v.getTime() + 330 * 60000);
      return `${d.getUTCDate()}-${'JanFebMarAprMayJunJulAugSepOctNovDec'.substr(d.getUTCMonth() * 3, 3)}-${d.getUTCFullYear()}`;
    }
    return String(v);
  };
  const sheet = {
    data, formats,
    getName: () => name,
    getLastRow: () => {
      for (let r = data.length; r > 0; r--) if ((data[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
      return 0;
    },
    getMaxRows: () => Math.max(data.length, 1000),
    getLastColumn: () => data.reduce((m, row) => Math.max(m, (row || []).reduce((k, v, i) => (v !== '' && v !== undefined && v !== null ? i + 1 : k), 0)), 0),
    insertRowsAfter() {},
    deleteRow(r) { data.splice(r - 1, 1); writes.push(`${name}!delete R${r}`); },
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getSheet: () => sheet,
        getRow: () => r,
        getColumn: () => c,
        getNumRows: () => nr,
        getNumColumns: () => nc,
        getLastRow: () => r + nr - 1,
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (isFormula(get(r + i, c + j)) ? result(get(r + i, c + j)) : get(r + i, c + j) ?? ''))),
        getDisplayValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => shown(get(r + i, c + j)))),
        // A string starting with "=" is treated as a formula that shows nothing.
        getFormulas: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (isFormula(get(r + i, c + j)) ? get(r + i, c + j) : ''))),
        getNumberFormats: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => formats[`${r + i},${c + j}`] || '')),
        setNumberFormats(f) { f.forEach((row, i) => row.forEach((x, j) => { formats[`${r + i},${c + j}`] = x; })); return this; },
        getDisplayValue: () => shown(get(r, c)),
        setValues(v) {
          v.forEach((row, i) => row.forEach((x, j) => { ensure(r + i); data[r + i - 1][c + j - 1] = x; writes.push(`${name}!R${r + i}C${c + j}`); }));
          return this;
        },
        setValue(x) { ensure(r); data[r - 1][c - 1] = x; writes.push(`${name}!R${r}C${c}`); return this; },
        setNumberFormat(f) { formats[`${r},${c}`] = f; return this; },
        setFontWeight() { return this; },
      };
    },
    clearContents() { data.length = 0; },
    getParent: () => ss,
  };
  return sheet;
}

function makeSpreadsheet(tabs) {
  const writes = [];
  const sheets = [];
  const ss = {
    writes,
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n, [], ss, writes); sheets.push(s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata',
    toast() {},
  };
  Object.entries(tabs).forEach(([n, rows]) => sheets.push(makeSheet(n, rows, ss, writes)));
  return ss;
}

/** Records every trigger builder call, e.g. { handler, everyDays: 1, atHour: 8, ... }. */
function makeScriptApp(triggers) {
  const newTrigger = (handler) => {
    const spec = { handler };
    const b = {
      timeBased: () => b,
      forSpreadsheet: () => { spec.spreadsheet = true; return b; },
      onOpen: () => { spec.onOpen = true; return b; },
      onEdit: () => { spec.onEdit = true; return b; },
      after: (ms) => { spec.after = ms; return b; },
      everyHours: (n) => { spec.everyHours = n; return b; },
      everyDays: (n) => { spec.everyDays = n; return b; },
      atHour: (h) => { spec.atHour = h; return b; },
      nearMinute: (m) => { spec.nearMinute = m; return b; },
      inTimezone: (tz) => { spec.tz = tz; return b; },
      create: () => { triggers.push({ ...spec, getHandlerFunction: () => handler }); return b; },
    };
    return b;
  };
  return {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger,
  };
}

// Asia/Kolkata only, enough for the tests.
const Utilities = {
  formatDate: (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10),
  parseDate: (s) => new Date(Date.parse(s + 'T00:00:00+05:30')),
};

module.exports = { makeSheet, makeSpreadsheet, makeScriptApp, Utilities };
