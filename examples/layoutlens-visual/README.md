# LayoutLens Visual Assertions Example

This example demonstrates using LayoutLens with mimiq for AI-powered visual assertions. LayoutLens can answer natural language questions about UI elements, accessibility, and layout.

## Prerequisites

- Python 3.8+
- LayoutLens library: `pip install layoutlens`

## Setup

```bash
npm install
pip install layoutlens
```

## Running Tests

```bash
# Run visual assertion tests
npm test

# Run with headed browser
npm run test:headed

# Run with recording
npm run test:record
```

## Project Structure

```
layoutlens-visual/
├── fixtures.ts           # Playwright/mimiq fixtures with LayoutLens config
├── playwright.config.ts
├── scenes/
│   ├── accessibility-check.yaml  # Accessibility audit scene
│   ├── form-validation.yaml      # Form UI validation
│   └── mobile-layout.yaml        # Mobile responsive checks
└── tests/
    └── visual-evaluation.spec.ts
```

## Scene with Visual Assertions

Scenes can include visual assertions that run after the conversation:

```yaml
id: accessibility_evaluation
description: Evaluate UI accessibility

starting_prompt: "Hello"
persona: cooperative
max_turns: 3

expectations:
  visual_assertions:
    - query: "Is there a chat input field visible?"
      min_confidence: 0.8
    - query: "Is the send button visible and clickable?"
      min_confidence: 0.8

  accessibility_audit:
    level: AA
    required_pass: false
```

## Standalone Visual Assertions

You can also use LayoutLens directly in tests:

```typescript
import { visualAssert, accessibilityAudit } from "@gojiplus/mimiq";

// Single visual assertion
const result = await visualAssert(
  "http://localhost:5173",
  "Is the chat interface properly laid out?"
);
console.log(`Confidence: ${result.confidence}`);
console.log(`Answer: ${result.answer}`);

// Accessibility audit
const audit = await accessibilityAudit("http://localhost:5173", {
  level: "AA"
});
console.log(`Passed: ${audit.passed}`);
```

## Batch Assertions

Run multiple assertions efficiently:

```typescript
import { runVisualAssertions } from "@gojiplus/mimiq";

const results = await runVisualAssertions(url, [
  { query: "Is there a text input?", minConfidence: 0.7 },
  { query: "Is the layout responsive?", minConfidence: 0.6 },
]);

console.log(`All passed: ${results.passed}`);
```

## LayoutLens Client

Create a reusable client with shared configuration:

```typescript
import { createLayoutLensClient } from "@gojiplus/mimiq";

const lens = createLayoutLensClient({
  pythonPath: "python3",
  timeout: 30000,
});

const result = await lens.visualAssert(url, "Is the button visible?");
```

## How It Works

1. **Visual Assertions**: LayoutLens uses vision models to analyze screenshots and answer natural language questions about the UI.

2. **Accessibility Audits**: Checks for WCAG compliance at A, AA, or AAA levels.

3. **Integration with Scenes**: Visual assertions defined in scene YAML files are automatically run during evaluation.

## Confidence Thresholds

- `min_confidence: 0.8` - High confidence required (recommended for critical assertions)
- `min_confidence: 0.7` - Medium confidence (good for general checks)
- `min_confidence: 0.6` - Lower confidence (for optional/soft checks)
