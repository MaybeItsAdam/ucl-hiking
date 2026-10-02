# Expense claims from the app → the reimbursement spreadsheet

Walk leaders and committee claim expenses in the app (Settings › Expenses, or
Club › Expenses). The claim, bank details and receipt go **from their browser
straight to this Apps Script** on the reimbursement spreadsheet. The app's
server only signs a ten-minute token saying who is claiming. It never sees or
stores the claim.

## Setup (treasurer, signed in as the spreadsheet's owner)

1. Open the reimbursement spreadsheet › **Extensions › Apps Script**.
2. **+ › Script**, name it `AppClaims`, and paste in `Code.gs` from this folder.
   - All of its functions are prefixed `uclhApp_` except `doPost`.
   - If the project **already has a `doPost`**, rename this file's `doPost` to
     `uclhApp_doPost`. Then, in the existing `doPost`, hand app claims to it:
     `if (String(e.postData && e.postData.contents).indexOf('"token"') !== -1) return uclhApp_handle(e);`
3. **Project Settings › Script properties › Add**:
   - `UCLH_APP_SECRET`: the same value as `REIMBURSE_SIGNING_SECRET` in the app.
   - `UCLH_RECEIPTS_FOLDER_ID` (optional): a Drive folder ID for receipts.
     Without it, a folder called "UCL Hiking app receipts" is created.
4. Run `uclhApp_checkSetup` once from the editor. It asks for permission to
   use Sheets and Drive, and logs what is missing.
5. **Deploy › New deployment › Web app**: Execute as **Me**, Who has access
   **Anyone**. Copy the `/exec` URL into the app as `REIMBURSE_SCRIPT_URL`.
   - After editing the script, use **Manage deployments › Edit › New version**,
     so the URL stays the same.

Claims land in a tab called **App submissions**, one row each:
- the claim's reference, such as `UH-20261002-K7QD`;
- the claimant;
- the walk, date, category and amount;
- a Drive link to the receipt;
- the bank details.

The sort code and account number are stored as text. The form's own tab and
existing scripts are untouched.

"Anyone" means anyone can *reach* the URL. Only requests carrying a valid,
unexpired, unused token from the app are written. Each token works once.
