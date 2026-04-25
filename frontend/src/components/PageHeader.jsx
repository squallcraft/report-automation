const HEADER_STYLES = {
  wrapper: {
    background: 'linear-gradient(135deg, #1e3a5f 0%, #264a73 50%, #1e3a5f 100%)',
    borderRadius: 16,
    padding: '22px 32px',
    marginBottom: 20,
    position: 'relative',
    overflow: 'hidden',
    minHeight: 96,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 28,
  },
  meshOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse at 20% 50%, rgba(30,58,95,0.6) 0%, transparent 70%), radial-gradient(ellipse at 80% 20%, rgba(37,99,235,0.1) 0%, transparent 50%)',
    pointerEvents: 'none',
  },
  diagonalAccent: {
    position: 'absolute',
    top: 0, right: 0,
    width: '40%', height: '100%',
    background: 'linear-gradient(135deg, transparent 40%, rgba(255,255,255,0.03) 100%)',
    pointerEvents: 'none',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 24,
    position: 'relative',
    zIndex: 1,
    flex: 1,
    minWidth: 0,
  },
  iconBox: {
    width: 56, height: 56,
    borderRadius: 14,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  textBlock: { minWidth: 0, flex: 1 },
  title: {
    color: '#f1f5f9',
    fontSize: 33,
    fontWeight: 800,
    lineHeight: 1.15,
    margin: 0,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 15,
    marginTop: 6,
    lineHeight: 1.3,
  },
  badgeRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  badge: {
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.03em',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    position: 'relative',
    zIndex: 1,
    flexShrink: 0,
  },
  stat: {
    textAlign: 'right',
  },
  statValue: {
    color: '#f1f5f9',
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    marginTop: 3,
  },
}

const ACCENT_COLORS = {
  blue:   { bg: 'rgba(37,99,235,0.15)',   color: '#60a5fa', border: 'rgba(37,99,235,0.3)' },
  green:  { bg: 'rgba(22,163,74,0.15)',   color: '#4ade80', border: 'rgba(22,163,74,0.3)' },
  amber:  { bg: 'rgba(217,119,6,0.15)',   color: '#fbbf24', border: 'rgba(217,119,6,0.3)' },
  red:    { bg: 'rgba(220,38,38,0.15)',    color: '#f87171', border: 'rgba(220,38,38,0.3)' },
  purple: { bg: 'rgba(124,58,237,0.15)',   color: '#a78bfa', border: 'rgba(124,58,237,0.3)' },
  teal:   { bg: 'rgba(20,184,166,0.15)',   color: '#5eead4', border: 'rgba(20,184,166,0.3)' },
  slate:  { bg: 'rgba(100,116,139,0.15)',  color: '#94a3b8', border: 'rgba(100,116,139,0.3)' },
}

/**
 * @param {object}   props
 * @param {string}   props.title
 * @param {string}   [props.subtitle]
 * @param {import('lucide-react').LucideIcon} [props.icon]
 * @param {string}   [props.accent]       - blue | green | amber | red | purple | teal | slate
 * @param {Array<{label:string, color?:string}>}  [props.badges]
 * @param {Array<{label:string, value:string|number}>} [props.stats]
 * @param {React.ReactNode} [props.actions]  - buttons / controls on the right
 * @param {React.ReactNode} [props.children] - extra content row below title
 */
export default function PageHeader({
  title, subtitle, icon: Icon, accent = 'blue',
  badges, stats, actions, children,
}) {
  const ac = ACCENT_COLORS[accent] || ACCENT_COLORS.blue

  return (
    <div style={HEADER_STYLES.wrapper}>
      <div style={HEADER_STYLES.meshOverlay} />
      <div style={HEADER_STYLES.diagonalAccent} />

      <div style={HEADER_STYLES.left}>
        {Icon && (
          <div style={{ ...HEADER_STYLES.iconBox, background: ac.bg, border: `1px solid ${ac.border}` }}>
            <Icon size={26} style={{ color: ac.color }} />
          </div>
        )}
        <div style={HEADER_STYLES.textBlock}>
          <h1 style={HEADER_STYLES.title}>{title}</h1>
          {subtitle && <p style={HEADER_STYLES.subtitle}>{subtitle}</p>}
          {badges?.length > 0 && (
            <div style={HEADER_STYLES.badgeRow}>
              {badges.map((b, i) => {
                const bc = ACCENT_COLORS[b.color] || ACCENT_COLORS.slate
                return (
                  <span key={i} style={{
                    ...HEADER_STYLES.badge,
                    background: bc.bg,
                    color: bc.color,
                    border: `1px solid ${bc.border}`,
                  }}>
                    {b.label}
                  </span>
                )
              })}
            </div>
          )}
          {children}
        </div>
      </div>

      {(stats?.length > 0 || actions) && (
        <div style={HEADER_STYLES.right}>
          {stats?.map((s, i) => (
            <div key={i} style={HEADER_STYLES.stat}>
              <div style={HEADER_STYLES.statValue}>{s.value}</div>
              <div style={HEADER_STYLES.statLabel}>{s.label}</div>
            </div>
          ))}
          {actions}
        </div>
      )}
    </div>
  )
}
