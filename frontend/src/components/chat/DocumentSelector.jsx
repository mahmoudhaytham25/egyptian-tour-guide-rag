// Corpus picker for the chat header: lists every uploaded document and lets
// the user aim /query at one of them. Indexed documents are selectable;
// uploaded-but-unindexed ones render disabled so the user can see they
// exist without sending a query the backend would reject.
const DocumentSelector = ({ documents, value, onChange, onRefresh }) => {
  // The selected value may be missing from the fetched list (list still
  // loading, or the fetch failed) — give it a fallback option so the select
  // never collapses to a blank value.
  const known = new Set(documents.map((doc) => doc.id));

  return (
    <div className="doc-picker">
      <span className="doc-picker-label" aria-hidden="true">
        Source
      </span>
      <select
        className="doc-picker-select"
        aria-label="Document to answer from"
        title="Choose which document the assistant answers from"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onRefresh}
      >
        {!known.has(value) && <option value={value}>{value}</option>}
        {documents.map((doc) => (
          <option key={doc.id} value={doc.id} disabled={!doc.indexed}>
            {doc.originalName || doc.filename || doc.id}
            {doc.indexed ? "" : " (not indexed)"}
          </option>
        ))}
      </select>
    </div>
  );
};

export default DocumentSelector;
