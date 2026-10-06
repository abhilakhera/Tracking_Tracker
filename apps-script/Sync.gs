/**
 * ORDER SYNC: keeps "Order Tracking" and "Review Calling" filled from
 * "Pre CRM" and "Self Ship Cases". No API calls; it only moves data between tabs.
 *
 *  1. Pre CRM → Order Tracking: one row per product (Order Item Id) for orders placed on or
 *     after CT_SYNC.INCLUDE_ORDERS_FROM whose Remarks contain "Dispatch". New products are
 *     added at the bottom; existing rows get their details refreshed. Rows are never deleted,
 *     and Tracking ID, Courier and Remarks (G, H, M) are never touched.
 *  2. Self Ship Cases → Order Tracking: Return Request Type (N) and Refund Status (O).
 *  3. Order Tracking → Review Calling: a product whose Brief Status is "Delivered" is
 *     added CT_SYNC.REVIEW_AFTER_DAYS days after its Status Date, unless the order is in
 *     Self Ship Cases. Orders that are (or later appear) in Self Ship Cases are removed.
 *     Your team's columns (H-L) are never touched.
 *
 * Runs: every hour, a minute after an edit to Pre CRM, right after an edit to Self Ship
 * Cases, before the daily tracking update, and from the menu.
 */

// ─── Entry points ─────────────────────────────────────────────────────────────

/** Menu: "Sync orders now". */
function CT_syncNow() {
  CT_runSync_({ interactive: true });
  CT_linkFsnsSafely_();
}

/** Hourly trigger. */
function CT_hourlySync() {
  CT_runSync_({});
  CT_linkFsnsSafely_(); // FSNs written by other scripts, in any tab
}

/** FSN links in all tabs; never lets a problem there stop the caller. */
function CT_linkFsnsSafely_() {
  if (!CT_SYNC.FSN_AS_LINK) return;
  try { CT_linkAllFsns_(); } catch (e) { console.error('FSN links: ' + e.message); }
}

/** One-off trigger, a minute after edits to Pre CRM (many quick edits → one sync). */
function CT_delayedSync() {
  CT_deleteTriggers_('CT_delayedSync');
  if (!CT_runSync_({})) CT_scheduleSync_(); // another sync was busy: try again in a minute
}

/** Installable "on edit" trigger (created by CT_setup). Ignores edits to other tabs. */
function CT_onEdit(e) {
  if (!e || !e.range) return;
  // FSNs typed or pasted in any tab become links straight away.
  if (CT_SYNC.FSN_AS_LINK) {
    try { CT_linkFsnsInEdit_(e.range); } catch (err) { console.error('FSN links: ' + err.message); }
  }
  var name = e.range.getSheet().getName();
  if (name === CT_SYNC.SELF_SHIP.SHEET) {
    // Self Ship cases must leave Review Calling straight away.
    if (!CT_runSync_({})) CT_scheduleSync_();
  } else if (name === CT_SYNC.PRE_CRM.SHEET) {
    CT_scheduleSync_();
  }
}

function CT_scheduleSync_() {
  var pending = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'CT_delayedSync';
  });
  if (!pending) ScriptApp.newTrigger('CT_delayedSync').timeBased().after(60 * 1000).create();
}

/**
 * Menu: "Move orders up to the top". Moves every row of Order Tracking that has data up
 * into the empty rows below the heading, keeping their order. Cells with formulas (such as
 * the Remarks "Days Remaining" formula) are never moved or overwritten, so each formula
 * keeps working on its own row. Safe to run again: if there is no gap, nothing changes.
 */
function CT_moveOrdersToTop() {
  var props = PropertiesService.getScriptProperties();
  var busy = function (k) { var t = Number(props.getProperty(k)) || 0; return t && Date.now() - t < 10 * 60 * 1000; };
  if (busy('CT_RUNNING_SINCE') || props.getProperty('CT_RESUME_ROW') || !CT_claimFlag_('CT_SYNC_RUNNING_SINCE', 10 * 60 * 1000)) {
    CT_notify_({ interactive: true }, 'An update is running right now. Try again in a few minutes.');
    return;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = CT_requireSheet_(ss, CT_CONFIG.SHEET_NAME);
    var result;
    try {
      result = CT_moveRowsUp_(sheet, CT_CONFIG.HEADER_ROWS, CT_columnNumber_(CT_SYNC.ORDER_TRACKING.ORDER_ITEM_ID));
    } catch (e) {
      result = 'Could not move the rows: ' + e.message;
    }
    try { SpreadsheetApp.getUi().alert(result); } catch (e) { CT_notify_({ interactive: true }, result); }
  } finally {
    props.deleteProperty('CT_SYNC_RUNNING_SINCE');
  }
}

/** Moves rows with data (ignoring formula cells) up to the first rows, columns 1..lastCol. Returns a message. */
function CT_moveRowsUp_(sheet, headerRows, lastCol) {
  var first = headerRows + 1;
  var n = sheet.getLastRow() - headerRows;
  if (n <= 0) return 'Nothing to move.';
  var range = sheet.getRange(first, 1, n, lastCol);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var formats = range.getNumberFormats();
  var hasData = function (r) {
    return values[r].some(function (v, c) { return formulas[r][c] === '' && CT_cellText_(v instanceof Date ? 'd' : v) !== ''; });
  };
  var dataRows = [];
  for (var r = 0; r < n; r++) if (hasData(r)) dataRows.push(r);
  if (!dataRows.length) return 'Nothing to move.';
  if (dataRows[dataRows.length - 1] === dataRows.length - 1) return 'Orders already start at the top; nothing to move.';

  var touched = dataRows[dataRows.length - 1] + 1; // rows 0..touched-1 are rewritten
  var isEmpty = function (v) { return !(v instanceof Date) && CT_cellText_(v) === ''; };

  // First decide what to do with every column, so nothing is changed if one can't be moved.
  // A formula on an order's row (e.g. an FSN link) belongs to that order and moves with it.
  // A formula on an empty row (e.g. the Remarks formula filled down in advance) stays put.
  var isDataRow = {};
  dataRows.forEach(function (r) { isDataRow[r] = true; });
  var toMove = [];
  for (var c = 0; c < lastCol; c++) {
    var fixedFormula = false;
    var dataContent = false;
    for (var i = 0; i < touched; i++) {
      if (isDataRow[i]) {
        if (formulas[i][c] !== '' || !isEmpty(values[i][c])) dataContent = true;
      } else if (formulas[i][c] !== '') {
        fixedFormula = true;
      }
    }
    if (!dataContent) continue;        // nothing to move in this column (e.g. Remarks)
    if (fixedFormula) {
      throw new Error('Column ' + CT_columnLetter_(c + 1) + ' has formulas on empty rows as well as order data, ' +
        'so the rows cannot be moved automatically. Nothing was changed.');
    }
    toMove.push(c);
  }

  toMove.forEach(function (c) {
    var newValues = [];
    var newFormats = [];
    for (var k = 0; k < touched; k++) {
      var src = dataRows[k];
      // A formula is written back as a formula (setValues treats "=..." as a formula).
      newValues.push([src === undefined ? '' : (formulas[src][c] || values[src][c])]);
      newFormats.push([src === undefined ? formats[k][c] : formats[src][c]]);
    }
    sheet.getRange(first, c + 1, touched, 1).setNumberFormats(newFormats).setValues(newValues);
  });
  return 'Moved ' + dataRows.length + ' row(s) up: they now start at row ' + first + '.';
}

function CT_columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Set a "running since" flag unless another run holds it. The check and the set happen
 * together under Google's script lock (held only for that instant), so two runs that
 * start at the same moment can never both go ahead. Returns true if this run may go ahead.
 */
function CT_claimFlag_(name, maxAgeMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return false;
  try {
    var props = PropertiesService.getScriptProperties();
    var since = Number(props.getProperty(name)) || 0;
    if (since && Date.now() - since < maxAgeMs) return false;
    props.setProperty(name, String(Date.now()));
    return true;
  } finally {
    lock.releaseLock();
  }
}

// ─── The sync ─────────────────────────────────────────────────────────────────

/** Returns true if it ran, false if another sync was already running. */
function CT_runSync_(options) {
  var props = PropertiesService.getScriptProperties();
  if (!CT_claimFlag_('CT_SYNC_RUNNING_SINCE', 5 * 60 * 1000)) {
    CT_notify_(options, 'A sync is already running. Try again in a minute.');
    return false;
  }
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var tz = ss.getSpreadsheetTimeZone();
    var log = new CT_SyncLog_(ss);
    try {
      var pre = CT_readPreCrm_(ss, tz, log);
      var selfShip = CT_readSelfShip_(ss, pre);
      var ot = CT_syncOrderTracking_(ss, tz, pre, selfShip, log);
      var rv = CT_syncReviews_(ss, tz, pre, selfShip, log);
      var summary = 'Order Tracking: ' + ot.added + ' product(s) added, ' + ot.updated + ' updated. ' +
        'Review Calling: ' + rv.added + ' added, ' + rv.updated + ' updated, ' + rv.removed + ' removed (Self Ship).';
      log.add('', '', 'INFO', summary);
      log.flush();
      CT_notify_(options, summary);
    } catch (e) {
      // Leave a note in the log tab so the problem is visible in the sheet.
      log.add('', '', 'ERROR', 'The sync stopped: ' + e.message);
      try { log.flush(); } catch (ignore) { /* nothing more we can do */ }
      CT_notify_(options, 'The sync stopped: ' + e.message);
      throw e;
    }
    return true;
  } finally {
    props.deleteProperty('CT_SYNC_RUNNING_SINCE');
  }
}

/**
 * Read Pre CRM. Returns { items: [...qualifying, in sheet order], byKey: {}, byOrder: {} }.
 * byKey/byOrder include every row (also non-qualifying) so details can be looked up.
 */
function CT_readPreCrm_(ss, tz, log) {
  var C = CT_SYNC.PRE_CRM;
  var sheet = CT_requireSheet_(ss, C.SHEET);
  var t = CT_readTable_(sheet, C.HEADER_ROWS, [C.SKU, C.FSN, C.CATEGORY, C.ORDER_ID, C.ORDER_ITEM_ID,
    C.ORDERED_ON, C.NAME, C.PHONE, C.REMARKS, C.DELIVERY_BY]);
  var fromDay = CT_dayFromText_(CT_SYNC.INCLUDE_ORDERS_FROM);
  var out = { items: [], byKey: {}, byOrder: {} };
  for (var i = 0; i < t.count; i++) {
    var orderId = t.text(i, C.ORDER_ID);
    if (!orderId) continue;
    var item = {
      row: t.firstRow + i,
      orderId: orderId,
      itemId: t.text(i, C.ORDER_ITEM_ID),
      sku: t.value(i, C.SKU),
      fsn: t.value(i, C.FSN),
      category: t.value(i, C.CATEGORY),
      orderedOn: CT_cellDate_(t.value(i, C.ORDERED_ON)),
      name: t.value(i, C.NAME),
      phone: t.value(i, C.PHONE),
      deliveryBy: CT_cellDate_(t.value(i, C.DELIVERY_BY)),
      remarks: t.text(i, C.REMARKS),
    };
    item.key = CT_itemKey_(item.orderId, item.itemId, item.sku);
    var day = item.orderedOn ? CT_dayNumber_(item.orderedOn, tz) : null;
    item.qualifies = CT_hasDispatchRemark_(item.remarks) && day !== null && day >= fromDay;
    item.doNotDispatch = CT_isDoNotDispatch_(item.remarks);

    if (out.byKey[item.key]) {
      // The same product on several Pre CRM rows: Order Tracking gets the same number of rows.
      var n = 2;
      while (out.byKey[item.key + ' #' + n]) n++;
      if (item.qualifies) log.add(C.SHEET + ' row ' + item.row, orderId, 'INFO',
        'This product is also on Pre CRM row ' + out.byKey[item.key].row + ', so Order Tracking gets a row for each.');
      item.key = item.key + ' #' + n;
    }
    out.byKey[item.key] = item;
    (out.byOrder[orderId] = out.byOrder[orderId] || []).push(item);
    if (item.qualifies) {
      out.items.push(item);
      if (!item.itemId) log.add(C.SHEET + ' row ' + item.row, orderId, 'INFO',
        'No Order Item Id; this product is matched by Order Id + SKU instead.');
    }
    if (CT_hasDispatchRemark_(item.remarks) && day === null) {
      log.add(C.SHEET + ' row ' + item.row, orderId, 'ERROR', '"Ordered On" is empty or not a date, so this order was not added.');
    }
  }
  return out;
}

/**
 * Read Self Ship Cases. Returns { byItem: {itemId: info}, byOrder: {orderId: info}, orders: {orderId: true} }.
 * A case with an Order Item Id applies to that product only; a case without one (or with an
 * Order Item Id that isn't in Pre CRM) applies to every product of the order.
 */
function CT_readSelfShip_(ss, pre) {
  var C = CT_SYNC.SELF_SHIP;
  var sheet = CT_requireSheet_(ss, C.SHEET);
  var t = CT_readTable_(sheet, C.HEADER_ROWS, [C.ORDER_ID, C.ORDER_ITEM_ID, C.REQUEST_TYPE, C.REFUND_STATUS]);
  var out = { byItem: {}, byOrder: {}, orders: {} };
  for (var i = 0; i < t.count; i++) {
    var orderId = t.text(i, C.ORDER_ID);
    if (!orderId) continue;
    var info = { requestType: t.value(i, C.REQUEST_TYPE), refundStatus: t.value(i, C.REFUND_STATUS) };
    var itemId = t.text(i, C.ORDER_ITEM_ID);
    out.orders[orderId] = true;
    // A later row for the same case wins.
    if (itemId && pre.byKey[itemId]) out.byItem[itemId] = info;
    else out.byOrder[orderId] = info;
  }
  return out;
}

/** Self Ship info for a product: by Order Item Id first, otherwise by Order Id. */
function CT_selfShipFor_(selfShip, orderId, itemId) {
  return (itemId && selfShip.byItem[itemId]) || selfShip.byOrder[orderId] || null;
}

/** Pre CRM → Order Tracking, and Self Ship → Order Tracking (N, O). */
function CT_syncOrderTracking_(ss, tz, pre, selfShip, log) {
  var O = CT_SYNC.ORDER_TRACKING;
  var sheet = CT_requireSheet_(ss, CT_CONFIG.SHEET_NAME);
  var trackingIdCol = CT_CONFIG.COLUMNS.TRACKING_ID;
  var columns = [O.ORDER_ID, O.ORDER_DATE, O.SKU, O.FSN, O.NAME, O.PHONE,
    O.DELIVERY_BY, O.RETURN_TYPE, O.REFUND_STATUS, O.ORDER_ITEM_ID, trackingIdCol, CT_CONFIG.COLUMNS.COURIER, O.REMARKS];
  var t = CT_readTable_(sheet, CT_CONFIG.HEADER_ROWS, columns);
  CT_ensureHeader_(sheet, O.ORDER_ITEM_ID, 'Order Item Id');
  if (CT_cleanUpOrderTracking_(sheet, t, pre, log)) t = CT_readTable_(sheet, CT_CONFIG.HEADER_ROWS, columns);

  // Index the rows already there.
  var rowOfKey = {};       // item key → row index
  var unclaimed = {};      // orderId → [row index] rows with an Order Id but no Order Item Id yet
  for (var i = 0; i < t.count; i++) {
    var orderId = t.text(i, O.ORDER_ID);
    var key = t.text(i, O.ORDER_ITEM_ID);
    if (key) rowOfKey[key] = i;
    else if (orderId) (unclaimed[orderId] = unclaimed[orderId] || []).push(i);
    else if (t.text(i, trackingIdCol)) {
      log.add(CT_CONFIG.SHEET_NAME + ' row ' + (t.firstRow + i), '', 'INFO',
        'This row has a Tracking ID but no Order Id. It is left as it is; delete it if it was a test row.');
    }
  }

  var desired = {};        // row index → { column letter: value }
  var stats = { added: 0, updated: 0 };
  var next = t.count;      // index of the next new row
  var seen = {};

  pre.items.forEach(function (item) {
    var idx = rowOfKey[item.key];
    if (idx === undefined) {
      // A row typed in by hand with the same Order Id: take it over (same SKU first).
      var list = unclaimed[item.orderId] || [];
      var pick = -1;
      for (var k = 0; k < list.length; k++) {
        if (CT_same_(t.value(list[k], O.SKU), item.sku)) { pick = k; break; }
      }
      if (pick < 0 && list.length) pick = 0;
      if (pick >= 0) idx = list.splice(pick, 1)[0];
    }
    var isNew = idx === undefined;
    if (isNew) idx = next++;
    seen[idx] = true;
    var self = CT_selfShipFor_(selfShip, item.orderId, item.itemId);
    desired[idx] = {
      isNew: isNew,
      values: CT_pairs_([
        [O.ORDER_ID, item.orderId], [O.ORDER_DATE, CT_dateOnly_(item.orderedOn, tz)], [O.SKU, item.sku],
        [O.FSN, item.fsn], [O.NAME, item.name], [O.PHONE, item.phone],
        [O.DELIVERY_BY, CT_dateOnly_(item.deliveryBy, tz)],
        [O.RETURN_TYPE, self ? self.requestType : ''], [O.REFUND_STATUS, self ? self.refundStatus : ''],
        [O.ORDER_ITEM_ID, item.key],
      ]),
    };
  });

  // Rows not (yet) removed by the clean-up (e.g. while tracking runs): only N and O refreshed.
  for (var r = 0; r < t.count; r++) {
    if (seen[r]) continue;
    var oid = t.text(r, O.ORDER_ID);
    if (!oid) continue;
    var self2 = CT_selfShipFor_(selfShip, oid, t.text(r, O.ORDER_ITEM_ID));
    desired[r] = { isNew: false, values: CT_pairs_([
      [O.RETURN_TYPE, self2 ? self2.requestType : ''], [O.REFUND_STATUS, self2 ? self2.refundStatus : ''],
    ]) };
  }

  // Keep only the cells that actually change.
  var changes = {};
  Object.keys(desired).forEach(function (idxText) {
    var idx = Number(idxText);
    var d = desired[idx];
    var diff = d.isNew ? d.values : CT_changedCells_(t, idx, d.values, tz, [O.FSN]);
    if (!diff) return;
    changes[idx] = diff;
    if (d.isNew) stats.added++; else stats.updated++;
  });

  CT_writeChanges_(sheet, t, changes, [O.ORDER_ITEM_ID, O.ORDER_ID], log, {
    dateCols: [O.ORDER_DATE, O.DELIVERY_BY], textCols: [O.ORDER_ITEM_ID], linkCols: [O.FSN],
  });
  return stats;
}

/**
 * Make Order Tracking mirror Pre CRM before syncing. Removes every row with an Order Id that
 * Pre CRM doesn't (or no longer) list as a "Dispatch" order from the start date — remark changed
 * (e.g. to "Do Not Dispatch"), order deleted from Pre CRM, too old — and extra copies of a
 * product beyond the number of times Pre CRM lists it. Of several copies, the row with a
 * Tracking ID / Courier / Remark typed in is the one kept.
 * Every removed row is first copied, complete, to the "Removed Orders" tab, so nothing typed
 * in is ever lost. Rows without an Order Id are left alone. Returns true if rows were removed.
 */
function CT_cleanUpOrderTracking_(sheet, t, pre, log) {
  var O = CT_SYNC.ORDER_TRACKING;
  var props = PropertiesService.getScriptProperties();
  var trackingBusy = (Number(props.getProperty('CT_RUNNING_SINCE')) || 0) > Date.now() - 10 * 60 * 1000 ||
    props.getProperty('CT_RESUME_ROW');
  var hasTypedData = function (i) {
    return !!(t.text(i, CT_CONFIG.COLUMNS.TRACKING_ID) || t.text(i, CT_CONFIG.COLUMNS.COURIER) ||
      (t.text(i, O.REMARKS) && !t.formula(i, O.REMARKS)));
  };
  var where = function (i) { return CT_CONFIG.SHEET_NAME + ' row ' + (t.firstRow + i); };
  var remove = {};  // row index → reason

  // 1. Rows whose product (or, without an Order Item Id, whose order) isn't a qualifying Pre CRM order.
  for (var i = 0; i < t.count; i++) {
    var orderId = t.text(i, O.ORDER_ID);
    if (!orderId) continue;
    var key = t.text(i, O.ORDER_ITEM_ID);
    var item = key ? pre.byKey[key] : null;
    var keep = key ? !!(item && item.qualifies)
      : (pre.byOrder[orderId] || []).some(function (it) { return it.qualifies; });
    if (keep) continue;
    var any = item || (pre.byOrder[orderId] || [])[0];
    remove[i] = !any ? 'Removed: this order is no longer in Pre CRM.'
      : any.doNotDispatch ? 'Removed: Pre CRM says "' + any.remarks + '".'
      : CT_hasDispatchRemark_(any.remarks) ? 'Removed: ordered before ' + CT_SYNC.INCLUDE_ORDERS_FROM + ' (or "Ordered On" is not a date).'
      : 'Removed: the Pre CRM remark is now "' + any.remarks + '" (not "Dispatch").';
  }

  // 2. Extra copies of the same product (Pre CRM lists each copy separately as "<id> #2", ...).
  var rowsOfKey = {};
  for (var j = 0; j < t.count; j++) {
    var k = t.text(j, O.ORDER_ITEM_ID);
    if (k && !(j in remove)) (rowsOfKey[k] = rowsOfKey[k] || []).push(j);
  }
  Object.keys(rowsOfKey).forEach(function (k) {
    var rows = rowsOfKey[k];
    if (rows.length < 2) return;
    var keepRow = rows.filter(hasTypedData)[0];
    if (keepRow === undefined) keepRow = rows[0];
    rows.forEach(function (r) {
      if (r !== keepRow) remove[r] = 'Removed: duplicate of ' + where(keepRow) + ' (Pre CRM lists this product fewer times).';
    });
  });

  // 3. Rows without an Order Item Id, for an order whose products all have their own row already.
  for (var x = 0; x < t.count; x++) {
    var oid = t.text(x, O.ORDER_ID);
    if (!oid || t.text(x, O.ORDER_ITEM_ID) || (x in remove)) continue;
    var its = (pre.byOrder[oid] || []).filter(function (it) { return it.qualifies; });
    if (its.length && its.every(function (it) { return rowsOfKey[it.key]; })) {
      remove[x] = 'Removed: duplicate row of an order that already has its own row(s).';
    }
  }

  var indexes = Object.keys(remove).map(Number).sort(function (a, b) { return b - a; }); // bottom-up
  if (!indexes.length) return false;
  if (trackingBusy) {
    indexes.forEach(function (i) {
      log.add(where(i), t.text(i, O.ORDER_ID), 'INFO', remove[i].replace('Removed:', 'Will be removed on the next sync (the tracking update is running right now):'));
    });
    return false;
  }
  var lastCol = Math.max(sheet.getLastColumn(), CT_columnNumber_(O.ORDER_ITEM_ID));
  var archived = [];
  indexes.forEach(function (i) {
    var row = t.firstRow + i;
    var range = sheet.getRange(row, 1, 1, lastCol);
    var now = range.getDisplayValues()[0];
    // Delete only if the row still holds the same order and product (rows may have moved meanwhile).
    if (CT_cellText_(now[CT_columnNumber_(O.ORDER_ID) - 1]) !== t.text(i, O.ORDER_ID) ||
        CT_cellText_(now[CT_columnNumber_(O.ORDER_ITEM_ID) - 1]) !== t.text(i, O.ORDER_ITEM_ID)) return;
    archived.push([new Date(), remove[i]].concat(range.getValues()[0]));
    sheet.deleteRow(row);
    log.add(CT_CONFIG.SHEET_NAME + ' row ' + row, t.text(i, O.ORDER_ID), 'INFO',
      remove[i] + (hasTypedData(i) ? ' Its Tracking ID / Courier / Remark were saved in the "' + CT_SYNC.REMOVED_SHEET_NAME + '" tab.' : ''));
  });
  CT_archiveRemovedRows_(sheet, archived.reverse(), lastCol);
  return archived.length > 0;
}

/** Append removed rows to the "Removed Orders" tab (created with Order Tracking's headings). */
function CT_archiveRemovedRows_(sheet, rows, lastCol) {
  if (!rows.length) return;
  var ss = sheet.getParent();
  var tab = ss.getSheetByName(CT_SYNC.REMOVED_SHEET_NAME);
  if (!tab) {
    tab = ss.insertSheet(CT_SYNC.REMOVED_SHEET_NAME);
    var head = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
    tab.getRange(1, 1, 1, lastCol + 2).setValues([['Removed On', 'Why'].concat(head)]).setFontWeight('bold');
  }
  var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
  rows = rows.map(function (r) { while (r.length < width) r.push(''); return r; });
  var start = tab.getLastRow() + 1;
  tab.getRange(start, 1, rows.length, width).setValues(rows);
  tab.getRange(start, 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
}

/** Order Tracking → Review Calling. */
function CT_syncReviews_(ss, tz, pre, selfShip, log) {
  var O = CT_SYNC.ORDER_TRACKING;
  var R = CT_SYNC.REVIEW;
  var stats = { added: 0, updated: 0, removed: 0 };
  var trackSheet = CT_requireSheet_(ss, CT_CONFIG.SHEET_NAME);
  var tr = CT_readTable_(trackSheet, CT_CONFIG.HEADER_ROWS,
    [O.ORDER_ID, O.ORDER_ITEM_ID, O.FSN, CT_CONFIG.COLUMNS.BRIEF_STATUS, CT_CONFIG.COLUMNS.STATUS_DATE]);
  var sheet = CT_requireSheet_(ss, R.SHEET);
  CT_ensureHeader_(sheet, R.ORDER_ITEM_ID, 'Order Item Id');
  var rv = CT_readTable_(sheet, R.HEADER_ROWS, [R.ORDER_ID, R.ORDER_DATE, R.FSN, R.CATEGORY, R.NAME, R.PHONE,
    R.DELIVERY_DATE, R.ORDER_ITEM_ID]);
  var today = CT_dayNumber_(new Date(), tz);

  // 1. Remove orders that are in Self Ship Cases (bottom-up so row numbers stay right).
  var removeRows = [];
  for (var i = 0; i < rv.count; i++) {
    var oid = rv.text(i, R.ORDER_ID);
    if (oid && selfShip.orders[oid]) removeRows.push(i);
  }
  removeRows.reverse().forEach(function (idx) {
    var row = rv.firstRow + idx;
    // Make sure the row still holds the same order (someone may have edited meanwhile).
    if (CT_cellText_(sheet.getRange(row, CT_columnNumber_(R.ORDER_ID)).getDisplayValue()) !== rv.text(idx, R.ORDER_ID)) return;
    sheet.deleteRow(row);
    stats.removed++;
    log.add(R.SHEET, rv.text(idx, R.ORDER_ID), 'INFO', 'Removed from ' + R.SHEET + ': the order is in ' + CT_SYNC.SELF_SHIP.SHEET + '.');
  });
  if (removeRows.length) {
    rv = CT_readTable_(sheet, R.HEADER_ROWS, [R.ORDER_ID, R.ORDER_DATE, R.FSN, R.CATEGORY, R.NAME, R.PHONE,
      R.DELIVERY_DATE, R.ORDER_ITEM_ID]);
  }

  // Rows already in Review Calling, by product.
  var rowOfKey = {};
  var unclaimed = {};
  for (var j = 0; j < rv.count; j++) {
    var o = rv.text(j, R.ORDER_ID);
    var k = rv.text(j, R.ORDER_ITEM_ID);
    if (k) rowOfKey[k] = j;
    else if (o) (unclaimed[o] = unclaimed[o] || []).push(j);
  }

  // 2. Delivered products → Review Calling.
  var changes = {};
  var next = rv.count;
  for (var x = 0; x < tr.count; x++) {
    var orderId = tr.text(x, O.ORDER_ID);
    if (!orderId || selfShip.orders[orderId]) continue;
    if (String(tr.value(x, CT_CONFIG.COLUMNS.BRIEF_STATUS)).trim().toLowerCase() !== 'delivered') continue;
    var delivered = CT_cellDate_(tr.value(x, CT_CONFIG.COLUMNS.STATUS_DATE));
    if (!delivered) continue;
    var key = tr.text(x, O.ORDER_ITEM_ID) || CT_itemKey_(orderId, '', '');
    var idx = rowOfKey[key];
    if (idx === undefined) {
      if (today < CT_dayNumber_(delivered, tz) + CT_SYNC.REVIEW_AFTER_DAYS) continue; // not yet
      var list = unclaimed[orderId] || [];
      for (var m = 0; m < list.length; m++) {
        if (CT_same_(rv.value(list[m], R.FSN), tr.value(x, O.FSN)) || list.length === 1) { idx = list.splice(m, 1)[0]; break; }
      }
    }
    var isNew = idx === undefined;
    if (isNew) idx = next++;
    rowOfKey[key] = idx;
    var item = pre.byKey[key] || (pre.byOrder[orderId] || [])[0] || {};
    var values = CT_pairs_([
      [R.ORDER_ID, orderId], [R.ORDER_DATE, CT_dateOnly_(item.orderedOn, tz)],
      [R.FSN, item.fsn !== undefined ? item.fsn : tr.value(x, O.FSN)], [R.CATEGORY, item.category || ''],
      [R.NAME, item.name || ''], [R.PHONE, item.phone || ''],
      [R.DELIVERY_DATE, CT_dateOnly_(delivered, tz)], [R.ORDER_ITEM_ID, key],
    ]);
    var diff = isNew ? values : CT_changedCells_(rv, idx, values, tz, [R.FSN]);
    if (!diff) continue;
    changes[idx] = diff;
    if (isNew) stats.added++; else stats.updated++;
  }

  CT_writeChanges_(sheet, rv, changes, [R.ORDER_ITEM_ID, R.ORDER_ID], log, {
    dateCols: [R.ORDER_DATE, R.DELIVERY_DATE], textCols: [R.ORDER_ITEM_ID], linkCols: [R.FSN],
  });
  return stats;
}

// ─── Reading and writing helpers ──────────────────────────────────────────────

/**
 * Read the given columns of a tab (data rows only). The row count stops at the last row
 * that has anything in any column between the first and last of these columns, so new
 * rows always go below everything that is already there.
 * Returns { firstRow, count, value(i, col), text(i, col) } where text is the cell as
 * shown (safe for long ID numbers).
 */
function CT_readTable_(sheet, headerRows, columns) {
  var nums = columns.map(CT_columnNumber_);
  var minCol = Math.min.apply(null, nums);
  var maxCol = Math.max.apply(null, nums);
  var firstRow = headerRows + 1;
  var lastRow = sheet.getLastRow();
  var n = Math.max(0, lastRow - headerRows);
  var values = n ? sheet.getRange(firstRow, minCol, n, maxCol - minCol + 1).getValues() : [];
  var shown = n ? sheet.getRange(firstRow, minCol, n, maxCol - minCol + 1).getDisplayValues() : [];
  var formulas = n ? sheet.getRange(firstRow, minCol, n, maxCol - minCol + 1).getFormulas() : [];
  // Ignore empty rows at the bottom. Cells with a formula (like a "Days Remaining" column
  // filled down in advance) don't count: such rows are ready-made rows waiting for data.
  var count = values.length;
  var rowIsEmpty = function (r) {
    return shown[r].every(function (v, c) { return formulas[r][c] !== '' || CT_cellText_(v) === ''; });
  };
  while (count > 0 && rowIsEmpty(count - 1)) count--;
  return {
    firstRow: firstRow,
    count: count,
    value: function (i, col) { return i < values.length ? values[i][CT_columnNumber_(col) - minCol] : ''; },
    text: function (i, col) { return i < shown.length ? CT_cellText_(shown[i][CT_columnNumber_(col) - minCol]) : ''; },
    formula: function (i, col) { return i < formulas.length ? formulas[i][CT_columnNumber_(col) - minCol] : ''; },
  };
}

/**
 * Write { rowIndex: { columnLetter: value } } into the tab, one column at a time and only
 * for neighbouring changed rows together. Existing rows are written only if their key
 * columns still hold what was read (rows may have been inserted or deleted meanwhile).
 */
function CT_writeChanges_(sheet, t, changes, keyCols, log, opts) {
  var indexes = Object.keys(changes).map(Number).sort(function (a, b) { return a - b; });
  if (!indexes.length) return;

  // Safety check for existing rows.
  if (t.count) {
    var now = CT_readTable_(sheet, t.firstRow - 1, keyCols);
    indexes = indexes.filter(function (i) {
      if (i >= t.count) return true; // new row
      var same = keyCols.every(function (c) { return now.text(i, c) === t.text(i, c); });
      if (!same) log.add(sheet.getName() + ' row ' + (t.firstRow + i), t.text(i, keyCols[1]), 'INFO',
        'Rows moved while syncing, so this row was skipped. It will be done on the next sync.');
      return same;
    });
  }

  var lastNeeded = t.firstRow + indexes[indexes.length - 1];
  if (lastNeeded > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), lastNeeded - sheet.getMaxRows());

  var columns = {};
  indexes.forEach(function (i) { Object.keys(changes[i]).forEach(function (c) { columns[c] = true; }); });
  Object.keys(columns).forEach(function (col) {
    var c = CT_columnNumber_(col);
    // Rows that set this column, grouped into runs of neighbours.
    var rows = indexes.filter(function (i) { return col in changes[i]; });
    var runs = [];
    rows.forEach(function (i) {
      var last = runs[runs.length - 1];
      if (last && last.end === i - 1) last.end = i; else runs.push({ start: i, end: i });
    });
    runs.forEach(function (run) {
      var range = sheet.getRange(t.firstRow + run.start, c, run.end - run.start + 1, 1);
      if (opts.textCols.indexOf(col) >= 0) range.setNumberFormat('@');
      var vals = [];
      var asLink = CT_SYNC.FSN_AS_LINK && (opts.linkCols || []).indexOf(col) >= 0;
      for (var i = run.start; i <= run.end; i++) vals.push([asLink ? CT_fsnLink_(changes[i][col]) : changes[i][col]]);
      range.setValues(vals);
      if (opts.dateCols.indexOf(col) >= 0) range.setNumberFormat(CT_SYNC.DATE_FORMAT);
    });
  });
}

/** Put a heading in row 1 of a column if it is empty. */
function CT_ensureHeader_(sheet, col, title) {
  var cell = sheet.getRange(1, CT_columnNumber_(col));
  if (CT_cellText_(cell.getDisplayValue()) === '') cell.setValue(title);
}

function CT_requireSheet_(ss, name) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Could not find the tab "' + name + '". Check the tab names in CT_Config.');
  return sheet;
}

// ─── Small helpers ────────────────────────────────────────────────────────────

/** Identifies one product of one order. */
function CT_itemKey_(orderId, itemId, sku) {
  if (itemId) return itemId;
  return orderId + (sku ? ' / ' + String(sku).trim() : '');
}

/** Remarks contain "dispatch" (Dispatch, DISPATCH, Dispatched...) and don't say not to dispatch. */
function CT_hasDispatchRemark_(remarks) {
  var letters = String(remarks || '').toLowerCase().replace(/[^a-z]/g, '');
  return letters.indexOf(CT_SYNC.REMARK_WORD.toLowerCase()) >= 0 && !CT_isDoNotDispatch_(remarks);
}

/**
 * Remarks that say NOT to dispatch: "Do Not Dispatch", "Don't Dispatch", "Dont dispatch",
 * "DoNot Dispatch", "Do-Not-Dispatch", "Not to Dispatch", "No Dispatch", "Not dispatched yet"...
 * (capitals, spaces and punctuation are ignored).
 */
function CT_isDoNotDispatch_(remarks) {
  var letters = String(remarks || '').toLowerCase().replace(/[^a-z]/g, '');
  var word = CT_SYNC.REMARK_WORD.toLowerCase();
  return ['not', 'dont', 'nottobe', 'notto', 'no'].some(function (neg) {
    return letters.indexOf(neg + word) >= 0;
  });
}

/** Cell value → Date (or null). Handles real dates and text like "9-Aug-2026". */
function CT_cellDate_(value) {
  if (value === '' || value == null) return null;
  return CT_parseCourierDate_(value);
}

/** Days since 1970 for the calendar day of `date` in timezone `tz`. */
function CT_dayNumber_(date, tz) {
  return CT_dayFromText_(Utilities.formatDate(date, tz, 'yyyy-MM-dd'));
}

function CT_dayFromText_(ymd) {
  var p = String(ymd).split('-').map(Number);
  return Math.round(Date.UTC(p[0], p[1] - 1, p[2]) / 86400000);
}

/** A Date at midnight of its calendar day in timezone tz, so Sheets shows a plain date. */
function CT_dateOnly_(date, tz) {
  if (!date) return '';
  return Utilities.parseDate(Utilities.formatDate(date, tz, 'yyyy-MM-dd'), tz, 'yyyy-MM-dd');
}

function CT_cellText_(v) {
  return String(v == null ? '' : v).trim();
}

function CT_same_(a, b) {
  return CT_cellText_(a).toLowerCase() === CT_cellText_(b).toLowerCase();
}

/** Same cell content? Dates are compared by calendar day. */
function CT_sameCell_(current, wanted, tz) {
  if (wanted instanceof Date || current instanceof Date) {
    var a = current instanceof Date ? current : CT_cellDate_(current);
    var b = wanted instanceof Date ? wanted : CT_cellDate_(wanted);
    if (!a || !b) return !a && !b;
    return CT_dayNumber_(a, tz) === CT_dayNumber_(b, tz);
  }
  return CT_cellText_(current) === CT_cellText_(wanted);
}

/**
 * The subset of `wanted` ({ column: value }) that differs from row idx of table t, or null.
 * linkCols: columns that should hold a clickable FSN link; a plain FSN there counts as different.
 */
function CT_changedCells_(t, idx, wanted, tz, linkCols) {
  var diff = null;
  Object.keys(wanted).forEach(function (col) {
    var same = CT_sameCell_(t.value(idx, col), wanted[col], tz);
    if (same && CT_SYNC.FSN_AS_LINK && (linkCols || []).indexOf(col) >= 0 && CT_cellText_(wanted[col]) !== '') {
      same = /^=HYPERLINK\(/i.test(t.formula(idx, col));
    }
    if (!same) (diff = diff || {})[col] = wanted[col];
  });
  return diff;
}

/**
 * FSN → clickable Flipkart link, the same link as the spreadsheet's own FSN script makes.
 * (Script writes don't trigger that script's onEdit, so the sync makes the link itself.)
 */
function CT_fsnLink_(fsn) {
  var text = CT_cellText_(fsn);
  if (!text) return '';
  var url = 'https://www.flipkart.com/product/p/itmf' + encodeURIComponent(text) + '?pid=' + encodeURIComponent(text);
  return '=HYPERLINK("' + url.replace(/"/g, '""') + '","' + text.replace(/"/g, '""') + '")';
}

/** [[key, value], ...] → { key: value } */
function CT_pairs_(list) {
  var o = {};
  list.forEach(function (p) { o[p[0]] = p[1]; });
  return o;
}

// ─── Sync log (its own tab, rewritten on every sync) ────────────────────────────

function CT_SyncLog_(ss) {
  this.ss = ss;
  this.rows = [];
}

CT_SyncLog_.prototype.add = function (where, orderId, level, message) {
  this.rows.push([new Date(), where, orderId, level, message]);
};

CT_SyncLog_.prototype.flush = function () {
  var sheet = this.ss.getSheetByName(CT_SYNC.LOG_SHEET_NAME) || this.ss.insertSheet(CT_SYNC.LOG_SHEET_NAME);
  sheet.clearContents();
  var rows = [['Time', 'Where', 'Order Id', 'Type', 'Message']].concat(this.rows.slice(0, 3000));
  sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
  if (rows.length > 1) sheet.getRange(2, 1, rows.length - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
};
