import { useEffect, useRef } from 'react';

/**
 * useActivitySocket
 * --------------------------------------------------------------
 * Isolated WebSocket lifecycle management. Kept separate from
 * useActivityFeed so the data-shape logic (merging, pagination) has
 * zero knowledge of transport — this hook could be swapped for an SSE
 * EventSource implementation (see Task 5 discussion) without touching
 * useActivityFeed at all.
 *
 * onMessage is expected to be a stable callback (wrap with useCallback
 * at the call site) — we still guard with a ref internally so a
 * non-memoized callback doesn't force socket reconnects on every render.
 */
export function useActivitySocket({ url, tenantId, onActivityCreated, enabled = true }) {
  const callbackRef = useRef(onActivityCreated);
  callbackRef.current = onActivityCreated;

  useEffect(() => {
    if (!enabled || !url) return;

    let socket;
    let reconnectTimer;
    let closedByClient = false;

    function connect() {
      socket = new WebSocket(`${url}?tenantId=${tenantId}`);

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'activity:created' && message.payload) {
            callbackRef.current?.(message.payload);
          }
        } catch {
          // Ignore malformed frames rather than crashing the feed.
        }
      };

      socket.onclose = () => {
        if (closedByClient) return;
        // Simple fixed backoff; swap for exponential backoff + jitter
        // in production to avoid thundering-herd reconnects after an
        // outage.
        reconnectTimer = setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    connect();

    return () => {
      closedByClient = true;
      clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [url, tenantId, enabled]);
}
