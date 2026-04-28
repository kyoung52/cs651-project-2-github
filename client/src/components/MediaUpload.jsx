import { useEffect, useRef, useState } from 'react';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_RECORDING_MS = 60_000;

// Pick the first MediaRecorder MIME the browser actually supports. Order
// matters: Gemini handles all of these, but webm/opus is the smallest.
const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
];
function pickRecorderMime() {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return null;
  for (const m of RECORDER_MIME_CANDIDATES) {
    if (window.MediaRecorder.isTypeSupported(m)) return m;
  }
  return ''; // empty string → let MediaRecorder pick its default
}

function extForMime(mime) {
  if (!mime) return 'webm';
  if (mime.startsWith('audio/webm')) return 'webm';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/mp4')) return 'm4a';
  return 'webm';
}

/**
 * File input + in-browser audio recorder.
 *
 * - Upload path: existing file picker, validates against accept list / size.
 * - Record path: MediaRecorder captures mic audio, packages it as a File and
 *   hands it to onFiles with the same shape as a picked file. Solves the
 *   "audio must be captured by the app" rubric requirement.
 */
export default function MediaUpload({ onFiles, disabled, multiple = true }) {
  const ref = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickRef = useRef(null);
  const stopTimerRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordError, setRecordError] = useState('');
  const [recorderSupported, setRecorderSupported] = useState(true);

  useEffect(() => {
    setRecorderSupported(
      typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        Boolean(navigator.mediaDevices?.getUserMedia)
    );
  }, []);

  useEffect(() => {
    return () => {
      // Hard cleanup on unmount: stop recorder + tracks + timers.
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop();
        }
      } catch {}
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (tickRef.current) clearInterval(tickRef.current);
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    };
  }, []);

  const change = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    const arr = Array.from(files);
    const tooBig = arr.filter((f) => f.size > MAX_BYTES).map((f) => f.name);
    const ok = arr.filter((f) => f.size <= MAX_BYTES);
    if (tooBig.length) {
      // eslint-disable-next-line no-alert
      alert(`Skipped (over 10MB): ${tooBig.join(', ')}`);
    }
    if (ok.length) onFiles(ok);
    e.target.value = '';
  };

  const stopRecording = () => {
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    } catch (err) {
      console.warn('[recorder] stop failed:', err?.message || err);
    }
  };

  const startRecording = async () => {
    if (disabled || recording) return;
    setRecordError('');

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const msg =
        err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'Microphone permission was denied. Allow mic access in your browser to record.'
          : 'No microphone available. Connect a mic or upload an audio file instead.';
      setRecordError(msg);
      return;
    }

    const mime = pickRecorderMime();
    let recorder;
    try {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setRecordError(`Recording is not supported in this browser (${err?.message || 'unknown error'}).`);
      return;
    }

    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onerror = (e) => {
      console.warn('[recorder] error:', e?.error?.message || e);
      setRecordError('Recording failed. Try again or upload an audio file.');
    };
    recorder.onstop = () => {
      // Cleanup mic + timers BEFORE handing the file off.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
      setRecording(false);
      setElapsedMs(0);

      if (!chunksRef.current.length) return;
      // Strip codec suffix when naming the blob so the server's MIME allowlist
      // sees e.g. "audio/webm" rather than "audio/webm;codecs=opus".
      const baseMime = (recorder.mimeType || mime || 'audio/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type: baseMime });
      chunksRef.current = [];

      if (blob.size > MAX_BYTES) {
        // eslint-disable-next-line no-alert
        alert('Recording exceeded 10MB and was discarded. Try a shorter clip.');
        return;
      }
      const fname = `recording-${Date.now()}.${extForMime(baseMime)}`;
      const file = new File([blob], fname, { type: baseMime });
      onFiles([file]);
    };

    streamRef.current = stream;
    recorderRef.current = recorder;
    try {
      recorder.start();
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      setRecordError(`Could not start recording: ${err?.message || 'unknown error'}.`);
      return;
    }

    setRecording(true);
    setElapsedMs(0);
    const startedAt = Date.now();
    tickRef.current = setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    // Hard cap so a forgotten recorder doesn't run indefinitely.
    stopTimerRef.current = setTimeout(stopRecording, MAX_RECORDING_MS);
  };

  const seconds = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="upload-zone">
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/webm,audio/ogg,.mp3,.wav,.m4a,.aac,.heic,.heif,.webm,.ogg"
        multiple={multiple}
        onChange={change}
        hidden
        disabled={disabled}
      />
      <button
        type="button"
        className="btn-outline full"
        disabled={disabled}
        onClick={() => ref.current?.click()}
      >
        Upload your own files
      </button>

      {recorderSupported ? (
        <button
          type="button"
          className={`btn-outline full mt-2 ${recording ? 'recording' : ''}`}
          disabled={disabled && !recording}
          onClick={recording ? stopRecording : startRecording}
          aria-pressed={recording}
        >
          {recording ? `Stop recording · ${mm}:${ss}` : 'Record audio'}
        </button>
      ) : null}

      {recordError ? <p className="hint small error">{recordError}</p> : null}

      <p className="hint small">JPEG, PNG, WebP, HEIC · MP3, WAV, M4A, WebM · max 10MB each</p>
    </div>
  );
}
