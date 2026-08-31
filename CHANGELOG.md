# Changelog

## [0.6.0] - 2026-08-30

### Added

- Application-layer browser simulation that observes the live UI, selects allowed actions, and executes them through Playwright or Cypress.
- Replayable evidence bundles with an ordered event log, observations, screenshots, agent tool calls, and browser action outcomes.
- Playwright evidence replay against a fresh page, a generic browser adapter, and optional application telemetry.
- Private model-gateway support with Ollama as the local default and LiteLLM for routed providers.

### Changed

- Browser-use-style simulation is now an in-process action policy. It no longer depends on the Python `browser-use` package or a separate browser service.
- Playwright and Cypress remain the browser runtimes. Mimiq supplies the simulated user and records causal evidence.
- Local Qwen policy calls disable hidden reasoning by default so browser turns return within the configured budget.
- Generated example recordings, reports, screenshots, and GIFs are no longer tracked, so E2E runs leave the repository clean.

### Removed

- Removed the `mimiq run` and `mimiq sim` commands, which could write recordings without operating an application.
- Removed the legacy Stagehand agent runner and provider-specific model routing.
