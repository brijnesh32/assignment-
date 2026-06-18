const mongoose = require('mongoose');

/**
 * Activity Schema
 * --------------------------------------------------------
 * Design notes:
 * - tenantId is on every document and is the FIRST field in every
 *   compound index. This guarantees that every query, by construction,
 *   narrows to a single tenant's data before touching createdAt,
 *   which is what keeps the feed scan tight and tenant-isolated.
 * - metadata is a Mixed/Object field — activity payloads vary by type
 *   (e.g. "comment" vs "invite" vs "status_change") so we don't want a
 *   rigid sub-schema here. Validate shape at the controller/service
 *   layer instead of the DB layer.
 * - We intentionally do NOT store a denormalized "actorAvatar" or similar
 *   here — entityId/actorId are references; resolve display data either
 *   from metadata snapshotted at write time (preferred for feeds, since
 *   it avoids N+1 lookups) or via a separate read-side join service.
 */
const activitySchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: false, // covered by compound index below; avoid duplicate single-field index
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    actorName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'comment_added',
        'task_created',
        'task_completed',
        'member_invited',
        'status_changed',
        'file_uploaded',
        'mention',
      ],
      index: false,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    // We manage createdAt ourselves (immutable, used for cursoring).
    // updatedAt is irrelevant — activities are immutable/append-only.
    timestamps: false,
    versionKey: false,
  }
);

/**
 * PRIMARY FEED INDEX
 * tenantId + createdAt (descending) is the core index that makes
 * GET /activities?cursor=&limit=20 fast at any scale.
 *
 * Why this shape:
 * - tenantId first -> every feed query has an equality match on tenantId,
 *   so Mongo narrows to that tenant's index slice immediately.
 * - createdAt second, descending -> within a tenant's slice, documents
 *   are already stored in the index in the exact order the feed needs
 *   them (newest first). No in-memory sort, no SORT_KEY_GENERATOR stage.
 * - This single index serves: tenant isolation, cursor pagination,
 *   AND avoids a separate blocking sort step.
 */
activitySchema.index({ tenantId: 1, createdAt: -1 });

/**
 * Secondary index to support type-filtered feeds (Task 3 "filtering"
 * requirement) without falling back to a full tenant scan + in-memory
 * filter. tenantId + type + createdAt lets "show me only comments"
 * queries use an index too.
 */
activitySchema.index({ tenantId: 1, type: 1, createdAt: -1 });

/**
 * Optional: if you frequently need "all activity on entity X", add:
 * activitySchema.index({ tenantId: 1, entityId: 1, createdAt: -1 });
 * Only add this if that access pattern is real — every extra index
 * has a write-amplification cost on a high-throughput insert path.
 */

module.exports = mongoose.model('Activity', activitySchema);
