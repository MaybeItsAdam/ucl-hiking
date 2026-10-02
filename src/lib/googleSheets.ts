import { parseServiceAccountKey, signAssertion, type ServiceAccountKey } from "@/lib/cloudRun";

/**
 * The club's Google Sheets, read and written as the site's service account
 * (`GCP_SA_KEY`). A sheet is reachable only once uclhiking@gmail.com has
 * shared it with that account's email. No SDK: a signed JWT for a token, then
 * the Sheets REST API.
 */

const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const API = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {}

let cached: { token: string; expires: number; email: string } | null = null;

export function sheetsKey(): ServiceAccountKey | null {
  return parseServiceAccountKey(process.env.GCP_SA_KEY);
}

async function accessToken(): Promise<string> {
  const key = sheetsKey();
  if (!key) throw new SheetsError("GCP_SA_KEY isn't set, so the app can't reach Google Sheets.");
  if (cached && cached.email === key.client_email && cached.expires > Date.now() + 60_000) return cached.token;
  const res = await fetch(key.token_uri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: signAssertion(key, undefined, SCOPE),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !body.access_token) throw new SheetsError(`Google rejected the service account key (HTTP ${res.status}).`);
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000, email: key.client_email };
  return body.access_token;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (res.status === 403 || res.status === 404) {
    throw new SheetsError(
      `Google Sheets won't open that sheet. Share it with ${sheetsKey()?.client_email ?? "the site's service account"} as an Editor.`,
    );
  }
  if (!res.ok) throw new SheetsError(`Google Sheets answered ${res.status}: ${body.error?.message ?? ""}`.trim());
  return body;
}

export interface TabInfo {
  sheetId: number;
  title: string;
  rows: number;
  columns: number;
}

export async function spreadsheetTabs(spreadsheetId: string): Promise<{ title: string; tabs: TabInfo[] }> {
  const data = await call<{
    properties?: { title?: string };
    sheets?: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
  }>(`${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties`);
  return {
    title: data.properties?.title ?? "",
    tabs: (data.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rows: s.properties.gridProperties?.rowCount ?? 0,
      columns: s.properties.gridProperties?.columnCount ?? 0,
    })),
  };
}

/** A1 range quoting: 'Tab name'!A1:Z. */
export function a1(tab: string, range?: string): string {
  const quoted = `'${tab.replace(/'/g, "''")}'`;
  return range ? `${quoted}!${range}` : quoted;
}

/**
 * Cell values as shown in the sheet (formatted), or the formulas behind them.
 */
export async function readValues(
  spreadsheetId: string,
  range: string,
  render: "FORMATTED_VALUE" | "FORMULA" = "FORMATTED_VALUE",
): Promise<string[][]> {
  const data = await call<{ values?: unknown[][] }>(
    `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${render}&dateTimeRenderOption=FORMATTED_STRING`,
  );
  return (data.values ?? []).map((row) => row.map((v) => (v == null ? "" : String(v))));
}

export interface CellWrite {
  range: string;
  value: string;
}

/** Write single cells as if typed in (so dates and numbers parse the way the sheet expects). */
export async function writeCells(spreadsheetId: string, writes: CellWrite[]): Promise<void> {
  if (!writes.length) return;
  await call(`${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      valueInputOption: "USER_ENTERED",
      data: writes.map((w) => ({ range: w.range, values: [[w.value]] })),
    }),
  });
}

/**
 * Which of these single cells a formula fills: one typed as `=…`, or one an
 * ARRAYFORMULA elsewhere spills into (no formula of its own, yet a value).
 * Writing to either would break the sheet, so the app never does.
 */
export async function formulaCells(spreadsheetId: string, ranges: string[]): Promise<Set<string>> {
  if (!ranges.length) return new Set();
  const get = (render: string) =>
    call<{ valueRanges?: { values?: unknown[][] }[] }>(
      `${encodeURIComponent(spreadsheetId)}/values:batchGet?valueRenderOption=${render}&${ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join("&")}`,
    );
  const [formulas, shown] = await Promise.all([get("FORMULA"), get("FORMATTED_VALUE")]);
  const out = new Set<string>();
  ranges.forEach((range, i) => {
    const f = String(formulas.valueRanges?.[i]?.values?.[0]?.[0] ?? "");
    const v = String(shown.valueRanges?.[i]?.values?.[0]?.[0] ?? "");
    if (f.startsWith("=") || (!f && v)) out.add(range);
  });
  return out;
}

/** Column letter for a 0-based index: 0 → A, 26 → AA. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}


/** Each row's value for a developer-metadata key, for one tab (index 0 = row 1). */
export async function rowKeys(spreadsheetId: string, tab: string, key: string): Promise<(string | null)[]> {
  const data = await call<{
    sheets?: { data?: { rowMetadata?: { developerMetadata?: { metadataKey?: string; metadataValue?: string }[] }[] }[] }[];
  }>(
    `${encodeURIComponent(spreadsheetId)}?ranges=${encodeURIComponent(a1(tab, "A:A"))}&fields=sheets.data.rowMetadata.developerMetadata(metadataKey,metadataValue)`,
  );
  const rows = data.sheets?.[0]?.data?.[0]?.rowMetadata ?? [];
  return rows.map((r) => r.developerMetadata?.find((m) => m.metadataKey === key)?.metadataValue ?? null);
}

async function batchUpdate(spreadsheetId: string, requests: unknown[]) {
  if (!requests.length) return {};
  return call<{ replies?: unknown[] }>(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({ requests }),
  });
}

/** Tag rows (1-based) with an invisible key that moves with the row when others are inserted or deleted. */
export async function tagRows(spreadsheetId: string, sheetId: number, key: string, tags: { row: number; value: string }[]) {
  await batchUpdate(
    spreadsheetId,
    tags.map((t) => ({
      createDeveloperMetadata: {
        developerMetadata: {
          metadataKey: key,
          metadataValue: t.value,
          visibility: "DOCUMENT",
          location: { dimensionRange: { sheetId, dimension: "ROWS", startIndex: t.row - 1, endIndex: t.row } },
        },
      },
    })),
  );
}

/** Add a tab with a frozen, bold header row. */
export async function addTab(spreadsheetId: string, title: string, header: string[]) {
  await batchUpdate(spreadsheetId, [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }]);
  await call(`${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1(title, "A1"))}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [header] }),
  });
}

/** Append rows under a tab's last row, typed in as a person would. */
export async function appendRows(spreadsheetId: string, tab: string, rows: string[][]) {
  if (!rows.length) return;
  await call(
    `${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(a1(tab, "A1"))}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}
