export default function FileEditor({ file, onUpdateContent }) {
  if (!file) {
    return (
      <div className="file-editor" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        Select a file to edit
      </div>
    );
  }

  return (
    <div className="file-editor">
      <div className="file-editor-header">
        <h3><span style={{ color: 'var(--text-muted)' }}>{'\u2666'}</span> {file.name}</h3>
      </div>
      <div className="file-editor-body">
        <textarea
          value={file.content || ''}
          onChange={e => onUpdateContent(file.id, e.target.value)}
          placeholder="Start writing..."
          spellCheck={false}
        />
      </div>
    </div>
  );
}
