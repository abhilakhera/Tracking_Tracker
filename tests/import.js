/**
 * Tests for the tracking import (seller team's spreadsheet → "Raw Order Tracking").
 * Run with:  node tests/import.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { makeSpreadsheet, makeScriptApp, makeLockService, Utilities } = require('./fake-sheet');

const FILES = ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Sync.gs', 'Fsn.gs', 'Import.gs', 'Main.gs'];

function load(sourceTabs, ourTabs, opts = {}) {
  const source = makeSpreadsheet(sourceTabs);
  const ours = makeSpreadsheet(ourTabs);
  const props = {};
  const toasts = [];
  const triggers = [];
  ours.toast = (m) => toasts.push(m);
  const ctx = vm.createContext({
    console: { log() {}, error() {} },
    SpreadsheetApp: {
      // In a trigger on the seller team's spreadsheet, the "active" spreadsheet is THEIRS.
      getActiveSpreadsheet: () => (opts.activeIsSource ? source : ours),
      openById: (id) => {
        if (id === '1u_f4uTXyrv4T2a6muBKFgKEtH1pjP4xeHekJ03qCRRk') return ours;
        if (opts.noAccess || id !== '1hI8DpYwC0i3YQsDUIexzj_IWb2-6OyE476B89HKgAp8') throw new Error('You do not have permission to access the requested document.');
        return source;
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: makeLockService().service,
    ScriptApp: makeScriptApp(triggers),
    UrlFetchApp: { fetch: () => { throw new Error('no API calls'); } },
    Utilities,
  });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  return { source, ours, props, toasts, triggers, run: (code) => vm.runInContext(code, ctx), raw: () => ours.getSheetByName('Raw Order Tracking') };
}

let passed = 0;
function scenario(name, fn) { fn(); passed++; console.log('Scenario ' + passed + ' (' + name + '): OK'); }

const sourceTabs = () => ({
  // Headings in row 1, misspelled; extra columns around them.
  'Sept': [
    ['S.No', 'Oder Id', 'Tracking  No.', 'Transporter', 'Date'],
    [1, 'OD338718828900872100', '42387010178824', 'delhivary', '21-Sep'],
    [2, 'OD438797615469450100', '100041695709', 'Safe Express', '22-Sep'],
    [3, 'OD438797615469450100', '100041695709', 'SAFEXPRESS ', '22-Sep'],  // same after correction → once
    [4, '', '', '', ''],                                                    // empty row
    [5, 'OD111', '1846272584', 'dp world', ''],
    [6, 'OD112', 'X1', 'BNG', ''],                                          // other courier: copied as typed
    ['S.No', 'ORDER ID', 'TRACKING ID', 'TRANSPORT', ''],                   // heading repeated mid-sheet
  ],
  // Title rows above the headings; different column order; "Order Item ID" must not be taken as Order ID.
  'Oct 2026': [
    ['GANPATI ARTS – OCTOBER DISPATCH', '', '', ''],
    ['', '', '', ''],
    ['TRANSPORT', 'Order Item ID', 'order id', 'TRACKING ID'],
    ['Delhivery Surface', '338700000000000100', 'OD222', '42387010179001'],
    ['DPWORLD', '338700000000000200', 'OD223', '1846272999'],
    ['Delhivery', '338700000000000300', 'OD224', ''],                       // no tracking yet → still copied
  ],
  'Notes': [['Some notes'], ['nothing here']],                               // no headings → skipped
});
const target = () => ({ 'Raw Order Tracking': [['Order ID', ' Tracking ID', 'Courier Name', 'Note'], ['OLD', 'OLD', 'OLD', 'keep me']] });

scenario('reads every tab, finds misspelled headings anywhere, corrects courier names, no duplicates', () => {
  const t = load(sourceTabs(), target());
  const msg = t.run('CT_runImport_()');
  const rows = t.raw().data.slice(1).map((r) => r.slice(0, 3));
  assert.deepStrictEqual(rows, [
    ['OD338718828900872100', '42387010178824', 'Delhivery'],
    ['OD438797615469450100', '100041695709', 'Safexpress'],
    ['OD111', '1846272584', 'DP World'],
    ['OD112', 'X1', 'BNG'],
    ['OD222', '42387010179001', 'Delhivery'],
    ['OD223', '1846272999', 'DP World'],
    ['OD224', '', 'Delhivery'],
  ]);
  assert.strictEqual(t.raw().data[1][3], 'keep me', 'other columns are never touched');
  assert.ok(/7 row\(s\) from 2 tab\(s\); no headings found in: Notes\. "Raw Order Tracking" updated\./.test(msg), msg);
  assert.ok(t.props.CT_IMPORT_STATUS.includes('7 row(s)'));
  assert.strictEqual(t.props.CT_IMPORT_RUNNING_SINCE, undefined);
});

scenario('only rewrites when the source changed; old rows beyond the new data are cleared', () => {
  const t = load(sourceTabs(), target());
  t.run('CT_runImport_()');
  const before = t.ours.writes.length;
  assert.ok(/No changes/.test(t.run('CT_runImport_()')));
  assert.strictEqual(t.ours.writes.length, before, 'nothing written when nothing changed');

  // The seller team removes a row and fixes a courier.
  const sept = t.source.getSheetByName('Sept').data;
  sept.splice(5, 1);                    // OD111 removed
  t.source.getSheetByName('Oct 2026').data[4][0] = 'D.P. World Express';
  t.run('CT_runImport_()');
  const rows = t.raw().data.slice(1).filter((r) => r[0] || r[1] || r[2]).map((r) => r.slice(0, 3));
  assert.strictEqual(rows.length, 6);
  assert.ok(!rows.some((r) => r[0] === 'OD111'));
  assert.deepStrictEqual(rows.find((r) => r[0] === 'OD223'), ['OD223', '1846272999', 'DP World']);
  assert.deepStrictEqual(t.raw().data[7].slice(0, 3), ['', '', ''], 'the leftover last row is cleared');
});

scenario('creates the hidden "Raw Order Tracking" tab if it is missing', () => {
  const t = load(sourceTabs(), { 'Pre CRM': [['x']] });
  t.run('CT_runImport_()');
  assert.ok(t.raw(), 'tab created');
  assert.strictEqual(t.raw().hidden, true, 'and hidden');
  assert.deepStrictEqual(t.raw().data[0], ['Order ID', 'Tracking ID', 'Courier Name']);
  assert.strictEqual(t.raw().data.length, 8);
});

scenario('a clear message when the source cannot be opened', () => {
  const t = load(sourceTabs(), target(), { noAccess: true });
  const msg = t.run('CT_runImport_()');
  assert.ok(/Tracking import failed: Cannot open the tracking spreadsheet .* can view it/.test(msg), msg);
  assert.deepStrictEqual(t.raw().data[1].slice(0, 3), ['OLD', 'OLD', 'OLD'], 'nothing changed');
  assert.strictEqual(t.props.CT_IMPORT_RUNNING_SINCE, undefined);
});

scenario('courier spellings', () => {
  const t = load({}, {});
  const c = (s) => t.run(`CT_correctCourierName_(${JSON.stringify(s)})`);
  for (const s of ['Delhivery', 'DELHIVERY', 'delhivary', 'Delhivry', 'Dilhivery', 'Delhi very', 'Delivery', 'Delhivery Surface', 'delhivery-b2b'])
    assert.strictEqual(c(s), 'Delhivery', s);
  for (const s of ['Safexpress', 'Safe Express', 'safexprss', 'SafeXpress Pvt Ltd', 'Saf express'])
    assert.strictEqual(c(s), 'Safexpress', s);
  for (const s of ['DP World', 'DPWORLD', 'dp wrld', 'D.P. World', 'DP World Express', 'DPW', 'Delex'])
    assert.strictEqual(c(s), 'DP World', s);
  for (const s of ['BNG', 'Blue Dart', 'DTDC', 'Self', ''])
    assert.strictEqual(c(s), s.trim(), s);
});

scenario('heading spellings', () => {
  const t = load({}, {});
  const f = (s) => t.run(`CT_headingField_(${JSON.stringify(s)})`);
  for (const s of ['ORDER ID', 'Order Id', 'Oder ID', 'Orderid', 'ORDER-ID', 'Order No.', 'Order Number'])
    assert.strictEqual(f(s), 'ORDER_ID', s);
  for (const s of ['Tracking ID', 'TRACKING  ID', 'Traking ID', 'Tracking No', 'Tracking Number', 'AWB', 'AWB No', 'Docket No'])
    assert.strictEqual(f(s), 'TRACKING_ID', s);
  for (const s of ['TRANSPORT', 'Transport', 'Trasport', 'Transporter', 'Transport Name', 'Courier', 'Courier Name'])
    assert.strictEqual(f(s), 'COURIER', s);
  for (const s of ['Order Item ID', 'Order Date', 'Tracking Status', 'S.No', 'Date', ''])
    assert.strictEqual(f(s), '', s);
});

scenario('live: edits in the seller team\'s spreadsheet start one import a minute later, written into OUR spreadsheet', () => {
  const t = load(sourceTabs(), target(), { activeIsSource: true });
  t.run('CT_onSourceChange({})'); t.run('CT_onSourceChange({})'); t.run('CT_onSourceChange({})');
  assert.deepStrictEqual(t.triggers.map((x) => [x.handler, x.after]), [['CT_delayedImport', 60000]], 'many edits → one pending import');
  assert.strictEqual(t.raw().data[1][0], 'OLD', 'not yet');
  t.run('CT_delayedImport()');
  assert.strictEqual(t.raw().data[1][0], 'OD338718828900872100', 'imported into our "Raw Order Tracking"');
  assert.strictEqual(t.source.getSheetByName('Raw Order Tracking'), null, 'nothing written into the seller team\'s spreadsheet');
  assert.ok(t.source.writes.length === 0, 'the seller team\'s spreadsheet is never changed');
  assert.deepStrictEqual(t.triggers.map((x) => x.handler), ['CT_delayedSync'],
    'the one-off import trigger cleans itself up; a sync is scheduled to fill Tracking ID / Courier in Order Tracking');
});

console.log(`\nAll ${passed} import scenarios passed`);
