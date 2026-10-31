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
    setName(n) { name = n; return sheet; },
    getLastRow: () => {
      for (let r = data.length; r > 0; r--) if ((data[r - 1] || []).some((v) => v !== '' && v !== undefined && v !== null)) return r;
      return 0;
    },
    getMaxRows: () => Math.max(data.length, 1000),
    getLastColumn: () => data.reduce((m, row) => Math.max(m, (row || []).reduce((k, v, i) => (v !== '' && v !== undefined && v !== null ? i + 1 : k), 0)), 0),
    insertRowsAfter() {},
    hidden: false,
    notes: {},
    hideSheet() { sheet.hidden = true; },
    deleteRow(r) { data.splice(r - 1, 1); writes.push(`${name}!delete R${r}`); },
    deleteRows(r, n) { data.splice(r - 1, n); writes.push(`${name}!delete R${r}x${n}`); },
    getRange(r, c, nr = 1, nc = 1) {
      if (typeof r === 'string') { // "B7" or "A2:C3"
        const [a, b] = r.split(':').map((x) => /^([A-Z]+)(\d+)$/.exec(x));
        const col = (l) => [...l].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
        const r1 = Number(a[2]), c1 = col(a[1]);
        return sheet.getRange(r1, c1, b ? Number(b[2]) - r1 + 1 : 1, b ? col(b[1]) - c1 + 1 : 1);
      }
      const letter = (n) => { let t = ''; while (n) { t = String.fromCharCode(65 + ((n - 1) % 26)) + t; n = Math.floor((n - 1) / 26); } return t; };
      return {
        getA1Notation: () => letter(c) + r + (nr > 1 || nc > 1 ? ':' + letter(c + nc - 1) + (r + nr - 1) : ''),
        setFormula(f) { ensure(r); data[r - 1][c - 1] = f; writes.push(`${name}!R${r}C${c}`); return this; },
        getSheet: () => sheet,
        getRow: () => r,
        getColumn: () => c,
        getNumRows: () => nr,
        getNumColumns: () => nc,
        getLastRow: () => r + nr - 1,
        getLastColumn: () => c + nc - 1,
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
        insertCheckboxes() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { ensure(r + i); if (data[r + i - 1][c + j - 1] === undefined) data[r + i - 1][c + j - 1] = false; } return this; },
        protect() { return ss.addProtection('RANGE', `${name}!R${r}C${c}:R${r + nr - 1}C${c + nc - 1}`); },
        getFormula: () => (isFormula(get(r, c)) ? get(r, c) : ''),
        getNote: () => sheet.notes[`${r},${c}`] || '',
        setNote(n) { if (n) sheet.notes[`${r},${c}`] = n; else delete sheet.notes[`${r},${c}`]; return this; },
      };
    },
    clearContents() { data.length = 0; },
    protect() { return ss.addProtection('SHEET', name); },
    getParent: () => ss,
  };
  return sheet;
}

const MAIN_ID = '1u_f4uTXyrv4T2a6muBKFgKEtH1pjP4xeHekJ03qCRRk';

function makeSpreadsheet(tabs, id = MAIN_ID, title = 'Flipkart - Ganpati Arts One Stop Data Sheet') {
  const writes = [];
  const sheets = [];
  const ss = {
    writes,
    getId: () => id,
    getName: () => title,
    getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    deleteSheet: (sh) => { sheets.splice(sheets.indexOf(sh), 1); writes.push(`delete tab ${sh.getName()}`); },
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n, [], ss, writes); sheets.push(s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata',
    toast() {},
    protections: [],
    addProtection(type, where) {
      const p = { type, where, description: '', warningOnly: false,
        setDescription(d) { p.description = d; return p; }, getDescription: () => p.description,
        setWarningOnly(w) { p.warningOnly = w; return p; },
        remove() { ss.protections.splice(ss.protections.indexOf(p), 1); } };
      ss.protections.push(p);
      return p;
    },
    getProtections: (type) => ss.protections.filter((p) => p.type === type),
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
      // An ID (another spreadsheet) is recorded as is; this spreadsheet's object as true.
      forSpreadsheet: (ss) => { spec.spreadsheet = typeof ss === 'string' ? ss : true; return b; },
      onOpen: () => { spec.onOpen = true; return b; },
      onEdit: () => { spec.onEdit = true; return b; },
      onChange: () => { spec.onChange = true; return b; },
      after: (ms) => { spec.after = ms; return b; },
      everyHours: (n) => { spec.everyHours = n; return b; },
      everyMinutes: (n) => { spec.everyMinutes = n; return b; },
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

/**
 * Google's script lock is shared with every other script in the spreadsheet, so the tracker
 * may only hold it for an instant. This fake counts how often it was taken and lets a test
 * check that it is never left held.
 */
function makeLockService() {
  const state = { held: false, taken: 0 };
  const lock = {
    tryLock: () => { if (state.held) return false; state.held = true; state.taken++; return true; },
    releaseLock: () => { state.held = false; },
  };
  return { state, service: { getScriptLock: () => lock } };
}

/** SpreadsheetApp.openById / create over a set of fake files (the main spreadsheet is always there). */
function makeFiles(main, extra = {}) {
  const files = { [main.getId()]: main, ...extra };
  let n = 0;
  return {
    files,
    openById: (id) => { if (!files[id]) throw new Error('You do not have permission to access the requested document.'); return files[id]; },
    create: (title) => { const f = makeSpreadsheet({ Sheet1: [] }, 'created' + ++n, title); files[f.getId()] = f; return f; },
  };
}

module.exports = { makeFiles, MAIN_ID, makeSheet, makeSpreadsheet, makeScriptApp, makeLockService, Utilities };
