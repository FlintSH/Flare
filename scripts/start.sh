#!/bin/sh

# Connect without migrating, so a failing migration stops the start with its
# own error instead of being retried as an unreachable database. A missing
# database counts as reachable: migrate deploy creates it.
database_reachable() {
    output=$(echo 'SELECT 1' | pnpm prisma db execute --stdin --schema prisma/schema.prisma 2>&1) && return 0
    case $output in
        *P1003*) return 0 ;;
    esac
    return 1
}

wait_for_db() {
    echo "Waiting for database to be ready..."
    max_retries=30
    counter=0
    
    while [ $counter -lt $max_retries ]
    do
        if database_reachable; then
            echo "Database is ready!"
            return 0
        fi
        
        echo "Database not ready yet. Retrying in 2 seconds..."
        sleep 2
        counter=$((counter + 1))
    done
    
    printf '%s\n' "$output" >&2
    echo "Could not connect to database after $max_retries attempts" >&2
    return 1
}

echo "Starting initialization..."

if ! wait_for_db; then
    echo "Failed to initialize database" >&2
    exit 1
fi

echo "Running database migrations..."
if ! pnpm prisma migrate deploy; then
    echo "Failed to run migrations" >&2
    exit 1
fi

echo "Running config migrations..."
if ! node /app/scripts/migrate-config.js; then
    echo "Failed to run config migrations" >&2
    exit 1
fi

echo "Running password migrations..."
if ! node /app/scripts/hash-file-passwords.js; then
    echo "Failed to run password migrations" >&2
    exit 1
fi

echo "Starting the application..."
exec pnpm start