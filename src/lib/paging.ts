/** PostgREST answers at most this many rows at a time. */
export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Reads a whole table page by page. `page` runs one query for rows `from`..`to`
 * (inclusive, as `.range()` takes them), ordered on something unique so pages
 * don't overlap. Stops at the first short page, or at an error with the rows so far.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => Page<T>,
  pageSize = PAGE_SIZE,
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return { rows, error: null };
  }
}
