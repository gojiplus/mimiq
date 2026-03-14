# mimiq

Cypress integration for end-to-end testing of agentic applications.

## Overview

`mimiq` is a complete TypeScript solution for testing AI agents with simulated users. It provides:

1. **Simulated users** - LLM-powered users that follow conversation plans
2. **Deterministic checks** - Verify tool calls, terminal states, forbidden actions
3. **LLM-as-judge** - Qualitative evaluation with majority voting
4. **Cypress commands** - Drive simulations in real browsers
5. **HTML reports** - View conversation traces and check results

No Python required. Everything runs in Node.js.

## Quick Start

### 1. Install

```bash
npm install mimiq --save-dev
```

### 2. Configure API Key

```bash
export OPENAI_API_KEY=your-key

# Optional: use a different model
export SIMULATOR_MODEL=gpt-4o  # default
```

### 3. Configure Cypress

**cypress.config.ts**
```ts
import { defineConfig } from "cypress";
import { setupUnderstudyTasks, createLocalRuntime } from "mimiq/node";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:5173",
    setupNodeEvents(on, config) {
      const runtime = createLocalRuntime({
        scenesDir: "./scenes",
      });
      setupUnderstudyTasks(on, { runtime });
      return config;
    },
  },
});
```

**cypress/support/e2e.ts**
```ts
import { createDefaultChatAdapter, registerUnderstudyCommands } from "mimiq";

registerUnderstudyCommands({
  browserAdapter: createDefaultChatAdapter({
    transcript: '[data-test="transcript"]',
    messageRow: '[data-test="message-row"]',
    messageRoleAttr: "data-role",
    messageText: '[data-test="message-text"]',
    input: '[data-test="chat-input"]',
    send: '[data-test="send-button"]',
    idleMarker: '[data-test="agent-idle"]',
  }),
});
```

### 4. Write a Scene

**scenes/return_backpack.yaml**
```yaml
id: return_backpack
description: Customer returns a backpack

starting_prompt: "I'd like to return an item please."
conversation_plan: |
  Goal: Return the hiking backpack from order ORD-10031.
  - Provide order ID when asked.
  - Cooperate with all steps.

persona: cooperative
max_turns: 15

expectations:
  required_tools:
    - lookup_order
    - create_return
  forbidden_tools:
    - issue_refund
  allowed_terminal_states:
    - return_created
  judges:
    - name: empathy
      rubric: "The agent maintained a professional and empathetic tone."
      samples: 3
```

### 5. Write the Test

```ts
describe("return flow", () => {
  afterEach(() => cy.understudyCleanupRun());

  it("processes valid return", () => {
    cy.visit("/");
    cy.understudyStartRun({ sceneId: "return_backpack" });
    cy.understudyRunToCompletion();

    cy.understudyEvaluate().then((report) => {
      expect(report.passed).to.eq(true);
    });
  });
});
```

## Scene Schema

```yaml
id: string                    # Unique identifier
description: string           # Human-readable description

starting_prompt: string       # First message from simulated user
conversation_plan: string     # Instructions for user behavior
persona: string               # Preset: cooperative, frustrated_but_cooperative, adversarial, vague, impatient
max_turns: number             # Maximum turns (default: 15)

context:                      # World state (optional)
  customer: { ... }
  orders: { ... }

expectations:
  required_tools: [string]           # Must be called
  forbidden_tools: [string]          # Must NOT be called
  allowed_terminal_states: [string]  # Valid end states
  forbidden_terminal_states: [string]
  required_agents: [string]          # For multi-agent systems
  forbidden_agents: [string]
  required_agent_tools:              # Agent-specific tool requirements
    agent_name: [tool1, tool2]
  judges:                            # LLM-as-judge evaluations
    - name: string
      rubric: string
      samples: number              # Number of samples (default: 5)
      model: string                # Model to use (default: gpt-4o)
```

## Persona Presets

| Preset | Description |
|--------|-------------|
| `cooperative` | Helpful, provides information directly |
| `frustrated_but_cooperative` | Mildly frustrated but ultimately cooperative |
| `adversarial` | Tries to push boundaries, social-engineer exceptions |
| `vague` | Gives incomplete information, needs follow-up |
| `impatient` | Wants fast resolution, short answers |

## LLM-as-Judge

Add qualitative evaluation with LLM judges:

```yaml
expectations:
  judges:
    - name: empathy
      rubric: "The agent maintained an empathetic tone throughout."
      samples: 5
    - name: accuracy
      rubric: "All factual claims were grounded in tool results."
```

Judges use majority voting across multiple samples for reliability.

### Built-in Rubrics

```ts
import { BUILTIN_RUBRICS } from "mimiq";

// Available rubrics:
BUILTIN_RUBRICS.TASK_COMPLETION
BUILTIN_RUBRICS.INSTRUCTION_FOLLOWING
BUILTIN_RUBRICS.TONE_EMPATHY
BUILTIN_RUBRICS.POLICY_COMPLIANCE
BUILTIN_RUBRICS.FACTUAL_GROUNDING
BUILTIN_RUBRICS.TOOL_USAGE_CORRECTNESS
BUILTIN_RUBRICS.ADVERSARIAL_ROBUSTNESS
```

## Cypress Commands

| Command | Description |
|---------|-------------|
| `cy.understudyStartRun({ sceneId })` | Start a simulation |
| `cy.understudyRunToCompletion()` | Run until done or max turns |
| `cy.understudyRunTurn()` | Execute one turn |
| `cy.understudyEvaluate()` | Run all checks and judges |
| `cy.understudyGetTrace()` | Get conversation trace |
| `cy.understudyCleanupRun()` | Clean up |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | API key for simulation and judges |
| `SIMULATOR_MODEL` | Model for simulation (default: `gpt-4o`) |
| `JUDGE_MODEL` | Model for judges (default: `gpt-4o`) |
| `OPENAI_BASE_URL` | Base URL for OpenAI-compatible API |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ mimiq                                                                   │
│                                                                         │
│ Browser Layer (Cypress):                                                │
│   - Captures UI state via data-test selectors                          │
│   - Executes actions (type, click, send)                               │
│                                                                         │
│ Node Layer (Cypress tasks):                                             │
│   - Simulator: LLM generates user messages                              │
│   - Trace: records conversation + tool calls                           │
│   - Check: validates against expectations                               │
│   - Judge: LLM-as-judge evaluation                                      │
│   - Reports: generates HTML summaries                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

## License

MIT
