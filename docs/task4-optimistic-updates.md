# Task 4 — Optimistic UI Update & Rollback Logic

Implementation lives in `frontend/hooks/useActivityFeed.js` →
`createActivityOptimistic`. Walking through the design:

## The flow

1. **Render immediately.** Before any network call is made, a
   temporary activity object is constructed with a locally-generated
   `tempId` (`temp-<timestamp>-<random>`) and prepended to the
   `activities` array with a `__optimistic: true` flag. The UI updates
   in the same tick the user clicked "post" — no spinner, no wait.

2. **Fire the request.** `createActivity(payload)` hits `POST
   /activities` in the background.

3. **Reconcile on success.** When the server responds with the real,
   persisted activity (real `_id`, server-assigned `createdAt`), we
   **replace** the temp item in place — `prev.map(a => a._id === tempId
   ? serverActivity : a)` — rather than just toggling `__optimistic` to
   false on the existing object. This matters: the temp object's
   `createdAt` was the client's local clock, which can drift from the
   server's. If we kept the client's guess and the feed later does
   cursor pagination, that item's sort position could be wrong relative
   to true insertion order. Swapping in the authoritative server object
   keeps the list's sort key trustworthy.

4. **Rollback on failure.** If the request rejects (network failure,
   validation error, 401, etc.), we **remove** the temp item entirely:
   `prev.filter(a => a._id !== tempId)`.

## Why rollback removes the item rather than marking it "failed"

There are two reasonable UX strategies here and it's worth being
explicit about the tradeoff:

- **Remove entirely** (what's implemented): the feed returns to
  exactly the state it was in before the user's action. This is the
  safer default for an *activity feed* specifically, because an
  activity is a fact about something that happened ("X commented",
  "Y completed a task") — if it didn't actually get persisted, leaving
  a ghost entry in the feed misrepresents what occurred, even with an
  error icon next to it. A feed with a few permanently-stuck "failed"
  items also accumulates visual debris over a session.
- **Leave it with a retry affordance:** for write-heavy primary actions
  (e.g. a chat message, not a passive activity log), users often prefer
  the failed item to stay visible with a "tap to retry" control, since
  the cost of re-typing a message is higher than re-clicking a button.

Given the assignment's context (an activity feed, where the user
triggering creation is usually a side effect of some other action like
commenting elsewhere in the app, not the focal task), removal + letting
the *original* action's own error handling tell the user "that didn't
save" is the more honest default. The hook still surfaces `{ success:
false, error }` from `createActivityOptimistic`, so the calling
component (e.g. a comment box) can show its own retry/error UI tied to
the actual form, rather than the feed silently growing zombie rows.

## Race condition this design avoids

Because reconciliation keys off `tempId` rather than array position,
it's safe even if:
- Other activities arrive (via the realtime socket) between steps 1
  and 3 and get prepended above the optimistic item.
- The user has scrolled and triggered `loadMore()` in the meantime,
  appending older items to the bottom of the array.

Both of those mutate `activities` via `setActivities`, but the
reconcile/rollback steps use a referential `_id` match inside a
functional state updater (`setActivities(prev => ...)`), not a captured
index or stale snapshot, so they apply correctly against whatever the
array looks like *at the time they run*, not at the time they were
scheduled.
