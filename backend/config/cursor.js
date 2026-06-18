/**
 * Cursor encoding for keyset (a.k.a. "seek") pagination.
 *
 * The cursor encodes the LAST item's sort key from the previous page:
 * { createdAt, _id }. We need both fields, not just createdAt, because
 * createdAt can collide (two activities written in the same millisecond
 * under high write throughput). _id is the tiebreaker that guarantees
 * a strict total order, so no item is ever skipped or duplicated across
 * page boundaries even when timestamps tie.
 *
 * The cursor is opaque to the client (base64 JSON) on purpose:
 * - Prevents clients from constructing arbitrary skip/offset-like
 *   queries by hand-editing it.
 * - Gives us room to change the internal shape later without
 *   breaking the public API contract.
 */

function encodeCursor({ createdAt, _id }) {
  const payload = JSON.stringify({
    createdAt: new Date(createdAt).toISOString(),
    _id: String(_id),
  });
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);
    if (!parsed.createdAt || !parsed._id) return null;
    return {
      createdAt: new Date(parsed.createdAt),
      _id: parsed._id,
    };
  } catch (err) {
    // Malformed cursor — treat as "no cursor" rather than 500ing,
    // since this is recoverable (client can just restart from page 1).
    return null;
  }
}

module.exports = { encodeCursor, decodeCursor };
