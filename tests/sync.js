/**
 * Tests for the order sync (Pre CRM → Order Tracking → Review & Rating Data).
 * Run with:  node tests/sync.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { makeSpreadsheet, makeScriptApp, Utilities } = require('./fake-sheet');

const FILES = ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Sync.gs', 'Main.gs'];
const DAY = 86400000;
const ist = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 330 * 60000); // a date cell (midnight IST)
const daysAgo = (n) => { const t = new Date(Date.now() + 330 * 60000 - n * DAY); return ist(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const day = (v) => (v instanceof Date ? Utilities.formatDate(v) : v);

// Pre CRM row: A SKU, B FSN, C Product, D Category, E Order Id, F Order Item Id, G Ordered On,
// H-I prices, J Ship to name, K City, L State, M PIN, N Phone, O Email, P Assigned, Q Remarks, R Sub, S Delivery By, T Msg
const pre = (o) => [o.sku, o.fsn, 'Product', o.cat || 'Bed', o.order, o.item, o.on, 1, 1, o.name, 'City', 'State', 1, o.phone,
  'mail', 'Vineet', o.remark, '', o.by, ''];
const PRE_HEADER = ['SKU Code', 'FSN', 'Product', 'Category', 'Order Id', 'Order Item Id', 'Ordered On', 'SP', 'Inv', 'Ship to name',
  'City', 'State', 'PIN', 'Phone No', 'Email', 'Assigned To', 'Remarks', 'Sub Remark', 'Delivery By Date', 'Msg'];
const OT_HEADER = ['Order Id', 'Order Date', 'SKU', 'FSN', 'Customer Name', 'Contact Number', 'Tracking ID', 'Courier Partner',
  'Brief Status', 'Tracking Status', 'Status Date', 'Delivery By Date', 'Remarks', 'Return Request Type', 'Refund Status'];
const SS_HEADER = ['SKU', 'FSN', 'Order ID', 'Order Item ID', 'Customer Name', 'Phone', 'City', 'Pin', 'Assigned', 'Return Tab',
  'Request Type', 'Request Date', 'Reason', 'Carpenter', 'Pickup', 'Packing', 'Images', 'What', 'Refund Status'];
const ss_ = (order, item, type, refund) => ['S', 'F', order, item, 'n', 'p', 'c', 'p', 'a', 't', type, '', '', '', '', '', '', '', refund];
const RV_HEADER = ['Order ID', 'Order Date', 'FSN', 'Category', 'Customer Name', 'Phone Number', 'Delivery Date', 'Calling Date',
  'Review Link', 'Review Message', 'Call Status', 'Remark'];

function load(tabs, extra = {}) {
  const ss = makeSpreadsheet(tabs);
  const triggers = [];
  const props = {};
  const ctx = vm.createContext({
    console: { log() {}, error: console.error },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: { getScriptLock: () => { throw new Error('must not use the shared script lock'); } },
    ScriptApp: makeScriptApp(triggers),
    UrlFetchApp: { fetch: () => { throw new Error('the order sync must not call any API'); } },
    Utilities,
  });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  return {
    ss, ctx, triggers, props,
    run: (code) => vm.runInContext(code, ctx),
    tab: (n) => ss.getSheetByName(n).data,
    log: () => ss.getSheetByName('Order Sync Log').data.slice(1).map((r) => `${r[1]} | ${r[2]} | ${r[3]} | ${r[4]}`),
  };
}

let passed = 0;
function scenario(name, fn) { fn(); passed++; console.log('Scenario ' + passed + ' (' + name + '): OK'); }

// ── 1. Pre CRM → Order Tracking ──
scenario('Pre CRM → Order Tracking: which orders, one row per product, manual columns untouched', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER,
      pre({ sku: 'OLD-1', fsn: 'F0', order: 'OD100', item: '100', on: '9-Aug-2026', name: 'Old', phone: 9000000000, remark: 'Dispatch', by: '23-Aug-2026' }),
      pre({ sku: 'SKU-A', fsn: 'FA', order: 'OD200', item: '338312839460372100', on: ist(2026, 9, 20), name: 'Asha', phone: 9111111111, remark: 'Dispatch', by: ist(2026, 10, 4) }),
      pre({ sku: 'SKU-B', fsn: 'FB', order: 'OD300', item: '301', on: '25-Sep-2026', name: 'Bala', phone: 9222222222, remark: 'DISPATCHED', by: '9-Oct-2026' }),
      pre({ sku: 'SKU-C', fsn: 'FC', order: 'OD300', item: '302', on: '25-Sep-2026', name: 'Bala', phone: 9222222222, remark: 'Dispatch', by: '9-Oct-2026' }),
      pre({ sku: 'SKU-D', fsn: 'FD', order: 'OD400', item: '400', on: '1-Oct-2026', name: 'Hold', phone: 1, remark: 'Hold', by: '' }),
      pre({ sku: 'SKU-E', fsn: 'FE', order: 'OD500', item: '500', on: ist(2026, 10, 2), name: 'NotYet', phone: 1, remark: 'Not dispatched yet', by: '' }),
      pre({ sku: 'SKU-F', fsn: 'FF', order: 'OD600', item: '600', on: ist(2026, 10, 3), name: 'Typed', phone: 9333333333, remark: 'Dispatch', by: '' }),
    ],
    'Order Tracking': [OT_HEADER,
      ['', '', '', '', '', '', '100041695709', 'Safexpress', 'Delivered', 'Delivered (x)', ist(2026, 9, 29)], // test row, no Order Id
      ['OD600', '', '', '', '', '', 'TRK600', 'Delhivery', '', '', '', '', 'my remark'],                     // typed in by hand
    ],
    'Self Ship Cases': [SS_HEADER, ss_('OD300', '302', 'Replacement', 'Not required'), ss_('OD200', '', 'Customer Return', 'Completed')],
    'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  const ot = t.tab('Order Tracking');
  assert.strictEqual(ot[0][15], 'Order Item Id', 'heading added in P1');
  // Row 2 (test row) untouched; row 3 (typed OD600) claimed, not duplicated; G, H, M kept.
  assert.deepStrictEqual(ot[1].slice(0, 8), ['', '', '', '', '', '', '100041695709', 'Safexpress']);
  assert.deepStrictEqual([ot[2][0], ot[2][2], ot[2][4], ot[2][6], ot[2][7], ot[2][12], ot[2][15]], ['OD600', 'SKU-F', 'Typed', 'TRK600', 'Delhivery', 'my remark', '600']);
  // New products added below, in Pre CRM order: OD200, OD300 (2 products). Old/Hold/Not dispatched excluded.
  const added = ot.slice(3).map((r) => [r[0], r[2], r[15]]);
  assert.deepStrictEqual(added, [['OD200', 'SKU-A', '338312839460372100'], ['OD300', 'SKU-B', '301'], ['OD300', 'SKU-C', '302']]);
  const a = ot[3];
  assert.deepStrictEqual([day(a[1]), a[3], a[4], a[5], day(a[11])], ['2026-09-20', 'FA', 'Asha', 9111111111, '2026-10-04']);
  assert.ok(a[1] instanceof Date && a[11] instanceof Date, 'Order Date and Delivery By Date are real dates');
  assert.ok([6, 7, 8, 9, 10, 12].every((c) => a[c] === undefined), 'G-K and M are never written for new rows');
  // Self Ship: by item (OD300/302) and by order (OD200)
  assert.deepStrictEqual([ot[3][13], ot[3][14]], ['Customer Return', 'Completed']);
  assert.deepStrictEqual([ot[4][13], ot[4][14]], ['', '']);
  assert.deepStrictEqual([ot[5][13], ot[5][14]], ['Replacement', 'Not required']);
  assert.ok(t.log().some((m) => m.includes('row 2') && m.includes('Tracking ID but no Order Id')), t.log().join('\n'));

  // A second sync changes nothing.
  const before = t.ss.writes.length;
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.ss.writes.slice(before).filter((w) => !w.startsWith('Order Sync Log')), []);

  // You fill in a Tracking ID, fix a name in Pre CRM and change a remark: only the right cells change.
  ot[4][6] = 'TRK301'; ot[4][7] = 'Delhivery';
  t.tab('Pre CRM')[2][9] = 'Asha K';
  t.tab('Pre CRM')[3][16] = 'Cancelled';
  const before2 = t.ss.writes.length;
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.ss.writes.slice(before2).filter((w) => !w.startsWith('Order Sync Log')), ['Order Tracking!R4C5']);
  assert.strictEqual(ot[3][4], 'Asha K');
  assert.deepStrictEqual([ot[4][0], ot[4][6]], ['OD300', 'TRK301'], 'a row that no longer qualifies is kept');
  assert.ok(t.log().some((m) => m.includes('OD300') && m.includes('No longer a "Dispatch" order')), t.log().join('\n'));
});

// ── 2. Order Tracking → Review & Rating Data ──
scenario('Delivered + 2 days → Review & Rating Data; Self Ship orders kept out and removed', () => {
  const ot = (order, item, brief, when) => [order, '', '', 'F' + item, '', '', 'T' + item, 'Delhivery', brief, brief, when, '', '', '', '', item];
  const t = load({
    'Pre CRM': [PRE_HEADER,
      pre({ sku: 'S1', fsn: 'F1', cat: 'Bed', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'One', phone: 9100000001, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S2', fsn: 'F2', cat: 'Sofa', order: 'OD2', item: '2', on: ist(2026, 9, 22), name: 'Two', phone: 9100000002, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S3', fsn: 'F3', order: 'OD3', item: '3', on: ist(2026, 9, 23), name: 'Three', phone: 1, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S4', fsn: 'F4', order: 'OD4', item: '4', on: ist(2026, 9, 24), name: 'Four', phone: 1, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S5', fsn: 'F5', order: 'OD5', item: '5', on: ist(2026, 9, 25), name: 'Five', phone: 1, remark: 'Dispatch', by: '' }),
    ],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']),
      ot('OD1', '1', 'Delivered', daysAgo(3)),      // → added
      ot('OD2', '2', 'DELIVERED', daysAgo(2)),      // exactly 2 days → added
      ot('OD3', '3', 'Delivered', daysAgo(1)),      // too early
      ot('OD4', '4', 'RTO Delivered', daysAgo(5)),  // a return, not a delivery
      ot('OD5', '5', 'Delivered', daysAgo(9)),      // Self Ship case → never added
    ],
    'Self Ship Cases': [SS_HEADER, ss_('OD5', '5', 'Customer Return', 'Pending')],
    'Review & Rating Data': [RV_HEADER,
      ['OD9', ist(2026, 9, 1), 'F9', 'Bed', 'Nine', 1, ist(2026, 9, 5), 'called', 'link', 'msg', 'Done', 'team note', '9'],
    ],
  });
  t.run('CT_syncNow()');
  let rv = t.tab('Review & Rating Data');
  assert.strictEqual(rv[0][12], 'Order Item Id');
  assert.deepStrictEqual(rv.slice(1).map((r) => r[0]), ['OD9', 'OD1', 'OD2']);
  const r1 = rv[2];
  assert.deepStrictEqual([day(r1[1]), r1[2], r1[3], r1[4], r1[5], day(r1[6]), r1[12]],
    ['2026-09-21', 'F1', 'Bed', 'One', 9100000001, day(daysAgo(3)), '1']);
  assert.ok([7, 8, 9, 10, 11].every((c) => r1[c] === undefined), "your team's columns H-L are never written");
  assert.strictEqual(rv[3][3], 'Sofa');

  // Later, OD1 becomes a Self Ship case → removed straight away (via the edit trigger); other rows keep their notes.
  t.tab('Self Ship Cases').push(ss_('OD1', '1', 'Replacement', 'Not required'));
  t.run(`CT_onEdit({ range: { getSheet: () => ({ getName: () => 'Self Ship Cases' }) } })`);
  rv = t.tab('Review & Rating Data');
  assert.deepStrictEqual(rv.slice(1).map((r) => r[0]), ['OD9', 'OD2']);
  assert.deepStrictEqual(rv[1].slice(7, 12), ['called', 'link', 'msg', 'Done', 'team note']);
  assert.ok(t.log().some((m) => m.includes('OD1') && m.includes('Removed from Review & Rating Data')), t.log().join('\n'));
  // ...and Order Tracking shows the Self Ship request.
  assert.deepStrictEqual(t.tab('Order Tracking')[1].slice(13, 15), ['Replacement', 'Not required']);

  // Running again does not add OD1 back, and does not duplicate OD2.
  t.run('CT_hourlySync()');
  assert.deepStrictEqual(t.tab('Review & Rating Data').slice(1).map((r) => r[0]), ['OD9', 'OD2']);
});

// ── 3. When the sync runs ──
scenario('edits: Self Ship → right away, Pre CRM → one sync a minute later, other tabs → nothing', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'One', phone: 1, remark: 'Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER], 'Raw p&l sheet': [['x']],
  });
  const edit = (tab) => t.run(`CT_onEdit({ range: { getSheet: () => ({ getName: () => ${JSON.stringify(tab)} }) } })`);
  edit('Raw p&l sheet');
  assert.strictEqual(t.tab('Order Tracking').length, 1);
  assert.strictEqual(t.triggers.length, 0);
  edit('Pre CRM'); edit('Pre CRM'); edit('Pre CRM');
  assert.deepStrictEqual(t.triggers.map((x) => [x.handler, x.after]), [['CT_delayedSync', 60000]], 'many edits → one pending sync');
  assert.strictEqual(t.tab('Order Tracking').length, 1, 'not yet');
  t.run('CT_delayedSync()');
  assert.strictEqual(t.tab('Order Tracking')[1][0], 'OD1');
  assert.strictEqual(t.triggers.length, 0, 'the one-off trigger cleans itself up');
  edit('Self Ship Cases');
  assert.strictEqual(t.triggers.length, 0, 'Self Ship edits sync immediately');
});

// ── 4. Rows inserted while syncing ──
scenario('a row inserted in Order Tracking during the sync is not overwritten', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'New name', phone: 1, remark: 'Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), ['OD1', '', 'S1', 'F1', 'Old name', 1, 'T1', 'Delhivery', '', '', '', '', '', '', '', '1']],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  // Simulate someone inserting a row at the top between reading and writing.
  const sheet = t.ss.getSheetByName('Order Tracking');
  const real = sheet.getRange.bind(sheet);
  let reads = 0;
  sheet.getRange = (...a) => {
    const r = real(...a);
    const gv = r.getDisplayValues;
    r.getDisplayValues = () => { if (++reads === 2) sheet.data.splice(1, 0, ['ODX', '', '', '', '', '', 'TX']); return gv(); };
    return r;
  };
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((r) => [r[0], r[4]]), [['ODX', ''], ['OD1', 'Old name']]);
  assert.ok(t.log().some((m) => m.includes('Rows moved while syncing')), t.log().join('\n'));
});

console.log(`\nAll ${passed} sync scenarios passed`);
