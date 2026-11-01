const SeverityTag = ({ severity }) => (
  <span className={`sev ${severity.toLowerCase()}`}>{severity}</span>
);

export default SeverityTag;
