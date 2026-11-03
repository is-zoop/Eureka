"use client";

import { useEffect, useSyncExternalStore } from "react";
import { desktopUpdateController } from "@/lib/desktop-update-controller";

export function useDesktopUpdater() {
  const view = useSyncExternalStore(desktopUpdateController.subscribe, desktopUpdateController.getSnapshot, desktopUpdateController.getServerSnapshot);
  useEffect(() => desktopUpdateController.connect(), []);
  return { ...view, run: desktopUpdateController.run, runPrimary: desktopUpdateController.runPrimary };
}
