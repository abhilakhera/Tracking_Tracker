/**
 * TrackingMore (https://www.trackingmore.com): one API that tracks many
 * couriers, including Delhivery and Safexpress.
 *
 * How TrackingMore works:
 *   1. You register a tracking number once ("create"). This uses 1 credit from your plan.
 *   2. TrackingMore keeps checking the courier for you.
 *   3. You read the latest result ("get") as often as you like. Reads are free.
 * So the first run registers new numbers (status shows up a few minutes later), and
 * later runs read the result.
 *
 * Auth header: Tracking-Api-Key: <your key>
 */

var TM_BATCH_SIZE = 40; // TrackingMore allows up to 40 numbers per request

var TM_STATUS_LABELS = {
  pending: 'Pending',
  notfound: 'Not Found',
  inforeceived: 'Info Received',
  transit: 'In Transit',
  pickup: 'Out for Delivery',
  delivered: 'Delivered',
  undelivered: 'Delivery Failed',
  exception: 'Exception',
  expired: 'Expired',
};

/** Call the TrackingMore API and return the parsed JSON. */
function tmRequest_(method, path, payload) {
  var key = getSecret_('TRACKINGMORE_API_KEY');
  if (!key) throw new Error('No TrackingMore API key saved. Use the menu: Courier Tracking → Set / change API keys.');
  var options = {
    method: method,
    headers: { 'Tracking-Api-Key': key },
    contentType: 'application/json',
    muteHttpExceptions: true,
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);

  var response = UrlFetchApp.fetch(CONFIG.TRACKINGMORE_BASE_URL + path, options);
  var code = response.getResponseCode();
  var body = response.getContentText();
  var json = null;
  try { json = JSON.parse(body); } catch (e) { /* handled below */ }

  var metaCode = json && json.meta ? Number(json.meta.code) : code;
  var metaMsg = json && json.meta ? json.meta.message : shorten_(body);
  if (code === 401 || metaCode === 401) throw new Error('TrackingMore rejected the API key: ' + metaMsg);
  if (code === 402 || metaCode === 402) throw new Error('TrackingMore: no credits left on your plan (' + metaMsg + ').');
  if (code === 429 || metaCode === 429) throw new Error('TrackingMore: too many requests, try again later (' + metaMsg + ').');
  if (!json) throw new Error('TrackingMore HTTP ' + code + ': ' + shorten_(body));
  return json;
}

/**
 * Track a list of numbers for one courier (key of CONFIG.COURIERS).
 * Returns { trackingId: { status, date } | { pending, message } | { error } }.
 */
function trackWithTrackingMore_(courierKey, ids) {
  var courierCode = trackingMoreCourierCode_(courierKey);
  var results = {};

  chunk_(ids, TM_BATCH_SIZE).forEach(function (batch) {
    // 1. Read numbers TrackingMore already knows.
    var got = tmRequest_('get', '/trackings/get?courier_code=' + encodeURIComponent(courierCode) +
      '&tracking_numbers=' + encodeURIComponent(batch.join(',')));
    var found = {};
    toArray_(got.data).forEach(function (t) {
      if (t && t.tracking_number) found[cleanTrackingId_(t.tracking_number).toUpperCase()] = t;
    });

    // 2. Register the ones it doesn't know yet.
    var missing = batch.filter(function (id) { return !found[id.toUpperCase()]; });
    if (missing.length) {
      var created = tmRequest_('post', '/trackings/batch', missing.map(function (id) {
        return { tracking_number: id, courier_code: courierCode };
      }));
      var errors = createErrors_(created);
      missing.forEach(function (id) {
        var err = errors[id.toUpperCase()];
        if (err && !/exist/i.test(err)) {
          results[id] = { error: 'TrackingMore could not register it: ' + err };
        } else if (err) {
          results[id] = { pending: true, message: 'TrackingMore says it is already registered but returned no result yet.' };
        } else {
          results[id] = { pending: true, message: 'Registered with TrackingMore. Status usually appears within a few minutes and will be filled on the next run.' };
        }
      });
    }

    // 3. Turn known results into status + date.
    batch.forEach(function (id) {
      var t = found[id.toUpperCase()];
      if (t) results[id] = parseTrackingMoreItem_(t);
    });
  });
  return results;
}

/** Collect per-number errors from a batch-create response, keyed by upper-case number. */
function createErrors_(json) {
  var errs = {};
  var data = json.data || {};
  // Depending on the account, failures arrive as data.error[] or as items carrying errorCode.
  var list = Array.isArray(data)
    ? data.filter(function (e) { return e && (e.errorCode || e.errorMessage); })
    : toArray_(data.error);
  list.forEach(function (e) {
    if (!e || !e.tracking_number) return;
    var msg = e.errorMessage || e.message || e.errorCode || 'unknown error';
    errs[cleanTrackingId_(e.tracking_number).toUpperCase()] = String(msg);
  });
  if (json.meta && Number(json.meta.code) >= 400 && !list.length) {
    throw new Error('TrackingMore: ' + json.meta.message);
  }
  return errs;
}

/** Turn one TrackingMore tracking record into { status, date } or { pending }. */
function parseTrackingMoreItem_(t) {
  var ds = String(t.delivery_status || '').toLowerCase();
  var main = TM_STATUS_LABELS[ds] || (ds ? ds.charAt(0).toUpperCase() + ds.slice(1) : '');

  var events = []
    .concat(toArray_(t.origin_info && t.origin_info.trackinfo))
    .concat(toArray_(t.destination_info && t.destination_info.trackinfo))
    .filter(function (e) { return e && (e.checkpoint_date || e.tracking_detail); });
  events.sort(function (a, b) {
    return (parseCourierDate_(b.checkpoint_date) || 0) - (parseCourierDate_(a.checkpoint_date) || 0);
  });
  var latest = events[0];

  if (latest) {
    return {
      status: formatStatus_(main, latest.tracking_detail, latest.location),
      date: parseCourierDate_(latest.checkpoint_date) || parseCourierDate_(t.latest_checkpoint_time),
    };
  }
  if (t.latest_event) {
    return { status: formatStatus_(main, t.latest_event, ''), date: parseCourierDate_(t.latest_checkpoint_time) };
  }
  if (ds === 'pending' || ds === 'inforeceived' || !ds) {
    return { pending: true, message: 'TrackingMore has not received data from the courier yet.' };
  }
  // notfound / expired etc. with no events: report it, no date.
  return { status: main, date: null };
}

/**
 * Work out TrackingMore's courier code for one of our couriers. Uses the value in
 * CONFIG if set, otherwise searches TrackingMore's courier list once and saves the result.
 */
function trackingMoreCourierCode_(courierKey) {
  var courier = CONFIG.COURIERS[courierKey];
  if (courier.trackingMoreCode) return courier.trackingMoreCode;

  var props = PropertiesService.getScriptProperties();
  var cached = props.getProperty('TM_CODE_' + courierKey);
  if (cached) return cached;

  var list = toArray_(tmRequest_('get', '/couriers/all').data);
  var match = pickCourier_(list, courier.trackingMoreSearch);
  if (!match.best) {
    throw new Error('TrackingMore has no Indian courier matching "' + courier.label + '". ' +
      (match.candidates.length ? 'Similar entries: ' + match.candidates.join('; ') +
        '. If one is right, put its code in trackingMoreCode in Config.gs.' : '') +
      ' See docs/TROUBLESHOOTING.md for other options.');
  }
  props.setProperty('TM_CODE_' + courierKey, match.best.courier_code);
  return match.best.courier_code;
}

/** Choose the best matching courier from TrackingMore's list (prefers Indian entries). */
function pickCourier_(list, searchTerms) {
  var terms = searchTerms.map(normalizeText_);
  var hits = list.filter(function (c) {
    var name = normalizeText_(c.courier_name) + ' ' + normalizeText_(c.courier_code);
    return terms.some(function (term) { return name.indexOf(term) !== -1; });
  });
  var indian = hits.filter(function (c) {
    return String(c.courier_country_iso2 || '').toUpperCase() === 'IN' || /india/i.test(c.courier_name);
  });
  return {
    best: indian[0] || null,
    candidates: hits.slice(0, 8).map(function (c) {
      return c.courier_name + ' [' + c.courier_code + ', ' + (c.courier_country_iso2 || '?') + ']';
    }),
  };
}

function toArray_(x) {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

/** Used by "Test API connections". Returns lines of text. */
function testTrackingMoreConnection_() {
  if (!getSecret_('TRACKINGMORE_API_KEY')) return ['TrackingMore: no API key saved.'];
  var lines = [];
  try {
    tmRequest_('get', '/couriers/all');
    lines.push('TrackingMore: ✅ connected.');
  } catch (e) {
    return ['TrackingMore: ❌ ' + e.message];
  }
  Object.keys(CONFIG.COURIERS).forEach(function (key) {
    var c = CONFIG.COURIERS[key];
    if (resolveProvider_(key) !== 'TRACKINGMORE') return;
    try {
      lines.push('  • ' + c.label + ' → TrackingMore courier code "' + trackingMoreCourierCode_(key) + '"');
    } catch (e) {
      lines.push('  • ' + c.label + ' → ❌ ' + e.message);
    }
  });
  return lines;
}
