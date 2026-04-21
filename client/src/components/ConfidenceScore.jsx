export default function ConfidenceScore({ value }) {
  if (value == null) return null;
  return (
    <span className="confidence" title="Match confidence">
      {value}%
    </span>
  );
}
