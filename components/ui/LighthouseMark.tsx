// THE MARK (2026-10-02 rebrand). The lighthouse reduced to three strokes: a tapered tower, two
// beams, one brass lamp. Ink and brass follow the theme (currentColor + brand-500), so the same
// component is right in the rail, the phone bar and the sign-in page, in either theme.
export function LighthouseMark({ size = 22, className = '', lamp }: { size?: number; className?: string; lamp?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" fill="none" aria-hidden="true" className={'shrink-0 text-ink ' + className}>
      <circle cx="11" cy="4.5" r="2.5" fill={lamp || 'rgb(var(--c-brand-500))'} />
      <path d="M1.5 4.5h4.6M15.9 4.5h4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8.3 8.2h5.4l2.1 12.3H6.2z" fill="currentColor" />
    </svg>
  )
}
