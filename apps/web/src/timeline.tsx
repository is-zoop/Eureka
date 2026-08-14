import { ToolCard } from "./tool-card.js";
import type { TimelineRow } from "./ui-utils.js";
export function Timeline({ rows }: { rows: TimelineRow[] }) { return <div className="timeline">{rows.length ? rows.map((row) => row.kind === "tool" ? <ToolCard key={row.id} text={row.text} /> : <article key={`${row.kind}-${row.id}`} className={`message ${row.kind}`}><b>{row.kind}</b><pre>{row.text}</pre></article>) : <div className="empty-chat">Ask Pi a coding question to begin.</div>}</div>; }
