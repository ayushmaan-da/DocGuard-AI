const DriftDiff = ({ file, line, documented, actual }) => (
  <figure className="diff">
    {file && (
      <figcaption className="diff-file">
        {file}
        {line ? `:${line}` : ""}
      </figcaption>
    )}

    <div className="diff-row del">
      <span className="diff-sign" aria-hidden="true">−</span>
      <div>
        <span className="diff-label">Docs say</span>
        <code>{documented}</code>
      </div>
    </div>

    <div className="diff-row add">
      <span className="diff-sign" aria-hidden="true">+</span>
      <div>
        <span className="diff-label">Code says</span>
        <code>{actual}</code>
      </div>
    </div>
  </figure>
);

export default DriftDiff;
