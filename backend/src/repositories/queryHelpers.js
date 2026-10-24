// Shared helpers for Supabase (PostgREST) queries.

// Removes characters that have meaning inside PostgREST filter strings, so
// user input can't change the shape of an .or() filter.
const sanitizeFilterValue = (value) =>
  String(value == null ? "" : value).replace(/[,()*:"\\{}]/g, " ").trim();

const PAGE_SIZE = 1000;

/**
 * Supabase returns at most 1,000 rows per request, silently. Reads every page.
 * `buildQuery` must return a fresh, ordered query each time it's called.
 */
const fetchAllRows = async (buildQuery, pageSize = PAGE_SIZE) => {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
};

module.exports = { sanitizeFilterValue, fetchAllRows };
