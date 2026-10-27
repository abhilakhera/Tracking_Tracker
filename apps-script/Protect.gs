/**
 * Protection against accidental changes, for everyone, the owner included.
 *
 * Adds Google Sheets "Show a warning when editing this range" protections (not hard locks):
 * anyone who edits a protected cell, the owner too, first gets a warning and must click OK.
 * The robot itself is never blocked. Covered:
 *   - the columns the robot fills (Order Tracking, Review & Rating Data, Self Ship Cases),
 *   - the heading row of every tab (the robot finds columns by their position and headings),
 *   - every formula in every tab (FSN links made by the robot are not counted as formulas),
 *   - the robot's own tabs (logs, Removed Orders, Raw Order Tracking) completely.
 * Protections you made yourself are never changed. Running it again refreshes the robot's own
 * protections (e.g. after new formulas were added). "Remove" takes only the robot's away.
 */

var CT_PROTECT_TAG_ = '📦 Robot: ';
var CT_PROTECT_MAX_RUNS_PER_COLUMN_ = 20; // more separate formula blocks in one column → one range from first to last

/** Menu: add (or refresh) the warnings. */
function CT_protectSheet() {
  var ui = SpreadsheetApp.getUi();
  var ok = ui.alert('Protect against accidental changes?',
    'This adds a WARNING (not a lock) to: the columns the robot fills, the heading row of every tab, every formula, ' +
    'and the robot\'s own tabs. Anyone, you included, who edits them first sees a warning and must click OK.\n\n' +
    'Your own protections are not changed. The robot keeps working normally. It can take a minute.', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  var r = CT_applyProtection_(SpreadsheetApp.getActiveSpreadsheet());
  ui.alert('Done', r.count + ' area(s) now show a warning before they are changed.' +
    (r.skipped.length ? '\n\nNot finished (time limit), run it again for: ' + r.skipped.join(', ') : ''), ui.ButtonSet.OK);
}

/** Menu: remove only the robot's warnings. */
function CT_unprotectSheet() {
  var n = CT_removeProtection_(SpreadsheetApp.getActiveSpreadsheet());
  SpreadsheetApp.getUi().alert(n + ' robot warning(s) removed. Your own protections were not touched.');
}

function CT_removeProtection_(ss) {
  var n = 0;
  [SpreadsheetApp.ProtectionType.RANGE, SpreadsheetApp.ProtectionType.SHEET].forEach(function (type) {
    ss.getProtections(type).forEach(function (p) {
      if (String(p.getDescription() || '').indexOf(CT_PROTECT_TAG_) === 0) { p.remove(); n++; }
    });
  });
  return n;
}

function CT_applyProtection_(ss) {
  var started = Date.now();
  CT_removeProtection_(ss);
  var count = 0;
  var skipped = [];
  var warn = function (target, why) {
    var p = target.protect();
    p.setDescription(CT_PROTECT_TAG_ + why);
    p.setWarningOnly(true);
    count++;
  };

  // 1. The robot's own tabs: completely.
  [CT_CONFIG.LOG_SHEET_NAME, CT_SYNC.LOG_SHEET_NAME, CT_SYNC.REMOVED_SHEET_NAME, CT_IMPORT.TARGET_SHEET, CT_HISTORY.SHEET].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) warn(sh, 'this tab is written by the robot');
  });
  var robotTabs = {};
  robotTabs[CT_CONFIG.LOG_SHEET_NAME] = robotTabs[CT_SYNC.LOG_SHEET_NAME] = robotTabs[CT_SYNC.REMOVED_SHEET_NAME] =
    robotTabs[CT_IMPORT.TARGET_SHEET] = robotTabs[CT_HISTORY.SHEET] = true;

  // 2. Columns the robot fills (from row 2 down).
  var O = CT_SYNC.ORDER_TRACKING, R = CT_SYNC.REVIEW, S = CT_SYNC.SELF_SHIP, K = CT_CONFIG.COLUMNS;
  var robotCols = {};
  robotCols[CT_CONFIG.SHEET_NAME] = [O.ORDER_ID, O.ORDER_DATE, O.SKU, O.FSN, O.NAME, O.PHONE, K.BRIEF_STATUS, K.STATUS,
    K.STATUS_DATE, O.DELIVERY_BY, O.RETURN_TYPE, O.REFUND_STATUS, O.ORDER_ITEM_ID];
  robotCols[R.SHEET] = [R.ORDER_ID, R.ORDER_DATE, R.FSN, R.CATEGORY, R.NAME, R.PHONE, R.DELIVERY_DATE, R.ORDER_ITEM_ID];
  robotCols[S.SHEET] = Object.keys(S.AUTO_FILL);
  Object.keys(robotCols).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    CT_letterRuns_(robotCols[name]).forEach(function (run) {
      warn(sh.getRange(2, run[0], Math.max(1, sh.getMaxRows() - 1), run[1] - run[0] + 1), 'filled by the robot');
    });
  });

  // 3. Heading row and formulas of every other tab.
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (robotTabs[name]) return;
    if (Date.now() - started > 4.5 * 60 * 1000) { skipped.push(name); return; }
    var lastCol = sh.getLastColumn();
    if (lastCol) warn(sh.getRange(1, 1, 1, lastCol), 'heading row');
    var lastRow = sh.getLastRow();
    if (lastRow < 2 || !lastCol) return;
    var formulas = sh.getRange(2, 1, lastRow - 1, lastCol).getFormulas();
    var skipCols = {};
    (robotCols[name] || []).forEach(function (l) { skipCols[CT_columnNumber_(l)] = true; }); // already covered
    for (var c = 0; c < lastCol; c++) {
      if (skipCols[c + 1]) continue;
      var runs = [];
      for (var r = 0; r < formulas.length; r++) {
        if (!CT_isRealFormula_(formulas[r][c])) continue;
        var last = runs[runs.length - 1];
        if (last && last[1] === r - 1) last[1] = r; else runs.push([r, r]);
      }
      if (!runs.length) continue;
      if (runs.length > CT_PROTECT_MAX_RUNS_PER_COLUMN_) runs = [[runs[0][0], runs[runs.length - 1][1]]];
      runs.forEach(function (run) { warn(sh.getRange(run[0] + 2, c + 1, run[1] - run[0] + 1, 1), 'formula'); });
    }
  });
  return { count: count, skipped: skipped };
}

/** A formula someone wrote (FSN links made by the robot from a typed FSN don't count). */
function CT_isRealFormula_(f) {
  return !!f && !/^=HYPERLINK\("https:\/\/www\.flipkart\.com\/product\/p\/itmf/i.test(f);
}

/** ['A','B','C','F','G'] → [[1,3],[6,7]] (column numbers, neighbours grouped). */
function CT_letterRuns_(letters) {
  var nums = letters.map(CT_columnNumber_).sort(function (a, b) { return a - b; });
  var runs = [];
  nums.forEach(function (n) {
    var last = runs[runs.length - 1];
    if (last && (last[1] === n - 1 || last[1] === n)) last[1] = n; else runs.push([n, n]);
  });
  return runs;
}
