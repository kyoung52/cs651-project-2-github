/**
 * Centered empty-state block with an optional title, description, and action.
 */
export default function EmptyState({ title, description, action, tone = 'default' }) {
  return (
    <div className={`empty-state empty-${tone}`}>
      {title ? <h3 className="empty-title">{title}</h3> : null}
      {description ? <p className="empty-desc">{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}
