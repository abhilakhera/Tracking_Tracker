/**
 * Self Ship Cases: fill a row from Pre CRM as soon as an Order ID is typed or pasted in column C.
 *
 * SKU, FSN, Order Item ID, Customer Name, Phone Number, City and Pin code come from the Pre CRM
 * row of that order (which Pre CRM column goes where: CT_SYNC.SELF_SHIP.AUTO_FILL).
 * If Pre CRM has more than one row for the order (several products, or the same product listed
 * twice), a pop-up asks which row to use. The other columns of Self Ship Cases are never touched.
 */

// Notes the robot puts on the Order ID cell start with this, so it only ever clears its own notes.
var CT_SS_NOTE_ = '📦 ';

/** From CT_onEdit: Order IDs typed/pasted in Self Ship Cases column C. */
function CT_selfShipOrderEdited_(range) {
  var C = CT_SYNC.SELF_SHIP;
  var first = Math.max(range.getRow(), C.HEADER_ROWS + 1);
  var last = range.getLastRow();
  if (last < first) return;
  CT_fillSelfShipRows_(range.getSheet(), first, last, false);
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
  CT_fillSelfShipRows_(range.getSheet(), first, range.getLastRow(), true);
}

/**
 * Fill rows first..last of Self Ship Cases. One matching Pre CRM row → filled at once.
 * Several → pop-up. None → a note on the Order ID cell.
 */
function CT_fillSelfShipRows_(sheet, first, last, fromMenu) {
  var C = CT_SYNC.SELF_SHIP;
  var col = CT_columnNumber_(C.ORDER_ID);
  var ids = sheet.getRange(first, col, last - first + 1, 1).getDisplayValues();
  var byOrder = CT_preCrmRowsByOrder_(sheet.getParent());
  var ask = [];
  var filled = 0;
  ids.forEach(function (r, i) {
    var row = first + i;
    var orderId = CT_cellText_(r[0]);
    if (!orderId) return; // Order ID cleared: the row is left as it is
    var matches = byOrder[orderId] || [];
    if (!matches.length) {
      CT_setSelfShipNote_(sheet, row, CT_SS_NOTE_ + 'This Order ID is not in Pre CRM, so nothing was filled in. Check the number.');
    } else if (matches.length === 1) {
      CT_writeSelfShipRow_(sheet, row, matches[0]);
      filled++;
    } else {
      CT_setSelfShipNote_(sheet, row, CT_SS_NOTE_ + matches.length + ' rows in Pre CRM for this order. Pick one in the pop-up, ' +
        'or select this row and use: 📦 Courier Tracking → Fill Self Ship row(s) from Pre CRM.');
      ask.push({ row: row, orderId: orderId, options: matches });
    }
  });
  if (ask.length) CT_showProductPicker_(ask);
  else if (fromMenu) CT_notify_({ interactive: true }, filled + ' row(s) filled from Pre CRM.');
  return { filled: filled, asked: ask.length };
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

/** The pop-up: for each row, which Pre CRM row to copy. */
function CT_showProductPicker_(ask) {
  var esc = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var html = '<style>body{font-family:Arial,sans-serif;font-size:13px}fieldset{margin:0 0 12px;border:1px solid #ccc;border-radius:6px}' +
    'legend{font-weight:bold}label{display:block;margin:6px 0;cursor:pointer}button{font-size:13px;padding:6px 14px;margin-right:8px}</style>' +
    '<p>Pre CRM has more than one row for ' + (ask.length === 1 ? 'this order' : 'these orders') +
    '. Choose the row to copy into Self Ship Cases:</p><form id="f">';
  ask.forEach(function (a, n) {
    html += '<fieldset><legend>Self Ship row ' + a.row + ' · Order ' + esc(a.orderId) + '</legend>';
    a.options.forEach(function (o, k) {
      html += '<label><input type="radio" name="q' + n + '" value="' + o.preRow + '"' + (k === 0 ? ' checked' : '') + '> ' + esc(o.label) + '</label>';
    });
    html += '<label><input type="radio" name="q' + n + '" value=""> Skip this row for now</label></fieldset>';
  });
  html += '</form><button onclick="go()">Fill</button><button onclick="google.script.host.close()">Cancel</button>' +
    '<span id="msg"></span><script>var ask=' + JSON.stringify(ask.map(function (a) { return { row: a.row, orderId: a.orderId }; })) + ';' +
    'function go(){var f=document.getElementById("f");var picks=ask.map(function(a,n){var c=f.querySelector("input[name=q"+n+"]:checked");' +
    'return {row:a.row,orderId:a.orderId,preRow:c&&c.value?Number(c.value):0};});' +
    'document.getElementById("msg").textContent=" Filling…";' +
    'google.script.run.withSuccessHandler(function(){google.script.host.close();})' +
    '.withFailureHandler(function(e){document.getElementById("msg").textContent=" "+e.message;}).CT_fillSelfShipChoices(picks);}</script>';
  var out = HtmlService.createHtmlOutput(html).setWidth(720).setHeight(Math.min(560, 160 + ask.length * 60 +
    ask.reduce(function (n, a) { return n + a.options.length * 28; }, 0)));
  try {
    SpreadsheetApp.getUi().showModalDialog(out, 'Which product?');
  } catch (e) {
    // The pop-up can't be shown here (e.g. the edit came from someone the robot can't show
    // windows to). The note on the Order ID cell says how to finish it from the menu.
    console.log('Product picker not shown: ' + e.message);
  }
}

/** Called by the pop-up with the rows chosen: [{ row, orderId, preRow }]. */
function CT_fillSelfShipChoices(picks) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = CT_requireSheet_(ss, CT_SYNC.SELF_SHIP.SHEET);
  var byOrder = CT_preCrmRowsByOrder_(ss);
  var col = CT_columnNumber_(CT_SYNC.SELF_SHIP.ORDER_ID);
  var problems = [];
  (picks || []).forEach(function (p) {
    if (!p || !p.preRow) return;
    // The row may have moved, or the Order ID changed, while the pop-up was open.
    if (CT_cellText_(sheet.getRange(p.row, col).getDisplayValue()) !== String(p.orderId)) {
      problems.push('Self Ship row ' + p.row + ' no longer holds order ' + p.orderId + ' (rows moved?); not filled.');
      return;
    }
    var match = (byOrder[p.orderId] || []).filter(function (m) { return m.preRow === p.preRow; })[0];
    if (!match) {
      problems.push('Pre CRM row ' + p.preRow + ' is no longer order ' + p.orderId + '; row ' + p.row + ' not filled.');
      return;
    }
    CT_writeSelfShipRow_(sheet, p.row, match);
  });
  // The chosen Order Item ID decides Order Tracking N/O and Review & Rating Data.
  if (!CT_runSync_({})) CT_scheduleSync_();
  if (problems.length) throw new Error(problems.join(' '));
}
