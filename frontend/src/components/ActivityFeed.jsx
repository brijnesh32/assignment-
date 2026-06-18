import { useState, useRef, useCallback, useMemo } from 'react';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { useActivitySocket } from '../hooks/useActivitySocket';
import ActivityItem from './ActivityItem';
import './ActivityFeed.css';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'comment_added', label: 'Comments' },
  { value: 'task_created', label: 'Tasks created' },
  { value: 'task_completed', label: 'Tasks completed' },
  { value: 'mention', label: 'Mentions' },
];

export default function ActivityFeed({ tenantId, currentUser, socketUrl }) {
  const [activeFilter, setActiveFilter] = useState('');

  const {
    activities,
    isInitialLoading,
    isFetchingMore,
    hasMore,
    error,
    loadMore,
    mergeRealtimeActivity,
    createActivityOptimistic,
  } = useActivityFeed({ type: activeFilter || undefined });

  // Stable callback identity so useActivitySocket's effect doesn't
  // reconnect the socket every render.
  const handleRealtimeActivity = useCallback(
    (activity) => mergeRealtimeActivity(activity),
    [mergeRealtimeActivity]
  );

  useActivitySocket({
    url: socketUrl,
    tenantId,
    onActivityCreated: handleRealtimeActivity,
    enabled: Boolean(socketUrl && tenantId),
  });

  // Infinite scroll via IntersectionObserver on a sentinel element,
  // rather than a window scroll listener — avoids firing on every
  // pixel of scroll and avoids manual scrollTop math entirely.
  const observerRef = useRef(null);

  const setSentinelRef = useCallback(
    (node) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (!node) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            loadMore();
          }
        },
        { rootMargin: '200px' } // start loading before the sentinel is fully visible
      );
      observerRef.current.observe(node);
    },
    [loadMore]
  );

  // Memoized so toggling a filter button doesn't cause this array to
  // be reconstructed from scratch when nothing about the filter list
  // itself changed (cheap here, but the pattern matters more once
  // FILTERS includes per-tenant dynamic types).
  const filterButtons = useMemo(
    () =>
      FILTERS.map((f) => (
        <button
          key={f.value || 'all'}
          type="button"
          className={`activity-feed__filter${
            activeFilter === f.value ? ' activity-feed__filter--active' : ''
          }`}
          onClick={() => setActiveFilter(f.value)}
          aria-pressed={activeFilter === f.value}
        >
          {f.label}
        </button>
      )),
    [activeFilter]
  );

const handlePostTestActivity = useCallback(async () => {
  if (!currentUser) return;
  await createActivityOptimistic({
    type: 'comment_added',
    entityId: '65a1f2c3b4d5e6f7a8b9c0d3',   // valid ObjectId instead of 'demo-entity'
    metadata: { text: 'Posted from the feed UI' },
  });
}, [createActivityOptimistic, currentUser]);

  return (
    <div className="activity-feed">
      <div className="activity-feed__toolbar" role="tablist" aria-label="Filter activities">
        {filterButtons}
      </div>

      {error && (
        <div className="activity-feed__error" role="alert">
          Couldn't load activity. Check your connection and try again.
        </div>
      )}

      {isInitialLoading ? (
        <ActivityFeedSkeleton />
      ) : activities.length === 0 ? (
        <EmptyState filterLabel={FILTERS.find((f) => f.value === activeFilter)?.label} />
      ) : (
        <>
          <ul className="activity-feed__list">
            {activities.map((activity) => (
              <ActivityItem key={activity._id} activity={activity} />
            ))}
          </ul>

          <div ref={setSentinelRef} className="activity-feed__sentinel" aria-hidden="true" />

          {isFetchingMore && <div className="activity-feed__loading-more">Loading more…</div>}
          {!hasMore && activities.length > 0 && (
            <div className="activity-feed__end">You're all caught up.</div>
          )}
        </>
      )}

      {/* Demo trigger for Task 4's optimistic flow — wire this to your real "post" form. */}
      <button type="button" className="activity-feed__demo-post" onClick={handlePostTestActivity}>
        Post test activity
      </button>
    </div>
  );
}

function ActivityFeedSkeleton() {
  return (
    <ul className="activity-feed__list" aria-busy="true" aria-label="Loading activity">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="activity-item activity-item--skeleton">
          <div className="activity-item__avatar activity-item__avatar--skeleton" />
          <div className="activity-item__body">
            <div className="skeleton-line skeleton-line--wide" />
            <div className="skeleton-line skeleton-line--narrow" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ filterLabel }) {
  return (
    <div className="activity-feed__empty">
      <p className="activity-feed__empty-title">No activity yet</p>
      <p className="activity-feed__empty-subtitle">
        {filterLabel && filterLabel !== 'All'
          ? `Nothing in "${filterLabel}" yet. Activity will show up here as it happens.`
          : 'Activity will show up here as it happens.'}
      </p>
    </div>
  );
}
