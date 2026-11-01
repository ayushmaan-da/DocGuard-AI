const SeverityTag = ({ severity }) => {
  const label = typeof severity === "string" && severity.trim() ? severity : "Info";
  return <span className={`sev ${label.toLowerCase()}`}>{label}</span>;
};

export default SeverityTag;
