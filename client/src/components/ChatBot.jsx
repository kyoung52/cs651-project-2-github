import { useState } from 'react';
import { sanitizeChatInput } from '../utils/validators.js';

/**
 * Left column: chat-style input for room vision + optional audio list display.
 */
export default function ChatBot({
  messages,
  onSend,
  disabled,
  audioFiles,
}) {
  const [input, setInput] = useState('');

  const submit = (e) => {
    e.preventDefault();
    const text = sanitizeChatInput(input);
    if (!text || disabled) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className="panel chat-panel">
      <h3 className="panel-title">Roomify Bot</h3>
      <div className="chat-scroll" role="log">
        {messages.map((m, i) => (
          <div key={i} className={`chat-bubble ${m.role}`}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="chat-form">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe your room vision..."
          rows={3}
          disabled={disabled}
          maxLength={8000}
        />
        <button type="submit" className="btn-primary" disabled={disabled}>
          Send
        </button>
      </form>
      {audioFiles?.length > 0 && (
        <div className="audio-list">
          <p className="label">Audio inspiration</p>
          <ul>
            {audioFiles.map((name, idx) => (
              <li key={idx}>{name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
