/**
 * SSE endpoint that streams generation phase events for a single job.
 *
 * EventSource cannot set custom headers, so the Firebase ID token is passed
 * via the `?t=` query param. In dev (DEV_SKIP_AUTH=true) the token check is
 * skipped, matching verifyFirebaseToken's behavior elsewhere.
 *
 * The job id is generated client-side (UUID); the upload POST carries the
 * same id so emit() can find this stream. We enforce that the ownerUid on
 * the job (if recorded) matches the caller.
 */
import express from 'express';
import { initFirebase, admin } from '../config/firebase.js';
import { subscribe } from '../utils/jobStream.js';

const router = express.Router();

const DEV_SKIP_AUTH =
  process.env.DEV_SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production';

/** Resolve the caller's uid from the `?t=` Firebase ID token. */
async function uidFromQueryToken(req) {
  if (DEV_SKIP_AUTH) return 'dev-user';
  const token = String(req.query?.t || '').trim();
  if (!token) return null;
  try {
    initFirebase();
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded.uid || null;
  } catch {
    return null;
  }
}

router.get('/:jobId/events', async (req, res) => {
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId) {
    res.status(400).json({ error: 'Missing jobId', code: 'BAD_REQUEST' });
    return;
  }

  const uid = await uidFromQueryToken(req);
  if (!uid) {
    res.status(401).json({ error: 'Sign in to receive job events', code: 'AUTH_REQUIRED' });
    return;
  }

  // SSE headers. The Cloud Run proxy buffers by default; the explicit
  // 'no-transform' + Cache-Control prevents intermediaries from chunking
  // the stream. `X-Accel-Buffering: no` is a hint for nginx-style proxies.
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Initial comment line nudges some browsers to treat the response as
  // streaming and start firing onmessage handlers.
  res.write(': stream-open\n\n');

  let closed = false;
  const send = (evt) => {
    if (closed) return;
    try {
      const payload = JSON.stringify(evt.data ?? {});
      res.write(`event: ${evt.type}\n`);
      res.write(`data: ${payload}\n\n`);
      // After a `done` event, end the connection so the client doesn't
      // keep retrying.
      if (evt.type === 'done' || evt.type === 'closed') {
        closed = true;
        res.end();
      }
    } catch {
      closed = true;
      try { res.end(); } catch {}
    }
  };

  const unsubscribe = subscribe(jobId, uid, send);
  if (!unsubscribe) {
    // Job doesn't exist yet (or wrong owner). Tell the client and end —
    // EventSource will reconnect, by which time the job may exist.
    send({ type: 'phase', data: { phase: 'waiting' } });
    res.end();
    return;
  }

  // 15s heartbeat so proxies don't kill the connection during slow Vertex
  // calls. Comment lines are ignored by EventSource.
  const heartbeat = setInterval(() => {
    if (closed) return;
    try { res.write(': hb\n\n'); } catch { closed = true; }
  }, 15_000);
  heartbeat.unref?.();

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    try { unsubscribe(); } catch {}
  });
});

export default router;
