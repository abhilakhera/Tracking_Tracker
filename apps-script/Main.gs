/**
 * The main program: adds the sheet menu, reads the shipments, asks the courier
 * APIs for their status and writes Tracking Status (col I) + Status Date (col J).
 */

// ─── Menu ───────────────────────────────────────────────────────────────────

/** Runs automatically when the spreadsheet is opened and adds the menu. */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Courier Tracking')
    .addItem('Update all tracking statuses now', 'updateAllTrackingStatuses')
    .addItem('Update selected rows only', 'updateSelectedRows')
    .addSeparator()
    .addItem('Set / change API keys', 'setApiKeys')
    .addItem('Test API connections', 'testConnections')
    .addSeparator()
    .addItem('Turn ON automatic updates', 'enableAutoUpdate')
    .addItem('Turn OFF automatic updates', 'disableAutoUpdate')
    .addToUi();
}

function updateAllTrackingStatuses() {
  runUpdate_({ interactive: true });
}

function updateSelectedRows() {
  var range = SpreadsheetApp.getActiveRange();
  if (!range) return SpreadsheetApp.getUi().alert('Select the rows you want to update first.');
  var rows = {};
  for (var r = range.getRow(); r <= range.getLastRow(); r++) rows[r] = true;
  runUpdate_({ interactive: true, onlyRows: rows, ignoreFinished: true });
}

/** Called by the automatic (time-based) trigger. */
function scheduledTrackingUpdate() {
  runUpdate_({});
}

/** Called one minute after a run had to pause because of Google's time limit. */
function continueTrackingUpdate() {
  runUpdate_({ resume: true });
}

// ─── API keys, connection test, automatic updates ──────────────────────────────

function setApiKeys() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var keys = [
    ['TRACKCOURIER_API_KEY', 'TrackCourier.io API key (starts with tc_live_)'],
    ['DELHIVERY_TOKEN', 'Delhivery API token (optional, leave empty if you don\'t have one)'],
  ];
  for (var i = 0; i < keys.length; i++) {
    var name = keys[i][0];
    var current = props.getProperty(name);
    var res = ui.prompt(keys[i][1],
      (current ? 'A key is already saved (ends with …' + current.slice(-4) + ').\n' : 'No key saved yet.\n') +
      'Paste the new key, leave empty to keep the current one, or type DELETE to remove it.',
      ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    var value = res.getResponseText().trim();
    if (value === 'DELETE') props.deleteProperty(name);
    else if (value) props.setProperty(name, value);
  }
  ui.alert('Saved. Next, use "Test API connections" to check the keys work.');
}

function testConnections() {
  var names = { DELHIVERY: 'Delhivery API', TRACKCOURIER: 'TrackCourier.io', DPWORLD_WEB: 'DP World website' };
  var lines = [testTrackCourierConnection_(), testDelhiveryConnection_(), testDpWorldConnection_(), ''];
  Object.keys(CONFIG.COURIERS).forEach(function (key) {
    lines.push(CONFIG.COURIERS[key].label + ' → ' + names[resolveProvider_(key)]);
  });
  SpreadsheetApp.getUi().alert('Connection test', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function enableAutoUpdate() {
  deleteTriggers_('scheduledTrackingUpdate');
  var schedule = ScriptApp.newTrigger('scheduledTrackingUpdate').timeBased();
  // Google accepts every 1, 2, 4, 6, 8 or 12 hours; 24 means once a day (around 9 AM).
  if (CONFIG.AUTO_UPDATE_EVERY_HOURS >= 24) schedule.everyDays(1).atHour(9).create();
  else schedule.everyHours(CONFIG.AUTO_UPDATE_EVERY_HOURS).create();
  SpreadsheetApp.getUi().alert('Automatic updates are ON. Statuses refresh every ' +
    CONFIG.AUTO_UPDATE_EVERY_HOURS + ' hour(s), even when the sheet is closed.');
}

function disableAutoUpdate() {
  deleteTriggers_('scheduledTrackingUpdate');
  deleteTriggers_('continueTrackingUpdate');
  SpreadsheetApp.getUi().alert('Automatic updates are OFF.');
}

function deleteTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  });
}

// ─── The update itself ──────────────────────────────────────────────────────

/** Where a courier's numbers are tracked: 'DELHIVERY', 'TRACKCOURIER' or 'DPWORLD_WEB'. */
function resolveProvider_(courierKey) {
  var p = CONFIG.COURIERS[courierKey].provider;
  if (p === 'AUTO') return getSecret_('DELHIVERY_TOKEN') ? 'DELHIVERY' : 'TRACKCOURIER';
  return p;
}

// Providers in the order they are asked. TrackCourier.io goes last because it is
// rate-limited: if it has to pause, the rows after the pause point only need
// re-checking with the free providers.
var PROVIDER_ORDER_ = ['DELHIVERY', 'DPWORLD_WEB', 'TRACKCOURIER'];

/** Time after which a run stops asking APIs and pauses (set by runUpdate_). */
var RUN_DEADLINE_ = 0;

function timeIsUp_() {
  return RUN_DEADLINE_ > 0 && Date.now() > RUN_DEADLINE_;
}

/**
 * Ask one provider about a list of jobs ({ courierKey, id }).
 * Returns { 'COURIERKEY|id': { status, date } | { error } | { deferred } }.
 */
function trackWithProvider_(provider, jobs) {
  var out = {};
  try {
    if (provider === 'TRACKCOURIER') return trackWithTrackCourier_(jobs);
    var ids = jobs.map(function (j) { return j.id; });
    var byId = provider === 'DELHIVERY' ? trackWithDelhivery_(ids) : trackWithDpWorld_(ids);
    jobs.forEach(function (j) { out[j.courierKey + '|' + j.id] = byId[j.id]; });
  } catch (e) {
    // A problem that affects every row of this provider (bad key, plan limit, ...).
    jobs.forEach(function (j) { out[j.courierKey + '|' + j.id] = { error: e.message }; });
  }
  return out;
}

/**
 * options:
 *   interactive    - started from the menu (show messages on screen)
 *   onlyRows       - { rowNumber: true } to update just those rows
 *   ignoreFinished - also re-check rows that are already Delivered
 *   resume         - continue a run that paused at Google's time limit
 */
function runUpdate_(options) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    notify_(options, 'An update is already running. Try again in a few minutes.');
    return;
  }
  try {
    deleteTriggers_('continueTrackingUpdate');
    var startedAt = Date.now();
    RUN_DEADLINE_ = startedAt + CONFIG.MAX_RUNTIME_MS;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = dataSheet_(ss);
    var props = PropertiesService.getScriptProperties();
    var log = new RunLog_(ss, !!options.resume);
    var stats = { updated: 0, errors: 0, skipped: 0 };

    var firstRow = CONFIG.HEADER_ROWS + 1;
    var lastRow = sheet.getLastRow();
    if (options.onlyRows) {
      var picked = Object.keys(options.onlyRows).map(Number);
      firstRow = Math.max(firstRow, Math.min.apply(null, picked));
      lastRow = Math.min(lastRow, Math.max.apply(null, picked));
    }
    if (options.resume) firstRow = Math.max(firstRow, Number(props.getProperty('RESUME_ROW')) || firstRow);
    props.deleteProperty('RESUME_ROW');
    // How many times in a row this run has paused and continued.
    var resumes = options.resume ? (Number(props.getProperty('RESUME_COUNT')) || 0) + 1 : 0;
    props.setProperty('RESUME_COUNT', String(resumes));

    notify_(options, 'Checking shipments…');
    var paused = false;
    var pauseAt = function (row, why) {
      paused = true;
      if (options.onlyRows) {
        // A "selected rows" run is not resumed on its own, so it never touches other rows.
        log.add(row, '', '', 'INFO', 'Stopped at row ' + row + ' (' + why + '). Select the remaining rows and run "Update selected rows only" again in a minute.');
        return;
      }
      if (resumes >= CONFIG.MAX_AUTO_RESUMES) {
        // Something keeps blocking progress (e.g. the plan's limit). Stop retrying;
        // the next scheduled update starts again from the top.
        log.add(row, '', '', 'ERROR', 'Stopped at row ' + row + ' (' + why + ') after ' + resumes +
          ' automatic continuations. The next scheduled update will try again.');
        return;
      }
      props.setProperty('RESUME_ROW', String(row));
      ScriptApp.newTrigger('continueTrackingUpdate').timeBased().after(60 * 1000).create();
      log.add(row, '', '', 'INFO', 'Paused at row ' + row + ' (' + why + '). Will continue automatically in about a minute.');
    };
    for (var r = firstRow; r <= lastRow; r += CONFIG.ROWS_PER_BLOCK) {
      if (timeIsUp_()) { pauseAt(r, 'Google time limit'); break; }
      var deferredRow = processBlock_(sheet, r, Math.min(CONFIG.ROWS_PER_BLOCK, lastRow - r + 1), options, log, stats);
      if (deferredRow) { pauseAt(deferredRow, 'time or TrackCourier.io per-minute limit'); break; }
    }

    log.flush();
    var summary = 'Updated ' + stats.updated + ' row(s). ' +
      (stats.errors ? stats.errors + ' problem(s), see the "' + CONFIG.LOG_SHEET_NAME + '" tab. ' : '') +
      (stats.skipped ? stats.skipped + ' finished/blank row(s) skipped. ' : '') +
      (paused ? 'Paused (time or speed limit); it will continue on its own in a minute.' : '');
    notify_(options, summary);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Process `count` rows starting at `startRow`: read, track, write.
 * Returns the first sheet row that had to be postponed (0 if none).
 */
function processBlock_(sheet, startRow, count, options, log, stats) {
  if (count <= 0) return 0;
  var cId = columnNumber_(CONFIG.COLUMNS.TRACKING_ID);
  var cCourier = columnNumber_(CONFIG.COLUMNS.COURIER);
  var cStatus = columnNumber_(CONFIG.COLUMNS.STATUS);
  var cDate = columnNumber_(CONFIG.COLUMNS.STATUS_DATE);
  var minCol = Math.min(cId, cCourier, cStatus, cDate);
  var maxCol = Math.max(cId, cCourier, cStatus, cDate);

  var values = sheet.getRange(startRow, minCol, count, maxCol - minCol + 1).getValues();
  var col = function (c) { return c - minCol; };

  // Collect the rows that need checking, in row order, grouped by provider.
  // The same number on several rows is asked only once.
  var rowsFor = {};    // 'COURIERKEY|id' → [row index, ...]
  var jobsFor = {};    // provider → [{ courierKey, id }, ...]
  values.forEach(function (row, i) {
    var sheetRow = startRow + i;
    if (options.onlyRows && !options.onlyRows[sheetRow]) return;
    var id = cleanTrackingId_(row[col(cId)]);
    var courierText = row[col(cCourier)];
    if (!id) { stats.skipped++; return; }
    if (CONFIG.SKIP_FINISHED && !options.ignoreFinished && isFinishedStatus_(row[col(cStatus)])) { stats.skipped++; return; }
    var key = courierKeyFor_(courierText);
    if (!key) {
      stats.errors++;
      log.add(sheetRow, id, courierText, 'ERROR', courierText
        ? 'Courier name not recognised. Add it to "aliases" in Config.gs if it is one of the supported couriers.'
        : 'Courier Partner (column ' + CONFIG.COLUMNS.COURIER + ') is empty.');
      return;
    }
    var jobKey = key + '|' + id;
    if (!rowsFor[jobKey]) {
      rowsFor[jobKey] = [];
      var provider = resolveProvider_(key);
      (jobsFor[provider] = jobsFor[provider] || []).push({ courierKey: key, id: id });
    }
    rowsFor[jobKey].push(i);
  });

  var statusOut = values.map(function (row) { return [row[col(cStatus)]]; });
  var dateOut = values.map(function (row) { return [row[col(cDate)]]; });
  var changed = false;
  var firstDeferred = 0;
  var tz = sheet.getParent().getSpreadsheetTimeZone();

  PROVIDER_ORDER_.forEach(function (provider) {
    var jobs = jobsFor[provider];
    if (!jobs) return;
    var results = trackWithProvider_(provider, jobs);
    jobs.forEach(function (job) {
      var jobKey = job.courierKey + '|' + job.id;
      var res = results[jobKey] || { error: 'No answer from the API for this number.' };
      var label = CONFIG.COURIERS[job.courierKey].label;
      rowsFor[jobKey].forEach(function (i) {
        var sheetRow = startRow + i;
        if (res.deferred) {
          if (!firstDeferred || sheetRow < firstDeferred) firstDeferred = sheetRow;
        } else if (res.error) {
          stats.errors++;
          log.add(sheetRow, job.id, label, 'ERROR', res.error);
        } else {
          statusOut[i][0] = res.status;
          dateOut[i][0] = toSheetDate_(res.date, tz);
          if (!res.date) log.add(sheetRow, job.id, label, 'INFO', 'Status found but the courier gave no date.');
          stats.updated++;
          changed = true;
        }
      });
    });
  });

  if (changed) {
    sheet.getRange(startRow, cStatus, count, 1).setValues(statusOut);
    var dateRange = sheet.getRange(startRow, cDate, count, 1);
    dateRange.setValues(dateOut);
    dateRange.setNumberFormat(CONFIG.DATE_FORMAT);
  }
  return firstDeferred;
}

function dataSheet_(ss) {
  var sheet = CONFIG.SHEET_NAME
    ? ss.getSheetByName(CONFIG.SHEET_NAME)
    : ss.getSheets().filter(function (s) { return s.getName() !== CONFIG.LOG_SHEET_NAME; })[0];
  if (!sheet) throw new Error('Could not find the tab "' + CONFIG.SHEET_NAME + '". Check SHEET_NAME in Config.gs.');
  return sheet;
}

function notify_(options, message) {
  console.log(message);
  if (!options.interactive) return;
  try { SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Courier Tracking', 8); } catch (e) { /* no UI */ }
}

// ─── Run log (the "Tracking Log" tab) ──────────────────────────────────────────

function RunLog_(ss, append) {
  this.ss = ss;
  this.append = append;
  this.rows = [];
}

RunLog_.prototype.add = function (row, id, courier, level, message) {
  this.rows.push([new Date(), row, id, courier, level, message]);
};

RunLog_.prototype.flush = function () {
  var sheet = this.ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) sheet = this.ss.insertSheet(CONFIG.LOG_SHEET_NAME);
  if (!this.append) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 6).setValues([['Time', 'Row', 'Tracking ID', 'Courier', 'Type', 'Message']]).setFontWeight('bold');
  }
  var rows = this.rows.length ? this.rows : [[new Date(), '', '', '', 'INFO', 'Run finished with nothing to report.']];
  rows = rows.slice(0, 5000);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
};
