import type {
  AdvanceRunRequest,
  AdvanceRunResponse,
  CleanupRunRequest,
  EvaluateRunRequest,
  EvaluationReport,
  GetAggregateReportRequest,
  GetReportRequest,
  GetTraceRequest,
  MimiqRuntimeClient,
  RunTrace,
  StartRunRequest,
  StartRunResponse,
} from "../types";

export interface HttpRuntimeClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
}

export function createHttpRuntimeClient(
  options: HttpRuntimeClientOptions,
): MimiqRuntimeClient {
  const { baseUrl, headers = {} } = options;

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  return {
    async startRun(input: StartRunRequest): Promise<StartRunResponse> {
      return request<StartRunResponse>("POST", "/runs", input);
    },

    async advanceRun(input: AdvanceRunRequest): Promise<AdvanceRunResponse> {
      return request<AdvanceRunResponse>(
        "POST",
        `/runs/${input.runId}/advance`,
        { snapshot: input.snapshot },
      );
    },

    async evaluateRun(input: EvaluateRunRequest): Promise<EvaluationReport> {
      return request<EvaluationReport>(
        "POST",
        `/runs/${input.runId}/evaluate`,
        {},
      );
    },

    async getTrace(input: GetTraceRequest): Promise<RunTrace> {
      return request<RunTrace>("GET", `/runs/${input.runId}/trace`);
    },

    async cleanupRun(input: CleanupRunRequest): Promise<void> {
      await request<void>("DELETE", `/runs/${input.runId}`);
    },

    async getReport(input: GetReportRequest): Promise<string> {
      const url = `${baseUrl}/runs/${input.runId}/report`;
      const response = await fetch(url, {
        method: "GET",
        headers,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      return response.text();
    },

    async getAggregateReport(_input: GetAggregateReportRequest): Promise<string> {
      const url = `${baseUrl}/reports/aggregate`;
      const response = await fetch(url, {
        method: "GET",
        headers,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      return response.text();
    },
  };
}
