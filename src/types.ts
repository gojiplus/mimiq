export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface TranscriptTurn {
  id?: string;
  role: MessageRole;
  text: string;
  timestamp?: string;
  pending?: boolean;
  metadata?: JsonObject;
}

export type UIActionKind =
  | "message"
  | "click"
  | "type"
  | "select"
  | "upload"
  | "navigate";

export interface UIActionOption {
  value: string;
  label?: string;
}

export interface UIActionTarget {
  id: string;
  kind: UIActionKind;
  label?: string;
  description?: string;
  enabled: boolean;
  options?: UIActionOption[];
  metadata?: JsonObject;
}

export type UserToolProvenance =
  | "ui"
  | "browser_extension"
  | "portal"
  | "external_app"
  | "test_only";

export interface UserToolAvailability {
  name: string;
  description: string;
  enabled: boolean;
  provenance?: UserToolProvenance;
  inputSchema?: JsonObject;
  reasonDisabled?: string;
}

export interface AffordanceSnapshot {
  screenId?: string;
  url?: string;
  transcript: TranscriptTurn[];
  availableActions: UIActionTarget[];
  availableUserTools: UserToolAvailability[];
  stateMarkers?: string[];
  metadata?: JsonObject;
}

export interface MessageAction {
  kind: "message";
  text: string;
}

export interface ClickAction {
  kind: "click";
  targetId: string;
}

export interface TypeAction {
  kind: "type";
  targetId: string;
  text: string;
  clearFirst?: boolean;
}

export interface SelectAction {
  kind: "select";
  targetId: string;
  value: string;
}

export interface UploadAction {
  kind: "upload";
  targetId: string;
  fileRef: string;
}

export interface NavigateAction {
  kind: "navigate";
  targetId?: string;
  url?: string;
}

export interface ToolAction {
  kind: "tool";
  toolName: string;
  args: JsonObject;
}

export interface DoneAction {
  kind: "done";
  reason?: string;
}

export type SimAction =
  | MessageAction
  | ClickAction
  | TypeAction
  | SelectAction
  | UploadAction
  | NavigateAction
  | ToolAction
  | DoneAction;

export type BrowserSimAction = Exclude<SimAction, ToolAction | DoneAction>;

export interface TraceEntry {
  id?: string;
  actor: "user" | "user_tool" | "assistant" | "assistant_tool" | "browser" | "system";
  kind:
    | "message"
    | "action"
    | "tool"
    | "state"
    | "terminal_state"
    | "observation";
  name?: string;
  text?: string;
  args?: JsonObject;
  result?: JsonValue;
  metadata?: JsonObject;
  timestamp?: string;
}

export interface RunTrace {
  runId: string;
  terminalState?: string;
  entries: TraceEntry[];
}

export interface EvaluationReport {
  runId: string;
  passed: boolean;
  terminalState?: string;
  checks: Array<{
    name: string;
    passed: boolean;
    details?: string;
  }>;
  summary?: string;
  metadata?: JsonObject;
}

export interface StartRunRequest {
  sceneId?: string;
  scenePath?: string;
  scene?: JsonObject;
  input?: JsonObject;
}

export interface StartRunResponse {
  runId: string;
}

export interface AdvanceRunRequest {
  runId: string;
  snapshot: AffordanceSnapshot;
}

export interface AdvanceRunResponse {
  runId: string;
  action: BrowserSimAction | DoneAction;
  turn: number;
  traceDelta?: TraceEntry[];
}

export interface EvaluateRunRequest {
  runId: string;
}

export interface GetTraceRequest {
  runId: string;
}

export interface CleanupRunRequest {
  runId: string;
}

export interface GetReportRequest {
  runId: string;
}

export type GetAggregateReportRequest = Record<string, never>;

export interface MimiqRuntimeClient {
  startRun(input: StartRunRequest): Promise<StartRunResponse>;
  advanceRun(input: AdvanceRunRequest): Promise<AdvanceRunResponse>;
  evaluateRun(input: EvaluateRunRequest): Promise<EvaluationReport>;
  getTrace(input: GetTraceRequest): Promise<RunTrace>;
  cleanupRun(input: CleanupRunRequest): Promise<void>;
  getReport(input: GetReportRequest): Promise<string>;
  getAggregateReport(input: GetAggregateReportRequest): Promise<string>;
}

export interface AwaitSettledOptions {
  timeoutMs?: number;
}

export interface BrowserAdapter {
  captureSnapshot(): Cypress.Chainable<AffordanceSnapshot>;
  executeAction(action: BrowserSimAction): Cypress.Chainable<void>;
  awaitSettled(options?: AwaitSettledOptions): Cypress.Chainable<void>;
  assertHealthy?(): Cypress.Chainable<void>;
}

export interface MimiqCommandDefaults {
  maxTurns?: number;
  settleTimeoutMs?: number;
  failOnHealthCheck?: boolean;
}

export interface RegisterMimiqCommandsOptions {
  browserAdapter: BrowserAdapter;
  defaults?: MimiqCommandDefaults;
}

export interface SetupMimiqTasksOptions {
  runtime: MimiqRuntimeClient;
}
