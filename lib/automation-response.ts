/** Keep HTTP status available to callers that distinguish rejected from uncertain starts. */
export class AutomationRequestError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "AutomationRequestError"; }
}

/** A failed read does not imply that a start request was submitted. */
export function automationRequestErrorKey(error: unknown, operation: "read" | "write" | "start") {
  if (error instanceof Error && error.name === "TimeoutError") {
    return operation === "start" ? "automationUi.startTimeout" : operation === "read" ? "automationUi.reconnecting" : "automationUi.operationTimeout";
  }
  if (operation === "read" && error instanceof TypeError) return "automationUi.reconnecting";
  return null;
}

/** HTML error pages must never become parser errors or leak their contents into the UI. */
export async function readAutomationResponse<T>(response: Response, fallback: string, invalid: string): Promise<T> {
  if (!/^application\/(?:[\w.-]+\+)?json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new AutomationRequestError(invalid, response.status);
  }
  let data: T;
  try { data = await response.json() as T; }
  catch (error) {
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) throw error;
    throw new AutomationRequestError(invalid, response.status);
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : fallback;
    throw new AutomationRequestError(message, response.status);
  }
  return data;
}
