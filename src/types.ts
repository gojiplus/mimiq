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
  screenshotBuffer?: Buffer | string;
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

export interface GenerateReportsResult {
  indexHtml: string;
  runReports: Array<{ sceneId: string; html: string }>;
}

export interface MimiqRuntimeClient {
  startRun(input: StartRunRequest): Promise<StartRunResponse>;
  advanceRun(input: AdvanceRunRequest): Promise<AdvanceRunResponse>;
  evaluateRun(input: EvaluateRunRequest): Promise<EvaluationReport>;
  getTrace(input: GetTraceRequest): Promise<RunTrace>;
  cleanupRun(input: CleanupRunRequest): Promise<void>;
  getReport(input: GetReportRequest): Promise<string>;
  getAggregateReport(input: GetAggregateReportRequest): Promise<string>;
  generateAllReports(): Promise<GenerateReportsResult>;
}

export interface AwaitSettledOptions {
  timeoutMs?: number;
}

export interface SetupMimiqTasksOptions {
  runtime: MimiqRuntimeClient;
}

export interface VisualAssertionResult {
  passed: boolean;
  answer: string;
  confidence: number;
  reasoning?: string;
  screenshotPath?: string;
  error?: string;
}

// Recording pipeline types

export interface RecordingScreenshotConfig {
  enabled: boolean;
  timing: "before" | "after" | "both";
  format: "png" | "jpeg";
}

export interface RecordingTranscriptConfig {
  format: "json";
  includeUiState: boolean;
}

export interface RecordingActionLogConfig {
  enabled: boolean;
  format: "markdown";
}

export interface RecordingConfig {
  enabled: boolean;
  outputDir: string;
  framework?: "playwright" | "cypress" | "stagehand";
  screenshots: RecordingScreenshotConfig;
  transcript: RecordingTranscriptConfig;
  actionLog: RecordingActionLogConfig;
  runNaming: "sequential" | "timestamp";
  defaultRunCount: number;
}

export interface RecordingUiState {
  url?: string;
  agentStatus: "idle" | "working";
  visibleMessages: number;
}

export interface RecordingToolCall {
  tool: string;
  args: JsonObject;
  result?: JsonValue;
}

export interface RecordingTurn {
  turn: number;
  timestamp: string;
  actor: "customer" | "agent";
  type: "message" | "click" | "type" | "select" | "navigate";
  content?: string;
  target?: string;
  toolCalls?: RecordingToolCall[];
  screenshot?: string;
  uiState?: RecordingUiState;
}

export interface RecordingTranscript {
  runId: string;
  sceneId: string;
  startedAt: string;
  finishedAt?: string;
  turns: RecordingTurn[];
  terminalState?: string;
}

export interface RecordingMetadata {
  runId: string;
  sceneId: string;
  runNumber: number;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "failed";
  config: RecordingConfig;
}

export interface RunMultipleOptions {
  sceneId?: string;
  scenePath?: string;
  scene?: JsonObject;
  count: number;
  onRunComplete?: (runId: string, report: EvaluationReport) => void;
}

export interface AggregateSummary {
  sceneId: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
}

export interface RunMultipleResult {
  runs: EvaluationReport[];
  summary: AggregateSummary;
}

// Job management types

export type Framework = "playwright" | "cypress";

export interface JobConfig {
  jobId?: string;
  scenesDir: string;
  outputDir: string;
  framework: Framework;
  runs: number;
  evaluators?: string[];
}

export interface JobManifest {
  jobId: string;
  createdAt: string;
  finishedAt?: string;
  config: JobConfig;
  status: "running" | "completed" | "failed";
  scenesRun: string[];
  runsPerScene: number;
  totalRuns: number;
  completedRuns: number;
}

export interface EvaluatorResult {
  name: string;
  passed: boolean;
  score?: number;
  details?: string;
  metadata?: JsonObject;
}

export interface RunEvalResult {
  runId: string;
  sceneId: string;
  runNumber: number;
  passed: boolean;
  terminalState?: string;
  results: EvaluatorResult[];
}

export interface JobEvalResults {
  jobId: string;
  evaluatedAt: string;
  evaluators: string[];
  runs: RunEvalResult[];
  summary: {
    totalRuns: number;
    passedRuns: number;
    failedRuns: number;
    passRate: number;
    byScene: Record<string, { total: number; passed: number; passRate: number }>;
    byEvaluator: Record<string, { total: number; passed: number; passRate: number }>;
  };
}

// Browser agent types

export type BrowserAgentType = "stagehand" | "playwright-mcp";

export interface BrowserAgentConfig {
  type: BrowserAgentType;
  model?: string;
  headless?: boolean;
  timeout?: number;
}

export interface BrowserTargetConfig {
  url: string;
  selector?: string;
}

export interface BrowserActionResult {
  success: boolean;
  text?: string;
  error?: string;
  screenshot?: string;
}

export interface BrowserObservation {
  url: string;
  title?: string;
  visibleText?: string;
  chatMessages?: Array<{ role: string; content: string }>;
  stateMarkers?: string[];
}

export interface BrowserStepAction {
  type: "act" | "extract" | "observe" | "message" | "navigate";
  instruction?: string;
  result?: string;
  error?: string;
}

export interface BrowserStepResponse {
  text: string;
  toolCalls?: Array<{
    tool: string;
    args: JsonObject;
    result?: JsonValue;
  }>;
}

export interface BrowserStep {
  turn: number;
  timestamp: string;
  action: BrowserStepAction;
  response?: BrowserStepResponse;
  screenshot?: string;
  domSnapshot?: string;
  url: string;
}

export interface BrowserTrace {
  sceneId: string;
  targetUrl: string;
  startedAt: string;
  finishedAt?: string;
  steps: BrowserStep[];
  terminalState?: string;
  goalAchieved: boolean;
}

export interface AgentRunConfig {
  scene: string | JsonObject;
  url?: string;
  agent?: BrowserAgentType;
  model?: string;
  headless?: boolean;
  runs?: number;
  jobId?: string;
  outputDir?: string;
}
