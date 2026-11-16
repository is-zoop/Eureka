export async function register(): Promise<void> {
  // Next compiles this hook for both Node and Edge. Keep the import inside the
  // positive guard so Webpack excludes Node-only dependencies from Edge builds.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
    configureHttpDispatcher();
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { startAutomationScheduler } = await import("@/lib/automation-scheduler");
      startAutomationScheduler();
    }
  }
}
