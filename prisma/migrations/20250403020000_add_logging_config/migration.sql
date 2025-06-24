-- AddLoggingConfig
-- Initialize default logging configuration in the config table

-- Insert logging configuration if it doesn't already exist
INSERT INTO "Config" (id, key, value, "updatedAt")
SELECT 'logging_config', 'logging', '{
  "enabled": true,
  "level": "info",
  "console": {
    "enabled": true,
    "format": "pretty"
  },
  "file": {
    "enabled": true,
    "path": "./logs",
    "maxSize": 10,
    "maxFiles": 5,
    "format": "json"
  },
  "categories": {
    "api": {
      "enabled": true,
      "level": "info"
    },
    "auth": {
      "enabled": true,
      "level": "info"
    },
    "upload": {
      "enabled": true,
      "level": "info"
    },
    "database": {
      "enabled": true,
      "level": "warn"
    },
    "system": {
      "enabled": true,
      "level": "info"
    },
    "user": {
      "enabled": true,
      "level": "info"
    }
  }
}'::jsonb, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "Config" WHERE key = 'logging'
);