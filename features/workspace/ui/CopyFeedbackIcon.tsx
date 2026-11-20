export function CopyFeedbackIcon({ copied, size = 12 }: { copied: boolean; size?: number }) {
  return <span className="copy-feedback-icon" data-copied={copied} aria-hidden="true">
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {copied ? <polyline points="20 6 9 17 4 12" /> : <><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}
    </svg>
  </span>;
}
