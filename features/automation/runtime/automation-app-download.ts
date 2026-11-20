import { APP_DOWNLOAD_MAX_BYTES } from "../shared/automation-data-limits";
import { stat } from "node:fs/promises";
import type { AppFileOperations } from "./automation-app-files";
import contract from "../sdk/automation-sdk-contract.json";

export async function streamAppDownload(files: AppFileOperations, ref: unknown, overwrite: boolean, rawOptions: unknown,
  invoke: (stream: { path: string; maxBytes: number; timeoutMs: number }) => Promise<unknown>, progress: (bytes: number) => Promise<void> = async () => {}) {
  const options = (rawOptions ?? {}) as { maxBytes?: number; timeoutMs?: number; sha256?: string };
  if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(key => !["maxBytes", "timeoutMs", "sha256"].includes(key))) throw new Error("下载选项无效。");
  const maxBytes = options.maxBytes ?? contract.limits.downloadBytes, timeoutMs = options.timeoutMs ?? contract.limits.downloadTimeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > contract.limits.maxDownloadTimeoutMs || options.sha256 !== undefined && (typeof options.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(options.sha256))) throw new Error("下载超时或 SHA256 选项无效。");
  const stage = await files.stage(ref, overwrite, maxBytes); let previous = -1;
  const timer = setInterval(() => { void stat(stage.path).then(info => { if (info.size !== previous) { previous = info.size; return progress(info.size); } }).catch(() => {}); }, 2000);
  try {
    const response = await invoke({ path: stage.path, maxBytes, timeoutMs }) as { status?: number; data?: { encoding?: string; bytes?: number; contentType?: string } };
    if (!Number.isInteger(response?.status) || response.status! < 200 || response.status! >= 300) throw new Error("下载未返回完整的成功响应。");
    let bytes: number;
    if (response.data?.encoding === "file") {
      if (!Number.isSafeInteger(response.data.bytes) || response.data.bytes! < 0 || response.data.bytes! > maxBytes) throw new Error("下载字节数无效。"); bytes = response.data.bytes!;
    } else {
      // Old native binaries can still return small downloads. Large downloads
      // require the new streaming native host; never loosen IPC envelope limits.
      const legacy = appDownloadData(response), buffer = Buffer.from(legacy.base64, "base64"); bytes = legacy.bytes;
      for (let offset = 0; offset < buffer.length; offset += contract.limits.fileChunkBytes) await stage.append(buffer.subarray(offset, offset + contract.limits.fileChunkBytes));
    }
    const saved = await stage.commit({ bytes, sha256: options.sha256 });
    return { ref, ...saved, status: response.status, contentType: response.data?.contentType ?? "application/octet-stream" };
  } finally { clearInterval(timer); await stage.abort(); }
}

export function appDownloadData(result:unknown){
  const response=result as {status?:number;data?:{encoding?:string;base64?:string;bytes?:number;contentType?:string}}|null;
  const data=response?.data,status=response?.status,size=data?.bytes;
  if(typeof status!=="number"||!Number.isInteger(status)||status<200||status>=300||!data||data.encoding!=="base64"||typeof data.base64!=="string"||data.base64.length>Math.ceil(APP_DOWNLOAD_MAX_BYTES/3)*4||typeof size!=="number"||!Number.isSafeInteger(size)||size<0||size>APP_DOWNLOAD_MAX_BYTES)throw new Error("下载没有返回完整、有效的二进制响应；未保存文件。");
  const bytes=Buffer.from(data.base64,"base64");
  if(bytes.length!==size||bytes.toString("base64")!==data.base64)throw new Error("下载内容或长度校验失败；未保存文件。");
  return {base64:data.base64,bytes:bytes.length,status,contentType:typeof data.contentType==="string"?data.contentType:"application/octet-stream"};
}
