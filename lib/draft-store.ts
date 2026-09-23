import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

/** A project file or directory selected through the composer UI. */
export interface ChatDraftReference {
  path: string;
  isDir: boolean;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  references?: ChatDraftReference[];
}

const drafts = new Map<string, ChatDraft>();

function cloneDraft(draft: ChatDraft): ChatDraft {
  const references = (draft.references ?? []).map((reference) => ({ ...reference }));
  return {
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(references.length ? { references } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !draft.value && draft.images.length === 0 && (draft.references?.length ?? 0) === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  return draft ? cloneDraft(draft) : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
}

export function mergeRestoredSubmissionText(submitted: string, current: string): string {
  if (!submitted.trim()) return current;
  if (!current.trim()) return submitted;
  return `${submitted}\n\n${current}`;
}

export function mergeRestoredSubmissionDraft(
  submittedText: string,
  submittedImages: ChatDraftImage[] | undefined,
  currentText: string,
  currentImages: ChatDraftImage[],
  submittedReferences?: ChatDraftReference[],
  currentReferences: ChatDraftReference[] = [],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    value: mergeRestoredSubmissionText(submittedText, currentText),
    images,
    ...(dedupeReferences([...(submittedReferences ?? []), ...(currentReferences ?? [])]).length
      ? { references: dedupeReferences([...(submittedReferences ?? []), ...(currentReferences ?? [])]) }
      : {}),
  };
}

export function dedupeReferences(references: ChatDraftReference[]): ChatDraftReference[] {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = `${reference.isDir ? "dir" : "file"}:${reference.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((reference) => ({ ...reference }));
}

export function restoreDraftSubmission(
  key: string,
  text: string,
  images?: ChatDraftImage[],
  references?: ChatDraftReference[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [], references: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
    references,
    current.references,
  );
  setDraft(key, restored);
  return restored;
}

export function rekeyDraft(
  previousKey: string,
  nextKey: string,
  currentDraft?: ChatDraft,
): ChatDraft | null {
  if (previousKey === nextKey) return currentDraft ? cloneDraft(currentDraft) : getDraft(nextKey);

  const storedPrevious = getDraft(previousKey);
  const previous = currentDraft && !isEmptyDraft(currentDraft)
    ? cloneDraft(currentDraft)
    : (storedPrevious ?? (currentDraft ? cloneDraft(currentDraft) : null));
  const next = getDraft(nextKey);
  clearDraft(previousKey);
  if (!previous) return next;

  const merged = next
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images, next.references, previous.references)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
