import contract from "./automation-sdk-contract.json";
/** Business data budgets are separate from configuration and model evidence.
 * Leave room for the response envelope/JSON escaping and the 24 MiB worker IPC. */
export const APP_HTTP_RESPONSE_MAX_BYTES = contract.limits.httpResponseBytes;
// Base64 + metadata must remain inside the existing 20 MiB browser envelope.
export const APP_DOWNLOAD_MAX_BYTES = contract.limits.legacyDownloadBytes;
export const APP_EXECUTION_VALUE_MAX_BYTES = contract.limits.executionValueBytes;
export const APP_BROWSER_POST_MAX_BYTES = APP_EXECUTION_VALUE_MAX_BYTES + 64 * 1024;

export const APP_ZIP_FILE_MAX_BYTES = contract.limits.zipFileBytes;
export const APP_ZIP_EXPANDED_MAX_BYTES = contract.limits.zipExpandedBytes;
