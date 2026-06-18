const Activity = require('../models/Activity');
const { encodeCursor, decodeCursor } = require('../config/cursor');

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * POST /activities
 * High write-throughput path.
 *
 * Design choices for write throughput:
 * 1. No pre-write read (no "check if duplicate" query) — activities
 *    are append-only events, not deduplicated entities. If dedup is
 *    ever needed, do it via a unique compound index + ordered: false
 *    bulk insert, not a read-then-write round trip.
 * 2. We don't await any fan-out (notifications, search indexing, etc.)
 *    synchronously in this handler — see BONUS section for the
 *    queue-based version. In this synchronous version, keep the write
 *    path to exactly one insert.
 * 3. tenantId/actorId come from req.tenantId / req.user, never from
 *    the request body, so a client cannot forge activity on behalf of
 *    another tenant or another user.
 */
async function createActivity(req, res) {
  try {
    const { type, entityId, metadata, actorName } = req.body;

    if (!type || !entityId) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'type and entityId are required.',
      });
    }

    const activity = await Activity.create({
      tenantId: req.tenantId,
      actorId: req.user._id,
      actorName: actorName || req.user.name,
      type,
      entityId,
      metadata: metadata || {},
      createdAt: new Date(),
    });

    // 201 + the created resource so the client can optimistically
    // reconcile its own local insert (see Task 4) against the
    // server-assigned _id and createdAt.
    return res.status(201).json({ activity });
  } catch (err) {
    req.log?.error?.(err) || console.error(err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to record activity.',
    });
  }
}

/**
 * GET /activities?cursor=&limit=20&type=
 *
 * Cursor (keyset) pagination — NOT skip()/offset.
 *
 * Why this query shape is fast:
 * - Filter is { tenantId, createdAt-or-tiebreak-condition }, which
 *   matches the compound index { tenantId: 1, createdAt: -1 } exactly
 *   in field order, so Mongo can use an index-only scan to locate the
 *   start of the page directly — O(log n + limit), not O(n).
 * - No .skip() anywhere. skip(n) forces MongoDB to walk and discard n
 *   documents from the index on every single request, so cost grows
 *   linearly with page depth — page 5000 is far slower than page 1
 *   even though both return 20 documents.
 * - .select() projection avoids pulling `metadata` blobs over the wire
 *   when not needed, and avoids the (mongoose-level) overhead of
 *   hydrating fields the client won't render either way. Adjust the
 *   projection to your actual feed UI's needs.
 */
async function listActivities(req, res) {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const cursor = decodeCursor(req.query.cursor);
    const typeFilter = req.query.type;

    const query = { tenantId: req.tenantId };

    if (typeFilter) {
      query.type = typeFilter;
    }

    if (cursor) {
      // Keyset condition: "strictly after the last item of the
      // previous page" in (createdAt DESC, _id DESC) order.
      // This is the standard seek-pagination predicate:
      //   createdAt < lastCreatedAt
      //   OR (createdAt == lastCreatedAt AND _id < lastId)
      query.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        {
          createdAt: cursor.createdAt,
          _id: { $lt: cursor._id },
        },
      ];
    }

    // Fetch limit+1 so we can tell whether another page exists
    // without a separate count() query (count() on large collections
    // is itself expensive and unnecessary here).
    const docs = await Activity.find(query)
      .select('tenantId actorId actorName type entityId metadata createdAt')
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean(); // skip Mongoose document hydration — pure read path

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;

    const nextCursor =
      hasMore && page.length > 0
        ? encodeCursor(page[page.length - 1])
        : null;

    return res.status(200).json({
      activities: page,
      nextCursor,
      hasMore,
    });
  } catch (err) {
    req.log?.error?.(err) || console.error(err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch activity feed.',
    });
  }
}

module.exports = { createActivity, listActivities };
