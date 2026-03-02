#!/usr/bin/env bash
#
# NowNow API Load Test Runner — REAL Database (Local Supabase)
#
# Runs k6 against the ACTUAL API server connected to your local Supabase.
# No mocks — real Postgres queries, real auth, real everything.
#
# Usage:
#   ./load-test/run-real.sh              # Smoke test (default)
#   ./load-test/run-real.sh smoke        # Smoke test (2 VUs, 30s)
#   ./load-test/run-real.sh load         # Normal load test
#   ./load-test/run-real.sh stress       # Stress test
#   ./load-test/run-real.sh spike        # Spike test
#   ./load-test/run-real.sh soak         # Soak test (10 min)
#
# Prerequisites:
#   - Local Supabase running: supabase start
#   - Seed data applied: supabase db reset
#   - k6 installed: brew install grafana/k6/k6
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SCENARIO="${1:-smoke}"
PORT="${LOAD_TEST_PORT:-3098}"
SERVER_PID=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Load nvm if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
fi

NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_MAJOR" -lt 20 ]; then
    echo -e "${YELLOW}Node.js v${NODE_MAJOR} detected. Fastify v5 requires Node >= 20.${NC}"
    if command -v nvm &>/dev/null; then
        nvm use 22 2>/dev/null || nvm use 20 2>/dev/null || {
            echo -e "${RED}Error: No Node >= 20 available.${NC}"
            exit 1
        }
    else
        echo -e "${RED}Error: Node >= 20 required.${NC}"
        exit 1
    fi
fi

cleanup() {
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        echo -e "\n${YELLOW}Stopping API server (PID: $SERVER_PID)...${NC}"
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
}
trap cleanup EXIT INT TERM

echo -e "${CYAN}=====================================${NC}"
echo -e "${CYAN}  NowNow API Load Test (REAL DB)${NC}"
echo -e "${CYAN}=====================================${NC}"
echo -e "  Scenario: ${GREEN}${SCENARIO}${NC}"
echo -e "  Port:     ${PORT}"
echo -e "  DB:       ${CYAN}Local Supabase (Postgres)${NC}"
echo ""

# Check prerequisites
if ! command -v k6 &>/dev/null; then
    echo -e "${RED}Error: k6 is not installed.${NC}"
    echo "Install with: brew install grafana/k6/k6"
    exit 1
fi

# Verify local Supabase is running
if ! curl -s "http://127.0.0.1:54321/rest/v1/" -H "apikey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" >/dev/null 2>&1; then
    echo -e "${RED}Error: Local Supabase is not running.${NC}"
    echo "Start it with: supabase start"
    echo "Then seed it:  supabase db reset"
    exit 1
fi
echo -e "${GREEN}Local Supabase is running.${NC}"

# Start the REAL API server with local Supabase credentials
echo -e "${YELLOW}Starting API server on port ${PORT} with local Supabase...${NC}"
cd "$PROJECT_DIR"

SUPABASE_URL="http://127.0.0.1:54321" \
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY env var}" \
JWT_SECRET="load-test-jwt-secret-minimum-32-chars!!" \
NODE_ENV="test" \
PORT="$PORT" \
WA_API_VERSION="v18.0" \
WA_PHONE_NUMBER_ID="mock-phone-id" \
WA_ACCESS_TOKEN="disabled" \
npx tsx src/index.ts &
SERVER_PID=$!

# Wait for server
echo -n "Waiting for server"
for i in $(seq 1 30); do
    if curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        echo -e " ${GREEN}ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

if ! curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    echo -e "\n${RED}Error: Server failed to start within 30s.${NC}"
    echo "Check if port ${PORT} is in use: lsof -i :${PORT}"
    exit 1
fi

echo ""
echo -e "${CYAN}=== Server Info ===${NC}"
HEALTH=$(curl -s "http://localhost:${PORT}/health")
echo -e "  Health: ${HEALTH}"
echo -e "${CYAN}===================${NC}"
echo ""

# Run k6
echo -e "${YELLOW}Running k6 ${SCENARIO} test against REAL database...${NC}"
echo ""

k6 run \
    --env SCENARIO="${SCENARIO}" \
    --env BASE_URL="http://localhost:${PORT}" \
    "$SCRIPT_DIR/k6-load-test.js"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Load test (REAL DB) completed successfully.${NC}"
else
    echo -e "${RED}Load test completed with failures (exit code: ${EXIT_CODE}).${NC}"
fi

exit $EXIT_CODE
