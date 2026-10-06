/**
 * Tests for the order sync (Pre CRM → Order Tracking → Review & Rating Data).
 * Run with:  node tests/sync.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { makeSpreadsheet, makeScriptApp, makeLockService, Utilities } = require('./fake-sheet');

const FILES = ['Config.gs', 'Utils.gs', 'Delhivery.gs', 'TrackCourier.gs', 'DPWorld.gs', 'Sync.gs', 'Fsn.gs', 'Main.gs'];
const DAY = 86400000;
const ist = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 330 * 60000); // a date cell (midnight IST)
const daysAgo = (n) => { const t = new Date(Date.now() + 330 * 60000 - n * DAY); return ist(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()); };
const day = (v) => (v instanceof Date ? Utilities.formatDate(v) : v);
const link = (fsn) => `=HYPERLINK("https://www.flipkart.com/product/p/itmf${fsn}?pid=${fsn}","${fsn}")`;

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
  const locks = makeLockService();
  const ctx = vm.createContext({
    console: { log() {}, error: console.error },
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ alert() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: (k) => { delete props[k]; } }) },
    LockService: locks.service,
    ScriptApp: makeScriptApp(triggers),
    UrlFetchApp: { fetch: () => { throw new Error('the order sync must not call any API'); } },
    Utilities,
  });
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
  return {
    ss, ctx, triggers, props, locks,
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
  assert.deepStrictEqual([day(a[1]), a[3], a[4], a[5], day(a[11])], ['2026-09-20', link('FA'), 'Asha', 9111111111, '2026-10-04']);
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
    ['2026-09-21', link('F1'), 'Bed', 'One', 9100000001, day(daysAgo(3)), '1']);
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

// ── 5. Formula-only rows (like a "Days Remaining" Remarks formula filled down) ──
const daysFormula = (r) => `=Ifs(or(J${r}="Delivered",ISBLANK(L${r})=True),"",True,"")`;
const blankWithFormula = (r) => ['', '', '', '', '', '', '', '', '', '', '', '', daysFormula(r)];
scenario('rows that only hold a formula count as empty: orders start at row 2, formulas stay', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'One', phone: 1, remark: 'Dispatch', by: ist(2026, 10, 1) })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), blankWithFormula(2), blankWithFormula(3), blankWithFormula(4)],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  const ot = t.tab('Order Tracking');
  assert.deepStrictEqual([ot[1][0], ot[1][12], ot[1][15]], ['OD1', daysFormula(2), '1']);
  assert.deepStrictEqual([ot[2][0], ot[2][12]], ['', daysFormula(3)]);
  assert.strictEqual(ot.length, 4, 'nothing added below');
});

// ── 6. Moving orders that were added below the formula rows up to the top ──
scenario('"Move orders up" fixes orders that were added below formula rows', () => {
  const orderRow = (o, item, extra = {}) => Object.assign([o, ist(2026, 9, 21), 'SKU' + item, 'F' + item, 'Name', 9000000000 + Number(item),
    '', '', '', '', '', ist(2026, 10, 1), '', '', '', item], extra);
  const t = load({
    'Pre CRM': [PRE_HEADER], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']),
      blankWithFormula(2), blankWithFormula(3), blankWithFormula(4), blankWithFormula(5),
      orderRow('OD1', '1', { 3: link('F1') }), orderRow('OD2', '2', { 6: 'TRK2', 7: 'Delhivery', 13: 'Replacement' }), orderRow('OD3', '3')],
  });
  const sheet = t.ss.getSheetByName('Order Tracking');
  sheet.formats['7,2'] = 'dd-mmm-yyyy';
  const alerts = [];
  t.ctx.SpreadsheetApp.getUi = () => ({ alert: (m) => alerts.push(m) });
  t.run('CT_moveOrdersToTop()');
  assert.deepStrictEqual(alerts, ['Moved 3 row(s) up: they now start at row 2.']);
  const ot = t.tab('Order Tracking');
  assert.deepStrictEqual(ot.slice(1, 4).map((r) => [r[0], r[6], r[7], r[13], r[15]]),
    [['OD1', '', '', '', '1'], ['OD2', 'TRK2', 'Delhivery', 'Replacement', '2'], ['OD3', '', '', '', '3']]);
  assert.ok(ot[1][1] instanceof Date && ot[1][11] instanceof Date, 'dates moved as dates');
  assert.strictEqual(ot[1][3], link('F1'), 'an FSN link (a formula on the order row) moves with its row');
  assert.strictEqual(sheet.formats['3,2'], 'dd-mmm-yyyy', 'number formats move with the values (OD2: row 7 → row 3)');
  // The Remarks formulas did not move and were not overwritten.
  assert.deepStrictEqual(ot.slice(1, 5).map((r) => r[12]), [daysFormula(2), daysFormula(3), daysFormula(4), daysFormula(5)]);
  // The old rows are now empty.
  assert.ok(ot.slice(4).every((r) => r.slice(0, 16).every((v, c) => c === 12 || v === '' || v === undefined)), JSON.stringify(ot.slice(4)));
  // Running it again changes nothing, and a following sync keeps the rows where they are.
  alerts.length = 0;
  t.run('CT_moveOrdersToTop()');
  assert.deepStrictEqual(alerts, ['Orders already start at the top; nothing to move.']);
});

scenario('"Move orders up" refuses (and changes nothing) when a column has formulas on empty rows and order data', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), blankWithFormula(2),
      ['OD1', '', '', '', '', '', '', '', '', '', '', '', 'typed remark', '', '', '1']],
  });
  const before = JSON.stringify(t.tab('Order Tracking'));
  const alerts = [];
  t.ctx.SpreadsheetApp.getUi = () => ({ alert: (m) => alerts.push(m) });
  t.run('CT_moveOrdersToTop()');
  assert.ok(/Column M has formulas on empty rows as well as order data/.test(alerts[0]), alerts[0]);
  assert.strictEqual(JSON.stringify(t.tab('Order Tracking')), before);
});

// ── 7. If the sync fails, the reason still appears in the log tab ──
scenario('a failing sync still writes its reason to the Order Sync Log tab', () => {
  const t = load({ 'Pre CRM': [PRE_HEADER], 'Order Tracking': [OT_HEADER], 'Review & Rating Data': [RV_HEADER] }); // no Self Ship tab
  assert.throws(() => t.run('CT_syncNow()'), /Could not find the tab "Self Ship Cases"/);
  assert.ok(t.log().some((m) => m.includes('ERROR') && m.includes('Could not find the tab "Self Ship Cases"')), t.log().join('\n'));
  assert.strictEqual(t.props.CT_SYNC_RUNNING_SINCE, undefined);
});

// ── 9. FSN links ──
scenario('FSNs are written as clickable Flipkart links; existing plain FSNs are converted once', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'BDDHAYHWAX2JGNHZ', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'One', phone: 1, remark: 'Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), ['OD1', ist(2026, 9, 21), 'S1', 'BDDHAYHWAX2JGNHZ', 'One', 1, '', '', '', '', '', '', '', '', '', '1']],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  const cell = t.tab('Order Tracking')[1][3];
  assert.strictEqual(cell, '=HYPERLINK("https://www.flipkart.com/product/p/itmfBDDHAYHWAX2JGNHZ?pid=BDDHAYHWAX2JGNHZ","BDDHAYHWAX2JGNHZ")');
  const before = t.ss.writes.length;
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.ss.writes.slice(before).filter((w) => !w.startsWith('Order Sync Log')), [], 'links are not rewritten every hour');
});

// ── 10. FSN links in every tab ──
scenario('FSN links in every tab: pasted values right away, script-written values hourly', () => {
  const lookup = '=VLOOKUP(A2,category!A:B,2,FALSE)';
  const t = load({
    'Pre CRM': [PRE_HEADER], 'Order Tracking': [OT_HEADER], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
    'Distribution': [['SKU', 'FSN', 'Listing ID'], ['S1', 'BDDGZM2ZSMXVKSVY', 'LST1'], ['S2', '', 'LST2'], ['S3', link('ALREADY'), 'LST3']],
    'Negative Rating Data': [['Order', 'x', 'y', 'z', ' fsn '], ['OD1', 'a', 'b', 'c', '']], // FSN in column E, odd spacing/case
    'Lookups': [['SKU', 'FSN'], ['S9', lookup]],
    'Notes': [['Note'], ['BDDGZM2ZSMXVKSVY']], // no FSN heading: never touched
  });
  const paste = (tab, row, col, rows, cols) => t.run(`CT_onEdit({ range: SpreadsheetApp.getActiveSpreadsheet().getSheetByName(${JSON.stringify(tab)}).getRange(${row}, ${col}, ${rows}, ${cols}) })`);
  t.ctx.SpreadsheetApp.getActiveSpreadsheet = () => t.ss;

  // Paste 3 rows x 3 columns (C2:E4) into Negative Rating Data: only column E (FSN) changes.
  const neg = t.tab('Negative Rating Data');
  neg[1] = ['OD1', 'a', 'pasted C', 'pasted D', 'FSNONE'];
  neg[2] = ['OD2', 'a', 'pasted C', 'pasted D', 'FSNTWO'];
  neg[3] = ['OD3', 'a', 'pasted C', 'pasted D', ''];
  const before = t.ss.writes.length;
  paste('Negative Rating Data', 2, 3, 3, 3);
  assert.deepStrictEqual(neg.slice(1).map((r) => r.slice(2)), [['pasted C', 'pasted D', link('FSNONE')], ['pasted C', 'pasted D', link('FSNTWO')], ['pasted C', 'pasted D', '']]);
  assert.ok(t.ss.writes.slice(before).every((w) => /^Negative Rating Data!R[23]C5$/.test(w)), t.ss.writes.slice(before).join(' '));

  // Editing only the heading row changes nothing.
  const before2 = t.ss.writes.length;
  paste('Distribution', 1, 1, 1, 3);
  assert.strictEqual(t.ss.writes.length, before2);

  // Values written by scripts are converted by the hourly run, in every tab.
  t.run('CT_hourlySync()');
  const dist = t.tab('Distribution');
  assert.deepStrictEqual(dist.slice(1).map((r) => r[1]), [link('BDDGZM2ZSMXVKSVY'), '', link('ALREADY')]);
  assert.strictEqual(t.tab('Lookups')[1][1], lookup, 'a lookup formula is left alone');
  assert.strictEqual(t.tab('Notes')[1][0], 'BDDGZM2ZSMXVKSVY', 'columns not headed FSN are never touched');

  // The menu reports when there is nothing left to do.
  const msgs = [];
  t.ctx.SpreadsheetApp.getActiveSpreadsheet = () => Object.assign(t.ss, { toast: (m) => msgs.push(m) });
  t.run('CT_linkAllFsns()');
  assert.deepStrictEqual(msgs, ['All FSNs are already clickable links.']);
});

// ── 11. "Do Not Dispatch" ──
scenario('"Do Not Dispatch" (any spelling) never comes in, and is removed unless you typed tracking details', () => {
  const t = load({ 'Pre CRM': [PRE_HEADER], 'Order Tracking': [OT_HEADER], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER] });
  const yes = ['Dispatch', 'DISPATCHED', 'Dispatch, Color Change', 'Call Not Pick, Dispatch', 'Dispatch, Do not call'];
  const no = ['Do Not Dispatch', 'do not dispatch', 'Do Not  Dispatch', "Don't Dispatch", 'Dont dispatch', 'DoNot Dispatch',
    'Do-Not-Dispatch', 'Not to Dispatch', 'No Dispatch', 'Not dispatched yet', 'Hold - Do not Dispatch', 'Call Not Pick', ''];
  yes.forEach((r) => assert.strictEqual(t.run(`CT_hasDispatchRemark_(${JSON.stringify(r)})`), true, r));
  no.forEach((r) => assert.strictEqual(t.run(`CT_hasDispatchRemark_(${JSON.stringify(r)})`), false, r));
});

scenario('orders already in Order Tracking that become "Do Not Dispatch" are removed (rows with your data are kept)', () => {
  const p = (o, item, remark) => pre({ sku: 'S' + item, fsn: 'F' + item, order: o, item, on: ist(2026, 9, 21), name: 'N', phone: 1, remark, by: '' });
  const r = (o, item, g = '', h = '') => [o, ist(2026, 9, 21), 'S' + item, link('F' + item), 'N', 1, g, h, '', '', '', '', '=formula', '', '', item];
  const t = load({
    'Pre CRM': [PRE_HEADER, p('OD1', '1', 'Dispatch'), p('OD2', '2', 'Do Not Dispatch'), p('OD3', '3', "Don't dispatch"), p('OD4', '4', 'Dispatch')],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), r('OD1', '1'), r('OD2', '2'), r('OD3', '3', 'TRK3', 'Delhivery'), r('OD4', '4')],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((x) => x[0]), ['OD1', 'OD3', 'OD4']);
  const log = t.log();
  assert.ok(log.some((m) => m.includes('OD2') && m.includes('Removed: Pre CRM says not to dispatch')), log.join('\n'));
  assert.ok(log.some((m) => m.includes('OD3') && m.includes('has a Tracking ID, Courier or Remark typed in, so it is kept')), log.join('\n'));
  // A second sync changes nothing more.
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((x) => x[0]), ['OD1', 'OD3', 'OD4']);
});

scenario('no rows are removed while the tracking update is running (done on the next sync)', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Do Not Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']), ['OD1', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '1']],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.props.CT_RESUME_ROW = '5';
  t.run('CT_syncNow()');
  assert.strictEqual(t.tab('Order Tracking')[1][0], 'OD1');
  delete t.props.CT_RESUME_ROW;
  t.run('CT_syncNow()');
  assert.strictEqual(t.tab('Order Tracking').length, 1);
});

// ── 12. Duplicates ──
scenario('a second sync starting while one is running does nothing (this is how duplicates appeared)', () => {
  const t = load({
    'Pre CRM': [PRE_HEADER, pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id'])], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  // While the first sync is reading Pre CRM, a second one starts (e.g. hourly + an edit at the same moment).
  const preSheet = t.ss.getSheetByName('Pre CRM');
  const real = preSheet.getRange.bind(preSheet);
  let second = null;
  preSheet.getRange = (...a) => { if (second === null) second = t.run('CT_runSync_({})'); return real(...a); };
  t.run('CT_syncNow()');
  assert.strictEqual(second, false, 'the second sync must not run');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((r) => r[0]), ['OD1'], 'exactly one row');
  assert.ok(!t.locks.state.held, 'the lock is released');
});

scenario('duplicate rows of the same product are removed, keeping the one with your typed data', () => {
  const row = (o, item, g = '', h = '', m = '') => [o, ist(2026, 9, 21), 'S' + item, link('F' + item), 'N', 1, g, h, '', '', '', '', m, '', '', item];
  const t = load({
    'Pre CRM': [PRE_HEADER,
      pre({ sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S2', fsn: 'F2', order: 'OD2', item: '2', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S3', fsn: 'F3', order: 'OD3', item: '3', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' }),
      pre({ sku: 'S4', fsn: 'F4', order: 'OD4', item: '4', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' })],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id']),
      row('OD1', '1'), row('OD1', '1', 'TRK1', 'Delhivery'), row('OD1', '1'),      // keep the one with the Tracking ID
      row('OD2', '2', 'TRKa', 'Delhivery'), row('OD2', '2', 'TRKb', 'Safexpress'), // both typed → both kept, reported
      row('OD3', '3'), ['OD3', '', '', '', '', '', '', '', '', '', '', '', '=formula'], // copy without Order Item Id
      row('OD4', '4', 'TRK4', 'Delhivery'), row('OD4', '4', 'trk4', 'Delhivery'),   // exact duplicates → one removed
    ],
    'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((r) => [r[0], r[6]]),
    [['OD1', 'TRK1'], ['OD2', 'TRKa'], ['OD2', 'TRKb'], ['OD3', ''], ['OD4', 'TRK4']]);
  const log = t.log();
  assert.strictEqual(log.filter((m) => m.includes('Removed: duplicate')).length, 3, log.join('\n'));
  assert.strictEqual(log.filter((m) => m.includes('Removed: exact duplicate')).length, 1, log.join('\n'));
  assert.ok(log.some((m) => m.includes('OD2') && m.includes('both rows have a Tracking ID')), log.join('\n'));
  // Nothing more happens on the next sync.
  t.run('CT_syncNow()');
  assert.strictEqual(t.tab('Order Tracking').length, 6);
});

scenario('a product listed twice in Pre CRM gets two rows in Order Tracking (and keeps them)', () => {
  const same = { sku: 'S1', fsn: 'F1', order: 'OD1', item: '1', on: ist(2026, 9, 21), name: 'N', phone: 1, remark: 'Dispatch', by: '' };
  const t = load({
    'Pre CRM': [PRE_HEADER, pre(same), pre(same)],
    'Order Tracking': [OT_HEADER.concat(['Order Item Id'])], 'Self Ship Cases': [SS_HEADER], 'Review & Rating Data': [RV_HEADER],
  });
  t.run('CT_syncNow()');
  t.run('CT_syncNow()');
  assert.deepStrictEqual(t.tab('Order Tracking').slice(1).map((r) => [r[0], r[15]]), [['OD1', '1'], ['OD1', '1 #2']]);
  assert.ok(!t.log().some((m) => m.includes('Removed')), t.log().join('\n'));
});

console.log(`\nAll ${passed} sync scenarios passed`);
