.PHONY: build start-app test-agent test-agent-headless test-playwright test-cypress test-all clean help

help:
	@echo "Mimiq Development Commands"
	@echo ""
	@echo "  build              Build the mimiq package"
	@echo "  start-app          Start the test application (localhost:5173)"
	@echo "  test-agent         Run agent tests with visible browser"
	@echo "  test-agent-headless Run agent tests in headless mode"
	@echo "  test-playwright    Run playwright example tests"
	@echo "  test-cypress       Run cypress example tests"
	@echo "  test-all           Run all example tests"
	@echo "  clean              Remove build artifacts"
	@echo ""

build:
	npm run build

start-app:
	@echo "Starting test app on http://localhost:5173..."
	npm run --prefix test/app dev &

test-agent:
	cd examples && npx mimiq agent --scenes ./agent-scenes --no-headless

test-agent-headless:
	cd examples && npx mimiq agent --scenes ./agent-scenes --headless

test-playwright:
	cd examples && ./run-all.sh --only playwright

test-cypress:
	cd examples && ./run-all.sh --only cypress

test-all:
	cd examples && ./run-all.sh

clean:
	rm -rf dist
	rm -rf examples/outputs/recordings/stagehand
	rm -rf examples/outputs/evals/stagehand
	rm -rf examples/outputs/reports/stagehand
