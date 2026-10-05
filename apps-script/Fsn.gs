/**
 * FSN → CLICKABLE FLIPKART LINKS, in every tab of this spreadsheet.
 *
 * Any column whose heading (row 1) is "FSN", wherever it is and in whichever tab:
 *  - typed or pasted values become links straight away (edit trigger made by CT_setup);
 *  - values written by scripts (which never trigger "on edit") are converted by the
 *    hourly sync, and by the menu item "Make all FSNs clickable (all tabs)".
 *
 * Only cells in FSN columns are changed. Cells that already hold a formula (a link,
 * or a lookup formula) are left as they are; blank cells stay blank.
 */

/** Menu: convert every FSN in every tab now. */
function CT_linkAllFsns() {
  var count = CT_linkAllFsns_();
  CT_notify_({ interactive: true }, count ? count + ' FSN(s) turned into clickable links.' : 'All FSNs are already clickable links.');
}

/** Converts plain FSNs in every tab. Returns how many cells were changed. */
function CT_linkAllFsns_() {
  var total = 0;
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;
    CT_fsnColumns_(sheet).forEach(function (col) {
      total += CT_linkFsnCells_(sheet, 2, col, lastRow - 1);
    });
  });
  return total;
}

/** Called from CT_onEdit: convert FSNs inside the edited area only. */
function CT_linkFsnsInEdit_(range) {
  var sheet = range.getSheet();
  var firstRow = Math.max(2, range.getRow());
  var lastRow = range.getRow() + range.getNumRows() - 1;
  if (lastRow < firstRow) return; // only the heading row was edited
  var firstCol = range.getColumn();
  var lastCol = firstCol + range.getNumColumns() - 1;
  CT_fsnColumns_(sheet).forEach(function (col) {
    if (col >= firstCol && col <= lastCol) CT_linkFsnCells_(sheet, firstRow, col, lastRow - firstRow + 1);
  });
}

/** Column numbers whose heading in row 1 is "FSN" (capitals and spaces ignored). */
function CT_fsnColumns_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return [];
  var headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var cols = [];
  headers.forEach(function (h, i) {
    if (String(h).trim().toUpperCase() === 'FSN') cols.push(i + 1);
  });
  return cols;
}

/**
 * Turn plain values in one column (rows startRow..startRow+n-1) into links.
 * Writes only the cells that change, grouped into runs. Returns the number changed.
 */
function CT_linkFsnCells_(sheet, startRow, col, n) {
  if (n <= 0) return 0;
  var range = sheet.getRange(startRow, col, n, 1);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var todo = [];
  for (var i = 0; i < n; i++) {
    if (formulas[i][0] !== '') continue;                      // already a link or another formula
    if (values[i][0] instanceof Date) continue;               // not an FSN
    if (CT_cellText_(values[i][0]) === '') continue;          // blank stays blank
    todo.push(i);
  }
  var runs = [];
  todo.forEach(function (i) {
    var last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i; else runs.push({ start: i, end: i });
  });
  runs.forEach(function (run) {
    var out = [];
    for (var k = run.start; k <= run.end; k++) out.push([CT_fsnLink_(values[k][0])]);
    sheet.getRange(startRow + run.start, col, out.length, 1).setValues(out);
  });
  return todo.length;
}
