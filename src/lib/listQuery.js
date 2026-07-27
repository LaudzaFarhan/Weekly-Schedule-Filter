/**
 * Helpers for the New Operations list endpoints.
 *
 * Chat/agent callers need to ask narrow questions ("find Dave Kingsley")
 * instead of pulling a whole table and filtering client-side. These build the
 * WHERE/LIMIT fragments for that.
 *
 * Important: when no query parameters are supplied the result is unfiltered and
 * unlimited, so the existing UI (which expects the full list) is unaffected.
 */

/**
 * Build a parameterised WHERE clause.
 *
 * @param {URLSearchParams} searchParams
 * @param {object} options
 * @param {string[]} options.searchColumns - columns the `search` term matches against
 * @param {object} options.filters - map of query-param name -> column name for exact matches
 * @param {object} options.arrayFilters - map of query-param name -> array column;
 *        matches when the column contains the value or the literal 'All Branches'
 * @returns {{ clause: string, params: any[], limit: number|null }}
 */
export function buildListQuery(searchParams, { searchColumns = [], filters = {}, arrayFilters = {} } = {}) {
  const conditions = [];
  const params = [];

  const search = (searchParams.get('search') || '').trim();
  if (search && searchColumns.length) {
    params.push(`%${search}%`);
    const idx = params.length;
    // ILIKE keeps the match case-insensitive and partial.
    conditions.push(`(${searchColumns.map((c) => `${c} ILIKE $${idx}`).join(' OR ')})`);
  }

  for (const [param, column] of Object.entries(filters)) {
    const value = searchParams.get(param);
    if (value) {
      params.push(value);
      conditions.push(`${column} = $${params.length}`);
    }
  }

  for (const [param, column] of Object.entries(arrayFilters)) {
    const value = searchParams.get(param);
    if (value) {
      params.push(value);
      conditions.push(`($${params.length} = ANY(${column}) OR 'All Branches' = ANY(${column}))`);
    }
  }

  const limitRaw = parseInt(searchParams.get('limit'), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : null;

  return {
    clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    limit,
  };
}

/** Append `LIMIT $n` when a limit was requested, returning the final params. */
export function withLimit(sql, params, limit) {
  if (!limit) return { sql, params };
  return { sql: `${sql} LIMIT $${params.length + 1}`, params: [...params, limit] };
}
