/**
 * COURIER TRACKING: the main program. Adds the sheet menu, reads the shipments,
 * asks the courier APIs for their status and writes Brief Status, Tracking Status
 * and Status Date (columns set in CT_Config).
 *
 * Built to live next to other scripts in the same spreadsheet:
 *  - every name starts with CT_, so nothing clashes with other files;
 *  - it has no function called onOpen (a spreadsheet can only have one); the menu
 *    is added by its own "on open" trigger, created by CT_setup;
 *  - it only creates, changes or deletes its own triggers (CT_...);
 *  - it holds Google's shared script lock only for an instant (to check its own "running"
 *    flag), so other scripts never wait for it;
 *  - it only writes to the SHEET_NAME tab and its own log tab.
 */

// ─── One-time setup ─────────────────────────────────────────────────────────

/**
 * Run this ONCE from the Apps Script editor (choose CT_setup at the top, press ▶ Run).
 * It adds the menu trigger and the daily update. Running it again is harmless.
 */
function CT_setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Stop here with a clear message if a tab name is wrong.
  CT_dataSheet_(ss);
  [CT_SYNC.PRE_CRM.SHEET, CT_SYNC.SELF_SHIP.SHEET, CT_SYNC.REVIEW.SHEET].forEach(function (n) { CT_requireSheet_(ss, n); });

  CT_deleteTriggers_('CT_onOpen');
  ScriptApp.newTrigger('CT_onOpen').forSpreadsheet(ss).onOpen().create();
  CT_deleteTriggers_('CT_onEdit');
  ScriptApp.newTrigger('CT_onEdit').forSpreadsheet(ss).onEdit().create();
  CT_deleteTriggers_('CT_hourlySync');
  ScriptApp.newTrigger('CT_hourlySync').timeBased().everyHours(CT_SYNC.SYNC_EVERY_HOURS).create();
  CT_deleteTriggers_('CT_importTracking');
  ScriptApp.newTrigger('CT_importTracking').timeBased().everyMinutes(CT_IMPORT.EVERY_MINUTES).create();
  // Live import: react to edits in the seller team's spreadsheet (needs edit access there).
  CT_deleteTriggers_('CT_onSourceChange');
  var live = 'live (about ' + CT_IMPORT.LIVE_DELAY_SECONDS + ' s after an edit there) + every ' + CT_IMPORT.EVERY_MINUTES + ' minutes';
  try {
    ScriptApp.newTrigger('CT_onSourceChange').forSpreadsheet(CT_IMPORT.SOURCE_SPREADSHEET_ID).onEdit().create();
    ScriptApp.newTrigger('CT_onSourceChange').forSpreadsheet(CT_IMPORT.SOURCE_SPREADSHEET_ID).onChange().create();
  } catch (e) {
    live = 'every ' + CT_IMPORT.EVERY_MINUTES + ' minutes only (could not watch the seller team\'s spreadsheet for edits: ' + e.message + ')';
  }
  CT_installDailyTrigger_();
  console.log('✅ Courier Tracking is set up. Reload the spreadsheet to see the "📦 Courier Tracking" menu. ' +
    'Daily tracking update: around ' + CT_CONFIG.DAILY_UPDATE_HOUR + ':00 (' + CT_CONFIG.TIMEZONE + '). ' +
    'Order sync: every ' + CT_SYNC.SYNC_EVERY_HOURS + ' hour(s) and after edits to "' + CT_SYNC.PRE_CRM.SHEET +
    '" or "' + CT_SYNC.SELF_SHIP.SHEET + '". Tracking import: ' + live + '.');
}

// ─── Menu ───────────────────────────────────────────────────────────────────

/** Adds the menu. Runs on every open through the trigger made by CT_setup. */
function CT_onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 Courier Tracking')
    .addItem('Sync orders now (Pre CRM → Order Tracking → Review)', 'CT_syncNow')
    .addItem('Move orders up to the top of Order Tracking', 'CT_moveOrdersToTop')
    .addItem('Make all FSNs clickable (all tabs)', 'CT_linkAllFsns')
    .addItem('Import tracking data now (seller team sheet → Raw Order Tracking)', 'CT_importTrackingNow')
    .addSeparator()
    .addItem('Update all tracking statuses now', 'CT_updateAllNow')
    .addItem('Update selected rows only', 'CT_updateSelectedRows')
    .addSeparator()
    .addItem('Set / change API keys', 'CT_setApiKeys')
    .addItem('Test API connections', 'CT_testConnections')
    .addSeparator()
    .addItem('Turn ON daily update (' + CT_CONFIG.DAILY_UPDATE_HOUR + ' AM)', 'CT_turnOnDailyUpdate')
    .addItem('Turn OFF daily update', 'CT_turnOffDailyUpdate')
    .addToUi();
}

function CT_updateAllNow() {
  CT_runUpdate_({ interactive: true });
}

function CT_updateSelectedRows() {
  var ui = SpreadsheetApp.getUi();
  var range = SpreadsheetApp.getActiveRange();
  if (!range || range.getSheet().getName() !== CT_CONFIG.SHEET_NAME) {
    return ui.alert('Go to the "' + CT_CONFIG.SHEET_NAME + '" tab and select the rows you want to update first.');
  }
  var rows = {};
  for (var r = range.getRow(); r <= range.getLastRow(); r++) rows[r] = true;
  CT_runUpdate_({ interactive: true, onlyRows: rows, ignoreFinished: true });
}

/** Called by the daily trigger: bring in new orders first, then track. */
function CT_dailyUpdate() {
  try {
    CT_runSync_({});
  } catch (e) {
    console.error('Order sync failed before the daily tracking update: ' + e.message);
  }
  CT_runUpdate_({});
}

/** Called one minute after a run had to pause (Google's time limit or the API's speed limit). */
function CT_continueUpdate() {
  CT_runUpdate_({ resume: true });
}

// ─── API keys, connection test, daily update ──────────────────────────────────

function CT_setApiKeys() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var keys = [
    ['CT_TRACKCOURIER_API_KEY', 'TrackCourier.io API key (starts with tc_live_)'],
    ['CT_DELHIVERY_TOKEN', 'Delhivery API token (optional, leave empty if you don\'t have one)'],
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

function CT_testConnections() {
  var names = { DELHIVERY: 'Delhivery API', TRACKCOURIER: 'TrackCourier.io', DPWORLD_WEB: 'DP World website' };
  var lines = [CT_testTrackCourierConnection_(), CT_testDelhiveryConnection_(), CT_testDpWorldConnection_(), ''];
  Object.keys(CT_CONFIG.COURIERS).forEach(function (key) {
    lines.push(CT_CONFIG.COURIERS[key].label + ' → ' + names[CT_resolveProvider_(key)]);
  });
  var daily = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'CT_dailyUpdate'; });
  lines.push('', 'Daily update: ' + (daily ? 'ON, around ' + CT_CONFIG.DAILY_UPDATE_HOUR + ':00' : 'OFF'));
  lines.push('Tab being updated: "' + CT_CONFIG.SHEET_NAME + '"');
  lines.push('Last tracking import: ' + (PropertiesService.getScriptProperties().getProperty('CT_IMPORT_STATUS') || 'not run yet'));
  SpreadsheetApp.getUi().alert('Connection test', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function CT_turnOnDailyUpdate() {
  CT_installDailyTrigger_();
  SpreadsheetApp.getUi().alert('Daily update is ON. Every day between ' + CT_CONFIG.DAILY_UPDATE_HOUR +
    ':00 and ' + CT_CONFIG.DAILY_UPDATE_HOUR + ':30, all parcels that are not delivered yet are checked, ' +
    'even when nobody has the sheet open.');
}

function CT_turnOffDailyUpdate() {
  CT_deleteTriggers_('CT_dailyUpdate');
  CT_deleteTriggers_('CT_continueUpdate');
  SpreadsheetApp.getUi().alert('Daily update is OFF.');
}

function CT_installDailyTrigger_() {
  CT_deleteTriggers_('CT_dailyUpdate');
  // nearMinute(15): Google starts it within ±15 minutes, so between hh:00 and hh:30.
  ScriptApp.newTrigger('CT_dailyUpdate').timeBased()
    .everyDays(1).atHour(CT_CONFIG.DAILY_UPDATE_HOUR).nearMinute(15)
    .inTimezone(CT_CONFIG.TIMEZONE)
    .create();
}

/** Deletes only this script's own triggers (by handler name); other scripts' triggers are never touched. */
function CT_deleteTriggers_(handlerName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handlerName) ScriptApp.deleteTrigger(t);
  });
}

// ─── The update itself ──────────────────────────────────────────────────────

/** Where a courier's numbers are tracked: 'DELHIVERY', 'TRACKCOURIER' or 'DPWORLD_WEB'. */
function CT_resolveProvider_(courierKey) {
  var p = CT_CONFIG.COURIERS[courierKey].provider;
  if (p === 'AUTO') return CT_getSecret_('CT_DELHIVERY_TOKEN') ? 'DELHIVERY' : 'TRACKCOURIER';
  return p;
}

// Providers in the order they are asked. TrackCourier.io goes last because it is
// rate-limited: if it has to pause, the rows after the pause point only need
// re-checking with the free providers.
var CT_PROVIDER_ORDER_ = ['DELHIVERY', 'DPWORLD_WEB', 'TRACKCOURIER'];

/** Time after which a run stops asking APIs and pauses (set by CT_runUpdate_). */
var CT_RUN_DEADLINE_ = 0;

function CT_timeIsUp_() {
  return CT_RUN_DEADLINE_ > 0 && Date.now() > CT_RUN_DEADLINE_;
}

/**
 * Ask one provider about a list of jobs ({ courierKey, id }).
 * Returns { 'COURIERKEY|id': { status, date } | { error } | { deferred } }.
 */
function CT_trackWithProvider_(provider, jobs) {
  var out = {};
  try {
    if (provider === 'TRACKCOURIER') return CT_trackWithTrackCourier_(jobs);
    var ids = jobs.map(function (j) { return j.id; });
    var byId = provider === 'DELHIVERY' ? CT_trackWithDelhivery_(ids) : CT_trackWithDpWorld_(ids);
    jobs.forEach(function (j) { out[j.courierKey + '|' + j.id] = byId[j.id]; });
  } catch (e) {
    // A problem that affects every row of this provider (bad key, plan limit, ...).
    jobs.forEach(function (j) { out[j.courierKey + '|' + j.id] = { error: e.message }; });
  }
  return out;
}

// A run counts as "still going" for at most this long (a crashed run can't block forever).
var CT_RUN_FLAG_MAX_AGE_MS_ = 10 * 60 * 1000;

/**
 * options:
 *   interactive    - started from the menu (show messages on screen)
 *   onlyRows       - { rowNumber: true } to update just those rows
 *   ignoreFinished - also re-check rows that are already Delivered
 *   resume         - continue a run that paused
 */
function CT_runUpdate_(options) {
  var props = PropertiesService.getScriptProperties();
  // Our own "already running" flag. Google's script lock (shared with every other script in
  // this spreadsheet) is held only for the instant it takes to check and set the flag.
  if (!CT_claimFlag_('CT_RUNNING_SINCE', CT_RUN_FLAG_MAX_AGE_MS_)) {
    CT_notify_(options, 'An update is already running. Try again in a few minutes.');
    return;
  }
  try {
    CT_deleteTriggers_('CT_continueUpdate');
    var startedAt = Date.now();
    CT_RUN_DEADLINE_ = startedAt + CT_CONFIG.MAX_RUNTIME_MS;
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = CT_dataSheet_(ss);
    var log = new CT_RunLog_(ss, !!options.resume);
    var stats = { updated: 0, errors: 0, skipped: 0 };

    var firstRow = CT_CONFIG.HEADER_ROWS + 1;
    var lastRow = sheet.getLastRow();
    if (options.onlyRows) {
      var picked = Object.keys(options.onlyRows).map(Number);
      firstRow = Math.max(firstRow, Math.min.apply(null, picked));
      lastRow = Math.min(lastRow, Math.max.apply(null, picked));
    }
    if (options.resume) firstRow = Math.max(firstRow, Number(props.getProperty('CT_RESUME_ROW')) || firstRow);
    props.deleteProperty('CT_RESUME_ROW');
    // How many times in a row this run has paused and continued.
    var resumes = options.resume ? (Number(props.getProperty('CT_RESUME_COUNT')) || 0) + 1 : 0;
    props.setProperty('CT_RESUME_COUNT', String(resumes));

    CT_notify_(options, 'Checking shipments…');
    var paused = false;
    var pauseAt = function (row, why) {
      paused = true;
      if (options.onlyRows) {
        // A "selected rows" run is not resumed on its own, so it never touches other rows.
        log.add(row, '', '', 'INFO', 'Stopped at row ' + row + ' (' + why + '). Select the remaining rows and run "Update selected rows only" again in a minute.');
        return;
      }
      if (resumes >= CT_CONFIG.MAX_AUTO_RESUMES) {
        // Something keeps blocking progress (e.g. the plan's limit). Stop retrying;
        // the next daily update starts again from the top.
        log.add(row, '', '', 'ERROR', 'Stopped at row ' + row + ' (' + why + ') after ' + resumes +
          ' automatic continuations. The next daily update will try again.');
        return;
      }
      props.setProperty('CT_RESUME_ROW', String(row));
      ScriptApp.newTrigger('CT_continueUpdate').timeBased().after(60 * 1000).create();
      log.add(row, '', '', 'INFO', 'Paused at row ' + row + ' (' + why + '). Will continue automatically in about a minute.');
    };
    for (var r = firstRow; r <= lastRow; r += CT_CONFIG.ROWS_PER_BLOCK) {
      if (CT_timeIsUp_()) { pauseAt(r, 'Google time limit'); break; }
      var deferredRow = CT_processBlock_(sheet, r, Math.min(CT_CONFIG.ROWS_PER_BLOCK, lastRow - r + 1), options, log, stats);
      if (deferredRow) { pauseAt(deferredRow, 'time or TrackCourier.io per-minute limit'); break; }
    }

    var usage = CT_trackCourierUsage_();
    if (usage) log.add('', '', '', 'INFO', usage);
    log.flush();
    var summary = 'Updated ' + stats.updated + ' row(s). ' +
      (stats.errors ? stats.errors + ' problem(s), see the "' + CT_CONFIG.LOG_SHEET_NAME + '" tab. ' : '') +
      (stats.skipped ? stats.skipped + ' delivered/blank row(s) skipped. ' : '') +
      (paused ? 'Paused (time or speed limit); it will continue on its own in a minute. ' : '') +
      (usage ? usage : '');
    CT_notify_(options, summary);
  } finally {
    props.deleteProperty('CT_RUNNING_SINCE');
  }
}

/**
 * Process `count` rows starting at `startRow`: read, track, write.
 * Returns the first sheet row that had to be postponed (0 if none).
 */
function CT_processBlock_(sheet, startRow, count, options, log, stats) {
  if (count <= 0) return 0;
  var C = CT_CONFIG.COLUMNS;
  var cId = CT_columnNumber_(C.TRACKING_ID);
  var cCourier = CT_columnNumber_(C.COURIER);
  var cStatus = CT_columnNumber_(C.STATUS);
  var cDate = CT_columnNumber_(C.STATUS_DATE);
  var cBrief = C.BRIEF_STATUS ? CT_columnNumber_(C.BRIEF_STATUS) : 0;
  var used = [cId, cCourier, cStatus, cDate].concat(cBrief ? [cBrief] : []);
  var minCol = Math.min.apply(null, used);
  var maxCol = Math.max.apply(null, used);

  var values = sheet.getRange(startRow, minCol, count, maxCol - minCol + 1).getValues();
  var cell = function (row, c) { return row[c - minCol]; };

  var statusOut = values.map(function (row) { return [cell(row, cStatus)]; });
  var dateOut = values.map(function (row) { return [cell(row, cDate)]; });
  var briefOut = values.map(function (row) { return [cBrief ? cell(row, cBrief) : '']; });
  var changedRows = {}; // row index → true

  // Collect the rows that need checking, in row order, grouped by provider.
  // The same number on several rows is asked only once.
  var rowsFor = {};    // 'COURIERKEY|id' → [row index, ...]
  var jobsFor = {};    // provider → [{ courierKey, id }, ...]
  values.forEach(function (row, i) {
    var sheetRow = startRow + i;
    if (options.onlyRows && !options.onlyRows[sheetRow]) return;
    var id = CT_cleanTrackingId_(cell(row, cId));
    var status = String(cell(row, cStatus) || '').trim();
    var brief = cBrief ? String(cell(row, cBrief) || '').trim() : '';

    // Fill a missing Brief Status from an existing Tracking Status (no API call needed).
    if (cBrief && !brief && status) {
      briefOut[i][0] = CT_briefStatus_(status);
      changedRows[i] = true;
    }
    if (!id) { stats.skipped++; return; }
    if (CT_CONFIG.SKIP_FINISHED && !options.ignoreFinished &&
        (CT_isFinishedStatus_(status) || CT_isFinishedStatus_(brief))) { stats.skipped++; return; }

    var courierText = cell(row, cCourier);
    if (CT_isManualCourier_(courierText)) { stats.skipped++; return; } // tracked by hand (e.g. BNG)
    var key = CT_courierKeyFor_(courierText);
    if (!key) {
      stats.errors++;
      log.add(sheetRow, id, courierText, 'ERROR', courierText
        ? 'Courier name not recognised. Add it to "aliases" in CT_Config if it is one of the supported couriers.'
        : 'Courier Partner (column ' + C.COURIER + ') is empty.');
      return;
    }
    var jobKey = key + '|' + id;
    if (!rowsFor[jobKey]) {
      rowsFor[jobKey] = [];
      var provider = CT_resolveProvider_(key);
      (jobsFor[provider] = jobsFor[provider] || []).push({ courierKey: key, id: id });
    }
    rowsFor[jobKey].push(i);
  });

  var firstDeferred = 0;
  var tz = sheet.getParent().getSpreadsheetTimeZone();

  CT_PROVIDER_ORDER_.forEach(function (provider) {
    var jobs = jobsFor[provider];
    if (!jobs) return;
    var results = CT_trackWithProvider_(provider, jobs);
    jobs.forEach(function (job) {
      var jobKey = job.courierKey + '|' + job.id;
      var res = results[jobKey] || { error: 'No answer from the API for this number.' };
      var label = CT_CONFIG.COURIERS[job.courierKey].label;
      rowsFor[jobKey].forEach(function (i) {
        var sheetRow = startRow + i;
        if (res.deferred) {
          if (!firstDeferred || sheetRow < firstDeferred) firstDeferred = sheetRow;
        } else if (res.error) {
          stats.errors++;
          log.add(sheetRow, job.id, label, 'ERROR', res.error);
        } else {
          statusOut[i][0] = res.status;
          briefOut[i][0] = CT_briefStatus_(res.status);
          dateOut[i][0] = CT_toSheetDate_(res.date, tz);
          if (!res.date) log.add(sheetRow, job.id, label, 'INFO', 'Status found but the courier gave no date.');
          stats.updated++;
          changedRows[i] = true;
        }
      });
    });
  });

  CT_writeChangedRows_(sheet, startRow, count, values, cell, cId, changedRows,
    [{ col: cStatus, out: statusOut }, { col: cDate, out: dateOut, format: CT_CONFIG.DATE_FORMAT }]
      .concat(cBrief ? [{ col: cBrief, out: briefOut }] : []), log);
  return firstDeferred;
}

/**
 * Write only the rows that changed, and only if the row still holds the same
 * tracking ID as when it was read (someone may have inserted or deleted rows
 * during the run). Untouched cells are never rewritten.
 */
function CT_writeChangedRows_(sheet, startRow, count, values, cell, cId, changedRows, columns, log) {
  var indexes = Object.keys(changedRows).map(Number).sort(function (a, b) { return a - b; });
  if (!indexes.length) return;
  var idsNow = sheet.getRange(startRow, cId, count, 1).getValues();
  indexes = indexes.filter(function (i) {
    var same = CT_cleanTrackingId_(idsNow[i][0]) === CT_cleanTrackingId_(cell(values[i], cId));
    if (!same) log.add(startRow + i, CT_cleanTrackingId_(cell(values[i], cId)), '', 'INFO',
      'Rows moved while updating (a row was added or deleted), so this row was left as it is. It will be updated on the next run.');
    return same;
  });

  // Group neighbouring rows so each group is one write.
  var runs = [];
  indexes.forEach(function (i) {
    var last = runs[runs.length - 1];
    if (last && last.end === i - 1) last.end = i;
    else runs.push({ start: i, end: i });
  });
  runs.forEach(function (run) {
    columns.forEach(function (c) {
      var range = sheet.getRange(startRow + run.start, c.col, run.end - run.start + 1, 1);
      range.setValues(c.out.slice(run.start, run.end + 1));
      if (c.format) range.setNumberFormat(c.format);
    });
  });
}

function CT_dataSheet_(ss) {
  var sheet = ss.getSheetByName(CT_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Could not find the tab "' + CT_CONFIG.SHEET_NAME + '". Check SHEET_NAME in CT_Config (spelling, spaces and capitals must match).');
  return sheet;
}

function CT_notify_(options, message) {
  console.log(message);
  if (!options.interactive) return;
  try { SpreadsheetApp.getActiveSpreadsheet().toast(message, 'Courier Tracking', 8); } catch (e) { /* no UI */ }
}

// ─── Run log (its own tab) ────────────────────────────────────────────────────

function CT_RunLog_(ss, append) {
  this.ss = ss;
  this.append = append;
  this.rows = [];
}

CT_RunLog_.prototype.add = function (row, id, courier, level, message) {
  this.rows.push([new Date(), row, id, courier, level, message]);
};

CT_RunLog_.prototype.flush = function () {
  var sheet = this.ss.getSheetByName(CT_CONFIG.LOG_SHEET_NAME);
  if (!sheet) sheet = this.ss.insertSheet(CT_CONFIG.LOG_SHEET_NAME);
  if (!this.append) {
    sheet.clearContents();
    sheet.getRange(1, 1, 1, 6).setValues([['Time', 'Row', 'Tracking ID', 'Courier', 'Type', 'Message']]).setFontWeight('bold');
  }
  var rows = this.rows.length ? this.rows : [[new Date(), '', '', '', 'INFO', 'Run finished with nothing to report.']];
  rows = rows.slice(0, 5000);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).setNumberFormat('dd-mmm-yyyy hh:mm');
};
