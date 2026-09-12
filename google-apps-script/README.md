# Two-Way Google Sheets Sync & Styling for UCL Hiking Inventory

This setup enables seamless **two-way synchronization** between your Google Sheet and the UCL Hiking Club equipment portal, while **automatically imposing official club styling, dropdown validation, and live KPI formulas**.

---

## 1. Worksheets Managed & Styled

1. **`Dashboard`**
   - Official UCL Forest Green (`#1e3a2b`) header banner.
   - Live KPI metric summary cards (Total Models, Fleet Units, Units Available in Locker, Out on Loan, Needs Repair, Pending Requests).
   - Category breakdown table powered by dynamic spreadsheet formulas (`COUNTIF`, `SUMIF`).
2. **`Master List`**
   - Full physical equipment catalog with frozen headers, zebra row banding, and clean cell borders.
   - **Category Dropdowns**: `Tents & Shelter`, `Footwear & Boots`, `Rucksacks & Bags`, `Navigation & Safety`, `Cooking & Stoves`, `Sleeping Gear`, `General & Other`.
   - **Condition Dropdowns & Colors**: `excellent` (green), `good` (soft green), `fair` (amber), `needs_repair` (soft red alert).
   - **Stock Alerts**: Automatically highlights in red if Available Quantity drops to 0.
3. **`Ledger Log`**
   - Chronological borrowing audit history and return tracking.
   - **Status Dropdowns**: `pending`, `approved`, `returned`, `rejected`, `cancelled`.
   - Dynamic conditional formatting by status.

---

## 2. Setup & Deployment (Takes 2 Minutes)

1. Open your target **Google Sheet** (or create a new blank Google Spreadsheet).
2. Go to **Extensions** > **Apps Script**.
3. Replace all contents of `Code.gs` with the code in [`google-apps-script/Code.gs`](./Code.gs).
4. Click **Deploy** (top right) > **New deployment** (or **Manage deployments** if updating).
5. Configure the deployment:
   - **Type**: `Web app`
   - **Description**: `UCL Hiking Inventory Two-Way Sync`
   - **Execute as**: `Me (your-account@ucl.ac.uk / gmail.com)`
   - **Who has access**: `Anyone` (required so the web app can deliver and read payloads)
6. Click **Deploy** and authorize permissions if prompted.
7. Copy the generated **Web app URL** (`https://script.google.com/macros/s/.../exec`).

> [!IMPORTANT]
> **Updating an existing deployment**:
> Google Apps Script pins web app URLs to fixed deployment versions. Whenever you update `Code.gs`, you must go to **Deploy > Manage deployments > Edit (pencil icon) > Version: New version > Deploy**, otherwise Google Apps Script will continue executing the older code!

---

## 3. Configure in the Web App

You can configure the webhook directly in the web app UI:
1. Go to the committee inventory portal (`/portal`).
2. Click the **⚙️ Settings** button next to the sync controls.
3. Paste your **Google Apps Script Webhook URL** and your **Google Spreadsheet ID** (or full Google Sheets URL).
4. Click **🎨 Push & Impose Styling** or **Save Webhook Settings**.

Alternatively, add it to your `.env.local` file:
```env
GOOGLE_SHEET_WEBHOOK_URL="https://script.google.com/macros/s/AKfycb.../exec"
GOOGLE_SHEET_ID="1BxiMVs0XR..."
```

---

## 4. How to Trigger & Impose Styling

### Option A: Directly from Google Sheets (Instant)
1. Refresh your Google Sheet.
2. Click the custom top menu: **`🌲 UCL Hiking`** > **`🎨 Apply All Club Styling & Formulas`**.
3. All three worksheets (`Dashboard`, `Master List`, `Ledger Log`) will be instantly styled with official UCL Forest Green banners, borders, dropdown validations, and live formulas!

### Option B: From the Web App
1. In the committee portal (`/portal`), click **`Push to Sheets`** (or click **`🎨 Push & Impose Styling`** inside the Settings modal).
2. The web app sends the latest inventory data and instructs Google Apps Script to write and style all tabs.

### Option C: Pulling Changes Back to the Web App
- **From Web App**: Click **`Pull from Sheets`** to import rows edited in Google Sheets into the website database.
- **From Google Sheet**: Click **`🌲 UCL Hiking`** > **`⬆️ Push Changes to Web App`** to send changes directly from the spreadsheet to the web app.
