import { dedupePlugins, retainedPluginSelection, type SelectedPlugin } from "./plugin-selection";
import {
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "./image-attachments";

export interface ChatDraftImage {
  data: string;
  mimeType: string;
}

/** A project reference or explicitly attached local file/directory. */
export interface ChatDraftReference {
  path: string;
  isDir: boolean;
}

export interface ChatDraft {
  value: string;
  images: ChatDraftImage[];
  references?: ChatDraftReference[];
  selectedPlugins?: SelectedPlugin[];
}

const drafts = new Map<string, ChatDraft>();
const PLUGIN_SELECTION_PREFIX = "eureka-plugin-selection:";
function readPersistentPlugins(key: string): SelectedPlugin[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(PLUGIN_SELECTION_PREFIX + key);
    if (!raw || raw.length > 50_000) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.length > 20) return [];
    return retainedPluginSelection(value.filter((item) => item && [item.source, item.capabilityId, item.digest, item.name, item.subject].every((v) => typeof v === "string")
      && item.selectionMode === "persistent").map(({ source, capabilityId, digest, name, subject, selectionMode }) => ({ source, capabilityId, digest, name, subject, selectionMode })));
  } catch { return []; }
}
function persistPlugins(key: string, plugins: SelectedPlugin[] = []): void {
  try {
    if (typeof window === "undefined") return;
    const retained = retainedPluginSelection(plugins).map(({ source, capabilityId, digest, name, selectionMode, subject }) => ({ source, capabilityId, digest, name, selectionMode, subject }));
    const storageKey = PLUGIN_SELECTION_PREFIX + key;
    if (retained.length) {
      const value = JSON.stringify(retained);
      if (window.localStorage.getItem(storageKey) !== value) window.localStorage.setItem(storageKey, value);
    } else window.localStorage.removeItem(storageKey);
  } catch { /* Device storage can be unavailable; the live composer still works. */ }
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  const references = (draft.references ?? []).map((reference) => ({ ...reference }));
  return {
    ...(draft.selectedPlugins?.length ? { selectedPlugins: dedupePlugins(draft.selectedPlugins) } : {}),
    value: draft.value,
    images: draft.images.map((image) => ({ ...image })),
    ...(references.length ? { references } : {}),
  };
}

function isEmptyDraft(draft: ChatDraft): boolean {
  return !(draft.selectedPlugins?.length) && !draft.value && draft.images.length === 0 && (draft.references?.length ?? 0) === 0;
}

export function getDraft(key: string): ChatDraft | null {
  const draft = drafts.get(key);
  if (draft) return cloneDraft(draft);
  const selectedPlugins = readPersistentPlugins(key);
  return selectedPlugins.length ? { value: "", images: [], selectedPlugins } : null;
}

export function setDraft(key: string, draft: ChatDraft): void {
  persistPlugins(key, draft.selectedPlugins);
  if (isEmptyDraft(draft)) {
    drafts.delete(key);
    return;
  }
  drafts.set(key, cloneDraft(draft));
}

export function clearDraft(key: string): void {
  drafts.delete(key);
  persistPlugins(key);
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
  submittedPlugins: SelectedPlugin[] = [],
  currentPlugins: SelectedPlugin[] = [],
): ChatDraft {
  const images = [...(submittedImages ?? []), ...currentImages]
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(({ data, mimeType }) => ({ data, mimeType }));

  return {
    ...([...submittedPlugins, ...currentPlugins].length ? { selectedPlugins: dedupePlugins([...submittedPlugins, ...currentPlugins]) } : {}),
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
  selectedPlugins?: SelectedPlugin[],
): ChatDraft {
  const current = getDraft(key) ?? { value: "", images: [], references: [] };
  const restored = mergeRestoredSubmissionDraft(
    text,
    images,
    current.value,
    current.images,
    references,
    current.references,
    selectedPlugins,
    current.selectedPlugins,
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
    ? mergeRestoredSubmissionDraft(next.value, next.images, previous.value, previous.images, next.references, previous.references, next.selectedPlugins, previous.selectedPlugins)
    : previous;
  setDraft(nextKey, merged);
  return cloneDraft(merged);
}
