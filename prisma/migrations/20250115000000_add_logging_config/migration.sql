-- AddLoggingConfig
-- Initialize default logging configuration in the config table

INSERT INTO "Config" (id, key, value, "updatedAt")
VALUES (
  gen_random_uuid(),
  'flare_logging_config',
  '{
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
  }',
  NOW()
)
ON CONFLICT (key) DO NOTHING;