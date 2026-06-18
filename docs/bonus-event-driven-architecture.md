# Bonus — Event-Driven Architecture Redesign

## Why move off the synchronous path at all

The Task 1 `createActivity` handler does exactly one thing: insert one
document. That's correct as a baseline. But in a real product, an
activity being created is rarely *just* a database row — it usually
needs to also: push a realtime event to connected clients (Task 3/5),
possibly trigger a notification, possibly update a denormalized
counter ("12 new activities"), possibly feed a search index. The
question is whether those side effects happen *inside* the request
that creates the activity, or *after* it, asynchronously.

Doing them inline couples the client-facing latency of `POST
/activities` to the slowest side effect, and couples its reliability to
all of them succeeding. A flaky notification provider shouldn't be able
to make activity creation itself fail or feel slow.

## Redesigned flow

```
Client
  │  POST /activities
  ▼
API server
  │  1. Validate + insert into MongoDB (the ONLY synchronous step)
  │  2. Publish "activity.created" event to a queue
  │  3. Return 201 immediately
  ▼
Message broker (e.g. Kafka / RabbitMQ / SQS — see tool choice below)
  │
  ├──► Realtime fan-out worker  → pushes to SSE/WebSocket subscribers
  ├──► Notification worker      → emails/push notifications for mentions etc.
  ├──► Search-index worker      → updates Elasticsearch/Atlas Search
  └──► Analytics/aggregation worker → updates per-tenant activity counters
```

The API's write path stays exactly as fast and as reliable as "can
Mongo accept one insert," because that's all it does synchronously.
Everything else is decoupled, independently scalable, and independently
recoverable from failure.

## Tool choice

- **Kafka** if activity volume is genuinely high-throughput
  (justifying the operational overhead) and if other systems (search
  indexing, analytics) might want to independently replay the same
  event stream from different offsets. Kafka's log-based model is a
  good fit for "many different consumers care about the same event for
  different reasons."
- **RabbitMQ or AWS SQS** if the need is simpler — a handful of
  well-defined consumers, each task-queue-shaped ("do this thing once
  per event") rather than stream-shaped. Much lower operational
  overhead than Kafka, and perfectly adequate unless you have a
  concrete reason to need replay/multiple independent consumer groups
  reading the same events at different paces.

For this specific scenario (activity feed with a known, bounded set of
consumers — realtime fan-out, notifications, search), I'd default to
**SQS (or RabbitMQ if self-hosted/cloud-agnostic matters)** unless
there's a stated future need for event replay or stream processing,
in which case Kafka earns its complexity.

## Idempotency

Any queue-based system has to assume **at-least-once delivery** — a
message can be redelivered (consumer crashed after processing but
before acking, network blip causes a retry, etc.). Consumers must be
written so that processing the same event twice produces the same
end state as processing it once.

- **Give every activity a stable, unique identifier carried in the
  event payload** — the Mongo `_id` from the insert is already
  perfect for this; it's generated once, at write time, before the
  event is ever published.
- **Realtime fan-out worker**: idempotent by construction if it just
  re-pushes the same payload to subscribers — a duplicate push to a
  websocket/SSE client is at worst a harmless duplicate the
  `mergeRealtimeActivity` de-dupe-by-`_id` logic in
  `useActivityFeed.js` already absorbs.
- **Notification worker**: needs an explicit dedup check — e.g. a
  `notifications_sent` collection/table keyed by `(activityId,
  recipientId)` with a unique index, and the worker does an
  upsert-or-skip before actually sending. Without this, a redelivered
  message would email someone twice.
- **Search-index worker**: naturally idempotent if it does an
  upsert-by-`activityId` into the search index rather than a blind
  insert — indexing the same document twice with the same ID just
  overwrites itself.
- **Aggregation/counter worker** is the trickiest: naively doing
  `counter += 1` on every message delivery is *not* idempotent (a
  redelivered message double-counts). Fix: track processed event IDs
  in a dedup table/set with a TTL roughly matching your broker's max
  redelivery window, and skip incrementing if the event ID was already
  applied. Alternatively, recompute the counter periodically from the
  source-of-truth collection instead of incrementally maintaining it,
  if eventual consistency on the counter is acceptable.

## Failure handling

- **Producer-side (API server publishing the event):** if the publish
  to the queue fails right after the Mongo insert succeeded, we now
  have an activity that exists but whose side effects never fire. Two
  options: (a) accept this as a rare, recoverable gap and run a
  periodic reconciliation job that finds activities newer than X
  without a corresponding "fanout completed" marker and re-publishes
  them; or (b) for stronger guarantees, use the **transactional
  outbox pattern** — write the event to an `outbox` collection in the
  same operation/transaction as the activity insert, and have a
  separate relay process tail the outbox and publish to the queue,
  retrying the *publish* step independently of the original request.
  Outbox is the more robust answer if this gap is unacceptable for the
  product (e.g. a missed notification is a real complaint-generating
  problem, not just a minor inconsistency).
- **Consumer-side retries:** each worker should use the broker's
  built-in retry/redelivery with **exponential backoff**, not retry in
  a tight loop, to avoid hammering a downstream dependency that's
  already struggling (e.g. the notification provider's API being
  temporarily down).
- **Dead-letter queue (DLQ):** after N failed delivery attempts (e.g.
  5), the message goes to a DLQ instead of retrying forever. This
  prevents one permanently-broken message (malformed payload, a
  recipient that no longer exists) from blocking the queue or burning
  infinite retry cycles. DLQ contents get alerted on and reviewed —
  this is the queue's equivalent of an error log, not a silent
  graveyard.
- **Poison-message isolation:** if a single malformed event crashes a
  worker process outright (rather than just failing gracefully), that
  worker should catch and log the error per-message rather than
  letting one bad message take down the whole consumer process, which
  would otherwise stall processing for every other tenant's events
  behind it in the same queue/partition.
- **Monitoring:** queue depth (is the backlog growing, meaning
  consumers can't keep up with producers) and DLQ size (is something
  systematically failing) are the two metrics that catch event-driven
  failures before they become incidents — both should be alerted on,
  not just dashboarded.
