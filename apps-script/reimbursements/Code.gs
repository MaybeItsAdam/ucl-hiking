/**
 * UCL Hiking app → reimbursement spreadsheet.
 *
 * Paste this into the reimbursement spreadsheet's own Apps Script project as a
 * new file (Extensions › Apps Script › + › Script, name it "AppClaims"). It
 * receives expense claims straight from a member's browser in the hiking app,
 * so bank details go only to this spreadsheet: the app never sees or stores
 * them. The app vouches for who is claiming with a short-lived signed token,
 * checked here before anything is written.
 *
 * Script properties (Project Settings › Script properties):
 *   UCLH_APP_SECRET          the same value as REIMBURSE_SIGNING_SECRET in the app
 *   UCLH_RECEIPTS_FOLDER_ID  optional: Drive folder for receipt photos
 *
 * Deploy › New deployment › Web app › Execute as: Me, Who has access: Anyone.
 * The /exec URL goes in the app as REIMBURSE_SCRIPT_URL.
 *
 * Everything except doPost is prefixed uclhApp_ so it can't clash with the
 * spreadsheet's existing scripts. A project can only have one doPost: if one
 * already exists, see README.md.
 */

/**
 * One tab per form, with the columns of that form's raw-responses tab
 * (WL_RawData and its committee twin) in the same order, filled the way Google
 * Forms fills them. So the sheet's formulas can read both stacked, e.g.
 *   ={WL_RawData!A2:L; 'App WL claims'!A2:L}
 * The app's own columns come after the form's and stay out of that range.
 */
var UCLH_APP_TABS = { wl: 'App WL claims', committee: 'App COM claims' };
var UCLH_APP_PAYMENT_HEADERS = [
  'Have you previously submitted your payment details?', 'Phone Number:', 'UCL Email (name.name.year@ucl.ac.uk):',
  'Full Name (as on bank account):', 'Account Number:', 'Sort Code:',
];
var UCLH_APP_EXTRA_HEADERS = ['App reference', 'App sign-in email'];
var UCLH_APP_HEADERS = {
  wl: ['Timestamp', 'Full Name (as on UCL ID)', 'Date of the walk/hike:',
    'Have you submitted the required Walk/Hike Route Feedback Form for this hike?', 'Receipt:']
    .concat(UCLH_APP_PAYMENT_HEADERS, ['Preferred Name'], UCLH_APP_EXTRA_HEADERS),
  committee: ['Timestamp', 'Full Name (as on UCL ID)', 'Date of purchase:', 'Amount (£) eligible for reimbursement:',
    'Description of purchase and extra info:', 'Receipt:']
    .concat(UCLH_APP_PAYMENT_HEADERS, UCLH_APP_EXTRA_HEADERS),
};
var UCLH_APP_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
var UCLH_APP_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
var UCLH_APP_RECEIPT_MAX_FILES = 5;

function doPost(e) {
  return uclhApp_handle(e);
}

function uclhApp_handle(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return uclhApp_reply({ ok: false, error: 'The claim arrived garbled. Try again.' });
  }

  var secret = PropertiesService.getScriptProperties().getProperty('UCLH_APP_SECRET');
  if (!secret) return uclhApp_reply({ ok: false, error: 'The spreadsheet is not set up for app claims yet.' });

  // The app's server asking which walks have claims, for its My walks page.
  if (body && body.action === 'wlClaims') {
    return uclhApp_reply(uclhApp_wlClaims(body, secret, Math.floor(Date.now() / 1000), SpreadsheetApp.getActiveSpreadsheet()));
  }

  var who = uclhApp_verifyToken(body && body.token, secret, Math.floor(Date.now() / 1000));
  if (!who.ok) return uclhApp_reply({ ok: false, error: who.error });

  var claim = uclhApp_parseClaim(body.claim, who.claims.kind);
  if (!claim.ok) return uclhApp_reply({ ok: false, error: claim.error });

  // Older app builds send one `receipt`; current ones send `receipts`.
  var sent = Array.isArray(body.receipts) ? body.receipts : body.receipt ? [body.receipt] : [];
  if (sent.length > UCLH_APP_RECEIPT_MAX_FILES) return uclhApp_reply({ ok: false, error: 'Attach up to ' + UCLH_APP_RECEIPT_MAX_FILES + ' receipts.' });
  var receipts = [];
  for (var i = 0; i < sent.length; i++) {
    var receipt = uclhApp_parseReceipt(sent[i] || {});
    if (!receipt.ok) return uclhApp_reply({ ok: false, error: receipt.error });
    receipts.push(receipt);
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return uclhApp_reply({ ok: false, error: 'The spreadsheet is busy. Try again in a minute.' });
  try {
    // One use per token, so a resent request can't add the claim twice.
    var cache = CacheService.getScriptCache();
    var seenKey = 'uclh-jti-' + who.claims.jti;
    if (cache.get(seenKey)) return uclhApp_reply({ ok: false, error: 'That claim was already sent.' });
    cache.put(seenKey, '1', 21600);

    var ref = uclhApp_reference();
    var receiptLinks = receipts.map(function (r) { return uclhApp_saveReceipt(r, ref, who.claims.name); }).join(', ');

    var kind = who.claims.kind === 'committee' ? 'committee' : 'wl';
    var v = claim.value;
    var day = v.date.split('-');
    var cells = {
      'Timestamp': new Date(),
      'Full Name (as on UCL ID)': who.claims.name,
      'Date of the walk/hike:': new Date(Number(day[0]), Number(day[1]) - 1, Number(day[2])),
      'Date of purchase:': new Date(Number(day[0]), Number(day[1]) - 1, Number(day[2])),
      'Have you submitted the required Walk/Hike Route Feedback Form for this hike?': v.routeFeedback,
      'Amount (£) eligible for reimbursement:': v.amount,
      'Description of purchase and extra info:': v.description,
      // Forms lists uploads as comma-separated Drive links.
      'Receipt:': receiptLinks,
      'Have you previously submitted your payment details?': v.bankOnFile ? 'Yes' : 'No',
      'Phone Number:': v.phone,
      // Walk leaders always give a UCL email; committee payees only when they're new.
      'UCL Email (name.name.year@ucl.ac.uk):': v.uclEmail,
      'Full Name (as on bank account):': v.accountName,
      'Account Number:': v.accountNumber,
      'Sort Code:': v.sortCode,
      'Preferred Name': v.nickname,
      'App reference': ref,
      'App sign-in email': who.claims.email,
    };
    var headers = UCLH_APP_HEADERS[kind];
    var row = headers.map(function (h) { return uclhApp_cell(cells[h]); });
    var sheet = uclhApp_sheet(kind);
    var at = sheet.getLastRow() + 1;
    // Phone, account number and sort code as text, so leading zeros survive.
    ['Phone Number:', 'Account Number:', 'Sort Code:'].forEach(function (h) {
      sheet.getRange(at, headers.indexOf(h) + 1).setNumberFormat('@');
    });
    sheet.getRange(at, 1, 1, row.length).setValues([row]);
    return uclhApp_reply({ ok: true, ref: ref });
  } finally {
    lock.releaseLock();
  }
}

function uclhApp_reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** base64url without padding, as the app writes it. */
function uclhApp_b64url(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
}

function uclhApp_b64urlDecode(text) {
  var padded = text + '===='.slice((text.length % 4) || 4);
  return Utilities.base64DecodeWebSafe(padded);
}

/**
 * token = base64url(JSON claims) + '.' + base64url(HMAC-SHA256(first part, secret)).
 * Returns { ok: true, claims } or { ok: false, error }.
 */
function uclhApp_verifyToken(token, secret, nowSeconds) {
  var bad = { ok: false, error: 'Your sign-in to the claim form has expired. Reload the page in the app and send it again.' };
  var claims = uclhApp_signedClaims(token, secret, nowSeconds);
  if (!claims) return bad;
  if (claims.kind !== 'wl' && claims.kind !== 'committee') return bad;
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || typeof claims.jti !== 'string') return bad;
  if (typeof claims.name !== 'string') claims.name = '';
  return { ok: true, claims: claims };
}

/** The claims of a correctly signed, unexpired token; null otherwise. */
function uclhApp_signedClaims(token, secret, nowSeconds) {
  if (typeof token !== 'string' || token.length > 4000) return null;
  var parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;

  var expected = uclhApp_b64url(Utilities.computeHmacSha256Signature(parts[0], secret, Utilities.Charset.UTF_8));
  if (!uclhApp_sameText(expected, parts[1])) return null;

  var claims;
  try {
    claims = JSON.parse(Utilities.newBlob(uclhApp_b64urlDecode(parts[0])).getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
  if (!claims || typeof claims !== 'object' || typeof claims.exp !== 'number' || claims.exp < nowSeconds) return null;
  return claims;
}

/** Compare without stopping at the first difference. */
function uclhApp_sameText(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function uclhApp_text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Walk-leader claims mirror the WL Google Form: the walk's date, the name they
 * lead under on the WL calendar, their UCL email and that they've sent the
 * route feedback form. The spreadsheet works out
 * the amount and description from the walk. Committee claims give the date
 * of purchase, what was bought and how much. Either may say the treasurer already has
 * their bank details, and then sends none; new payees add a phone number
 * (and, on committee claims, their UCL email) as the sheet's payee columns ask.
 */
function uclhApp_parseClaim(c, kind) {
  if (!c || typeof c !== 'object') return { ok: false, error: 'The claim is empty.' };
  var wl = kind !== 'committee';
  var date = uclhApp_text(c.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: wl ? 'Give the date of the walk.' : 'Give the date of purchase.' };

  var nickname = '', uclEmail = '', routeFeedback = '', description = '', amount = '';
  if (wl) {
    nickname = uclhApp_text(c.nickname, 60);
    if (!nickname) return { ok: false, error: 'Give the name you use on the WL calendar.' };
    uclEmail = uclhApp_text(c.uclEmail, 120).toLowerCase();
    if (!/^[^\s@]+@ucl\.ac\.uk$/.test(uclEmail)) return { ok: false, error: 'Give your UCL email, ending @ucl.ac.uk.' };
    if (c.routeFeedback !== true) return { ok: false, error: 'Fill in the Walk/Hike Route Feedback Form for this walk first.' };
    routeFeedback = 'Yes';
  } else {
    var n = Number(c.amount);
    if (!isFinite(n) || n <= 0 || n > 2000 || Math.round(n * 100) !== Math.round(n * 100 * 1000) / 1000) {
      return { ok: false, error: 'The amount should be in pounds, between £0.01 and £2,000.' };
    }
    amount = Math.round(n * 100) / 100;
    description = uclhApp_text(c.description, 500);
    if (!description) return { ok: false, error: 'Describe the purchase.' };
  }

  if (c.bankOnFile !== 'yes' && c.bankOnFile !== 'no') return { ok: false, error: "Say whether you've sent your bank details before." };
  var bankOnFile = c.bankOnFile === 'yes';
  var accountName = '', sortCode = '', accountNumber = '', phone = '';
  if (!bankOnFile) {
    accountName = uclhApp_text(c.accountName, 70);
    if (!accountName) return { ok: false, error: 'Give the name on the bank account.' };
    sortCode = String(c.sortCode || '').replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(sortCode)) return { ok: false, error: 'The sort code should be 6 digits.' };
    accountNumber = String(c.accountNumber || '').replace(/\s/g, '');
    if (!/^\d{8}$/.test(accountNumber)) return { ok: false, error: 'The account number should be 8 digits.' };
    sortCode = sortCode.slice(0, 2) + '-' + sortCode.slice(2, 4) + '-' + sortCode.slice(4);
    phone = uclhApp_text(c.phone, 20);
    if (!/^\+?[\d\s()-]{10,20}$/.test(phone) || phone.replace(/\D/g, '').length < 10) {
      return { ok: false, error: 'Give a phone number the treasurer can reach you on.' };
    }
    if (!wl) {
      uclEmail = uclhApp_text(c.uclEmail, 120).toLowerCase();
      if (!/^[^\s@]+@ucl\.ac\.uk$/.test(uclEmail)) return { ok: false, error: 'Give your UCL email, ending @ucl.ac.uk.' };
    }
  }

  return {
    ok: true,
    value: {
      date: date,
      nickname: nickname,
      uclEmail: uclEmail,
      routeFeedback: routeFeedback,
      description: description,
      amount: amount,
      bankOnFile: bankOnFile,
      accountName: accountName,
      sortCode: sortCode,
      accountNumber: accountNumber,
      phone: phone,
    },
  };
}

function uclhApp_parseReceipt(r) {
  var type = uclhApp_text(r.type, 60).toLowerCase();
  if (UCLH_APP_RECEIPT_TYPES.indexOf(type) === -1) return { ok: false, error: 'The receipt should be a photo or a PDF.' };
  if (typeof r.data !== 'string' || !r.data) return { ok: false, error: 'The receipt arrived empty.' };
  var bytes;
  try {
    bytes = Utilities.base64Decode(r.data);
  } catch (err) {
    return { ok: false, error: 'The receipt arrived garbled.' };
  }
  if (bytes.length > UCLH_APP_RECEIPT_MAX_BYTES) return { ok: false, error: 'The receipt is over 5 MB. Take a smaller photo.' };
  var name = uclhApp_text(r.name, 120).replace(/[\\/:*?"<>|]/g, '_') || 'receipt';
  return { ok: true, type: type, bytes: bytes, name: name };
}

function uclhApp_saveReceipt(receipt, ref, who) {
  var folder = uclhApp_folder();
  var file = folder.createFile(Utilities.newBlob(receipt.bytes, receipt.type, ref + ' ' + who + ' - ' + receipt.name));
  return file.getUrl();
}

function uclhApp_folder() {
  var id = PropertiesService.getScriptProperties().getProperty('UCLH_RECEIPTS_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  var found = DriveApp.getFoldersByName('UCL Hiking app receipts');
  var folder = found.hasNext() ? found.next() : DriveApp.createFolder('UCL Hiking app receipts');
  PropertiesService.getScriptProperties().setProperty('UCLH_RECEIPTS_FOLDER_ID', folder.getId());
  return folder;
}

function uclhApp_sheet(kind) {
  var name = UCLH_APP_TABS[kind];
  var headers = UCLH_APP_HEADERS[kind];
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('|') !== headers.join('|')) {
    // The form's questions changed: keep earlier rows under their old headings
    // and start a fresh tab for the new layout.
    sheet.setName(name + ' (old ' + Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd') + ')');
    return uclhApp_sheet(kind);
  }
  return sheet;
}

/** "UH-20261002-K7QD": short enough to read out to the treasurer. */
function uclhApp_reference() {
  var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var tail = '';
  for (var i = 0; i < 4; i++) tail += letters.charAt(Math.floor(Math.random() * letters.length));
  return 'UH-' + Utilities.formatDate(new Date(), 'Europe/London', 'yyyyMMdd') + '-' + tail;
}

/** Text that a spreadsheet would read as a formula is kept as text. */
function uclhApp_cell(value) {
  if (typeof value === 'string' && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

/** Run once from the editor to check the setup: it says what's missing. */
function uclhApp_checkSetup() {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('UCLH_APP_SECRET');
  Logger.log(secret ? 'UCLH_APP_SECRET is set (' + secret.length + ' characters).' : 'UCLH_APP_SECRET is missing.');
  Logger.log('Receipts go to: ' + uclhApp_folder().getName());
  Logger.log('Claims go to the tabs: ' + uclhApp_sheet('wl').getName() + ', ' + uclhApp_sheet('committee').getName());
  Logger.log('My walks reads walk-leader claims from: ' +
    uclhApp_wlClaimTabs(SpreadsheetApp.getActiveSpreadsheet()).map(function (s) { return s.getName(); }).join(', '));
}

// ---------------------------------------------------------------------------
// Which walks have walk-leader claims, for the app's My walks page.
//
// Only the app's server can ask: its token says scope "wl-claims", which the
// tokens handed to members' browsers never carry. The answer is each claim's
// walk date, names and emails: no bank details, amounts or receipts.

var UCLH_APP_READ_SCOPE = 'wl-claims';

function uclhApp_wlClaims(body, secret, nowSeconds, book) {
  var claims = uclhApp_signedClaims(body && body.token, secret, nowSeconds);
  if (!claims || claims.scope !== UCLH_APP_READ_SCOPE) return { ok: false, error: 'Not allowed.' };
  var since = typeof body.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : '';
  var zone = book.getSpreadsheetTimeZone();
  var out = [];
  uclhApp_wlClaimTabs(book).forEach(function (sheet) {
    var values = sheet.getDataRange().getValues();
    out = out.concat(uclhApp_wlClaimRows(values, zone, since));
  });
  return { ok: true, claims: out };
}

/**
 * The tabs holding walk-leader claims: those named in the script property
 * UCLH_WL_CLAIM_TABS (comma-separated), else every tab laid out like the WL
 * form's responses (Timestamp in A1 and a "Date of the walk/hike" column).
 * That finds the form's own tab and the app's, old ones included.
 */
function uclhApp_wlClaimTabs(book) {
  var named = PropertiesService.getScriptProperties().getProperty('UCLH_WL_CLAIM_TABS');
  if (named) {
    return named.split(',').map(function (n) { return book.getSheetByName(n.trim()); }).filter(function (s) { return s; });
  }
  return book.getSheets().filter(function (sheet) {
    var width = sheet.getLastColumn();
    if (!width || sheet.getLastRow() < 1) return false;
    return uclhApp_isWlClaimHeader(sheet.getRange(1, 1, 1, width).getValues()[0]);
  });
}

function uclhApp_headerText(h) {
  return String(h == null ? '' : h).trim().toLowerCase();
}

function uclhApp_isWlClaimHeader(header) {
  return uclhApp_headerText(header[0]) === 'timestamp' &&
    header.some(function (h) { return uclhApp_headerText(h).indexOf('date of the walk') === 0; });
}

/** Rows of a WL claims tab (header first) as { date, name, preferred, emails }, walks on or after `since`. */
function uclhApp_wlClaimRows(values, zone, since) {
  var header = (values[0] || []).map(uclhApp_headerText);
  var col = function (prefix) {
    for (var i = 0; i < header.length; i++) if (header[i].indexOf(prefix) === 0) return i;
    return -1;
  };
  var dateCol = col('date of the walk');
  if (dateCol === -1) return [];
  var nameCol = col('full name (as on ucl id)');
  var preferredCol = col('preferred name');
  var emailCols = [];
  header.forEach(function (h, i) { if (h.indexOf('email') !== -1) emailCols.push(i); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r] || [];
    var date = uclhApp_isoDay(row[dateCol], zone);
    if (!date || (since && date < since)) continue;
    var emails = [];
    emailCols.forEach(function (i) {
      var e = String(row[i] == null ? '' : row[i]).trim().toLowerCase();
      if (/^[^\s@]+@[^\s@]+$/.test(e) && emails.indexOf(e) === -1) emails.push(e);
    });
    out.push({
      date: date,
      name: nameCol === -1 ? '' : String(row[nameCol] == null ? '' : row[nameCol]).trim().slice(0, 100),
      preferred: preferredCol === -1 ? '' : String(row[preferredCol] == null ? '' : row[preferredCol]).trim().slice(0, 100),
      emails: emails,
    });
  }
  return out;
}

/** A date cell as "2026-10-18": a Sheets date, or text typed as 18/10/2026 or 2026-10-18. */
function uclhApp_isoDay(cell, zone) {
  if (Object.prototype.toString.call(cell) === '[object Date]') {
    return isNaN(cell.getTime()) ? '' : Utilities.formatDate(cell, zone, 'yyyy-MM-dd');
  }
  var text = String(cell == null ? '' : cell).trim();
  var m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = text.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (!m) return '';
  var year = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  if (Number(m[2]) < 1 || Number(m[2]) > 12 || Number(m[1]) < 1 || Number(m[1]) > 31) return '';
  return year + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
}
