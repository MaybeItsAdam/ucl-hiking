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
 * One tab per form. Where a column holds what the claimant typed, it takes the
 * heading Slava's WL Reimbursement / COM Reimbursement tabs use, so their
 * formulas can read either. Columns those tabs work out (Form Status, Fancy
 * Date, Did they WL this hike?, the payment descriptions) are left to them.
 */
var UCLH_APP_TABS = { wl: 'App WL claims', committee: 'App COM claims' };
var UCLH_APP_HEADERS = {
  wl: [
    'Date Requested', 'Reference', 'Full Name (as on UCL ID)', 'App sign-in email', 'Preferred Name', 'Date of Hike:',
    'Route feedback submitted', 'Receipt:', 'Previously submitted payment details?',
    'Payee Name:', 'Payee Phone Number:', 'Payee UCL Email Address', 'Account Number', 'Sort Code',
  ],
  committee: [
    'Date Requested', 'Reference', 'Full Name (as on UCL ID)', 'App sign-in email', 'Date of Purchase', 'Amount (£):',
    'Purchase Description Submitted', 'Receipt:', 'Previously submitted payment details?',
    'Payee Name:', 'Payee Phone Number:', 'Payee UCL Email Address', 'Account Number', 'Sort Code',
  ],
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
    var receiptLinks = receipts.map(function (r) { return uclhApp_saveReceipt(r, ref, who.claims.name); }).join('\n');

    var kind = who.claims.kind === 'committee' ? 'committee' : 'wl';
    var v = claim.value;
    var cells = {
      'Date Requested': new Date(),
      'Reference': ref,
      'Full Name (as on UCL ID)': who.claims.name,
      'App sign-in email': who.claims.email,
      'Preferred Name': v.nickname,
      'Date of Hike:': v.date,
      'Date of Purchase': v.date,
      'Route feedback submitted': v.routeFeedback,
      'Amount (£):': v.amount,
      'Purchase Description Submitted': v.description,
      'Receipt:': receiptLinks,
      'Previously submitted payment details?': v.bankOnFile ? 'Yes' : 'No',
      'Payee Name:': v.accountName,
      'Payee Phone Number:': v.phone,
      // Walk leaders always give a UCL email; payees only when they're new.
      'Payee UCL Email Address': v.uclEmail,
      'Account Number': v.accountNumber,
      'Sort Code': v.sortCode,
    };
    var headers = UCLH_APP_HEADERS[kind];
    var row = headers.map(function (h) { return uclhApp_cell(cells[h]); });
    var sheet = uclhApp_sheet(kind);
    var at = sheet.getLastRow() + 1;
    // Phone, account number and sort code as text, so leading zeros survive.
    ['Payee Phone Number:', 'Account Number', 'Sort Code'].forEach(function (h) {
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
  if (typeof token !== 'string' || token.length > 4000) return bad;
  var parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return bad;

  var expected = uclhApp_b64url(Utilities.computeHmacSha256Signature(parts[0], secret, Utilities.Charset.UTF_8));
  if (!uclhApp_sameText(expected, parts[1])) return bad;

  var claims;
  try {
    claims = JSON.parse(Utilities.newBlob(uclhApp_b64urlDecode(parts[0])).getDataAsString('UTF-8'));
  } catch (err) {
    return bad;
  }
  if (!claims || typeof claims.exp !== 'number' || claims.exp < nowSeconds) return bad;
  if (claims.kind !== 'wl' && claims.kind !== 'committee') return bad;
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || typeof claims.jti !== 'string') return bad;
  if (typeof claims.name !== 'string') claims.name = '';
  return { ok: true, claims: claims };
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
}
