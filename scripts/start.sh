#!/bin/sh

# Function to wait for database
wait_for_db() {
    echo "Waiting for database to be ready..."
    max_retries=30
    counter=0
    
    while [ $counter -lt $max_retries ]
    do
        if npx prisma migrate deploy 2>/dev/null; then
            echo "Database is ready!"
            return 0
        fi
        
        echo "Database not ready yet. Retrying in 2 seconds..."
        sleep 2
        counter=$((counter + 1))
    done
    
    echo "Could not connect to database after $max_retries attempts"
    return 1
}

echo "Starting initialization..."

# Wait for database and run migrations
if ! wait_for_db; then
    echo "Failed to initialize database"
    exit 1
fi

# Run migrations
echo "Running database migrations..."
if ! npx prisma migrate deploy; then
    echo "Failed to run migrations"
    exit 1
fi

# Generate Prisma Client if needed
echo "Ensuring Prisma Client is generated..."
if ! npx prisma generate; then
    echo "Failed to generate Prisma Client"
    exit 1
fi

# Run config migrations
echo "Running config migrations..."
if ! node /app/scripts/migrate-config.js; then
    echo "Failed to run config migrations"
    exit 1
fi

# Run password migrations
echo "Running password migrations..."
if ! node /app/scripts/hash-file-passwords.js; then
    echo "Failed to run password migrations"
    exit 1
fi

# Start the application
echo "Starting the application..."
exec npm run start