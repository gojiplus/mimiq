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

## Scene Configuration with Stagehand

Scenes can specify Stagehand as the simulator:

```yaml
id: autonomous_navigation
description: Agent navigates website autonomously

starting_prompt: "I need to find the return policy"
conversation_plan: |
  Goal: Find return policy information.
  - Look for navigation or help sections
  - Ask the support agent about returns

persona: curious
max_turns: 10

simulator:
  type: stagehand
  options:
    model: gpt-4o
    headless: false  # Show browser for demo
    verbose: true
```

## How It Works

1. **Stagehand Simulator**: Instead of following a scripted conversation, Stagehand uses an LLM to decide what browser actions to take.

2. **Autonomous Actions**: The simulator can click buttons, fill forms, navigate pages - not just type in chat.

3. **Goal-Oriented**: The conversation plan provides high-level goals, and Stagehand figures out how to achieve them.

## Local vs Cloud

By default, Stagehand runs a local browser. For cloud execution:

```yaml
simulator:
  type: stagehand
  options:
    browserbaseApiKey: ${BROWSERBASE_API_KEY}
    browserbaseProjectId: ${BROWSERBASE_PROJECT_ID}
```
