#!/bin/bash

# Agnee Localhost Runner
# Jalankan backend server dan optional frontend development server
# Bisa dijalankan dari directory manapun

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_info() {
    echo -e "${BLUE}ℹ${NC}  $1"
}

print_success() {
    echo -e "${GREEN}✓${NC}  $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC}  $1"
}

print_error() {
    echo -e "${RED}✗${NC}  $1"
}

# Project root = directory of this script, regardless of where you call it from
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Change to project root
cd "$PROJECT_ROOT"
print_info "Project root: $PROJECT_ROOT"

# Check Node.js version
print_info "Checking Node.js version..."
NODE_VERSION=$(node -v)
print_success "Node.js $NODE_VERSION found"

# Check if .env exists
if [ ! -f .env ]; then
    print_warning ".env file not found"
    if [ -f .env.example ]; then
        print_info "Creating .env from .env.example..."
        cp .env.example .env
        print_success ".env created (please update sensitive values)"

        # Show minimal setup
        echo ""
        print_warning "IMPORTANT: Please update these in .env:"
        echo "  - API_KEY"
        echo "  - SESSION_SECRET"
        echo "  - POSTGRES_PASSWORD"
        echo "  - DATABASE_URL (if using external PostgreSQL)"
        echo "  - MCP_BEARER_TOKEN"
        echo "  - MCP_OAUTH_SIGNING_SECRET"
        echo ""
    else
        print_error ".env.example not found"
        exit 1
    fi
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    print_info "Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_success "Dependencies already installed"
fi

# Parse command line arguments
FRONTEND_ONLY=false
BACKEND_ONLY=false
FRONTEND_AND_BACKEND=false

case "${1:-both}" in
    frontend)
        FRONTEND_ONLY=true
        ;;
    backend)
        BACKEND_ONLY=true
        ;;
    both|"")
        FRONTEND_AND_BACKEND=true
        ;;
    *)
        echo "Usage: ./run-localhost.sh [backend|frontend|both]"
        echo ""
        echo "  backend  - Run only the Fastify backend server (port 4100)"
        echo "  frontend - Run only the Vite dev server (port 5173)"
        echo "  both     - Run both backend and frontend (default)"
        exit 1
        ;;
esac

# Run servers
echo ""
print_info "Starting Agnee server(s)..."
echo ""

if [ "$BACKEND_ONLY" = true ] || [ "$FRONTEND_AND_BACKEND" = true ]; then
    print_info "Backend server will run on: http://localhost:4100"
fi

if [ "$FRONTEND_ONLY" = true ] || [ "$FRONTEND_AND_BACKEND" = true ]; then
    print_info "Frontend dev server will run on: http://localhost:5173"
fi

echo ""

if [ "$BACKEND_ONLY" = true ]; then
    print_success "Starting backend server..."
    npm start
elif [ "$FRONTEND_ONLY" = true ]; then
    print_success "Starting frontend dev server..."
    npm run dev:web
else
    # Run both in parallel
    print_success "Starting both servers..."
    echo ""

    # Start backend in background
    npm start &
    BACKEND_PID=$!

    # Give backend time to start
    sleep 2

    # Start frontend in foreground
    npm run dev:web &
    FRONTEND_PID=$!

    print_success "Backend (PID: $BACKEND_PID) and Frontend (PID: $FRONTEND_PID) running"
    echo ""
    print_info "Press Ctrl+C to stop both servers"
    echo ""

    # Trap Ctrl+C to kill both processes
    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo ''; print_info 'Servers stopped'; exit 0" INT

    # Wait for both processes
    wait
fi
