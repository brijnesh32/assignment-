# Task 5 — Scaling to 50M Activities per Tenant

Assume a multi-tenant SaaS where some tenants are tiny (hundreds of
activities) and a handful are huge (50M+). The design has to handle
both without punishing small tenants with unnecessary infrastructure
overhead, and without letting one huge tenant degrade everyone else.

## 1. Indexing

The base index from Task 1, `{ tenantId: 1, createdAt: -1 }`, still
holds at this scale — it's not something that needs to change as data
grows, which is the point of getting it right early. What does change
at 50M docs/tenant:

- **Index size becomes a real resource cost.** At 50M documents,
  `tenantId (12 bytes) + createdAt (8 bytes) + _id (12 bytes)` per
  index entry, plus B-tree overhead, is on the order of low hundreds of
  MB per heavily-active tenant for this one index alone. Across many
  large tenants, total index size needs to be tracked against
  available RAM (WiredTiger cache) — once indexes stop fitting in
  cache, every "fast" index seek starts paying disk I/O.
- **TTL or partial indexes for retention** (see §4) reduce the
  effective index size by physically removing old documents rather
  than just hiding them from queries.
- **Avoid index bloat from speculative indexes.** Every additional
  index (e.g. `tenantId+type+createdAt` from Task 2) doubles write cost
  for that field combination across 50M-row tenants. Only add indexes
  for query patterns that are actually used in production, verified
  via `db.activities.aggregate([{$indexStats:{}}])` or equivalent,
  not "might be useful."

## 2. Sharding strategy

**Shard key: `{ tenantId: 1, _id: 1 }` (tenantId as the prefix).**

Why tenantId-prefixed rather than a pure hashed shard key on `_id`
alone:

- Every real query in this system already filters by `tenantId`. A
  shard key that doesn't include it means a query has to fan out to
  *every* shard and merge results (a "scatter-gather" query), even
  though we know in advance which tenant's data we want. Prefixing
  tenantId means queries become **targeted** — mongos can route
  directly to the shard(s) holding that tenant's chunk.
- Compound shard key `{tenantId, _id}` (rather than `{tenantId,
  createdAt}`) avoids a different problem: if many tenants are writing
  concurrently and we shard purely on `createdAt`, all "live" writes
  across all tenants cluster into the same chunk range (whichever
  range covers "now"), creating a write hotspot on one shard regardless
  of tenant. Using `_id` (which has high cardinality and is
  effectively random-ish across tenants once you're past the tenantId
  prefix) avoids that, while tenantId as the prefix still keeps each
  tenant's data contiguous for range queries.

**Chunk distribution:** with tenantId as the shard key prefix, small
tenants' chunks naturally co-locate and get balanced across shards by
the usual chunk-splitting/balancing process. The interesting case is
hot tenants (next section).

## 3. Hot tenant isolation

A tenant at 50M+ activities with high write throughput is a candidate
to "go noisy neighbor" on shared infrastructure. Strategies, roughly in
order of operational complexity:

1. **Zone sharding (tag-aware sharding).** MongoDB lets you tag shards
   and tag ranges of a shard key to pin them to specific shards. A
   known-large tenant's `tenantId` range can be tagged to live on a
   dedicated shard (or shard set) with its own hardware, isolating its
   I/O from smaller tenants sharing the rest of the cluster. This is
   the standard approach and doesn't require application-level
   forking.
2. **Dedicated cluster for tier-1 tenants.** For a small number of
   enterprise tenants that justify it commercially, route them to an
   entirely separate MongoDB cluster (different connection string,
   resolved at the application's tenant-routing layer based on
   tenantId → cluster mapping in a config/lookup table). More
   operational overhead (more clusters to patch/monitor) but total
   blast-radius isolation — a hot tenant's incident can't even
   theoretically touch others' latency.
3. **Per-tenant rate limiting on the write path** (token bucket on
   `POST /activities`, keyed by tenantId) as a cheap first line of
   defense against a runaway integration/bug on one tenant flooding
   writes, independent of the sharding story.
4. **Monitor per-tenant index hit ratio and query latency** (from Task
   2's metrics section) sliced by tenantId specifically — the earliest
   signal of "this tenant needs to be moved to its own zone" is a
   tenant whose p99 query latency diverges from the cluster average
   well before it causes a wider incident.

## 4. Data retention

50M activities/tenant indefinitely is rarely actually needed by the
product — it's needed for "the last N days/months of feed," with older
data being audit/compliance material at most. Two retention layers:

- **Hot tier (e.g. last 90 days):** lives in the primary `activities`
  collection, fully indexed, serving the live feed UI.
- **Cold tier (older than 90 days):** either:
  - **TTL-expired and archived**: a MongoDB TTL index
    (`expireAfterSeconds`) on `createdAt` automatically deletes
    documents past the retention window, *after* a scheduled job has
    already exported them to cheaper storage (S3 + Parquet, or a
    columnar warehouse) for any compliance/analytics need.
  - **Time-bucketed collections** (e.g. `activities_2026_01`,
    `activities_2026_02`): write-time the app picks the current
    month's collection; reads for "recent feed" only ever touch the
    current (and maybe previous) collection, keeping the actively
    queried + actively indexed dataset small regardless of how much
    history exists in total. Older monthly collections can be moved to
    cheaper storage tiers or dropped per tenant-specific retention
    policy.

  The bucketed-collection approach is generally preferable at this
  scale specifically because it keeps the *hot* index small (one
  month's worth of one tenant's data, not 50M rows), which is a bigger
  lever on query latency than the index-design tuning in §1 alone.

- **Per-tenant configurable retention**, since compliance requirements
  (e.g. some enterprise contracts mandate 7-year audit trails, others
  want minimal retention for privacy reasons) differ by tenant —
  retention can't be a single global constant.

## 5. Real-time delivery: WebSocket vs SSE

For "new activity appears in your feed live," the relevant comparison:

| | WebSocket | SSE (Server-Sent Events) |
|---|---|---|
| Direction | Bidirectional | Server → client only |
| Protocol | Own handshake (upgrade from HTTP) | Plain HTTP, long-lived connection |
| Reconnection | Manual (app code, as implemented in `useActivitySocket.js`) | Built into the browser `EventSource` API |
| Proxy/LB friendliness | Needs WebSocket-aware infra (sticky sessions or a pub/sub fanout layer) | Works through standard HTTP infra, including most CDNs/LBs unmodified |
| Use case fit here | Better if the client also needs to *send* real-time signals (typing indicators, presence) | A better fit if the feed is **read-only push** from server to client |

**Recommendation: SSE**, specifically because the activity feed's
real-time requirement is one-directional — the server tells connected
clients "a new activity exists," and the client never needs to push
anything back over that same channel (activity *creation* already goes
through the normal `POST /activities` REST call, not the realtime
channel). SSE gets us:

- Free reconnection-with-backoff via the browser's native
  `EventSource`, instead of hand-rolled reconnect logic.
- Simpler infra — it's just HTTP, so it rides through existing load
  balancers and doesn't need a WebSocket-aware piece of the stack.
- Easier horizontal scaling of the push layer: each app server instance
  can hold its own SSE connections and subscribe to a shared pub/sub
  (Redis Pub/Sub, or the message broker from the Bonus section) for
  "activity created in tenant X," fanning out to whichever of its
  connected clients belong to that tenant — no need for sticky
  WebSocket session affinity at the load balancer.

WebSocket would be the better choice if this product later needs
bidirectional real-time features (live cursors, typing indicators,
collaborative editing) — at that point it's worth introducing
WebSocket for *those* features specifically, while the activity feed
itself can stay on SSE since its actual requirement never changed.
