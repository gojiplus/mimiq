# Cypress Basic Example

This example demonstrates how to use mimiq with Cypress to simulate user interactions and evaluate AI agent responses.

## Setup

```bash
npm install
```

## Running Tests

Make sure the test app is running:

```bash
npm run dev --prefix ../../test/app
```

Then run the tests:

```bash
# Run tests
npm test

# Run with Cypress UI
npm run test:open

# Run with recording enabled
npm run test:record
```

## Test Scenarios

- `return-flow.cy.ts` - Tests return request flows
- `html-adapter.cy.ts` - Tests HTML-based adapter
- `visual-evaluation.cy.ts` - Tests visual assertions

## Output

Test outputs go to `../outputs/`:
- Reports: `../outputs/reports/cypress/`
- Screenshots: `../outputs/screenshots/cypress/`
- Recordings: `../outputs/recordings/` (when MIMIQ_RECORDING=1)
