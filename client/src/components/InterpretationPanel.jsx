/**
 * InterpretationPanel — replaces the "vibe summary" one-liner with a structured
 * breakdown of how Roomify combined image, audio, and prompt signals into the
 * final concept. Renders nothing if all four arrays are empty.
 *
 * Old saved projects (pre-Batch-E) won't have `concept.interpretation`. The
 * helper `legacyInterpretation` below builds a best-effort structure from the
 * legacy `summary` fields so old projects don't crash or show a blank panel.
 */
function Section({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="interpretation-section">
      <span className="label">{title}</span>
      <ul className="interpretation-list">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export default function InterpretationPanel({ interpretation }) {
  const i = interpretation && typeof interpretation === 'object' ? interpretation : null;
  if (!i) return null;
  const all = [i.fromImages, i.fromAudio, i.fromPrompt, i.decisionTrace];
  const empty = all.every((a) => !Array.isArray(a) || a.length === 0);
  if (empty) return null;

  return (
    <div className="panel interpretation-panel">
      <h3 className="panel-title">How I read your inputs</h3>
      <Section title="What I saw in your photos" items={i.fromImages} />
      <Section title="What your audio suggested" items={i.fromAudio} />
      <Section title="What your prompt asked for" items={i.fromPrompt} />
      <Section title="How I combined these" items={i.decisionTrace} />
    </div>
  );
}

/**
 * Build a legacy interpretation from older saved-concept fields (`summary`
 * lines and `analysisKeywords`) so pre-Batch-E projects still render
 * something sensible in the panel.
 */
export function legacyInterpretation(concept, regen) {
  if (!concept) return null;
  const fromImages = Array.isArray(regen?.conceptGenInput?.imageAnalyses)
    ? regen.conceptGenInput.imageAnalyses
        .map((a) => (typeof a?.summary === 'string' ? a.summary : ''))
        .filter(Boolean)
        .slice(0, 5)
    : [];
  const fromAudio = Array.isArray(regen?.conceptGenInput?.audioAnalyses)
    ? regen.conceptGenInput.audioAnalyses
        .map((a) => (typeof a?.summary === 'string' ? a.summary : ''))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const promptText =
    typeof regen?.conceptGenInput?.chatContext === 'string'
      ? regen.conceptGenInput.chatContext.trim()
      : '';
  const fromPrompt = promptText ? [promptText.slice(0, 240)] : [];
  const decisionTrace = concept?.conceptDescription
    ? [String(concept.conceptDescription).slice(0, 320)]
    : [];

  if (
    fromImages.length === 0 &&
    fromAudio.length === 0 &&
    fromPrompt.length === 0 &&
    decisionTrace.length === 0
  ) {
    return null;
  }
  return { fromImages, fromAudio, fromPrompt, decisionTrace };
}
