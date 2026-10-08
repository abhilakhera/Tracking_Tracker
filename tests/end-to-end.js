/**
 * End-to-end tests of full runs against a fake Google spreadsheet and fake courier APIs.
 * Run with:  node tests/end-to-end.js
 *
 * Sheet layout used (same as Config.gs):
 *   G Tracking ID | H Courier Partner | I Brief Status | J Tracking Status | K Status Date
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const FILES = ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Sync.gs', 'Fsn.gs', 'Main.gs'];
const G = 6, I = 8, J = 9, K = 10; // 0-based column indexes in a row array

const { makeSpreadsheet, makeScriptApp, makeLockService, Utilities } = require('./fake-sheet');

const row = (id, courier, brief = '', status = '', date = '') => ['', '', '', '', '', '', id, courier, brief, status, date];
const json = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) });
const tcAnswer = (state, activity, place) => json(200, { success: true, data: { ShipmentState: state.toLowerCase().replace(/ /g, ''), MostRecentStatus: state,
  Checkpoints: [{ Activity: activity, Date: '02-Oct-2026', Time: '10:15', Location: place }] }, usage: { used: 1234, quota: 5000 } });
const delivered = (place) => tcAnswer('Delivered', 'Delivered', place);

/** Load the robot into a sandbox with a fake spreadsheet and fake APIs. */
function setup(rows, props, trackCourierReply, extra = {}) {
  const header = ['', '', '', '', '', '', 'Tracking ID', 'Courier Partner', 'Brief Status', 'Tracking Status', 'Status Date'];
  const ss = makeSpreadsheet({
    'Dashboard': [['Order', 'Tracking'], ['x', '1111111111111']], // another tab that must never be touched
    'Order Tracking': [header, ...rows],
    'Pre CRM': [['SKU Code']],
    'Self Ship Cases': [['SKU']],
    'Review & Rating Data': [['Order ID']],
  });
  const writes = ss.writes;
  const dashboard = ss.getSheetByName('Dashboard');
  const main = ss.getSheetByName('Order Tracking');
  const sheets = ss.getSheets();
  const calls = [];
  const triggers = (extra.triggers || []).slice(); // triggers that already exist (other scripts)
  let slept = 0;
  function fetch(url, opts) {
    calls.push('GET ' + url);
    if (extra.onFetch) extra.onFetch(main, calls.length);
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
  const locks = makeLockService();
  const ctx = vm.createContext({
    console: { log() {}, error: console.error },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      getActiveRange: () => extra.activeRange && extra.activeRange(sheets),
      getUi: () => ({ alert: (m) => { (extra.alerts || []).push(m); } }),
    },
    UrlFetchApp: { fetch },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    // Other scripts may hold Google's shared script lock; the tracker must not need it.
    LockService: locks.service,
    ScriptApp: makeScriptApp(triggers),
    Utilities: { ...Utilities, sleep: (ms) => { slept += ms; } }, // don't really wait in tests
  });
  for (const f of FILES) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  }
  return {
    ctx, ss,
    run: (fn) => vm.runInContext(fn + '()', ctx),
    data: main.data, formats: main.formats, dashboard, calls, triggers, props, writes, locks,
    log: () => ss.getSheetByName('Courier Tracking Log').data.slice(1).map((r) => `${r[1]} ${r[4]} ${r[5]}`),
    slept: () => slept,
  };
}
const iso = (x) => (x instanceof Date ? x.toISOString() : x);

// ── Scenario 1: a normal daily run with every kind of row ──
{
  const t = setup([
    row('1111111111111', 'Delhivery'),
    row('SX9001', 'Safexpress'),
    row(1846272584, 'DP World'),           // typed as a number in the sheet
    row('DPW777', 'DPWorld'),
    row('2222222222222', 'delhivery', 'Delivered', 'Delivered - Waybill Delivered (Asansol)', 'old'),
    row('', 'Delhivery'),
    row('X1', 'Blue Dart'),
    row('BNG123', ' bng '),               // tracked by hand → skipped, no error, nothing written
    row('SX9002', 'Safe Express'),
  ], { CT_DELHIVERY_TOKEN: 'DTOKEN', CT_TRACKCOURIER_API_KEY: 'TCKEY' }, (slug, id) => {
    assert.strictEqual(slug, 'safexpress');
    return id === 'SX9001' ? delivered('Chennai') : json(404, { success: false, error: { code: 'TRACKING_NOT_FOUND', message: 'Tracking number not found' } });
  });
  t.run('CT_dailyUpdate');
  const d = t.data;
  // Delhivery: 23:30 IST on 3 Oct → stored as the date 3 Oct (midnight IST)
  assert.deepStrictEqual([d[1][I], d[1][J], iso(d[1][K])], ['In Transit', 'In Transit - Bag received (Pune_Hub)', '2026-10-02T18:30:00.000Z']);
  // Safexpress via TrackCourier.io
  assert.deepStrictEqual([d[2][I], d[2][J], iso(d[2][K])], ['Delivered', 'Delivered (Chennai)', '2026-10-01T18:30:00.000Z']);
  // DP World read from DP World's tracking data
  assert.deepStrictEqual([d[3][I], d[3][J], iso(d[3][K])], ['Delivered', 'Delivered (Anantapur)', '2026-09-29T18:30:00.000Z']);
  // unknown DP World docket → left blank, explained in the log
  assert.deepStrictEqual([d[4][I], d[4][J]], ['', '']);
  // already delivered row untouched
  assert.deepStrictEqual([d[5][I], d[5][J], d[5][K]], ['Delivered', 'Delivered - Waybill Delivered (Asansol)', 'old']);
  // BNG is tracked by hand: skipped, nothing written, no error
  assert.deepStrictEqual([d[8][I], d[8][J], d[8][K]], ['', '', '']);
  assert.ok(!t.calls.some((c) => c.includes('BNG123')), 'BNG is never sent to an API');
  assert.ok(!t.log().some((m) => m.startsWith('9 ')), 'no log message for the BNG row');
  // unknown Safexpress number → left blank
  assert.strictEqual(d[9][J], '');
  // Status Date column K holds dates
  assert.strictEqual(t.formats['2,11'], 'dd-mmm-yyyy');
  // Tracking writes only columns I-K of updated rows (plus the log tabs; the order sync that runs
  // first only adds the "Order Item Id" headings).
  assert.ok(t.writes.every((w) => /^Order Tracking!R\d+C(9|10|11)$/.test(w) || /Log!/.test(w) ||
    ['Order Tracking!R1C16', 'Review & Rating Data!R1C13'].includes(w)), t.writes.join(' '));
  assert.deepStrictEqual(t.dashboard.data, [['Order', 'Tracking'], ['x', '1111111111111']]);
  assert.ok(!t.writes.some((w) => w.startsWith('Order Tracking!R6C')), 'the delivered row must not be rewritten');
  const msgs = t.log();
  assert.ok(msgs.some((m) => m.startsWith('8 ERROR Courier name not recognised')), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('5 ERROR DP World has no shipment with this docket')), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.startsWith('10 ERROR TrackCourier.io found no shipment')), msgs.join('\n'));
  assert.ok(msgs.some((m) => m.includes('TrackCourier.io: 1,234 of 5,000 requests used this month.')), msgs.join('\n'));
  assert.strictEqual(t.calls.filter((c) => c.includes('cargoes.com')).length, 1, 'both DP World dockets in one request');
  assert.ok(!t.calls.some((c) => c.includes('2222222222222')), 'delivered row should not be re-checked');
  // Starter plan = 60 requests/minute → the 2nd TrackCourier request waits ~1 s.
  assert.ok(t.slept() >= 500, 'requests should be paced, slept ' + t.slept() + ' ms');
  assert.strictEqual(t.triggers.length, 0, 'no pause expected');
  assert.strictEqual(t.props.CT_RUNNING_SINCE, undefined, 'the "running" flag is cleared at the end');
  assert.ok(t.locks.state.taken > 0 && !t.locks.state.held, "Google's shared lock is only taken for an instant and always released");
  console.log('Scenario 1 (normal run, only the Order Tracking tab is touched): OK');
}

// ── Scenario 2: speed limit hit mid-run → pause, then continue without re-asking ──
{
  let replies = 0;
  const t = setup([
    row('42387010178824', 'Delhivery'),   // no Delhivery token → TrackCourier.io
    row('100041695709', 'Safexpress'),
    row('42387010178931', 'Delhivery'),
    row('100041880732', 'Safexpress'),
  ], { CT_TRACKCOURIER_API_KEY: 'TCKEY' }, (slug, id) => {
    replies++;
    if (replies === 3) return json(429, { message: 'Too many requests' });
    return delivered(slug + '-' + id);
  });
  t.run('CT_dailyUpdate');
  assert.strictEqual(t.data[1][J], 'Delivered (delhivery-42387010178824)');
  assert.strictEqual(t.data[2][J], 'Delivered (safexpress-100041695709)');
  assert.strictEqual(t.data[3][J], '');
  assert.strictEqual(t.props.CT_RESUME_ROW, '4', 'should resume at the first row that was not asked');
  assert.deepStrictEqual(t.triggers.map((x) => [x.handler, x.after]), [['CT_continueUpdate', 60000]]);

  t.calls.length = 0;
  t.run('CT_continueUpdate');
  assert.deepStrictEqual(t.calls.map((c) => c.split('tracking_number=')[1]), ['42387010178931', '100041880732'],
    'the continuation must only ask the rows that were not done');
  assert.strictEqual(t.data[3][J], 'Delivered (delhivery-42387010178931)');
  assert.strictEqual(t.data[4][J], 'Delivered (safexpress-100041880732)');
  assert.strictEqual(t.props.CT_RESUME_ROW, undefined);
  assert.strictEqual(t.triggers.length, 0, 'the one-off continuation trigger is removed');
  console.log('Scenario 2 (pause and continue): OK');
}

// ── Scenario 3: key rejected halfway keeps what was already fetched ──
{
  let replies = 0;
  const t = setup([row('SXA', 'Safexpress'), row('SXB', 'Safexpress'), row('SXC', 'Safexpress')],
    { CT_TRACKCOURIER_API_KEY: 'TCKEY' }, () => (++replies === 1 ? delivered('Pune') : json(401, { success: false, error: { code: 'INVALID_API_KEY', message: 'invalid key' } })));
  t.run('CT_dailyUpdate');
  assert.strictEqual(t.data[1][J], 'Delivered (Pune)');
  assert.strictEqual(t.calls.length, 2, 'stop asking after the key is rejected');
  assert.ok(t.log().some((m) => m.startsWith('4 ERROR TrackCourier.io rejected the API key')), t.log().join('\n'));
  console.log('Scenario 3 (bad key midway): OK');
}

// ── Scenario 4: Brief Status ──
{
  const t = setup([
    // Existing rows from before the Brief Status column existed: filled in without any API call.
    row('42387010178824', 'Delhivery', '', 'Delivered - Waybill Delivered: Delivered Date: 29/09/2026 (Asansol)', 'x'),
    // Delivered according to Brief Status only → skipped.
    row('100041695709', 'Safexpress', 'Delivered', '', ''),
    // Moving parcel: re-checked, all three columns refreshed.
    row('42387010178931', 'Delhivery', 'In Transit', 'In Transit - old', 'old'),
  ], { CT_TRACKCOURIER_API_KEY: 'TCKEY' }, () =>
    tcAnswer('In Transit', 'In Transit - Shipment left for next facility Sahebganj', 'Malda Tiakati I (West Bengal)'));
  t.run('CT_dailyUpdate');
  assert.strictEqual(t.data[1][I], 'Delivered');
  assert.strictEqual(t.data[1][K], 'x');
  assert.strictEqual(t.data[2][J], '');
  assert.deepStrictEqual([t.data[3][I], t.data[3][J]],
    ['In Transit', 'In Transit - In Transit - Shipment left for next facility Sahebganj (Malda Tiakati I (West Bengal))']);
  assert.deepStrictEqual(t.calls.map((c) => c.split('tracking_number=')[1]), ['42387010178931'], 'only the undelivered parcel is asked');
  console.log('Scenario 4 (Brief Status, delivered rows skipped): OK');
}

// ── Scenario 5: someone inserts a row while the robot is working ──
{
  const t = setup([row('SXA', 'Safexpress'), row('SXB', 'Safexpress')], { CT_TRACKCOURIER_API_KEY: 'TCKEY' },
    (slug, id) => delivered('Place-' + id), {
      onFetch: (sheet, n) => { if (n === 1) sheet.data.splice(1, 0, row('NEW1', 'Safexpress')); },
    });
  t.run('CT_dailyUpdate');
  // Row 2 is now NEW1 and row 3 is SXA: nothing may land on the wrong parcel.
  assert.deepStrictEqual(t.data.slice(1).map((r) => [r[G], r[J]]), [['NEW1', ''], ['SXA', ''], ['SXB', '']]);
  assert.ok(t.log().some((m) => m.includes('Rows moved while updating')), t.log().join('\n'));
  console.log('Scenario 5 (rows moved during a run → nothing written to the wrong row): OK');
}

// ── Scenario 6: setup creates only its own triggers and keeps other scripts' triggers ──
{
  const others = [{ handler: 'theirDailyReport', getHandlerFunction: () => 'theirDailyReport' },
    { handler: 'onEditHandler', getHandlerFunction: () => 'onEditHandler' }];
  const t = setup([], {}, () => assert.fail('no API call expected'), { triggers: others });
  t.run('CT_setup');
  t.run('CT_setup'); // running it twice must not create duplicates
  const mine = t.triggers.filter((x) => x.handler.startsWith('CT_')).map(({ getHandlerFunction, ...spec }) => spec);
  assert.deepStrictEqual(mine, [
    { handler: 'CT_onOpen', spreadsheet: true, onOpen: true },
    { handler: 'CT_onEdit', spreadsheet: true, onEdit: true },
    { handler: 'CT_hourlySync', everyHours: 1 },
    { handler: 'CT_dailyUpdate', everyDays: 1, atHour: 8, nearMinute: 15, tz: 'Asia/Kolkata' },
  ]);
  assert.deepStrictEqual(t.triggers.filter((x) => !x.handler.startsWith('CT_')).map((x) => x.handler), ['theirDailyReport', 'onEditHandler']);
  t.run('CT_turnOffDailyUpdate');
  assert.deepStrictEqual(t.triggers.map((x) => x.handler), ['theirDailyReport', 'onEditHandler', 'CT_onOpen', 'CT_onEdit', 'CT_hourlySync']);
  console.log('Scenario 6 (setup: menu, edit, hourly sync and daily 8 AM triggers; other triggers untouched): OK');
}

// ── Scenario 7: "Update selected rows" only works on the Order Tracking tab ──
{
  const alerts = [];
  const t = setup([row('SXA', 'Safexpress')], { CT_TRACKCOURIER_API_KEY: 'TCKEY' }, () => delivered('Pune'), {
    alerts, activeRange: (sheets) => sheets[0].getRange(2, 1, 1, 1), // a cell on the Dashboard tab
  });
  t.run('CT_updateSelectedRows');
  assert.strictEqual(t.calls.length, 0);
  assert.ok(/Go to the "Order Tracking" tab/.test(alerts[0]), alerts[0]);
  console.log('Scenario 7 (selected rows on another tab are refused): OK');
}

// ── Scenario 8: every global name starts with CT_ (no clashes with other scripts) ──
{
  const ctx = vm.createContext({});
  const before = new Set(Object.getOwnPropertyNames(ctx));
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  const added = Object.getOwnPropertyNames(ctx).filter((n) => !before.has(n));
  const bad = added.filter((n) => !n.startsWith('CT_'));
  assert.deepStrictEqual(bad, [], 'names without CT_: ' + bad.join(', '));
  assert.ok(!added.includes('onOpen'));
  console.log('Scenario 8 (all ' + added.length + ' global names start with CT_): OK');
}
