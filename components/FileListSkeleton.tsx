import { Skeleton } from "./ui/skeleton";

const nameWidths = ["52%", "38%", "64%", "45%", "58%", "34%", "48%"];

export function FileListSkeleton({ label, rows = 7 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-slot="file-list-skeleton">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-7 min-w-0 items-center gap-2 px-2">
          <Skeleton className="size-[18px] shrink-0 rounded bg-[var(--border)] motion-reduce:animate-none" />
          <Skeleton className="h-3 rounded bg-[var(--border)] motion-reduce:animate-none" style={{ width: nameWidths[index % nameWidths.length] }} />
        </div>
      ))}
    </div>
  );
}
