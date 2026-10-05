/**
 * Offline tests for the parsing logic. Run with:  node tests/run-tests.js
 * They load the .gs files into a sandbox with tiny stand-ins for Google services,
 * so no API keys or Google account are needed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = vm.createContext({
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => null, setProperty() {}, deleteProperty() {} }) },
});
for (const f of ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Main.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
}
const g = (expr) => vm.runInContext(expr, ctx);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const iso = (d) => d && d.toISOString();

console.log('Courier name matching');
test('recognises spellings', () => {
  const k = g('courierKeyFor_');
  assert.strictEqual(k('Delhivery'), 'DELHIVERY');
  assert.strictEqual(k(' DELHIVERY B2C '), 'DELHIVERY');
  assert.strictEqual(k('Safe Express'), 'SAFEXPRESS');
  assert.strictEqual(k('SafExpress'), 'SAFEXPRESS');
  assert.strictEqual(k('DP World'), 'DPWORLD');
  assert.strictEqual(k('dp-world express'), 'DPWORLD');
  assert.strictEqual(k('Blue Dart'), null);
  assert.strictEqual(k(''), null);
});

console.log('Date parsing (times without timezone are IST)');
test('ISO with offset', () => assert.strictEqual(iso(g('parseCourierDate_')('2026-10-03T14:25:11+05:30')), '2026-10-03T08:55:11.000Z'));
test('ISO without offset → IST', () => assert.strictEqual(iso(g('parseCourierDate_')('2026-10-03T14:25:11.389000')), '2026-10-03T08:55:11.000Z'));
test('ISO Z', () => assert.strictEqual(iso(g('parseCourierDate_')('2026-10-03T08:55:11Z')), '2026-10-03T08:55:11.000Z'));
test('dd-mm-yyyy hh:mm', () => assert.strictEqual(iso(g('parseCourierDate_')('03-10-2026 14:25')), '2026-10-03T08:55:00.000Z'));
test('dd/mm/yyyy', () => assert.strictEqual(iso(g('parseCourierDate_')('03/10/2026')), '2026-10-02T18:30:00.000Z'));
test('dd-Mon-yyyy hh:mm PM', () => assert.strictEqual(iso(g('parseCourierDate_')('03-Oct-2026 02:25 PM')), '2026-10-03T08:55:00.000Z'));
test('12 AM is midnight', () => assert.strictEqual(iso(g('parseCourierDate_')('03 Oct 2026 12:05 AM')), '2026-10-02T18:35:00.000Z'));
test('junk → null', () => assert.strictEqual(g('parseCourierDate_')('n/a'), null));
test('empty → null', () => assert.strictEqual(g('parseCourierDate_')(''), null));

console.log('Finished-status detection');
test('Delivered is finished, Undelivered is not', () => {
  const f = g('isFinishedStatus_');
  assert.ok(f('Delivered - Delivered to consignee (Pune)'));
  assert.ok(f('RTO Delivered'));
  assert.ok(!f('Delivery Failed'));
  assert.ok(!f('Undelivered'));
  assert.ok(!f('In Transit'));
});

console.log('Delhivery response parsing');
test('uses Status block', () => {
  const out = g('parseDelhiveryResponse_')({ ShipmentData: [{ Shipment: {
    AWB: '1234567890123',
    Status: { Status: 'In Transit', StatusDateTime: '2026-10-03T11:02:44.123', StatusLocation: 'Mumbai_Bhiwandi_HB (Maharashtra)', Instructions: 'Shipment Received at Facility', StatusType: 'UD' },
  } }] });
  assert.strictEqual(out['1234567890123'].status, 'In Transit - Shipment Received at Facility (Mumbai_Bhiwandi_HB (Maharashtra))');
  assert.strictEqual(iso(out['1234567890123'].date), '2026-10-03T05:32:44.000Z');
});
test('falls back to latest scan and RTO Delivered', () => {
  const out = g('parseDelhiveryResponse_')({ ShipmentData: [{ Shipment: {
    AWB: 'abc1', Status: { Status: 'RTO', StatusType: 'DL' },
    Scans: [
      { ScanDetail: { Scan: 'Manifested', ScanDateTime: '2026-09-28T10:00:00', ScannedLocation: 'A' } },
      { ScanDetail: { Scan: 'Delivered', ScanDateTime: '2026-10-01T16:30:00', ScannedLocation: 'Origin', Instructions: 'Returned to shipper' } },
    ],
  } }] });
  assert.strictEqual(out.ABC1.status, 'RTO Delivered - Returned to shipper (Origin)');
  assert.strictEqual(iso(out.ABC1.date), '2026-10-01T11:00:00.000Z');
});

console.log('TrackCourier.io response parsing');
test('PascalCase answer, newest checkpoint wins', () => {
  const out = g('parseTrackCourierResult_')({
    ShipmentState: 'InTransit', MostRecentStatus: 'In Transit',
    Checkpoints: [
      { Activity: 'Arrived at hub', CheckpointState: 'intransit', Date: '02-Oct-2026', Time: '18:45', Location: 'Nagpur' },
      { Activity: 'Booked', CheckpointState: 'pickup', Date: '30-Sep-2026', Time: '09:00', Location: 'Delhi' },
    ],
  });
  assert.strictEqual(out.status, 'In Transit - Arrived at hub (Nagpur)');
  assert.strictEqual(iso(out.date), '2026-10-02T13:15:00.000Z');
});
test('snake_case answer (wrapped in data) also works', () => {
  const out = g('parseTrackCourierResult_')({ data: { status: 'delivered',
    checkpoints: [{ activity: 'Delivered', date: '28-Aug-2026', time: '09:41', location: 'Delhi' }] } });
  assert.strictEqual(out.status, 'Delivered (Delhi)');
  assert.strictEqual(iso(out.date), '2026-08-28T04:11:00.000Z');
});
test('no events → error, so the row is left as is', () => assert.ok(g('parseTrackCourierResult_')({ Checkpoints: [] }).error));
test('bad key stops the run with a clear message', () => {
  assert.throws(() => g('handleTrackCourierResponse_')(401, '{"message":"invalid key"}', 'safexpress'), /rejected the API key/);
});
test('404 → row-level error', () => assert.ok(/no shipment/.test(g('handleTrackCourierResponse_')(404, '{}', 'safexpress').error)));
test('state names are made readable', () => {
  assert.strictEqual(g('humanizeState_')('InTransit'), 'In Transit');
  assert.strictEqual(g('humanizeState_')('out_for_delivery'), 'Out for Delivery');
  assert.strictEqual(g('humanizeState_')('intransit'), 'In Transit');
});
test('example answer from the TrackCourier.io docs', () => {
  const out = g('handleTrackCourierResponse_')(200, JSON.stringify({ success: true, data: {
    MostRecentStatus: 'Delivered', ShipmentState: 'delivered',
    Checkpoints: [
      { Activity: 'Delivered', CheckpointState: 'delivered', CourierName: 'DTDC', Date: '18-Sep-2026', Time: '17:08', Location: 'Delhi' },
      { Activity: 'Out for Delivery - Shipment is out for Delivery 2026-09-18 14:09:12', CheckpointState: 'outfordelivery', Date: '18-Sep-2026', Time: '14:09', Location: 'Delhi' },
      { Activity: 'On The Way - On its way between JAIPUR and DELHI', CheckpointState: 'intransit', Date: '17-Sep-2026', Time: '22:15', Location: 'Jaipur to Delhi' },
    ],
    CourierHasNoRecordOfShipment: false }, usage: { used: 45, quota: 100 } }), 'dtdc');
  assert.strictEqual(out.status, 'Delivered (Delhi)');
  assert.strictEqual(iso(out.date), '2026-09-18T11:38:00.000Z');
});
test('courier has no record → row-level error', () => {
  assert.ok(/no record/.test(g('handleTrackCourierResponse_')(200, '{"success":true,"data":{"CourierHasNoRecordOfShipment":true,"Checkpoints":[]}}', 'safexpress').error));
});
test('documented error codes', () => {
  const h = g('handleTrackCourierResponse_');
  assert.throws(() => h(402, '{"success":false,"error":{"code":"QUOTA_EXCEEDED","message":"Monthly quota of 100 requests exceeded."}}', 'x'), /monthly limit.*Monthly quota of 100/);
  assert.throws(() => h(404, '{"success":false,"error":{"code":"COURIER_NOT_FOUND","message":"Unknown courier slug"}}', 'safexpres'), /does not know the courier name "safexpres"/);
  assert.ok(/no shipment/.test(h(404, '{"success":false,"error":{"code":"TRACKING_NOT_FOUND","message":"Tracking number not found"}}', 'x').error));
  assert.ok(/retry/.test(h(504, '{"success":false,"error":{"code":"TIMEOUT","message":"Courier backend timeout - retry"}}', 'x').error));
});

console.log('DP World response parsing (real reply for docket 1846272584)');
const dpw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'dpworld-1846272584.json'), 'utf8'));
test('delivered docket → latest status and date', () => {
  const out = g('parseDpWorldResponse_')(dpw);
  assert.strictEqual(out['1846272584'].status, 'Delivered (Anantapur)');
  assert.strictEqual(iso(out['1846272584'].date), '2026-09-30T15:33:00.000Z'); // 30-Sep-2026 21:03 IST
});
test('docket in the "failed" list is simply absent', () => {
  assert.deepStrictEqual(dpw.data.failedTrackings, ['ZZ99999999X']);
  assert.strictEqual(g('parseDpWorldResponse_')(dpw).ZZ99999999X, undefined);
});
test('parcel still moving: newest hub scan becomes the detail', () => {
  // Same docket as it looked on 27-Sep: only the first steps had happened.
  const events = JSON.parse(JSON.stringify(dpw.data.trackings[0].containersTrackingEvents['1846272584'])).slice(0, 4);
  events[3].sub_events = events[3].sub_events.filter((s) => s.ata < '2026-09-27T17:00:00');
  events[3].event_time = '2026-09-24T00:54:00';
  const out = g('latestDpWorldEvent_')(events);
  assert.strictEqual(g('formatStatus_')(out.main, out.detail, out.location), 'In Transit - Destination Hub In (BANGALORE HUB BLRH)');
  assert.strictEqual(iso(out.when), '2026-09-27T11:25:49.000Z');
});
test('planned (not yet happened) events are ignored', () => {
  const out = g('latestDpWorldEvent_')([
    { event_desc: 'Received', event_status: 'actual', event_time: '2026-10-01T10:00:00', event_location: { city: 'Pune' } },
    { event_desc: 'Delivered', event_status: 'planned', event_time: '2026-10-05T10:00:00', event_location: { city: 'Goa' } },
  ]);
  assert.strictEqual(out.main, 'Received');
});

console.log('Misc');
test('column letters', () => {
  assert.strictEqual(g('columnNumber_')('G'), 7);
  assert.strictEqual(g('columnNumber_')('J'), 10);
  assert.strictEqual(g('columnNumber_')('AA'), 27);
});
test('numeric tracking IDs are kept as text', () => assert.strictEqual(g('cleanTrackingId_')(1234567890123), '1234567890123'));

console.log(`\n${passed} test(s) passed` + (process.exitCode ? ', some FAILED' : ''));
