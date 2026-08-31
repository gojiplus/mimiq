.PHONY: build start-app test-playwright test-cypress test-all clean help

help:
	@echo "Mimiq Development Commands"
	@echo ""
	@echo "  build              Build the mimiq package"
	@echo "  start-app          Start the test application (localhost:5173)"
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

test-playwright:
	cd examples && ./run-all.sh --only playwright

test-cypress:
	cd examples && ./run-all.sh --only cypress

test-all:
	cd examples && ./run-all.sh

clean:
	rm -rf dist
