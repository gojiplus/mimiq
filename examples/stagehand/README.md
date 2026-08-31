# Stagehand Autonomous Browser Example

This example demonstrates using Stagehand with mimiq for autonomous browser-based agent testing. Stagehand can perform dynamic browser actions beyond typing - it can click, navigate, scroll, and interact with UI elements autonomously.

## Prerequisites

- OpenAI API key (or compatible LLM)
- Node.js 18+

## Setup

```bash
npm install
```

## Environment Variables

```bash
# Required: OpenAI API key for Stagehand
export OPENAI_API_KEY=sk-...

# Optional: Use a different model
export STAGEHAND_MODEL=gpt-4o

# Optional: Use Browserbase cloud (instead of local browser)
export BROWSERBASE_API_KEY=...
export BROWSERBASE_PROJECT_ID=...
```

## Running Tests

```bash
# Run tests (headed browser for visibility)
npm run test:headed

# Run with recording
npm run test:record

# Debug mode
npm run test:debug
```

## Project Structure

```
stagehand-autonomous/
├── fixtures.ts           # Playwright/mimiq fixtures
├── playwright.config.ts  # Playwright configuration
├── scenes/
│   ├── web-navigation.yaml      # Autonomous navigation scene
│   └── autonomous-checkout.yaml # Checkout assistance scene
└── tests/
    └── autonomous-browse.spec.ts
```

## Two execution modes

The Playwright fixtures simulate a user who sends chat messages. They use the
LLM simulator, so the scene describes a customer and a conversation plan:

```yaml
id: autonomous_navigation
description: Agent navigates website autonomously

starting_prompt: "I need to find the return policy"
conversation_plan: |
  Goal: Find return policy information.
  - Look for navigation or help sections
  - Ask the support agent about returns

persona: cooperative
max_turns: 10
```

Stagehand browser automation is a separate mode. Use `AgentRunner` or the
`mimiq agent` command with an agent scene:

```yaml
id: find_return_policy
agent:
  type: stagehand
  model: openai/gpt-4o
target:
  url: http://localhost:5173
goal: Find and report the return policy.
max_turns: 10
```

Run it with:

```bash
npx mimiq agent --scene ../agent-scenes/track_order_button.yaml
```
