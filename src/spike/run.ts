import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { EventJournal } from "./event-journal.js";

interface Options {
  workspace: string;
  prompt: string;
  abortAfterMs?: number;
  dryRun: boolean;
}

function parseOptions(argv: string[]): Options {
  const valueAfter = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const abortAfter = valueAfter("--abort-after-ms");
  const parsedAbortAfterMs = abortAfter === undefined ? undefined : Number.parseInt(abortAfter, 10);
  if (parsedAbortAfterMs !== undefined && (!Number.isFinite(parsedAbortAfterMs) || parsedAbortAfterMs <= 0)) {
    throw new Error("--abort-after-ms must be a positive integer.");
  }

  return {
    workspace: path.resolve(valueAfter("--workspace") ?? process.cwd()),
    prompt:
      valueAfter("--prompt") ??
      "Use the read tool exactly once to inspect PRD.md. Do not modify any files. Then state the document title in one sentence.",
    abortAfterMs: parsedAbortAfterMs,
    dryRun: argv.includes("--dry-run"),
  };
}

const options = parseOptions(process.argv.slice(2));
const journal = new EventJournal();
let receivedEvents = 0;

const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
  const services = await createAgentSessionServices({ cwd });
  return {
    ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
    services,
    diagnostics: services.diagnostics,
  };
};

const runtime = await createAgentSessionRuntime(createRuntime, {
  cwd: options.workspace,
  agentDir: getAgentDir(),
  sessionManager: SessionManager.inMemory(options.workspace),
});

console.log(`[spike] Runtime created for workspace: ${options.workspace}`);
console.log(`[spike] Initial session: ${runtime.session.sessionId}`);

let unsubscribe = runtime.session.subscribe((event) => {
  receivedEvents += 1;
  journal.record(event);
  console.log(`[pi:${event.type}]`);

  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
  if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
    process.stdout.write(`[thinking] ${event.assistantMessageEvent.delta}`);
  }
});

let abortTimer: NodeJS.Timeout | undefined;
let abortRequested = false;
let abortPromise: Promise<void> | undefined;

if (options.dryRun) {
  console.log("[spike] Dry run: skipping prompt; no workspace content is sent to a model provider.");
} else {
  try {
    if (options.abortAfterMs !== undefined) {
      abortTimer = setTimeout(() => {
        console.log("\n[spike] Abort requested.");
        abortRequested = true;
        abortPromise = runtime.session.abort();
      }, options.abortAfterMs);
    }

    await runtime.session.prompt(options.prompt);
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer);
    await abortPromise;
  }
}

const originalSessionId = runtime.session.sessionId;
unsubscribe();
await runtime.newSession();
const replacementSessionId = runtime.session.sessionId;
let replacementEvents = 0;
unsubscribe = runtime.session.subscribe((event) => {
  replacementEvents += 1;
  journal.record(event);
  console.log(`[pi:replacement:${event.type}]`);
});

const assertions = {
  runtimeCreated: Boolean(originalSessionId),
  promptProducedEvents: options.dryRun || receivedEvents > 0,
  sessionWasReplaced: originalSessionId !== replacementSessionId,
  replacementSubscriptionAttached: typeof unsubscribe === "function",
  abortRequested,
  abortSettled: !abortRequested || (!runtime.session.isStreaming && journal.has("agent_end")),
  replacementEventsObserved: replacementEvents > 0,
};

const reportDirectory = path.join(options.workspace, "reports");
const reportPath = path.join(reportDirectory, "pi-event-shape.json");
await mkdir(reportDirectory, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(journal.toReport(assertions), null, 2)}\n`, "utf8");
unsubscribe();
runtime.session.dispose();

console.log(`\n[spike] Event-shape report written to ${reportPath}`);
console.log(`[spike] Assertions: ${JSON.stringify(assertions)}`);

if (!assertions.promptProducedEvents || !assertions.sessionWasReplaced) {
  process.exitCode = 1;
}
