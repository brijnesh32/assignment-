import { useState, useCallback, useRef, useEffect } from "react";
import { fetchActivities, createActivity } from "../api/activitiesApi";

export function useActivityFeed({ type } = {}) {
  const [activities, setActivities] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [error, setError] = useState(null);

  const isFetchingRef = useRef(false);
  const requestTypeRef = useRef(type);

  const loadInitial = useCallback(async (activeType) => {
    setIsInitialLoading(true);
    setError(null);
    setActivities([]);
    setNextCursor(null);
    setHasMore(true);
    requestTypeRef.current = activeType;

    try {
      const result = await fetchActivities({ type: activeType, limit: 20 });
      if (requestTypeRef.current !== activeType) return;
      setActivities(result.activities);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestTypeRef.current !== activeType) return;
      setError(err);
    } finally {
      if (requestTypeRef.current === activeType) {
        setIsInitialLoading(false);
      }
    }
  }, []); // stable — only uses refs and setters

  const loadMore = useCallback(async () => {
    if (isFetchingRef.current || !hasMore || !nextCursor) return;

    isFetchingRef.current = true;
    setIsFetchingMore(true);
    const activeType = requestTypeRef.current;

    try {
      const result = await fetchActivities({
        cursor: nextCursor,
        type: activeType,
        limit: 20,
      });
      if (requestTypeRef.current !== activeType) return;

      setActivities((prev) => {
        const seen = new Set(prev.map((a) => a._id));
        const fresh = result.activities.filter((a) => !seen.has(a._id));
        return [...prev, ...fresh];
      });
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestTypeRef.current !== activeType) return;
      setError(err);
    } finally {
      isFetchingRef.current = false;
      setIsFetchingMore(false);
    }
  }, [hasMore, nextCursor]);

  // loadInitial intentionally omitted from deps — it's stable ([] above)
  // and including it causes an infinite loop via setIsInitialLoading re-renders
  useEffect(() => {
    loadInitial(type);
  }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const mergeRealtimeActivity = useCallback((activity) => {
    const activeType = requestTypeRef.current;
    if (activeType && activity.type !== activeType) return;
    setActivities((prev) => {
      if (prev.some((a) => a._id === activity._id)) return prev;
      return [activity, ...prev];
    });
  }, []);

  const createActivityOptimistic = useCallback(async (payload) => {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimisticActivity = {
      _id: tempId,
      ...payload,
      createdAt: new Date().toISOString(),
      __optimistic: true,
    };

    setActivities((prev) => [optimisticActivity, ...prev]);

    try {
      const { activity: serverActivity } = await createActivity(payload);
      setActivities((prev) =>
        prev.map((a) => (a._id === tempId ? serverActivity : a)),
      );
      return { success: true, activity: serverActivity };
    } catch (err) {
      setActivities((prev) => prev.filter((a) => a._id !== tempId));
      return { success: false, error: err };
    }
  }, []);

  return {
    activities,
    isInitialLoading,
    isFetchingMore,
    hasMore,
    error,
    loadMore,
    mergeRealtimeActivity,
    createActivityOptimistic,
    refetch: () => loadInitial(requestTypeRef.current),
  };
}
