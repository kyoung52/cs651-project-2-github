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
 * File input + in-browser audio recorder + in-browser camera capture.
 *
 * - Upload path: existing file picker, validates against accept list / size.
 * - Record path: MediaRecorder captures mic audio, packages it as a File and
 *   hands it to onFiles with the same shape as a picked file. Solves the
 *   "audio must be captured by the app" rubric requirement.
 * - Camera path: getUserMedia + a live <video> preview; on capture we paint
 *   the current frame to a <canvas>, convert to a JPEG Blob, and hand it to
 *   onFiles as a File. On browsers without getUserMedia (or when the user
 *   denies it), a hidden `<input capture="environment">` is used as a
 *   fallback — on mobile this opens the native camera app directly.
 */
export default function MediaUpload({ onFiles, disabled, multiple = true }) {
  const ref = useRef(null);
  const cameraInputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const tickRef = useRef(null);
  const stopTimerRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const videoRef = useRef(null);

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [recordError, setRecordError] = useState('');
  const [recorderSupported, setRecorderSupported] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [cameraSupported, setCameraSupported] = useState(true);

  useEffect(() => {
    const hasGetUserMedia =
      typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    setRecorderSupported(
      typeof window !== 'undefined' &&
        typeof window.MediaRecorder !== 'undefined' &&
        hasGetUserMedia
    );
    setCameraSupported(hasGetUserMedia);
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
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
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

  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    setCameraOpen(false);
  };

  const openCamera = async () => {
    if (disabled || cameraOpen) return;
    setCameraError('');

    // No getUserMedia available — fall back to the OS camera via the
    // hidden input. On mobile this opens the native camera; on desktop
    // it just opens the file picker.
    if (!cameraSupported) {
      cameraInputRef.current?.click();
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // `environment` prefers the rear camera on phones; desktop
        // browsers ignore it and pick the default webcam.
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
    } catch (err) {
      const msg =
        err?.name === 'NotAllowedError' || err?.name === 'SecurityError'
          ? 'Camera permission was denied. Allow camera access in your browser, or upload a photo instead.'
          : 'No camera available. Upload a photo instead.';
      setCameraError(msg);
      // Fallback: trigger the OS camera picker (mobile) or the file picker.
      cameraInputRef.current?.click();
      return;
    }

    cameraStreamRef.current = stream;
    setCameraOpen(true);
    // Attach to the <video> after the element renders.
    requestAnimationFrame(() => {
      const v = videoRef.current;
      if (!v) return;
      try { v.srcObject = stream; } catch {}
      // iOS Safari needs play() on a user gesture; we're inside a click
      // handler chain so this should succeed.
      v.play().catch(() => {});
    });
  };

  const capturePhoto = () => {
    const v = videoRef.current;
    const stream = cameraStreamRef.current;
    if (!v || !stream) return;
    const w = v.videoWidth || 1280;
    const h = v.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Could not capture photo. Try again or upload a file.');
      return;
    }
    ctx.drawImage(v, 0, 0, w, h);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError('Could not encode photo. Try again or upload a file.');
          return;
        }
        if (blob.size > MAX_BYTES) {
          // eslint-disable-next-line no-alert
          alert('Captured photo exceeded 10MB and was discarded. Try again at lower resolution.');
          return;
        }
        const fname = `camera-${Date.now()}.jpg`;
        const file = new File([blob], fname, { type: 'image/jpeg' });
        onFiles([file]);
        closeCamera();
      },
      'image/jpeg',
      0.9
    );
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
      {/* Mobile / no-getUserMedia fallback: opens the OS camera. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={change}
        hidden
        disabled={disabled}
      />
      <button
        type="button"
        className="btn-outline full"
        disabled={disabled || cameraOpen}
        onClick={() => ref.current?.click()}
      >
        Upload your own files
      </button>

      <button
        type="button"
        className="btn-outline full mt-2"
        disabled={disabled || cameraOpen || recording}
        onClick={openCamera}
      >
        Take photo with camera
      </button>

      {recorderSupported ? (
        <button
          type="button"
          className={`btn-outline full mt-2 ${recording ? 'recording' : ''}`}
          disabled={(disabled || cameraOpen) && !recording}
          onClick={recording ? stopRecording : startRecording}
          aria-pressed={recording}
        >
          {recording ? `Stop recording · ${mm}:${ss}` : 'Record audio'}
        </button>
      ) : null}

      {cameraOpen ? (
        <div className="camera-preview mt-2">
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            autoPlay
          />
          <div className="row-actions compact no-mt mt-2">
            <button type="button" className="btn-primary small" onClick={capturePhoto}>
              Capture
            </button>
            <button type="button" className="btn-ghost small" onClick={closeCamera}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {recordError ? <p className="hint small error">{recordError}</p> : null}
      {cameraError ? <p className="hint small error">{cameraError}</p> : null}

      <p className="hint small">JPEG, PNG, WebP, HEIC · MP3, WAV, M4A, WebM · max 10MB each</p>
    </div>
  );
}
