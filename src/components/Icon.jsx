// Shared SVG icon registry. Same stroke style as ToolExecutionCard's StepIcon
// so coworker avatars, file/tool indicators, and workflow visuals share one taxonomy.

const PATHS = {
  user: <><circle cx="8" cy="5" r="2.5" /><path d="M3 14c0-3 2.5-5 5-5s5 2 5 5" /></>,
  users: <><circle cx="6" cy="6" r="2" /><circle cx="11.5" cy="6.5" r="1.5" /><path d="M2 14c0-2.5 2-4 4-4s4 1.5 4 4" /><path d="M10 12c0.5-1.5 1.8-2.3 3-2.3" /></>,
  search: <><circle cx="7" cy="7" r="3.5" /><line x1="9.5" y1="9.5" x2="13" y2="13" /></>,
  chart: <><line x1="2.5" y1="13" x2="13.5" y2="13" /><rect x="4" y="8" width="1.8" height="5" /><rect x="7.1" y="5" width="1.8" height="8" /><rect x="10.2" y="9" width="1.8" height="4" /></>,
  document: <><path d="M3 2h6l4 4v8H3V2z" /><line x1="5" y1="7" x2="11" y2="7" /><line x1="5" y1="9.5" x2="11" y2="9.5" /><line x1="5" y1="12" x2="9" y2="12" /></>,
  shield: <><path d="M8 2l5 2v4c0 3-2.2 5.5-5 6-2.8-0.5-5-3-5-6V4l5-2z" /></>,
  code: <><polyline points="5,5 2,8 5,11" /><polyline points="11,5 14,8 11,11" /><line x1="9.5" y1="4" x2="7" y2="12" /></>,
  scales: <><line x1="8" y1="3" x2="8" y2="13" /><line x1="4" y1="13" x2="12" y2="13" /><path d="M4 7l-2 3h4l-2-3z" /><path d="M12 7l-2 3h4l-2-3z" /><line x1="4" y1="7" x2="12" y2="7" /></>,
  target: <><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="3" /><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" /></>,
  bulb: <><path d="M5.5 9.5c-1-0.7-1.5-1.8-1.5-3a4 4 0 018 0c0 1.2-0.5 2.3-1.5 3v1.5h-5V9.5z" /><line x1="6" y1="13" x2="10" y2="13" /><line x1="6.5" y1="14.5" x2="9.5" y2="14.5" /></>,
  package: <><path d="M2.5 5l5.5-2.5L13.5 5v6L8 13.5 2.5 11V5z" /><polyline points="2.5,5 8,7.5 13.5,5" /><line x1="8" y1="7.5" x2="8" y2="13.5" /></>,
  globe: <><circle cx="8" cy="8" r="5.5" /><ellipse cx="8" cy="8" rx="2.5" ry="5.5" /><line x1="2.5" y1="8" x2="13.5" y2="8" /></>,
  alert: <><path d="M8 2L14 13H2L8 2z" /><line x1="8" y1="6" x2="8" y2="9.5" /><circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" /></>,
  gavel: <><rect x="2" y="11" width="8" height="2" rx="0.5" /><line x1="6" y1="11" x2="9.5" y2="7.5" /><rect x="8.5" y="3.5" width="4.5" height="3" rx="0.5" transform="rotate(45 10.75 5)" /></>,
  wallet: <><rect x="2" y="5" width="12" height="8" rx="1.5" /><path d="M10.5 9h2.5" /><circle cx="11.5" cy="9" r="0.8" fill="currentColor" stroke="none" /><path d="M2 5c0-1.5 1-2.5 2.5-2.5H11" /></>,
  checklist: <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><polyline points="5,6.5 6.2,7.7 8,5.5" /><line x1="9.5" y1="6.5" x2="11.5" y2="6.5" /><polyline points="5,10.5 6.2,11.7 8,9.5" /><line x1="9.5" y1="10.5" x2="11.5" y2="10.5" /></>,
};

export const COWORKER_ICONS = [
  'user', 'users', 'search', 'chart', 'document', 'shield',
  'code', 'scales', 'target', 'bulb', 'package', 'globe',
  'alert', 'gavel', 'wallet', 'checklist',
];

export function hasIcon(id) {
  return !!PATHS[id];
}

// Renders whatever a coworker has stored in `avatar`: data-URL image, `icon:*` id,
// legacy emoji, or nothing (falls back to the default user icon).
export function CoworkerGlyph({ avatar, size = 16, color = 'currentColor', strokeWidth = 1.6, style }) {
  if (typeof avatar === 'string' && avatar.startsWith('data:')) {
    return <img src={avatar} alt="" style={{ width: size, height: size, borderRadius: Math.round(size / 4), objectFit: 'cover', ...style }} />;
  }
  if (typeof avatar === 'string' && avatar.startsWith('icon:') && PATHS[avatar.slice(5)]) {
    return <Icon name={avatar.slice(5)} size={size} color={color} strokeWidth={strokeWidth} style={style} />;
  }
  return <Icon name="user" size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}

export default function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.5, style }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {path}
    </svg>
  );
}
