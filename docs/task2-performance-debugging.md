# Task 2 — Performance Debugging: skip() Pagination

## The slow query

```js
// BEFORE — offset pagination
const page = 250; // user is on page 250 of results
const pageSize = 20;

const activities = await Activity.find({ tenantId })
  .sort({ createdAt: -1 })
  .skip(page * pageSize)   // 5000
  .limit(pageSize);
```

## Why this is slow

`skip(n)` does not let MongoDB jump directly to the nth matching
document. The query engine still has to walk the index (or collection)
from the start of the result set, visiting and discarding every one of
the first `n` documents, before it can start returning the page you
actually asked for.

Concretely, for `skip(5000).limit(20)`:

- Mongo locates the first matching document via the index.
- It then advances through 5000 index entries one by one, fetching and
  discarding each.
- Only then does it start collecting the 20 documents to return.

Cost is **O(skip + limit)**, not O(limit). As users page deeper (or as
a feed grows over months), every request gets linearly slower, because
the "discard" work grows with page depth even though the page size
never changes. At 50M activities, page 100,000 could mean walking
millions of index entries to throw them away, on every single request,
from every tenant doing that page depth simultaneously. This is the
single most common cause of "pagination feels fine at 1K rows, falls
over at 1M+ rows."

There's a second, sneakier problem: if new activities are inserted
between two page requests (very likely on a high-write feed), the
offset shifts. Page 2 can show duplicates from page 1, or silently
skip items, because "the 21st document" is a moving target.

## The fix: cursor (keyset) pagination

Instead of asking "skip N, give me the next 20," cursor pagination
asks "give me the next 20 documents strictly older than the last one
I already saw." That's a direct index seek, not a walk-and-discard.

```js
// AFTER — cursor (keyset) pagination
async function getActivityPage(tenantId, cursor, limit = 20) {
  const query = { tenantId };

  if (cursor) {
    // cursor = { createdAt, _id } of the last item on the previous page
    query.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
    ];
  }

  const docs = await Activity.find(query)
    .select('tenantId actorId actorName type entityId metadata createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1) // fetch one extra to detect hasMore without count()
    .lean();

  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const nextCursor = hasMore
    ? { createdAt: page[page.length - 1].createdAt, _id: page[page.length - 1]._id }
    : null;

  return { page, nextCursor, hasMore };
}
```

Why `_id` is included as a tiebreaker, not just `createdAt`: under high
write throughput it's entirely possible for two activities to share the
same millisecond timestamp. `_id` is monotonically increasing (it
embeds a timestamp + counter) and unique, so `(createdAt, _id)` together
give a strict total order with zero possibility of ties — which is what
guarantees no duplicate or skipped rows across page boundaries,
regardless of concurrent inserts.

This is exactly what's implemented in `controllers/activityController.js`
in this submission — same query shape, with an opaque base64 cursor at
the API boundary so clients can't hand-construct offsets.

## The correct index

```js
activitySchema.index({ tenantId: 1, createdAt: -1 });
```

Field order matters and is not arbitrary:

- `tenantId` first because every query has an **equality** predicate on
  it. Equality fields belong before range/sort fields in a compound
  index (the standard "Equality, Sort, Range" — ESR — rule), so Mongo
  can narrow to that tenant's slice of the index immediately.
- `createdAt` second, descending, because that's both our sort key and
  our range condition (`$lt`). Since the index is already sorted
  descending per tenant, the query plan can satisfy `sort({ createdAt:
  -1 })` directly from the index — no in-memory `SORT` stage, which is
  the other classic cause of pagination slowing down as data grows.

If type-filtering is a common access pattern (Task 3's filter UI), add:

```js
activitySchema.index({ tenantId: 1, type: 1, createdAt: -1 });
```

so filtered feeds also get a full index seek instead of a tenant-wide
scan with an in-memory filter on `type`.

## Metrics to monitor in production

- **`executionStats.totalDocsExamined` vs `nReturned`** (via
  `explain("executionStats")`) — for a healthy cursor query this ratio
  should stay close to 1:1 regardless of page depth. If it starts
  growing, something has regressed back toward a scan.
- **p95/p99 query latency on the activities collection**, sliced by
  tenant — a single hot tenant degrading shouldn't be invisible inside
  an averaged, all-tenant metric.
- **Index hit rate / "IXSCAN vs COLLSCAN" in slow query logs** — any
  COLLSCAN on this collection in production is a regression alert by
  itself.
- **Write latency and oplog lag** on the activities collection,
  separately from read latency — write throughput and read pagination
  cost are coupled (more writes = deeper pages = more reason offset
  pagination would have failed), so both need tracking even though this
  fix decouples read cost from page depth.
- **Index size vs working set / RAM** — `tenantId+createdAt` is small
  per-document, but at 50M+ documents you want to confirm the index
  still fits comfortably in the WiredTiger cache; if it doesn't, even
  index seeks start hitting disk.
- **MongoDB `slow query log` threshold** (e.g. >100ms) on this
  collection specifically, with alerting — catches regressions (a
  missing index after a schema change, an accidental `$or` that breaks
  the index path) before users notice.
