/**
 * Self Ship Cases: fill a row from Pre CRM as soon as an Order ID is typed or pasted in column C.
 *
 * SKU, FSN, Order Item ID, Customer Name, Phone Number, City and Pin code come from the Pre CRM
 * row of that order (which Pre CRM column goes where: CT_SYNC.SELF_SHIP.AUTO_FILL).
 * If Pre CRM has more than one row for the order (several products, or the same product listed
 * twice), a question box asks which row to use. Deleting the Order ID clears those values again.
 * The other columns of Self Ship Cases are never touched.
 */

// Notes the robot puts on the Order ID cell start with this, so it only ever clears its own notes.
var CT_SS_NOTE_ = '📦 ';

/** From CT_onEdit: Order IDs typed/pasted in Self Ship Cases column C. */
function CT_selfShipOrderEdited_(range) {
  var C = CT_SYNC.SELF_SHIP;
  var first = Math.max(range.getRow(), C.HEADER_ROWS + 1);
  var last = range.getLastRow();
  if (last < first) return;
  CT_fillSelfShipRows_(range.getSheet(), first, last, false, true);
}

/** Menu: fill the selected Self Ship Cases rows from Pre CRM again (also shows the pop-up). */
function CT_fillSelfShipSelected() {
  var ui = SpreadsheetApp.getUi();
  var range = SpreadsheetApp.getActiveRange();
  var C = CT_SYNC.SELF_SHIP;
  if (!range || range.getSheet().getName() !== C.SHEET) {
    ui.alert('Go to the "' + C.SHEET + '" tab, select the row(s) to fill (any cell in them), then try again.');
    return;
  }
  var first = Math.max(range.getRow(), C.HEADER_ROWS + 1);
  if (range.getLastRow() < first) { ui.alert('Select rows below the heading.'); return; }
  CT_fillSelfShipRows_(range.getSheet(), first, range.getLastRow(), true, true);
  // The chosen Order Item IDs decide Order Tracking N/O and Review & Rating Data.
  if (!CT_runSync_({})) CT_scheduleSync_();
}

/**
 * Fill rows first..last of Self Ship Cases. One matching Pre CRM row → filled at once.
 * Several → the person is asked which one (if `ask` is true). None → a note on the Order ID cell.
 * An empty Order ID → the values the robot fills (A, B, D–H) are cleared.
 */
function CT_fillSelfShipRows_(sheet, first, last, fromMenu, ask) {
  var C = CT_SYNC.SELF_SHIP;
  var col = CT_columnNumber_(C.ORDER_ID);
  var ids = sheet.getRange(first, col, last - first + 1, 1).getDisplayValues();
  var byOrder = null; // Pre CRM is read only when needed
  var pending = [];
  var filled = 0;
  ids.forEach(function (r, i) {
    var row = first + i;
    var orderId = CT_cellText_(r[0]);
    if (!orderId) { CT_clearSelfShipRow_(sheet, row); return; }
    byOrder = byOrder || CT_preCrmRowsByOrder_(sheet.getParent());
    var matches = byOrder[orderId] || [];
    if (!matches.length) {
      CT_setSelfShipNote_(sheet, row, CT_SS_NOTE_ + 'This Order ID is not in Pre CRM, so nothing was filled in. Check the number.');
    } else if (matches.length === 1) {
      CT_writeSelfShipRow_(sheet, row, matches[0]);
      filled++;
    } else {
      CT_setSelfShipNote_(sheet, row, CT_SS_NOTE_ + matches.length + ' rows in Pre CRM for this order. ' +
        'Select this row and use: 📦 Courier Tracking → Fill Self Ship row(s) from Pre CRM.');
      pending.push({ row: row, orderId: orderId, options: matches });
    }
  });
  if (pending.length && ask !== false) filled += CT_askWhichProducts_(sheet, pending);
  if (fromMenu) CT_notify_({ interactive: true }, filled + ' row(s) filled from Pre CRM.');
  return { filled: filled, asked: pending.length };
}

/** Order ID deleted: clear the values the robot fills (A, B, D–H) and the robot's note. */
function CT_clearSelfShipRow_(sheet, row) {
  var map = CT_SYNC.SELF_SHIP.AUTO_FILL;
  Object.keys(map).forEach(function (letter) {
    var cell = sheet.getRange(row, CT_columnNumber_(letter));
    if (cell.getDisplayValue() !== '') cell.setValue('');
  });
  CT_setSelfShipNote_(sheet, row, '');
}

/**
 * Ask, one order at a time, which Pre CRM row to copy. Uses Google's own question box
 * (the same kind as "Set / change API keys"). Returns how many rows were filled.
 */
function CT_askWhichProducts_(sheet, pending) {
  var ui;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { CT_notePopupProblem_(sheet, pending, e); return 0; }
  var filled = 0;
  for (var n = 0; n < pending.length; n++) {
    var a = pending[n];
    var text = 'Pre CRM has ' + a.options.length + ' rows for order ' + a.orderId + ' (Self Ship row ' + a.row + ').\n\n' +
      a.options.map(function (o, k) { return (k + 1) + ')  ' + o.label; }).join('\n') +
      '\n\nType the number of the row to copy (1-' + a.options.length + '), then OK. Cancel = skip this row.';
    var res;
    try {
      res = ui.prompt('Which product? (' + (n + 1) + ' of ' + pending.length + ')', text, ui.ButtonSet.OK_CANCEL);
    } catch (e) {
      CT_notePopupProblem_(sheet, pending.slice(n), e);
      return filled;
    }
    if (res.getSelectedButton() !== ui.Button.OK) continue;
    var k = Number(String(res.getResponseText()).trim());
    if (!(k >= 1 && k <= a.options.length && Math.floor(k) === k)) {
      ui.alert('"' + res.getResponseText() + '" is not one of the numbers 1-' + a.options.length +
        '. Row ' + a.row + ' was not filled; use the menu item to try again.');
      continue;
    }
    // The row may have changed while the question was open.
    if (CT_cellText_(sheet.getRange(a.row, CT_columnNumber_(CT_SYNC.SELF_SHIP.ORDER_ID)).getDisplayValue()) !== a.orderId) continue;
    CT_writeSelfShipRow_(sheet, a.row, a.options[k - 1]);
    filled++;
  }
  return filled;
}

/** The question box could not be shown: say why in the note, so it can be fixed. */
function CT_notePopupProblem_(sheet, pending, err) {
  console.log('Product question not shown: ' + err.message);
  pending.forEach(function (a) {
    CT_setSelfShipNote_(sheet, a.row, CT_SS_NOTE_ + a.options.length + ' rows in Pre CRM for this order. ' +
      'Select this row and use: 📦 Courier Tracking → Fill Self Ship row(s) from Pre CRM. ' +
      '(The question could not be shown here: ' + err.message + ')');
  });
}

/**
 * Safety net for pastes the edit trigger misses (from the change trigger): rows that have an
 * Order ID but nothing yet in A, B, D–H are filled. Rows needing a choice only get the note.
 */
function CT_fillSelfShipMissing_(ss) {
  var C = CT_SYNC.SELF_SHIP;
  var sheet = ss.getSheetByName(C.SHEET);
  if (!sheet) return 0;
  var letters = Object.keys(C.AUTO_FILL);
  var t = CT_readTable_(sheet, C.HEADER_ROWS, letters.concat([C.ORDER_ID]));
  var done = 0;
  for (var i = 0; i < t.count; i++) {
    if (!t.text(i, C.ORDER_ID)) continue;
    if (letters.some(function (l) { return t.text(i, l) !== ''; })) continue;
    var row = t.firstRow + i;
    done += CT_fillSelfShipRows_(sheet, row, row, false, false).filled;
  }
  return done;
}

/** Pre CRM rows grouped by Order Id: { orderId: [{ preRow, values: { SKU: .. }, label }] }. */
function CT_preCrmRowsByOrder_(ss) {
  var P = CT_SYNC.PRE_CRM;
  var sheet = CT_requireSheet_(ss, P.SHEET);
  var fields = { SKU: P.SKU, FSN: P.FSN, ORDER_ID: P.ORDER_ID, ORDER_ITEM_ID: P.ORDER_ITEM_ID, NAME: P.NAME,
    PHONE: P.PHONE, CITY: P.CITY, PIN: P.PIN, ORDERED_ON: P.ORDERED_ON, REMARKS: P.REMARKS };
  var t = CT_readTable_(sheet, P.HEADER_ROWS, Object.keys(fields).map(function (f) { return fields[f]; }));
  var out = {};
  for (var i = 0; i < t.count; i++) {
    var orderId = t.text(i, P.ORDER_ID);
    if (!orderId) continue;
    var values = {};
    Object.keys(fields).forEach(function (f) { values[f] = t.text(i, fields[f]); });
    (out[orderId] = out[orderId] || []).push({ preRow: t.firstRow + i, values: values });
  }
  // Labels for the pop-up. A product listed twice is told apart by its Pre CRM row.
  Object.keys(out).forEach(function (orderId) {
    var list = out[orderId];
    var seen = {};
    list.forEach(function (m) { seen[m.values.ORDER_ITEM_ID] = (seen[m.values.ORDER_ITEM_ID] || 0) + 1; });
    list.forEach(function (m) {
      var v = m.values;
      m.label = 'Pre CRM row ' + m.preRow + ' · Item ID ' + (v.ORDER_ITEM_ID || '–') + ' · SKU ' + (v.SKU || '–') +
        ' · FSN ' + (v.FSN || '–') + (v.ORDERED_ON ? ' · Ordered ' + v.ORDERED_ON : '') +
        (v.REMARKS ? ' · Remarks: ' + v.REMARKS : '') +
        (seen[v.ORDER_ITEM_ID] > 1 ? '  (this product is listed ' + seen[v.ORDER_ITEM_ID] + ' times in Pre CRM)' : '');
    });
  });
  return out;
}

/** Write one Pre CRM row's details into a Self Ship Cases row (only the AUTO_FILL columns). */
function CT_writeSelfShipRow_(sheet, row, match) {
  var map = CT_SYNC.SELF_SHIP.AUTO_FILL;
  Object.keys(map).forEach(function (letter) {
    var field = map[letter];
    var value = match.values[field] || '';
    var cell = sheet.getRange(row, CT_columnNumber_(letter));
    if (field === 'FSN' && CT_SYNC.FSN_AS_LINK && value) {
      cell.setValue(CT_fsnLink_(value));
    } else {
      cell.setNumberFormat('@'); // long IDs, phone numbers and PIN codes stay exactly as in Pre CRM
      cell.setValue(value);
    }
  });
  CT_setSelfShipNote_(sheet, row, '');
}

/** Put (or clear) the robot's note on the Order ID cell; notes typed by people are left alone. */
function CT_setSelfShipNote_(sheet, row, note) {
  var cell = sheet.getRange(row, CT_columnNumber_(CT_SYNC.SELF_SHIP.ORDER_ID));
  var current = cell.getNote ? cell.getNote() : '';
  if (current && current.indexOf(CT_SS_NOTE_) !== 0) return;
  if (current !== note) cell.setNote(note);
}
