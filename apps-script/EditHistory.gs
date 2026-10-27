/**
 * Edit History: every change a person makes in any tab is written to the "Edit History" tab
 * (time, who, tab, cell, old value, new value). A mistaken change can be put back later with
 * 📦 Courier Tracking → Restore selected change(s): only that one cell gets its old value back,
 * everything changed after it stays as it is.
 *
 * Limits (set by Google): for one cell Google tells the robot the old value. When many cells are
 * changed at once (a paste over several cells, Delete on a selection), Google gives only the new
 * values, so such a row says "(old value not known)" and the time to use in File → Version history.
 * Deleted rows are noted the same way. Changes made by the robot itself are not recorded here
 * (they are in the robot's own log tabs).
 */

var CT_HISTORY = {
  SHEET: 'Edit History',
  HEADINGS: ['Time', 'Who', 'Tab', 'Cell', 'Old value', 'New value', 'Status'],
  UNKNOWN: '(old value not known)',
  MAX_CELLS_PER_EDIT: 300,  // larger changes are recorded as one summary line
  KEEP_ROWS: 20000,         // the oldest lines are removed above this
};

/** From CT_onEdit, before anything else changes the sheet. */
function CT_recordEdit_(e) {
  var range = e.range;
  var sheet = range.getSheet();
  var tab = sheet.getName();
  if (CT_historySkipsTab_(tab)) return;
  var who = CT_editorEmail_(e);
  var now = new Date();
  var rows = [];
  var cells = range.getNumRows() * range.getNumColumns();
  if (cells === 1) {
    var oldValue = e.oldValue === undefined ? '' : String(e.oldValue);
    var newValue = range.getFormula() || range.getDisplayValue();
    if (oldValue === newValue) return;
    rows.push([now, who, tab, range.getA1Notation(), oldValue, newValue, '']);
  } else if (cells <= CT_HISTORY.MAX_CELLS_PER_EDIT) {
    var shown = range.getDisplayValues();
    var formulas = range.getFormulas();
    for (var r = 0; r < shown.length; r++) {
      for (var c = 0; c < shown[r].length; c++) {
        var a1 = sheet.getRange(range.getRow() + r, range.getColumn() + c).getA1Notation();
        rows.push([now, who, tab, a1, CT_HISTORY.UNKNOWN, formulas[r][c] || shown[r][c], CT_historyVersionHint_(now)]);
      }
    }
  } else {
    rows.push([now, who, tab, range.getA1Notation(), CT_HISTORY.UNKNOWN, '(' + cells + ' cells changed at once)', CT_historyVersionHint_(now)]);
  }
  CT_appendHistory_(sheet.getParent(), rows);
}

/** From CT_onChange: whole rows deleted (Google gives no values for those). */
function CT_recordRowsRemoved_(ss, tab) {
  if (!tab || CT_historySkipsTab_(tab)) return;
  var now = new Date();
  CT_appendHistory_(ss, [[now, '', tab, '(row(s) deleted)', CT_HISTORY.UNKNOWN, '', CT_historyVersionHint_(now)]]);
}

function CT_historyVersionHint_(when) {
  return 'To get old values back: File → Version history → open the version from just before ' +
    Utilities.formatDate(when, CT_CONFIG.TIMEZONE, 'dd-MMM-yyyy HH:mm') + ' and copy the cell(s).';
}

function CT_historySkipsTab_(tab) {
  return [CT_HISTORY.SHEET, CT_CONFIG.LOG_SHEET_NAME, CT_SYNC.LOG_SHEET_NAME, CT_SYNC.REMOVED_SHEET_NAME,
    CT_IMPORT.TARGET_SHEET].indexOf(tab) >= 0;
}

function CT_editorEmail_(e) {
  try {
    var u = (e && e.user) || Session.getActiveUser();
    return (u && u.getEmail && u.getEmail()) || '';
  } catch (err) { return ''; }
}

function CT_historySheet_(ss) {
  var sh = ss.getSheetByName(CT_HISTORY.SHEET);
  if (sh) return sh;
  sh = ss.insertSheet(CT_HISTORY.SHEET);
  sh.getRange(1, 1, 1, CT_HISTORY.HEADINGS.length).setValues([CT_HISTORY.HEADINGS]).setFontWeight('bold');
  return sh;
}

function CT_appendHistory_(ss, rows) {
  if (!rows.length) return;
  var sh = CT_historySheet_(ss);
  var start = sh.getLastRow() + 1;
  // Old/new values are kept as text, exactly as they looked (long IDs stay whole).
  sh.getRange(start, 5, rows.length, 2).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, CT_HISTORY.HEADINGS.length).setValues(rows.map(function (r) {
    return [r[0], r[1], r[2], r[3], String(r[4]), String(r[5]), r[6]];
  }));
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy hh:mm:ss');
  var extra = sh.getLastRow() - 1 - CT_HISTORY.KEEP_ROWS;
  if (extra > 500) sh.deleteRows(2, extra);
}

/**
 * Menu: select one or more lines in the "Edit History" tab, then this puts each cell's old value
 * back. If the cell was changed again since, it asks first.
 */
function CT_restoreSelectedChanges() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var range = SpreadsheetApp.getActiveRange();
  if (!range || range.getSheet().getName() !== CT_HISTORY.SHEET || range.getLastRow() < 2) {
    ui.alert('Go to the "' + CT_HISTORY.SHEET + '" tab, select the line(s) of the change(s) to undo (any cell in them), then try again.');
    return;
  }
  var hist = range.getSheet();
  var first = Math.max(2, range.getRow());
  var lines = hist.getRange(first, 1, range.getLastRow() - first + 1, CT_HISTORY.HEADINGS.length).getDisplayValues();
  var done = 0;
  var notes = [];
  lines.forEach(function (l, i) {
    var row = first + i;
    var tab = l[2], a1 = l[3], oldValue = l[4], newValue = l[5];
    if (!tab || !a1 || /^\(/.test(a1)) return;
    if (oldValue === CT_HISTORY.UNKNOWN) { notes.push(tab + '!' + a1 + ': old value not known (use File → Version history).'); return; }
    var target = ss.getSheetByName(tab);
    if (!target) { notes.push(tab + '!' + a1 + ': the tab "' + tab + '" no longer exists.'); return; }
    var cell = target.getRange(a1);
    var now = cell.getFormula() || cell.getDisplayValue();
    if (now !== newValue && cell.getDisplayValue() !== newValue) {
      var ask = ui.alert('Cell changed again', tab + '!' + a1 + ' now shows "' + now + '" (the change in this line set it to "' +
        newValue + '").\n\nPut back "' + oldValue + '" anyway?', ui.ButtonSet.YES_NO);
      if (ask !== ui.Button.YES) { notes.push(tab + '!' + a1 + ': skipped.'); return; }
    }
    CT_writeOldValue_(cell, oldValue);
    done++;
    var when = new Date();
    hist.getRange(row, 7).setValue('Restored ' + Utilities.formatDate(when, CT_CONFIG.TIMEZONE, 'dd-MMM-yyyy HH:mm') +
      (CT_editorEmail_(null) ? ' by ' + CT_editorEmail_(null) : ''));
    CT_appendHistory_(ss, [[when, CT_editorEmail_(null), tab, a1, now, oldValue, 'Restore of the change on row ' + row + ' of this tab']]);
  });
  ui.alert(done + ' cell(s) restored.' + (notes.length ? '\n\n' + notes.join('\n') : ''));
}

/** Put a recorded value back: formulas as formulas, long numbers (IDs) as text, the rest as typed. */
function CT_writeOldValue_(cell, value) {
  if (/^=/.test(value)) { cell.setFormula(value); return; }
  if (/^\d{16,}$/.test(value)) cell.setNumberFormat('@');
  cell.setValue(value);
}
