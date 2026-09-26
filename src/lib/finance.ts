export interface FinanceLine {
  id: string;
  event_suu_id: string;
  kind: "income" | "expense";
  label: string;
  amount_pence: number;
}

export interface TripMoney {
  eventSuuId: string;
  ticketIncome: number;
  otherIncome: number;
  expenses: number;
  net: number;
  lines: FinanceLine[];
}

/** Ticket income from the SU numbers, plus whatever the treasurer adds or spends. */
export function tripMoney(
  event: { suu_event_id: string; price_pence: number; tickets_sold: number },
  lines: FinanceLine[],
): TripMoney {
  const mine = lines.filter((l) => l.event_suu_id === event.suu_event_id);
  const ticketIncome = Math.max(0, event.price_pence) * Math.max(0, event.tickets_sold);
  const otherIncome = mine.filter((l) => l.kind === "income").reduce((sum, l) => sum + l.amount_pence, 0);
  const expenses = mine.filter((l) => l.kind === "expense").reduce((sum, l) => sum + l.amount_pence, 0);
  return { eventSuuId: event.suu_event_id, ticketIncome, otherIncome, expenses, net: ticketIncome + otherIncome - expenses, lines: mine };
}

export function pounds(pence: number): string {
  const sign = pence < 0 ? "−" : "";
  return `${sign}£${(Math.abs(pence) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "£12.50", "12.5", "12" → pence; null if it isn't money. */
export function parsePounds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function csvCell(value: string | number): string {
  const text = String(value);
  // A leading = + - @ would run as a formula in Excel or Sheets.
  const safe = /^[=+\-@]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function moneyCsv(trips: (TripMoney & { name: string; date: string })[]): string {
  const rows: (string | number)[][] = [["Date", "Trip", "Line", "Kind", "Amount (£)"]];
  for (const trip of trips) {
    if (trip.ticketIncome) rows.push([trip.date, trip.name, "SU tickets", "income", (trip.ticketIncome / 100).toFixed(2)]);
    for (const line of trip.lines) rows.push([trip.date, trip.name, line.label, line.kind, (line.amount_pence / 100).toFixed(2)]);
    rows.push([trip.date, trip.name, "Net", "", (trip.net / 100).toFixed(2)]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}
