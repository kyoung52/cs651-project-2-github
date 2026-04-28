/**
 * Per-job in-memory event channel for SSE phase updates during long-running
 * generation requests. Keeps recent events in a small ring so a client that
 * opens its EventSource a bit late doesn't miss the early phases.
 *
 * Lifecycle:
 *   registerJob(jobId, ownerUid)        — creates the job entry
 *   emit(jobId, phase, data?)           — pushes an event; replays to current subscribers
 *   subscribe(jobId, ownerUid, onEvent) — replays buffered events then streams new ones
 *   end(jobId)                          — emits a final `done` and schedules deletion
 *
 * The ownerUid check on subscribe prevents one user reading another user's
 * stream by guessing a jobId. We don't enforce it on emit because emit is
 * called only by the route handlers that already have req.user.
 *
 * TTL prune runs at the top of every public method; jobs older than
 * JOB_TTL_MS without activity are dropped. SSE connections to those jobs
 * are closed on next event/heartbeat.
 */

const jobs = new Map();
const JOB_TTL_MS = 5 * 60 * 1000;
const MAX_BUFFERED_EVENTS = 64;

function pruneStale() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.lastActivityAt > JOB_TTL_MS) {
      // Best-effort close any lingering subscribers.
      for (const fn of job.subscribers) {
        try { fn({ type: 'closed', data: { reason: 'expired' } }); } catch {}
      }
      jobs.delete(id);
    }
  }
}

/**
 * Register a new job. Idempotent — calling twice with the same id is a no-op
 * after the first call (so client-supplied job ids are safe even if the
 * client retries the upload POST).
 */
export function registerJob(jobId, ownerUid) {
  pruneStale();
  if (!jobId || typeof jobId !== 'string') return;
  if (jobs.has(jobId)) return;
  jobs.set(jobId, {
    ownerUid: ownerUid || null,
    events: [],
    subscribers: new Set(),
    closed: false,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  });
}

/**
 * Append a phase event. `phase` is a short identifier ("analyzing_image",
 * "generating_concept", "rendering_hero", "fetching_similar"). `data` is an
 * arbitrary small JSON-serializable object (kept under ~1KB by callers).
 */
export function emit(jobId, phase, data = {}) {
  pruneStale();
  if (!jobId || typeof jobId !== 'string') return;
  const job = jobs.get(jobId);
  if (!job || job.closed) return;
  const evt = {
    type: 'phase',
    data: { phase: String(phase || ''), ...data, ts: Date.now() },
  };
  job.events.push(evt);
  if (job.events.length > MAX_BUFFERED_EVENTS) {
    job.events.splice(0, job.events.length - MAX_BUFFERED_EVENTS);
  }
  job.lastActivityAt = Date.now();
  for (const fn of job.subscribers) {
    try { fn(evt); } catch { /* one bad subscriber doesn't kill others */ }
  }
}

/**
 * Mark the job as done; emit a final `done` event and schedule deletion.
 * Subsequent emit() calls are no-ops.
 */
export function end(jobId, payload = {}) {
  if (!jobId) return;
  const job = jobs.get(jobId);
  if (!job || job.closed) return;
  const evt = {
    type: 'done',
    data: { ...payload, ts: Date.now() },
  };
  job.events.push(evt);
  job.closed = true;
  job.lastActivityAt = Date.now();
  for (const fn of job.subscribers) {
    try { fn(evt); } catch {}
  }
  // Keep the buffer briefly so a late subscriber can replay the `done`.
  setTimeout(() => {
    jobs.delete(jobId);
  }, 30_000).unref?.();
}

/**
 * Subscribe an SSE writer. Returns an unsubscribe function. Emits any
 * buffered events synchronously before streaming new ones, so a late client
 * still sees the phases that already fired.
 *
 * Returns null if the job doesn't exist or doesn't belong to the caller.
 */
export function subscribe(jobId, ownerUid, onEvent) {
  pruneStale();
  if (!jobId) return null;
  const job = jobs.get(jobId);
  if (!job) return null;
  // If the job was created with an owner, enforce match. (DEV_SKIP_AUTH
  // creates jobs under "dev-user" — same uid for the SSE caller too.)
  if (job.ownerUid && ownerUid && job.ownerUid !== ownerUid) return null;

  for (const evt of job.events) {
    try { onEvent(evt); } catch {}
  }
  // If the job already finished, don't add to subscribers — just signal end.
  if (job.closed) {
    return () => {};
  }
  job.subscribers.add(onEvent);
  return () => {
    job.subscribers.delete(onEvent);
  };
}

/** For tests / introspection only. */
export function _peek(jobId) {
  return jobs.get(jobId) || null;
}
