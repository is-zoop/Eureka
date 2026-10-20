import { TOOL_PRESET_VALUES, type ToolPreset } from "./tool-presets";

export interface SessionToolPermissions {
  sessionId: string;
  preset: ToolPreset;
  pendingPreset: ToolPreset | null;
  locked: boolean;
  busy: boolean;
  loading: boolean;
  ready: boolean;
  saving: boolean;
  load: () => Promise<void>;
  change: (preset: ToolPreset) => Promise<void>;
}

export function toolPermissionOptions(t: (key: string) => string) {
  return TOOL_PRESET_VALUES.map((value) => ({ value, label: t(`toolPermissions.preset.${value}`), description: t(`toolPermissions.description.${value}`) }));
}
