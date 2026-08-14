import {
  type AgentSession,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

export class PiRuntimeManager {
  private runtime?: AgentSessionRuntime;
  private unsubscribe?: () => void;
  constructor(readonly workspace: string, private readonly onEvent: (event: unknown) => void) {}

  async initialize(): Promise<void> {
    const factory: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({ cwd });
      return { ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })), services, diagnostics: services.diagnostics };
    };
    this.runtime = await createAgentSessionRuntime(factory, { cwd: this.workspace, agentDir: getAgentDir(), sessionManager: SessionManager.create(this.workspace) });
    this.subscribe();
  }
  getRuntime(): AgentSessionRuntime { if (!this.runtime) throw new Error("Runtime has not been initialized."); return this.runtime; }
  getSession(): AgentSession { return this.getRuntime().session; }
  rebind(): void { this.unsubscribe?.(); this.subscribe(); }
  private subscribe(): void { this.unsubscribe = this.getSession().subscribe(this.onEvent); }
  async dispose(): Promise<void> { this.unsubscribe?.(); this.unsubscribe = undefined; await this.runtime?.dispose(); this.runtime = undefined; }
}
