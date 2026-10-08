/**
 * TRACKING IMPORT: copies Order ID, Tracking ID and Transport from every tab of the seller
 * team's spreadsheet (CT_IMPORT.SOURCE_SPREADSHEET_ID, view access is enough) into the hidden
 * "Raw Order Tracking" tab of this spreadsheet.
 *
 *  - Columns are found by heading (in the first rows of each tab), wherever they are, with
 *    capitals, spaces and small spelling mistakes ignored ("Oder ID", "TRACKING NO", "Transporter").
 *  - "Delhivery", "Safexpress" and "DP World" are written correctly even when misspelled in the
 *    source; other couriers are copied as they are.
 *  - No two identical rows; rows without an Order ID and a Tracking ID are left out.
 *  - Live: an edit (or a new tab) in the seller team's spreadsheet starts an import about a minute
 *    later (CT_IMPORT.LIVE_DELAY_SECONDS; many quick edits → one import). This needs edit access
 *    to that spreadsheet; it is only ever read, never changed. A safety-net import also runs every
 *    CT_IMPORT.EVERY_MINUTES (for changes Google doesn't report, e.g. made by other scripts),
 *    and from the menu. The tab is rewritten only when something changed.
 */

/** Menu: import now. */
function CT_importTrackingNow() {
  var result = CT_runImport_();
  CT_notify_({ interactive: true }, result);
}

/** Safety-net time trigger (created by CT_setup). */
function CT_importTracking() {
  CT_runImport_();
}

/**
 * Edit / change trigger on the SELLER TEAM's spreadsheet (created by CT_setup). Only schedules
 * an import a little later, so a burst of edits leads to one import. Nothing here may use
 * getActiveSpreadsheet(): in this trigger it is the seller team's spreadsheet, not ours.
 */
function CT_onSourceChange(e) {
  var pending = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'CT_delayedImport';
  });
  if (!pending) ScriptApp.newTrigger('CT_delayedImport').timeBased().after(CT_IMPORT.LIVE_DELAY_SECONDS * 1000).create();
}

/** One-off trigger a little after an edit in the seller team's spreadsheet. */
function CT_delayedImport() {
  CT_deleteTriggers_('CT_delayedImport');
  if (/already running/.test(CT_runImport_())) CT_onSourceChange(); // try again a little later
}

/** Returns a one-line result, which is also kept for "Test API connections". */
function CT_runImport_() {
  if (!CT_claimFlag_('CT_IMPORT_RUNNING_SINCE', 10 * 60 * 1000)) return 'An import is already running.';
  var props = PropertiesService.getScriptProperties();
  var message;
  try {
    var source;
    try {
      source = SpreadsheetApp.openById(CT_IMPORT.SOURCE_SPREADSHEET_ID);
    } catch (e) {
      throw new Error('Cannot open the tracking spreadsheet (' + CT_IMPORT.SOURCE_SPREADSHEET_ID + '). Make sure the Google ' +
        'account that ran CT_setup can view it. (' + e.message + ')');
    }
    var collected = CT_collectSourceRows_(source);
    // Always name our spreadsheet by ID: when an edit in the seller team's spreadsheet woke us up,
    // the "active" spreadsheet is theirs.
    var target = CT_IMPORT.TARGET_SPREADSHEET_ID ? SpreadsheetApp.openById(CT_IMPORT.TARGET_SPREADSHEET_ID)
      : SpreadsheetApp.getActiveSpreadsheet();
    var changed = CT_writeRawTracking_(target, collected.rows);
    if (changed && CT_SYNC.FILL_TRACKING_FROM_RAW) CT_scheduleSync_(); // fill Order Tracking a minute later
    message = 'Tracking import: ' + collected.rows.length + ' row(s) from ' + collected.tabsUsed + ' tab(s)' +
      (collected.tabsSkipped.length ? '; no headings found in: ' + collected.tabsSkipped.join(', ') : '') +
      (changed ? '. "' + CT_IMPORT.TARGET_SHEET + '" updated.' : '. No changes.');
  } catch (e) {
    message = 'Tracking import failed: ' + e.message;
    console.error(message);
  } finally {
    props.deleteProperty('CT_IMPORT_RUNNING_SINCE');
  }
  props.setProperty('CT_IMPORT_STATUS', Utilities.formatDate(new Date(), CT_CONFIG.TIMEZONE, 'dd-MMM-yyyy HH:mm') + ' – ' + message);
  console.log(message);
  return message;
}

/**
 * Read every tab of the source. Returns { rows: [[orderId, trackingId, courier], ...] (no
 * duplicates, in sheet order), tabsUsed, tabsSkipped: [names without the headings] }.
 */
function CT_collectSourceRows_(source) {
  var rows = [];
  var seen = {};
  var tabsUsed = 0;
  var tabsSkipped = [];
  source.getSheets().forEach(function (sheet) {
    if (CT_IMPORT.SKIP_SOURCE_TABS.indexOf(sheet.getName()) >= 0) return;
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return;
    var top = sheet.getRange(1, 1, Math.min(CT_IMPORT.HEADING_SEARCH_ROWS, lastRow), lastCol).getDisplayValues();
    var found = CT_findHeadingRow_(top);
    if (!found) { tabsSkipped.push(sheet.getName()); return; }
    tabsUsed++;
    var first = found.row + 2; // sheet row after the heading row
    var n = lastRow - first + 1;
    if (n <= 0) return;
    var read = function (col) {
      return col ? sheet.getRange(first, col, n, 1).getDisplayValues() : null; // displayed text keeps long IDs exact
    };
    var orders = read(found.ORDER_ID);
    var tracks = read(found.TRACKING_ID);
    var couriers = read(found.COURIER);
    for (var i = 0; i < n; i++) {
      var orderId = CT_cleanCell_(orders[i][0]);
      var trackingId = tracks ? CT_cleanCell_(tracks[i][0]) : '';
      var courier = couriers ? CT_correctCourierName_(couriers[i][0]) : '';
      if (!orderId && !trackingId) continue;
      if (CT_headingField_(orderId) === 'ORDER_ID') continue; // a repeated heading row
      var key = [orderId, trackingId, courier].join('\u0001').toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      rows.push([orderId, trackingId, courier]);
    }
  });
  return { rows: rows, tabsUsed: tabsUsed, tabsSkipped: tabsSkipped };
}

/**
 * Find the heading row among the top rows: the first row with an Order ID heading and a
 * Tracking ID or Transport heading. Returns { row (0-based), ORDER_ID, TRACKING_ID, COURIER
 * (1-based columns, 0 if missing) } or null.
 */
function CT_findHeadingRow_(top) {
  for (var r = 0; r < top.length; r++) {
    var best = {};
    top[r].forEach(function (cell, c) {
      var m = CT_headingMatch_(cell);
      if (m && (!best[m.field] || m.score < best[m.field].score)) best[m.field] = { col: c + 1, score: m.score };
    });
    if (best.ORDER_ID && (best.TRACKING_ID || best.COURIER)) {
      return {
        row: r,
        ORDER_ID: best.ORDER_ID.col,
        TRACKING_ID: best.TRACKING_ID ? best.TRACKING_ID.col : 0,
        COURIER: best.COURIER ? best.COURIER.col : 0,
      };
    }
  }
  return null;
}

/** Which field a heading is (ORDER_ID / TRACKING_ID / COURIER), or ''. */
function CT_headingField_(text) {
  var m = CT_headingMatch_(text);
  return m ? m.field : '';
}

/**
 * Match one heading against CT_IMPORT.SOURCE_HEADINGS, ignoring capitals, spaces and
 * punctuation. Small spelling mistakes are allowed (1 letter for short names, 2 for longer
 * ones); a few extra letters after a correctly spelled heading are allowed too ("TRANSPORT NAME").
 * Returns { field, score } (lower score = better match) or null.
 */
function CT_headingMatch_(text) {
  var h = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!h) return null;
  var best = null;
  Object.keys(CT_IMPORT.SOURCE_HEADINGS).forEach(function (field) {
    CT_IMPORT.SOURCE_HEADINGS[field].forEach(function (name) {
      var target = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
      var allowed = target.length <= 4 ? 0 : target.length <= 8 ? 1 : 2;
      var score = null;
      var d = CT_editDistance_(h, target);
      if (d <= allowed) score = d;
      // Extra letters after an exactly spelled heading ("TRANSPORT NAME"), but not "ORDER ITEM ID".
      else if (h.length > target.length && h.length - target.length <= 4 &&
               h.slice(0, target.length) === target) score = 10 + (h.length - target.length);
      if (score !== null && (!best || score < best.score)) best = { field: field, score: score };
    });
  });
  return best;
}

/** Correct misspelled Delhivery / Safexpress / DP World; anything else is returned as typed (tidied). */
function CT_correctCourierName_(text) {
  var raw = CT_cleanCell_(text);
  var n = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (!n) return raw;
  var names = CT_IMPORT.COURIER_NAMES;
  var candidates = [
    ['delhivery', names.DELHIVERY], ['dilhivery', names.DELHIVERY],
    ['safexpress', names.SAFEXPRESS], ['safeexpress', names.SAFEXPRESS],
    ['dpworld', names.DPWORLD], ['dpwexpress', names.DPWORLD], ['delex', names.DPWORLD],
  ];
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i][0];
    var allowed = c.length <= 5 ? 0 : 2;
    // Whole name misspelled ("delhivary"), or followed by extra words ("Safexpress Pvt Ltd").
    if (CT_editDistance_(n, c) <= allowed) return candidates[i][1];
    if (n.length > c.length && CT_editDistance_(n.slice(0, c.length), c) <= allowed) return candidates[i][1];
  }
  if (n === 'dpw' || n === 'dp') return names.DPWORLD;
  return raw;
}

/** Number of single-letter edits to turn a into b (Levenshtein distance). */
function CT_editDistance_(a, b) {
  var prev = [];
  for (var j = 0; j <= b.length; j++) prev.push(j);
  for (var i = 1; i <= a.length; i++) {
    var cur = [i];
    for (var k = 1; k <= b.length; k++) {
      cur.push(Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1)));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Trim and collapse spaces. */
function CT_cleanCell_(v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
}

/**
 * Put the rows into the "Raw Order Tracking" tab (found by its headings in row 1). Only the
 * three columns are touched, and only if something changed. Returns true if it wrote.
 */
function CT_writeRawTracking_(ss, rows) {
  var sheet = ss.getSheetByName(CT_IMPORT.TARGET_SHEET);
  var H = CT_IMPORT.TARGET_HEADINGS;
  if (!sheet) {
    sheet = ss.insertSheet(CT_IMPORT.TARGET_SHEET);
    sheet.getRange(1, 1, 1, 3).setValues([[H.ORDER_ID, H.TRACKING_ID, H.COURIER]]).setFontWeight('bold');
    sheet.hideSheet();
  }
  var lastCol = Math.max(sheet.getLastColumn(), 1);
  var heads = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (h) {
    return String(h).toUpperCase().replace(/[^A-Z0-9]/g, '');
  });
  var colOf = function (name) { return heads.indexOf(name.toUpperCase().replace(/[^A-Z0-9]/g, '')) + 1; };
  var cols = [colOf(H.ORDER_ID), colOf(H.TRACKING_ID), colOf(H.COURIER)];
  if (cols.some(function (c) { return c === 0; })) {
    throw new Error('"' + CT_IMPORT.TARGET_SHEET + '" needs the headings "' + H.ORDER_ID + '", "' + H.TRACKING_ID +
      '" and "' + H.COURIER + '" in row 1.');
  }

  var oldCount = Math.max(0, sheet.getLastRow() - 1);
  var current = cols.map(function (c) { return oldCount ? sheet.getRange(2, c, oldCount, 1).getDisplayValues() : []; });
  // Ignore empty rows at the bottom when comparing.
  var oldRows = [];
  for (var i = 0; i < oldCount; i++) oldRows.push([current[0][i][0], current[1][i][0], current[2][i][0]].map(CT_cleanCell_));
  while (oldRows.length && oldRows[oldRows.length - 1].join('') === '') oldRows.pop();
  if (JSON.stringify(oldRows) === JSON.stringify(rows)) return false;

  var height = Math.max(rows.length, oldCount);
  if (height + 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), height + 1 - sheet.getMaxRows());
  cols.forEach(function (c, k) {
    var out = [];
    for (var r = 0; r < height; r++) out.push([r < rows.length ? rows[r][k] : '']);
    var range = sheet.getRange(2, c, height, 1);
    range.setNumberFormat('@'); // keep long IDs exactly as text
    range.setValues(out);
  });
  return true;
}
