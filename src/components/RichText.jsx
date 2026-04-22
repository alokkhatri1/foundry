// Lightweight markdown → React renderer for chat messages.
// Handles: headings, bold, italic, inline code, code blocks, lists, paragraphs.

function formatInline(text) {
  if (!text) return text;
  const segments = [];
  // Order matters: bold (**) before italic (*), and code (`) captured separately
  const regex = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push(text.slice(lastIndex, match.index));
    }
    if (match[2]) {
      segments.push(<strong key={key++}>{match[2]}</strong>);
    } else if (match[3]) {
      segments.push(<code key={key++} className="rt-inline-code">{match[3]}</code>);
    } else if (match[4]) {
      segments.push(<em key={key++}>{match[4]}</em>);
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push(text.slice(lastIndex));
  }

  return segments.length > 0 ? segments : text;
}

export default function RichText({ content }) {
  if (!content) return null;

  const lines = content.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.trimStart().startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', content: codeLines.join('\n') });
      i++; // skip closing ```
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, content: headingMatch[2] });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-—*]{3,}\s*$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    // Unordered list — tolerate single blank lines between items so
    // Claude's loose-style output renders as one list, not fragmented ones.
    if (/^\s*[-*]\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*[-*]\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
          i++;
        } else if (lines[i].trim() === '' && i + 1 < lines.length && /^\s*[-*]\s/.test(lines[i + 1])) {
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ul', items });
      continue;
    }

    // Ordered list — same loose-list tolerance as above. Without this,
    // blank-line-separated items each become their own <ol> and every
    // marker restarts at "1.".
    if (/^\s*\d+\.\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        if (/^\s*\d+\.\s/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        } else if (lines[i].trim() === '' && i + 1 < lines.length && /^\s*\d+\.\s/.test(lines[i + 1])) {
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'ol', items });
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-special lines
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^#{1,4}\s/) &&
      !lines[i].trimStart().startsWith('```') &&
      !/^\s*[-*]\s/.test(lines[i]) &&
      !/^\s*\d+\.\s/.test(lines[i]) &&
      !/^[-—*]{3,}\s*$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', content: paraLines.join('\n') });
    }
  }

  return (
    <div className="rt">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'heading': {
            const Tag = `h${Math.min(block.level, 4)}`;
            return <Tag key={idx} className={`rt-h rt-h${block.level}`}>{formatInline(block.content)}</Tag>;
          }
          case 'ul':
            return (
              <ul key={idx} className="rt-ul">
                {block.items.map((item, j) => <li key={j}>{formatInline(item)}</li>)}
              </ul>
            );
          case 'ol':
            return (
              <ol key={idx} className="rt-ol">
                {block.items.map((item, j) => <li key={j}>{formatInline(item)}</li>)}
              </ol>
            );
          case 'code':
            return <pre key={idx} className="rt-pre"><code>{block.content}</code></pre>;
          case 'hr':
            return <hr key={idx} className="rt-hr" />;
          case 'paragraph':
            return <p key={idx} className="rt-p">{formatInline(block.content)}</p>;
          default:
            return null;
        }
      })}
    </div>
  );
}
