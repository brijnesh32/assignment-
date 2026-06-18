import { memo } from 'react';

const TYPE_LABELS = {
  comment_added: 'commented',
  task_created: 'created a task',
  task_completed: 'completed a task',
  member_invited: 'invited a member',
  status_changed: 'changed status',
  file_uploaded: 'uploaded a file',
  mention: 'mentioned you',
};

function timeAgo(isoDate) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Wrapped in React.memo so that when the parent list re-renders
 * (e.g. because a new activity arrived at the top, or isFetchingMore
 * flipped), the ~20-50 already-rendered rows that haven't changed
 * skip re-rendering entirely. The custom comparator below checks only
 * the fields this component actually reads, rather than relying on
 * default shallow-prop-equality, because the `activity` object
 * reference itself does change identity on every parent re-render
 * coming from state updates elsewhere in the array (new array = new
 * object refs for every untouched item too, under naive spread
 * patterns) — comparing by _id + __optimistic flag is what makes this
 * memoization actually bite instead of being a no-op.
 */
const ActivityItem = memo(
  function ActivityItem({ activity }) {
    const isPending = Boolean(activity.__optimistic);

    return (
      <li
        className={`activity-item${isPending ? ' activity-item--pending' : ''}`}
        aria-busy={isPending}
      >
        <div className="activity-item__avatar" aria-hidden="true">
          {activity.actorName?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <div className="activity-item__body">
          <p className="activity-item__text">
            <strong>{activity.actorName}</strong>{' '}
            {TYPE_LABELS[activity.type] || activity.type}
          </p>
          <span className="activity-item__time">
            {isPending ? 'Sending…' : timeAgo(activity.createdAt)}
          </span>
        </div>
      </li>
    );
  },
  (prevProps, nextProps) =>
    prevProps.activity._id === nextProps.activity._id &&
    prevProps.activity.__optimistic === nextProps.activity.__optimistic &&
    prevProps.activity.createdAt === nextProps.activity.createdAt
);

export default ActivityItem;
