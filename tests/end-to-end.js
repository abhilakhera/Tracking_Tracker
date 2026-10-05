/**
 * End-to-end test of a full run against a fake Google Sheet and fake courier APIs.
 * Run with:  node tests/end-to-end.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// ── fake spreadsheet ──
function makeSheet(name, rows, ss) {
  const data = rows.map((r) => r.slice());
  const formats = {};
  const cell = (r, c) => { while (data.length < r) data.push([]); return data[r - 1][c - 1]; };
  return {
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
}
const row = (id, courier, status = '', date = '') => ['', '', '', '', '', '', id, courier, status, date];
const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const delivered = (place) => json(200, { ShipmentState: 'Delivered', MostRecentStatus: 'Delivered', Checkpoints: [{ Activity: 'Delivered', Date: '02-Oct-2026', Time: '10:15', Location: place }] });

/** Load the robot into a sandbox with a fake sheet and fake APIs. */
function setup(rows, props, trackCourierReply) {
  const ss = {
    getSheets: () => sheets,
    getSheetByName: (n) => sheets.find((s) => s.getName() === n) || null,
    insertSheet: (n) => { const s = makeSheet(n, [], ss); sheets.push(s); return s; },
    getSpreadsheetTimeZone: () => 'Asia/Kolkata',
    toast() {},
  };
  const main = makeSheet('Orders', [['', '', '', '', '', '', 'Tracking ID', 'Courier Partner', 'Tracking Status', 'Status Date'], ...rows], ss);
  const sheets = [main];
  const calls = [];
  const triggers = [];
  let slept = 0;
  function fetch(url, opts) {
    calls.push('GET ' + url);
    if (url.startsWith('https://track.delhivery.com/')) {
      assert.strictEqual(opts.headers.Authorization, 'Token DTOKEN');
      return json(200, { ShipmentData: [{ Shipment: { AWB: '1111111111111', Status: { Status: 'In Transit', StatusDateTime: '2026-10-03T23:30:00', StatusLocation: 'Pune_Hub', Instructions: 'Bag received' } } }] });
    }
    if (url.startsWith('https://api-fr.cargoes.com/track/v4?transportMode=express&trackingId=')) {
      const ids = decodeURIComponent(url.split('trackingId=')[1]).split(',');
      const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'dpworld-1846272584.json'), 'utf8'));
      return json(200, { status: 'success', data: {
        trackings: ids.includes('1846272584') ? fixture.data.trackings : [],
        failedTrackings: ids.filter((id) => id !== '1846272584'), skippedTrackings: [] } });
    }
    assert.strictEqual(opts.headers['X-API-Key'], 'TCKEY');
    const m = url.match(/^https:\/\/api\.trackcourier\.io\/v1\/track\?courier=([a-z]+)&tracking_number=(.+)$/);
    assert.ok(m, url);
    return trackCourierReply(m[1], decodeURIComponent(m[2]));
  }
  const trigger = { timeBased: () => trigger, after: (ms) => { triggers.push(ms); return trigger; }, create: () => trigger };
  const ctx = vm.createContext({
    console: { log() {}, error: console.error },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    UrlFetchApp: { fetch },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => trigger },
    Utilities: {
      sleep: (ms) => { slept += ms; }, // don't really wait in tests
      // Asia/Kolkata only, enough for the test
      formatDate: (d) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10),
      parseDate: (s) => new Date(Date.parse(s + 'T00:00:00+05:30')),
    },
  });
  for (const f of ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Main.gs']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  }
  return {
    run: (fn) => vm.runInContext(fn + '()', ctx),
    data: main.data, formats: main.formats, calls, triggers, props,
    log: () => ss.getSheetByName('Tracking Log').data.slice(1).map((r) => `${r[1]} ${r[4]} ${r[5]}`),
    slept: () => slept,
  };
}
const iso = (x) => (x instanceof Date ? x.toISOString() : x);

// ── Scenario 1: a normal run with every kind of row ──
{
  const t = setup([
    row('1111111111111', 'Delhivery'),
    row('SX9001', 'Safexpress'),
    row(1846272584, 'DP World'),           // typed as a number in the sheet
    row('DPW777', 'DPWorld'),
    row('2222222222222', 'delhivery', 'Delivered', 'old'),
    row('', 'Delhivery'),
    row('X1', 'Blue Dart'),
    row('SX9002', 'Safe Express'),
  ], { DELHIVERY_TOKEN: 'DTOKEN', TRACKCOURIER_API_KEY: 'TCKEY' }, (slug, id) => {
    assert.strictEqual(slug, 'safexpress');
    return id === 'SX9001' ? delivered('Chennai') : json(404, { success: false, error: { code: 'TRACKING_NOT_FOUND', message: 'Tracking number not found' } });
  });
  t.run('scheduledTrackingUpdate');
  const d = t.data;
  // Delhivery: 23:30 IST on 3 Oct → stored as the date 3 Oct (midnight IST)
  assert.strictEqual(d[1][8], 'In Transit - Bag received (Pune_Hub)');
  assert.strictEqual(iso(d[1][9]), '2026-10-02T18:30:00.000Z');
  // Safexpress via TrackCourier.io
  assert.strictEqual(d[2][8], 'Delivered (Chennai)');
  assert.strictEqual(iso(d[2][9]), '2026-10-01T18:30:00.000Z');
  // DP World read from DP World's tracking data
  assert.strictEqual(d[3][8], 'Delivered (Anantapur)');
  assert.strictEqual(iso(d[3][9]), '2026-09-29T18:30:00.000Z');
  // unknown DP World docket → left blank, explained in the log
  assert.strictEqual(d[4][8], '');
  // already delivered row untouched
  assert.strictEqual(d[5][8], 'Delivered');
  assert.strictEqual(d[5][9], 'old');
  // unknown Safexpress number → left blank, explained in the log
  assert.strictEqual(d[8][8], '');
  assert.strictEqual(t.formats['2,10'], 'dd-mmm-yyyy');
  const msgs = t.log();
  assert.ok(msgs.some((m) => m.startsWith('8 ERROR Courier name not recognised')), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('5 ERROR DP World has no shipment with this docket')), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('9 ERROR TrackCourier.io found no shipment')), msgs.join('\n'));
  assert.strictEqual(t.calls.filter((c) => c.includes('cargoes.com')).length, 1, 'both DP World dockets in one request');
  assert.ok(!t.calls.some((c) => c.includes('2222222222222')), 'delivered row should not be re-checked');
  // Free plan = 10 requests/minute → the 2nd TrackCourier request waits ~6 s.
  assert.ok(t.slept() >= 5000, 'requests should be paced, slept ' + t.slept() + ' ms');
  assert.strictEqual(t.triggers.length, 0, 'no pause expected');
  console.log('Scenario 1 (normal run): OK');
}

// ── Scenario 2: speed limit hit mid-run → pause, then continue without re-asking ──
{
  let replies = 0;
  const t = setup([
    row('42387010178824', 'Delhivery'),   // no Delhivery token → TrackCourier.io
    row('100041695709', 'Safexpress'),
    row('42387010178931', 'Delhivery'),
    row('100041880732', 'Safexpress'),
  ], { TRACKCOURIER_API_KEY: 'TCKEY' }, (slug, id) => {
    replies++;
    if (replies === 3) return json(429, { message: 'Too many requests' });
    return delivered(slug + '-' + id);
  });
  t.run('scheduledTrackingUpdate');
  assert.strictEqual(t.data[1][8], 'Delivered (delhivery-42387010178824)');
  assert.strictEqual(t.data[2][8], 'Delivered (safexpress-100041695709)');
  assert.strictEqual(t.data[3][8], '');
  assert.strictEqual(t.props.RESUME_ROW, '4', 'should resume at the first row that was not asked');
  assert.deepStrictEqual(t.triggers, [60000]);

  t.calls.length = 0;
  t.run('continueTrackingUpdate');
  assert.deepStrictEqual(t.calls.map((c) => c.split('tracking_number=')[1]), ['42387010178931', '100041880732'],
    'the continuation must only ask the rows that were not done');
  assert.strictEqual(t.data[3][8], 'Delivered (delhivery-42387010178931)');
  assert.strictEqual(t.data[4][8], 'Delivered (safexpress-100041880732)');
  assert.strictEqual(t.props.RESUME_ROW, undefined);
  console.log('Scenario 2 (pause and continue): OK');
}

// ── Scenario 3: key rejected halfway keeps what was already fetched ──
{
  let replies = 0;
  const t = setup([row('SXA', 'Safexpress'), row('SXB', 'Safexpress'), row('SXC', 'Safexpress')],
    { TRACKCOURIER_API_KEY: 'TCKEY' }, () => (++replies === 1 ? delivered('Pune') : json(401, { message: 'invalid key' })));
  t.run('scheduledTrackingUpdate');
  assert.strictEqual(t.data[1][8], 'Delivered (Pune)');
  assert.strictEqual(t.calls.length, 2, 'stop asking after the key is rejected');
  assert.ok(t.log().some((m) => m.startsWith('4 ERROR TrackCourier.io rejected the API key')), t.log().join('\n'));
  console.log('Scenario 3 (bad key midway): OK');
}
