#!/usr/bin/env bash
#
# NowNow API Load Test — Simulated ALB (3 instances)
#
# Runs 3 API server instances behind a round-robin proxy to simulate
# an Application Load Balancer with horizontal scaling.
#
# Usage:
#   ./load-test/run-alb.sh              # Smoke test (default)
#   ./load-test/run-alb.sh load         # Normal load test
#   ./load-test/run-alb.sh stress       # Stress test
#   ./load-test/run-alb.sh spike        # Spike test
#   ./load-test/run-alb.sh soak         # Soak test
#
# Prerequisites:
#   - Local Supabase running: supabase start
#   - Seed data applied: supabase db reset
#   - k6 installed: brew install grafana/k6/k6
#   - SUPABASE_SERVICE_ROLE_KEY env var set (get it from: supabase status)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SCENARIO="${1:-smoke}"
INSTANCES="${INSTANCES:-3}"
PROXY_PORT="${LOAD_TEST_PORT:-3098}"
BASE_PORT=3101
PIDS=()

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
    echo -e "\n${YELLOW}Stopping all processes...${NC}"
    for pid in "${PIDS[@]}"; do
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo -e "${GREEN}All processes stopped.${NC}"
}
trap cleanup EXIT INT TERM

echo -e "${CYAN}=============================================${NC}"
echo -e "${CYAN}  NowNow API Load Test (ALB × ${INSTANCES} instances)${NC}"
echo -e "${CYAN}=============================================${NC}"
echo -e "  Scenario:  ${GREEN}${SCENARIO}${NC}"
echo -e "  Instances: ${GREEN}${INSTANCES}${NC}"
echo -e "  Proxy:     ${PROXY_PORT} → ${BASE_PORT}-$((BASE_PORT + INSTANCES - 1))"
echo -e "  DB:        ${CYAN}Local Supabase (Postgres)${NC}"
echo ""

# Check prerequisites
if ! command -v k6 &>/dev/null; then
    echo -e "${RED}Error: k6 is not installed.${NC}"
    echo "Install with: brew install grafana/k6/k6"
    exit 1
fi

if ! curl -s "http://127.0.0.1:54321/rest/v1/" -H "apikey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH" >/dev/null 2>&1; then
    echo -e "${RED}Error: Local Supabase is not running.${NC}"
    echo "Start it with: supabase start"
    exit 1
fi
echo -e "${GREEN}Local Supabase is running.${NC}"

# Build backend port list
BACKEND_PORTS=""
for i in $(seq 0 $((INSTANCES - 1))); do
    PORT=$((BASE_PORT + i))
    if [ -n "$BACKEND_PORTS" ]; then
        BACKEND_PORTS="${BACKEND_PORTS},"
    fi
    BACKEND_PORTS="${BACKEND_PORTS}${PORT}"
done

# Start API server instances
cd "$PROJECT_DIR"
for i in $(seq 0 $((INSTANCES - 1))); do
    PORT=$((BASE_PORT + i))
    echo -e "${YELLOW}Starting instance $((i + 1)) on port ${PORT}...${NC}"

    SUPABASE_URL="http://127.0.0.1:54321" \
    SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY env var}" \
    JWT_SECRET="load-test-jwt-secret-minimum-32-chars!!" \
    NODE_ENV="test" \
    PORT="$PORT" \
    WA_API_VERSION="v18.0" \
    WA_PHONE_NUMBER_ID="mock-phone-id" \
    WA_ACCESS_TOKEN="disabled" \
    npx tsx src/index.ts > /dev/null 2>&1 &
    PIDS+=($!)
done

# Wait for all instances
echo -n "Waiting for instances"
for attempt in $(seq 1 30); do
    ALL_READY=true
    for i in $(seq 0 $((INSTANCES - 1))); do
        PORT=$((BASE_PORT + i))
        if ! curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
            ALL_READY=false
            break
        fi
    done
    if $ALL_READY; then
        echo -e " ${GREEN}all ready!${NC}"
        break
    fi
    echo -n "."
    sleep 1
done

# Verify all instances
for i in $(seq 0 $((INSTANCES - 1))); do
    PORT=$((BASE_PORT + i))
    if ! curl -s "http://localhost:${PORT}/health" >/dev/null 2>&1; then
        echo -e "\n${RED}Error: Instance on port ${PORT} failed to start.${NC}"
        exit 1
    fi
done

# Start ALB proxy
echo -e "${YELLOW}Starting ALB proxy on port ${PROXY_PORT}...${NC}"
BACKEND_PORTS="$BACKEND_PORTS" \
PROXY_PORT="$PROXY_PORT" \
npx tsx "$SCRIPT_DIR/alb-proxy.ts" &
PIDS+=($!)

# Wait for proxy
sleep 1
if ! curl -s "http://localhost:${PROXY_PORT}/health" >/dev/null 2>&1; then
    sleep 2
fi

if ! curl -s "http://localhost:${PROXY_PORT}/health" >/dev/null 2>&1; then
    echo -e "${RED}Error: ALB proxy failed to start.${NC}"
    exit 1
fi
echo -e "${GREEN}ALB proxy ready.${NC}"

echo ""
echo -e "${CYAN}=== Cluster Info ===${NC}"
for i in $(seq 0 $((INSTANCES - 1))); do
    PORT=$((BASE_PORT + i))
    echo -e "  Instance $((i + 1)): ${GREEN}:${PORT}${NC} ✓"
done
echo -e "  ALB Proxy: ${GREEN}:${PROXY_PORT}${NC} → round-robin"
echo -e "${CYAN}====================${NC}"
echo ""

# Run k6
echo -e "${YELLOW}Running k6 ${SCENARIO} test via ALB (${INSTANCES} instances)...${NC}"
echo ""

k6 run \
    --env SCENARIO="${SCENARIO}" \
    --env BASE_URL="http://localhost:${PROXY_PORT}" \
    "$SCRIPT_DIR/k6-load-test.js"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}Load test (ALB × ${INSTANCES}) completed successfully.${NC}"
else
    echo -e "${RED}Load test completed with failures (exit code: ${EXIT_CODE}).${NC}"
fi

exit $EXIT_CODE
