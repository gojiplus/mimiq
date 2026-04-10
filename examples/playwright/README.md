# Playwright Basic Example

This example demonstrates basic mimiq usage with Playwright for evaluating AI agents in browser-based chat interfaces.

## Setup

```bash
npm install
```

## Running Tests

```bash
# Run all tests
npm test

# Run with headed browser
npm run test:headed

# Run with recording enabled (captures screenshots for GIF generation)
npm run test:record

# Debug mode
npm run test:debug
```

## Project Structure

```
playwright-basic/
├── fixtures.ts           # Playwright fixtures configuring mimiq
├── playwright.config.ts  # Playwright configuration
├── scenes/               # Scene definitions (YAML)
│   ├── customer-support.yaml
│   └── return-request.yaml
└── tests/
    └── support-flow.spec.ts  # Test specifications
```

## Scene Definition

Scenes define simulated customer behaviors:

```yaml
id: customer_support_basic
description: Customer asks about order status

starting_prompt: "Hi, I need to check on my order status"
conversation_plan: |
  Goal: Get information about order ORD-10031.
  - Provide order ID when asked
  - Thank the agent when done

persona: cooperative
max_turns: 10

expectations:
  required_tools:
    - lookup_order
  allowed_terminal_states:
    - order_info_provided
```

## Key Concepts

- **Scene**: Defines what the simulated customer wants to accomplish
- **Persona**: How the simulated customer behaves (cooperative, confused, etc.)
- **Expectations**: What the agent should (or shouldn't) do
- **Terminal State**: How the conversation should end

## Adapter Configuration

The adapter tells mimiq how to interact with your chat UI:

```typescript
createDefaultChatAdapter(page, {
  transcript: "[data-test=transcript]",
  messageRow: "[data-test=message-row]",
  input: "[data-test=chat-input]",
  send: "[data-test=send-button]",
  idleMarker: "[data-test=agent-idle]",
});
```
