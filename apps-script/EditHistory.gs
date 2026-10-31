/**
 * Edit History: every change a person makes in any tab is written to a SEPARATE Google Sheets file
 * ("Edit History – <this spreadsheet>", in the Drive of the person who ran CT_setup): time, who,
 * tab, cell, old value, new value. A mistaken change is put back by ticking "Restore" on its line
 * there: only that one cell gets its old value back, everything changed after it stays as it is.
 *
 * Why a separate file: Google Sheets forgets its Undo (Ctrl+Z) history whenever a script writes
 * into the spreadsheet while people work in it. Writing the history into another file keeps
 * Ctrl+Z working in this one.
 *
 * Limits (set by Google): for one cell Google tells the robot the old value. When many cells are
 * changed at once (a paste over several cells, Delete on a selection), Google gives only the new
 * values, so such a row says "(old value not known)" and the time to use in File → Version history.
 * Deleted rows are noted the same way. Changes made by the robot itself are not recorded here
 * (they are in the robot's own log tabs).
 */

var CT_HISTORY = {
  SHEET: 'Edit History',    // the tab inside the history file (and the old tab name in this spreadsheet)
  HEADINGS: ['Time', 'Who', 'Tab', 'Cell', 'Old value', 'New value', 'Status', 'Restore', 'Restore even if changed since'],
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
  CT_appendHistory_(rows);
}

/** From CT_onChange: whole rows deleted (Google gives no values for those). */
function CT_recordRowsRemoved_(ss, tab) {
  if (!tab || CT_historySkipsTab_(tab)) return;
  var now = new Date();
  CT_appendHistory_([[now, '', tab, '(row(s) deleted)', CT_HISTORY.UNKNOWN, '', CT_historyVersionHint_(now)]]);
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

/**
 * The "Edit History" tab in the separate history file; the file is made the first time.
 * An "Edit History" tab left in this spreadsheet by the earlier version is moved into it.
 */
function CT_historySheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('CT_HISTORY_FILE_ID');
  var file = null;
  if (id) { try { file = SpreadsheetApp.openById(id); } catch (e) { file = null; } }
  if (!file) {
    var main = SpreadsheetApp.openById(CT_IMPORT.TARGET_SPREADSHEET_ID);
    file = SpreadsheetApp.create('Edit History – ' + main.getName());
    props.setProperty('CT_HISTORY_FILE_ID', file.getId());
    var first = file.getSheets()[0];
    first.setName(CT_HISTORY.SHEET);
    first.getRange(1, 1, 1, CT_HISTORY.HEADINGS.length).setValues([CT_HISTORY.HEADINGS]).setFontWeight('bold');
    CT_moveOldHistoryTab_(main, first);
  }
  return file.getSheetByName(CT_HISTORY.SHEET) || file.getSheets()[0];
}

/** One time: lines from the old "Edit History" tab of this spreadsheet go into the history file. */
function CT_moveOldHistoryTab_(main, target) {
  var old = main.getSheetByName(CT_HISTORY.SHEET);
  if (!old) return;
  var n = old.getLastRow() - 1;
  if (n > 0) {
    var rows = old.getRange(2, 1, n, 7).getValues();
    target.getRange(2, 5, n, 2).setNumberFormat('@');
    target.getRange(2, 1, n, 7).setValues(rows.map(function (r) { return [r[0], r[1], r[2], r[3], String(r[4]), String(r[5]), r[6]]; }));
    target.getRange(2, 1, n, 1).setNumberFormat('dd-mmm-yyyy hh:mm:ss');
    target.getRange(2, 8, n, 2).insertCheckboxes();
  }
  main.deleteSheet(old);
}

function CT_appendHistory_(rows) {
  if (!rows.length) return;
  var sh = CT_historySheet_();
  var start = sh.getLastRow() + 1;
  // Old/new values are kept as text, exactly as they looked (long IDs stay whole).
  sh.getRange(start, 5, rows.length, 2).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, 7).setValues(rows.map(function (r) {
    return [r[0], r[1], r[2], r[3], String(r[4]), String(r[5]), r[6]];
  }));
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('dd-mmm-yyyy hh:mm:ss');
  sh.getRange(start, 8, rows.length, 2).insertCheckboxes();
  var extra = sh.getLastRow() - 1 - CT_HISTORY.KEEP_ROWS;
  if (extra > 500) sh.deleteRows(2, extra);
}

/** Menu: show the link to the history file. */
function CT_openEditHistory() {
  var url = CT_historySheet_().getParent().getUrl();
  SpreadsheetApp.getUi().alert('Edit History',
    'Every change is listed in a separate file (so Ctrl+Z keeps working here):\n\n' + url +
    '\n\nTo undo one change: tick "Restore" on its line there. Only that cell gets its old value back.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}
/** Kept for menus opened before this version (the old menu item name). */
function CT_restoreSelectedChanges() { CT_openEditHistory(); }

/**
 * Installable "on edit" trigger on the history file (made by CT_setup): ticking "Restore" on a line
 * puts that cell's old value back in this spreadsheet. "Restore even if changed since" does it also
 * when the cell was changed again after that line.
 */
function CT_onHistoryEdit(e) {
  if (!e || !e.range) return;
  var hist = e.range.getSheet();
  if (hist.getName() !== CT_HISTORY.SHEET || e.range.getLastColumn() < 8 || e.range.getColumn() > 9) return;
  var main = SpreadsheetApp.openById(CT_IMPORT.TARGET_SPREADSHEET_ID);
  var first = Math.max(2, e.range.getRow());
  for (var row = first; row <= e.range.getLastRow(); row++) {
    var line = hist.getRange(row, 1, 1, 9).getValues()[0];
    var shown = hist.getRange(row, 1, 1, 7).getDisplayValues()[0];
    if (line[7] !== true && line[8] !== true) continue;
    var status = CT_restoreHistoryLine_(main, shown, line[8] === true, row);
    hist.getRange(row, 7).setValue(status);
    hist.getRange(row, 8, 1, 2).setValues([[false, false]]);
  }
}

/** Put one line's old value back. Returns the text for the Status column. */
function CT_restoreHistoryLine_(main, l, force, row) {
  var tab = l[2], a1 = l[3], oldValue = l[4], newValue = l[5];
  var stamp = function () { return Utilities.formatDate(new Date(), CT_CONFIG.TIMEZONE, 'dd-MMM-yyyy HH:mm'); };
  if (!tab || !a1 || /^\(/.test(a1) || oldValue === CT_HISTORY.UNKNOWN) {
    return 'Not restored: the old value is not known for this line. Use File → Version history in the main sheet.';
  }
  var target = main.getSheetByName(tab);
  if (!target) return 'Not restored: the tab "' + tab + '" no longer exists.';
  var cell = target.getRange(a1);
  var now = cell.getFormula() || cell.getDisplayValue();
  if (!force && now !== newValue && cell.getDisplayValue() !== newValue) {
    return 'Not restored: ' + a1 + ' was changed again since and now shows "' + now + '". ' +
      'Tick "Restore even if changed since" to put back "' + oldValue + '" anyway.';
  }
  CT_writeOldValue_(cell, oldValue);
  var who = CT_editorEmail_(null);
  CT_appendHistory_([[new Date(), who, tab, a1, now, oldValue, 'Restore of line ' + row]]);
  return 'Restored ' + stamp() + (who ? ' by ' + who : '');
}

/** Put a recorded value back: formulas as formulas, long numbers (IDs) as text, the rest as typed. */
function CT_writeOldValue_(cell, value) {
  if (/^=/.test(value)) { cell.setFormula(value); return; }
  if (/^\d{16,}$/.test(value)) cell.setNumberFormat('@');
  cell.setValue(value);
}
