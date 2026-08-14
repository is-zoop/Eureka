import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

const IdentifierSchema = z.string().trim().min(1);
const JsonValueSchema = z.json();
const RelativePathSchema = z.string().min(1).max(1024).refine((value) => !value.startsWith("/") && !value.includes("\\") && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".."), "Expected a safe relative POSIX path.");

export const AgentPhaseSchema = z.enum(["idle", "running", "compacting", "retrying", "error"]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

export const WebErrorSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().trim().min(1),
    recoverable: z.boolean(),
    details: JsonValueSchema.optional(),
  })
  .strict();
export type WebError = z.infer<typeof WebErrorSchema>;

export const WebModelSchema = z
  .object({
    provider: IdentifierSchema,
    id: IdentifierSchema,
    name: z.string().trim().min(1),
    supportsThinking: z.boolean(),
    contextWindow: z.number().int().positive().optional(),
  })
  .strict();
export type WebModel = z.infer<typeof WebModelSchema>;

export const WebToolExecutionSchema = z
  .object({
    id: IdentifierSchema,
    name: IdentifierSchema,
    input: JsonValueSchema,
    status: z.enum(["running", "success", "error"]),
    output: JsonValueSchema.optional(),
    startedAt: z.number().int().nonnegative().optional(),
    finishedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export type WebToolExecution = z.infer<typeof WebToolExecutionSchema>;

export const WebMessageSchema = z
  .object({
    id: IdentifierSchema,
    role: z.enum(["user", "assistant", "system"]),
    content: JsonValueSchema,
    createdAt: z.number().int().nonnegative(),
    isError: z.boolean().optional(),
  })
  .strict();
export type WebMessage = z.infer<typeof WebMessageSchema>;

export const WebContextUsageSchema = z
  .object({
    usedTokens: z.number().int().nonnegative().optional(),
    maxTokens: z.number().int().positive().optional(),
    percentage: z.number().min(0).max(100).optional(),
  })
  .strict();
export type WebContextUsage = z.infer<typeof WebContextUsageSchema>;

export const WebUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cacheReadTokens: z.number().int().nonnegative().optional(),
    cacheWriteTokens: z.number().int().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
  })
  .strict();
export type WebUsage = z.infer<typeof WebUsageSchema>;

export const SessionSnapshotSchema = z
  .object({
    sessionId: IdentifierSchema,
    sessionName: z.string().trim().min(1).optional(),
    cwd: z.string().trim().min(1),
    phase: AgentPhaseSchema,
    model: WebModelSchema.optional(),
    thinkingLevel: IdentifierSchema,
    availableModels: z.array(WebModelSchema).optional(),
    availableThinkingLevels: z.array(IdentifierSchema).optional(),
    messages: z.array(WebMessageSchema),
    context: WebContextUsageSchema.optional(),
    usage: WebUsageSchema.optional(),
  })
  .strict();
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export const WebSessionSummarySchema=z.object({id:IdentifierSchema,name:z.string().optional(),createdAt:z.number().int().nonnegative(),modifiedAt:z.number().int().nonnegative(),messageCount:z.number().int().nonnegative(),preview:z.string()}).strict();
export type WebSessionSummary=z.infer<typeof WebSessionSummarySchema>;
export const WebFileEntrySchema = z.object({ path: RelativePathSchema, name: z.string().min(1), kind: z.enum(["file", "directory"]), size: z.number().int().nonnegative().optional(), modifiedAt: z.number().int().nonnegative() }).strict();
export type WebFileEntry = z.infer<typeof WebFileEntrySchema>;
export const WebFilePreviewSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), path: RelativePathSchema, content: z.string(), truncated: z.boolean() }).strict(),
  z.object({ kind: z.literal("image"), path: RelativePathSchema, mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]), data: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),
  z.object({ kind: z.literal("unavailable"), path: RelativePathSchema, reason: z.enum(["binary", "too_large", "unsupported"]) }).strict(),
]);
export type WebFilePreview = z.infer<typeof WebFilePreviewSchema>;

const ImageAttachmentSchema = z
  .object({
    mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  data: z.string().max(27_962_028).regex(/^[A-Za-z0-9+/]+={0,2}$/, "Expected base64 image data."),
  })
  .strict();

const CommandBaseSchema = z.object({ id: IdentifierSchema }).strict();
export const PromptCommandSchema = CommandBaseSchema.extend({
  type: z.literal("prompt"),
  text: z.string().trim().min(1),
  images: z.array(ImageAttachmentSchema).optional(),
}).strict();
export const AbortCommandSchema = CommandBaseSchema.extend({ type: z.literal("abort") }).strict();
export const SetModelCommandSchema = CommandBaseSchema.extend({
  type: z.literal("set_model"),
  provider: IdentifierSchema,
  modelId: IdentifierSchema,
}).strict();
export const SetThinkingLevelCommandSchema = CommandBaseSchema.extend({
  type: z.literal("set_thinking_level"),
  level: IdentifierSchema,
}).strict();
export const CompactCommandSchema = CommandBaseSchema.extend({
  type: z.literal("compact"),
  instructions: z.string().trim().min(1).optional(),
}).strict();
export const NewSessionCommandSchema = CommandBaseSchema.extend({ type: z.literal("new_session") }).strict();
export const ListSessionsCommandSchema = CommandBaseSchema.extend({ type: z.literal("list_sessions") }).strict();
export const ListFilesCommandSchema = CommandBaseSchema.extend({ type: z.literal("list_files"), path: RelativePathSchema.optional() }).strict();
export const ReadFileCommandSchema = CommandBaseSchema.extend({ type: z.literal("read_file"), path: RelativePathSchema }).strict();
export const SwitchSessionCommandSchema = CommandBaseSchema.extend({
  type: z.literal("switch_session"),
  sessionId: IdentifierSchema,
}).strict();

export const ClientCommandSchema = z.discriminatedUnion("type", [
  PromptCommandSchema,
  AbortCommandSchema,
  SetModelCommandSchema,
  SetThinkingLevelCommandSchema,
  CompactCommandSchema,
  NewSessionCommandSchema,
  ListSessionsCommandSchema,
  ListFilesCommandSchema,
  ReadFileCommandSchema,
  SwitchSessionCommandSchema,
]);
export type ClientCommand = z.infer<typeof ClientCommandSchema>;

const ConnectedEventSchema = z
  .object({ type: z.literal("connected"), protocolVersion: z.literal(PROTOCOL_VERSION), sessionId: IdentifierSchema })
  .strict();
const AcceptedCommandAckSchema = z
  .object({ type: z.literal("command_ack"), commandId: IdentifierSchema, accepted: z.literal(true) })
  .strict();
const RejectedCommandAckSchema = z
  .object({ type: z.literal("command_ack"), commandId: IdentifierSchema, accepted: z.literal(false), error: WebErrorSchema })
  .strict();
export const CommandAckEventSchema = z.discriminatedUnion("accepted", [AcceptedCommandAckSchema, RejectedCommandAckSchema]);
const SnapshotEventSchema = z.object({ type: z.literal("snapshot"), snapshot: SessionSnapshotSchema }).strict();
const SessionsEventSchema=z.object({type:z.literal("sessions"),sessions:z.array(WebSessionSummarySchema)}).strict();
const FileListEventSchema = z.object({ type: z.literal("file_list"), path: RelativePathSchema.optional(), entries: z.array(WebFileEntrySchema) }).strict();
const FilePreviewEventSchema = z.object({ type: z.literal("file_preview"), preview: WebFilePreviewSchema }).strict();
const MessageStartEventSchema = z
  .object({ type: z.literal("message_start"), messageId: IdentifierSchema, role: z.enum(["assistant", "user", "system"]) })
  .strict();
const MessageDeltaEventSchema = z
  .object({ type: z.literal("message_delta"), messageId: IdentifierSchema, delta: z.string().min(1) })
  .strict();
const ThinkingDeltaEventSchema = z
  .object({ type: z.literal("thinking_delta"), messageId: IdentifierSchema, delta: z.string().min(1) })
  .strict();
const MessageEndEventSchema = z.object({ type: z.literal("message_end"), message: WebMessageSchema }).strict();
const ToolStartEventSchema = z
  .object({ type: z.literal("tool_start"), tool: WebToolExecutionSchema.extend({ status: z.literal("running") }) })
  .strict();
const ToolUpdateEventSchema = z
  .object({ type: z.literal("tool_update"), toolId: IdentifierSchema, delta: z.string().optional(), output: JsonValueSchema.optional() })
  .strict()
  .refine((event) => event.delta !== undefined || event.output !== undefined, "Tool update requires delta or output.");
const ToolEndEventSchema = z
  .object({ type: z.literal("tool_end"), toolId: IdentifierSchema, success: z.boolean(), output: JsonValueSchema.optional(), finishedAt: z.number().int().nonnegative().optional(), error: WebErrorSchema.optional() })
  .strict()
  .superRefine((event, context) => {
    if (event.success && event.error !== undefined) context.addIssue({ code: "custom", message: "Successful tool events cannot include an error." });
    if (!event.success && event.error === undefined) context.addIssue({ code: "custom", message: "Failed tool events require an error." });
  });
const AgentStatusEventSchema = z.object({ type: z.literal("agent_status"), phase: AgentPhaseSchema }).strict();
const UsageEventSchema = z.object({ type: z.literal("usage"), usage: WebUsageSchema, context: WebContextUsageSchema.optional() }).strict();
const ErrorEventSchema = z.object({ type: z.literal("error"), error: WebErrorSchema }).strict();

export const ServerEventSchema = z.union([
  ConnectedEventSchema,
  CommandAckEventSchema,
  SnapshotEventSchema,
  SessionsEventSchema,
  FileListEventSchema,
  FilePreviewEventSchema,
  MessageStartEventSchema,
  MessageDeltaEventSchema,
  ThinkingDeltaEventSchema,
  MessageEndEventSchema,
  ToolStartEventSchema,
  ToolUpdateEventSchema,
  ToolEndEventSchema,
  AgentStatusEventSchema,
  UsageEventSchema,
  ErrorEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;

export type ProtocolParseResult<T> = { success: true; data: T } | { success: false; error: WebError };

function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): ProtocolParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return result;

  return {
    success: false,
    error: {
      code: "invalid_protocol_payload",
      message: "The WebSocket payload does not match the protocol schema.",
      recoverable: true,
      details: result.error.issues.map((issue) => ({ code: issue.code, path: issue.path.join("."), message: issue.message })),
    },
  };
}

export function parseClientCommand(input: unknown): ProtocolParseResult<ClientCommand> {
  return parseWithSchema(ClientCommandSchema, input);
}

export function parseServerEvent(input: unknown): ProtocolParseResult<ServerEvent> {
  return parseWithSchema(ServerEventSchema, input);
}

export function serializeClientCommand(command: ClientCommand): string {
  return JSON.stringify(ClientCommandSchema.parse(command));
}

export function serializeServerEvent(event: ServerEvent): string {
  return JSON.stringify(ServerEventSchema.parse(event));
}
