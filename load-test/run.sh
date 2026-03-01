#!/usr/bin/env bash
#
# NowNow API Load Test Runner
#
# Usage:
#   ./load-test/run.sh              # Smoke test (default)
#   ./load-test/run.sh smoke        # Smoke test
#   ./load-test/run.sh load         # Normal load test
#   ./load-test/run.sh stress       # Stress test
#   ./load-test/run.sh spike        # Spike test
#   ./load-test/run.sh soak         # Soak test (10 min sustained)
#
# Prerequisites:
#   - Node.js + tsx installed
#   - k6 installed: brew install grafana/k6/k6
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SCENARIO="${1:-smoke}"
PORT="${LOAD_TEST_PORT:-3099}"
SERVER_PID=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ensure Node >= 20 (Fastify v5 requirement)
# Load nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo -e "${YELLOW}Node.js v${NODE_MAJOR} detected. Fastify v5 requires Node >= 20.${NC}"
    if command -v nvm &>/dev/null; then
        echo -e "${YELLOW}Switching to latest Node 22 via nvm...${NC}"
        nvm use 22 2>/dev/null || nvm use 20 2>/dev/null || {
            echo -e "${RED}Error: No Node >= 20 available. Install with: nvm install 22${NC}"
            exit 1
        }
    else
        echo -e "${RED}Error: Node >= 20 required. Current: $(node --version)${NC}"
        exit 1
    fi
fi

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}Stopping load test server (PID: $SERVER_PID)...${NC}"
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}  NowNow API Load Test Runner${NC}"
echo -e "${BLUE}=====================================${NC}"
echo -e "  Scenario: ${GREEN}${SCENARIO}${NC}"
echo -e "  Port:     ${PORT}"
echo ""

# Check prerequisites
if ! command -v k6 &>/dev/null; then
    echo -e "${RED}Error: k6 is not installed.${NC}"
    echo "Install it with: brew install grafana/k6/k6"
    echo "Or see: https://k6.io/docs/getting-started/installation/"
    exit 1
fi

if ! command -v npx &>/dev/null; then
    echo -e "${RED}Error: npx/Node.js is not installed.${NC}"
    exit 1
fi

# Step 1: Start mock server in background
echo -e "${YELLOW}Starting load test server on port ${PORT}...${NC}"
cd "$PROJECT_DIR"

LOAD_TEST_PORT="$PORT" npx tsx load-test/server.ts &
SERVER_PID=$!

# Wait for server to be ready
echo -n "Waiting for server"
for i in $(seq 1 30); do
    if curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Verify server is running
if ! curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo -e "\n${RED}Error: Server failed to start within 30s.${NC}"
    exit 1
fi

echo ""

# Step 2: Run k6
echo -e "${YELLOW}Running k6 ${SCENARIO} test...${NC}"
echo ""

k6 run \
    --env SCENARIO="${SCENARIO}" \
    --env BASE_URL="http://localhost:${PORT}" \
    "$SCRIPT_DIR/k6-load-test.js"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Load test completed successfully.${NC}"
else
    echo -e "${RED}Load test completed with failures (exit code: ${EXIT_CODE}).${NC}"
fi

exit $EXIT_CODE
