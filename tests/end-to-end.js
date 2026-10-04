/**
 * End-to-end test of a full run against a fake Google Sheet and fake courier APIs.
 * Run with:  node tests/end-to-end.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ── fake spreadsheet ──
function makeSheet(name, rows) {
  const data = rows.map((r) => r.slice());
  const formats = {};
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1]; };
  const sheet = {
    data, formats,
    getName: () => name,
    getLastRow: () => data.length,
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j) ?? '')),
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { cell(r + i, 1); data[r + i - 1][c + j - 1] = x; })); return this; },
        setNumberFormat(f) { formats[`${r},${c}`] = f; return this; },
        setFontWeight() { return this; },
      };
    },
    clearContents() { data.length = 0; },
    getParent: () => ss,
  };
  return sheet;
}
const row = (id, courier, status = '', date = '') => ['', '', '', '', '', '', id, courier, status, date];
const main = makeSheet('Orders', [
  ['', '', '', '', '', '', 'Tracking ID', 'Courier Partner', 'Tracking Status', 'Status Date'],
  row('1111111111111', 'Delhivery'),
  row('SX9001', 'Safexpress'),
  row('DPW777', 'DP World'),
  row('2222222222222', 'delhivery', 'Delivered', 'old'),
  row('', 'Delhivery'),
  row('X1', 'Blue Dart'),
  row('SX9002', 'Safe Express'),
]);
const sheets = [main];
const ss = {
  getSheets: () => sheets,
  getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
  insertSheet: (n) => { const s = makeSheet(n, []); sheets.push(s); return s; },
  getSpreadsheetTimeZone: () => 'Asia/Kolkata',
  toast() {},
};

// ── fake APIs ──
const calls = [];
const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
function fetch(url, opts) {
  calls.push((opts.method || 'get').toUpperCase() + ' ' + url);
  if (url.includes('delhivery.com')) {
    assert.strictEqual(opts.headers.Authorization, 'Token DTOKEN');
    return json(200, { ShipmentData: [{ Shipment: { AWB: '1111111111111', Status: { Status: 'In Transit', StatusDateTime: '2026-10-03T23:30:00', StatusLocation: 'Pune_Hub', Instructions: 'Bag received' } } }] });
  }
  assert.strictEqual(opts.headers['Tracking-Api-Key'], 'TMKEY');
  if (url.includes('/couriers/all')) return json(200, { meta: { code: 200 }, data: [{ courier_name: 'DP World Express India', courier_code: 'dp-world-in', courier_country_iso2: 'IN' }] });
  if (url.includes('/trackings/get')) {
    if (url.includes('courier_code=safexpress')) {
      return json(200, { meta: { code: 200 }, data: [{ tracking_number: 'SX9001', delivery_status: 'delivered', origin_info: { trackinfo: [{ checkpoint_date: '2026-10-02 10:15:00', tracking_detail: 'Delivered', location: 'Chennai' }] } }] });
    }
    assert.ok(url.includes('courier_code=dp-world-in'), url);
    return json(200, { meta: { code: 200 }, data: [] });
  }
  if (url.includes('/trackings/batch')) {
    const body = JSON.parse(opts.payload);
    return json(200, { meta: { code: 200 }, data: { success: body.map((b) => ({ tracking_number: b.tracking_number })), error: [] } });
  }
  throw new Error('unexpected ' + url);
}

const props = { DELHIVERY_TOKEN: 'DTOKEN', TRACKINGMORE_API_KEY: 'TMKEY' };
const ctx = vm.createContext({
  console: { log() {}, error: console.error },
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  UrlFetchApp: { fetch },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {} },
  Utilities: {
    // Asia/Kolkata only, enough for the test
    formatDate: (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10),
    parseDate: (s) => new Date(Date.parse(s + 'T00:00:00+05:30')),
  },
});
for (const f of ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackingMore.gs', 'Main.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
}
vm.runInContext('scheduledTrackingUpdate()', ctx);

const d = main.data;
const iso = (x) => (x instanceof Date ? x.toISOString() : x);
// Delhivery: 23:30 IST on 3 Oct → stored as the date 3 Oct (midnight IST)
assert.strictEqual(d[1][8], 'In Transit - Bag received (Pune_Hub)');
assert.strictEqual(iso(d[1][9]), '2026-10-02T18:30:00.000Z');
// Safexpress via TrackingMore
assert.strictEqual(d[2][8], 'Delivered (Chennai)');
assert.strictEqual(iso(d[2][9]), '2026-10-01T18:30:00.000Z');
// DP World newly registered → left blank for now
assert.strictEqual(d[3][8], '');
// already delivered row untouched
assert.strictEqual(d[4][8], 'Delivered');
assert.strictEqual(d[4][9], 'old');
// unregistered Safexpress number SX9002 → registered, left blank
assert.strictEqual(d[7][8], '');
assert.strictEqual(main.formats['2,10'], 'dd-mmm-yyyy');
assert.strictEqual(props.TM_CODE_DPWORLD, 'dp-world-in');

const log = ss.getSheetByName('Tracking Log').data;
const msgs = log.slice(1).map((r) => `${r[1]} ${r[4]} ${r[5]}`);
assert.ok(msgs.some((m) => m.startsWith('7 ERROR Courier name not recognised')), msgs.join('\n'));
assert.ok(msgs.some((m) => m.startsWith('4 INFO Registered with TrackingMore')), msgs.join('\n'));
assert.ok(msgs.some((m) => m.startsWith('8 INFO Registered with TrackingMore')), msgs.join('\n'));
assert.ok(!calls.some((c) => c.includes('2222222222222')), 'delivered row should not be re-checked');

console.log('End-to-end run: OK');
console.log('API calls made:\n  ' + calls.join('\n  '));
