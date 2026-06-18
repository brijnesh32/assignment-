# Task 6 — Code Review: Infinite Loop in useEffect

## The code under review

```js
useEffect(() => {
  fetchActivities().then(setActivities);
}, [activities]);
```

## The bug

`activities` is listed as the effect's dependency, but `activities` is
also the *thing this effect updates* (via `setActivities`). That
creates a direct feedback loop:

1. Component mounts. `activities` is `[]` (or whatever its initial
   state is). The effect runs because it runs on every dependency
   change, including the initial render.
2. `fetchActivities()` resolves, and `setActivities(newData)` runs.
3. `activities` state changes → React re-renders → the dependency
   array `[activities]` is shallow-compared against its previous
   value. Since `setActivities` replaced it with a **new array
   reference** (even if the contents happened to be identical), the
   dependency is considered "changed."
4. The effect fires again. Step 2 repeats. Forever.

This isn't a rare edge case — it fires on literally every successful
fetch, unconditionally, as long as the component is mounted.

## Production impact

- **Infinite network requests.** Every fetch resolution immediately
  triggers another fetch. This isn't throttled by anything in the code
  shown — it'll fire as fast as the network round-trip allows,
  potentially dozens of requests per second per mounted component
  instance.
- **Backend load amplification.** With multiple users having this
  component mounted simultaneously, this turns into a self-inflicted
  denial-of-service against your own `/activities` endpoint —
  proportional to concurrently open browser tabs, not to real user
  actions.
- **Browser resource exhaustion.** Continuous re-renders plus
  continuous in-flight fetches will spike CPU and memory in the tab,
  and on lower-end devices can make the page visibly freeze or the tab
  crash.
- **Masked by appearing to "work."** This bug is dangerous specifically
  because the feed *does* show data — it looks functional in a quick
  manual test, and the runaway request pattern is something you'd only
  catch by watching the Network tab or noticing battery/data usage, not
  from the feature visibly breaking. It's the kind of bug that reaches
  production because it doesn't look broken.
- **Race conditions on top of the loop.** Since requests overlap (each
  new fetch starts before the previous one's state update has
  necessarily settled, given how fast this loop spins), responses can
  resolve out of order, so the rendered list can flicker between
  different fetch results non-deterministically.

## The fix

```js
useEffect(() => {
  fetchActivities().then(setActivities);
}, []); // run once on mount, not on every state change this effect causes
```

If the intent was actually "refetch when some *external* condition
changes" (e.g. a filter, a tenantId, a page param), the dependency
array should list **that** value, never the state the effect itself
sets:

```js
useEffect(() => {
  fetchActivities({ type: activeFilter }).then(setActivities);
}, [activeFilter]); // correct: depends on an input, not its own output
```

This is exactly the structure used in `useActivityFeed.js` in this
submission — `loadInitial` is triggered by a `useEffect` keyed on the
`type` filter prop, never on `activities` itself, and all writes to
`activities` happen either inside event-handler callbacks (`loadMore`,
`createActivityOptimistic`) or inside that one type-keyed effect — not
in a way that feeds back into its own trigger condition.

It's also worth adding a cleanup/cancellation guard for the realistic
case where the component unmounts (or the filter changes again) before
the fetch resolves, to avoid a "set state on unmounted component"
warning and to avoid a stale response overwriting fresher state:

```js
useEffect(() => {
  let cancelled = false;
  fetchActivities({ type: activeFilter }).then((data) => {
    if (!cancelled) setActivities(data);
  });
  return () => {
    cancelled = true;
  };
}, [activeFilter]);
```

## Prevention strategy

- **Lint rule, not just code review discipline.** `eslint-plugin-react-hooks`'s
  `exhaustive-deps` rule catches a related-but-distinct class of bugs
  (missing dependencies) and is good practice regardless, but the
  specific "depends on its own output" pattern is best caught by a
  simple mental check during review: *for every value in this
  dependency array, trace whether this same effect's body writes to
  that value.* If yes, that's almost always a bug, with the rare
  exception of legitimate convergence patterns (e.g. retry-with-backoff
  effects that intentionally re-trigger off their own error state,
  which should be commented as intentional when they appear).
- **Separate "fetch trigger" state from "fetch result" state.** Reaching
  for distinct variables — e.g. `activeFilter` (trigger) vs `activities`
  (result) — rather than ever needing one state value to feed off
  itself, structurally prevents this category of bug rather than
  relying on remembering to get the dependency array right every time.
- **PR template / checklist line**: "Does any `useEffect` dependency
  array include a value that the effect body itself sets via
  `setState`?" as an explicit review question, since this bug is easy
  to miss in a quick skim — the code reads as plausible at a glance.
- **Add a dev-only render-count guard during development** (e.g. a
  simple counter that warns to console if an effect fires more than N
  times in M milliseconds) to surface runaway-effect bugs immediately
  in local dev, before they reach a PR at all.
