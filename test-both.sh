#!/bin/bash

# Clear the terminal for better readability
clear
echo "=== Starting Next.js and Cypress ==="
echo

# Check if 'npm start' or 'npm run dev' exists in package.json
if grep -q '"start":' package.json; then
  START_CMD="npm start"
elif grep -q '"dev":' package.json; then
  START_CMD="npm run dev"
else
  echo "Error: No start or dev command found in package.json"
  exit 1
fi

# Define port to use for dev server
PORT=3000

# Check if port is already in use
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
  echo "Port $PORT is already in use. Please close the application using that port."
  echo "You can find the process using: lsof -i :$PORT"
  echo "Attempting to continue anyway..."
fi

# Function to clean up background processes
cleanup() {
  echo
  echo "=== Shutting down processes ==="
  # Kill the background process (next.js server)
  if [ ! -z "$SERVER_PID" ]; then
    echo "Stopping Next.js server (PID: $SERVER_PID)..."
    kill $SERVER_PID 2>/dev/null
  fi
  echo "Cleanup complete."
  exit 0
}

# Register the cleanup function for exit
trap cleanup EXIT INT TERM

# Start Next.js in the background
echo "Starting Next.js server: $START_CMD"
$START_CMD &
SERVER_PID=$!

# Wait for server to start (adjust timeout as needed)
echo "Waiting for Next.js server to start..."
timeout=30
counter=0
server_up=false

while [ $counter -lt $timeout ]; do
  if curl -s http://localhost:$PORT > /dev/null; then
    server_up=true
    break
  fi
  counter=$((counter+1))
  echo -n "."
  sleep 1
done

echo

if [ "$server_up" = true ]; then
  echo "Next.js server is up and running at http://localhost:$PORT"
else
  echo "Warning: Next.js server might not be ready yet, but proceeding with tests..."
fi

echo
echo "=== Starting Cypress tests ==="
echo "You can manually run: npm run cy:open for an interactive UI"
echo

# Run Cypress tests
npm run cy:run

echo
echo "=== Tests completed ==="
echo "Next.js server is still running. Press Ctrl+C to stop."

# Keep the script running to keep the server alive
# The server will be terminated when the script exits via the cleanup trap
wait $SERVER_PID