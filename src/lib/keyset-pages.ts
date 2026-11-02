/** Read bounded pages without silently accepting a truncated catalogue. */
export async function readKeysetPages<T extends { id: string }>(
  fetchPage: (after: string | null, size: number, signal: AbortSignal) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 250, maximumRows = 50_000
): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let page: T[];
    try {
      const { data, error } = await fetchPage(after, pageSize, controller.signal);
      if (error) throw error;
      page = data ?? [];
    } finally { clearTimeout(timeout); }
    if (page.length === 0) return rows;
    for (const row of page) {
      if (!row.id || (after !== null && row.id <= after)) throw new Error("Catalogue pagination did not advance.");
      after = row.id; rows.push(row);
    }
    if (rows.length > maximumRows) throw new Error("Catalogue exceeds the supported page budget.");
    // A server row cap may be smaller than pageSize; only an empty page ends it.
  }
}
