import { useRef } from 'react';

/**
 * File input for images/audio — validates accept list client-side.
 */
export default function MediaUpload({ onFiles, disabled, multiple = true }) {
  const ref = useRef(null);

  const change = (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    onFiles(Array.from(files));
    e.target.value = '';
  };

  return (
    <div className="upload-zone">
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp,audio/mpeg,audio/wav,.mp3,.wav"
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
      <p className="hint small">JPEG, PNG, WebP · MP3, WAV · max 10MB each</p>
    </div>
  );
}
