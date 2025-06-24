# Flare Logging System

Flare includes a comprehensive logging system that provides detailed insights into system operations, user activities, and potential security issues. This document explains how to configure, use, and maintain the logging system.

## Overview

The logging system captures detailed information about:

- **API Requests**: All incoming API requests with response times and status codes
- **Authentication Events**: Login attempts, registrations, and authorization failures
- **File Operations**: Upload, download, and file management activities
- **User Actions**: Account creation, profile updates, and other user activities
- **System Events**: Configuration changes, health checks, and system operations
- **Errors and Warnings**: Application errors, validation failures, and security warnings

## Configuration

### Logging Settings

The logging system can be configured through the Flare admin panel under Settings > Logging, or by modifying the configuration directly:

```typescript
{
  "logging": {
    "enabled": true,                    // Enable/disable logging
    "level": "info",                   // Global log level: error, warn, info, debug
    "console": {
      "enabled": true,                 // Log to console
      "format": "pretty"               // Console format: json, pretty
    },
    "file": {
      "enabled": true,                 // Log to files
      "path": "./logs",                // Log directory path
      "maxSize": 10,                   // Max file size in MB
      "maxFiles": 5,                   // Max number of log files to keep
      "format": "json"                 // File format: json, pretty
    },
    "categories": {
      "api": { "enabled": true, "level": "info" },
      "auth": { "enabled": true, "level": "info" },
      "upload": { "enabled": true, "level": "info" },
      "database": { "enabled": true, "level": "warn" },
      "system": { "enabled": true, "level": "info" },
      "user": { "enabled": true, "level": "info" }
    }
  }
}
```

### Log Levels

- **error**: Critical errors that need immediate attention
- **warn**: Warning messages for potentially problematic situations
- **info**: General information about system operations
- **debug**: Detailed debugging information (use sparingly in production)

### Log Categories

- **api**: HTTP API requests and responses
- **auth**: Authentication and authorization events
- **upload**: File upload and management operations
- **database**: Database operations and errors
- **system**: System configuration and health events
- **user**: User account and profile activities

## Log Format

Logs are structured as JSON objects with the following fields:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "category": "api",
  "message": "File upload successful",
  "userId": "user123",
  "ipAddress": "192.168.1.100",
  "userAgent": "Mozilla/5.0...",
  "requestId": "req_abc123",
  "endpoint": "/api/files",
  "method": "POST",
  "statusCode": 200,
  "responseTime": 1250,
  "metadata": {
    "fileName": "document.pdf",
    "fileSize": 1048576,
    "mimeType": "application/pdf"
  }
}
```

## Log Files

Log files are stored in the configured directory (default: `./logs`) with the following naming convention:

- `flare-YYYY-MM-DD.log` - Daily log files in JSON format

Example log directory structure:

```
logs/
├── flare-2024-01-15.log
├── flare-2024-01-14.log
├── flare-2024-01-13.log
└── flare-2024-01-12.log
```

## Viewing and Analyzing Logs

### Using the Log Viewer

The logging system includes a built-in log viewer utility:

```typescript
import { logViewer } from '@/lib/logging/viewer'

// Get recent logs
const recentLogs = logViewer.getLogs({ limit: 100 })

// Get error logs from the last 24 hours
const errors = logViewer.getLogs({
  level: 'error',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
})

// Get user activity
const userActivity = logViewer.getUserActivity('user123')

// Get API statistics
const apiStats = logViewer.getApiStats(24) // Last 24 hours
```

### Command Line Tools

You can also view logs using standard command-line tools:

```bash
# View recent logs
tail -f logs/flare-$(date +%Y-%m-%d).log

# Search for errors
grep '"level":"error"' logs/flare-*.log

# Search for specific user activity
grep '"userId":"user123"' logs/flare-*.log

# Count API requests by status code
grep '"statusCode"' logs/flare-*.log | grep -o '"statusCode":[0-9]*' | sort | uniq -c
```

### Log Analysis with jq

For advanced log analysis, use `jq` to parse JSON logs:

```bash
# Get all failed login attempts
cat logs/flare-*.log | jq 'select(.category == "auth" and .message | contains("failed"))'

# Get average response times by endpoint
cat logs/flare-*.log | jq -r 'select(.responseTime) | "\(.endpoint) \(.responseTime)"' | \
  awk '{sum[$1]+=$2; count[$1]++} END {for(i in sum) print i, sum[i]/count[i]}'

# Get error rate by hour
cat logs/flare-*.log | jq -r 'select(.level == "error") | .timestamp' | \
  cut -T1 | sort | uniq -c
```

## Security Monitoring

The logging system helps monitor security events:

### Failed Authentication Attempts

```bash
# Monitor failed login attempts
grep '"message":".*failed"' logs/flare-*.log | grep '"category":"auth"'
```

### Suspicious Activity

```bash
# Monitor unauthorized access attempts
grep '"statusCode":40[13]' logs/flare-*.log

# Monitor large file uploads
cat logs/flare-*.log | jq 'select(.category == "upload" and .metadata.fileSize > 10000000)'
```

### Rate Limiting

```bash
# Find IPs with high request rates
cat logs/flare-*.log | jq -r '.ipAddress' | sort | uniq -c | sort -nr | head -20
```

## Maintenance

### Log Rotation

Logs are automatically rotated daily. To implement custom log rotation:

```bash
# Compress old logs
gzip logs/flare-$(date -d '7 days ago' +%Y-%m-%d).log

# Delete logs older than 30 days
find logs/ -name "flare-*.log" -mtime +30 -delete
```

### Monitoring Disk Usage

```bash
# Check log directory size
du -sh logs/

# Monitor log file sizes
ls -lh logs/
```

## Troubleshooting

### Common Issues

1. **Logs not appearing**: Check that logging is enabled in configuration
2. **Permission errors**: Ensure write permissions for the log directory
3. **Disk space**: Monitor disk usage and implement log rotation
4. **Performance**: Use appropriate log levels to avoid excessive logging

### Performance Considerations

- Use `info` level for production (avoid `debug`)
- Monitor disk I/O if logging to files
- Consider log rotation and cleanup policies
- Disable categories not needed for your use case

## Integration with Monitoring Tools

### Logstash/Elasticsearch

```bash
# Send logs to Elasticsearch via Logstash
tail -f logs/flare-*.log | logstash -f logstash.conf
```

### Grafana/Prometheus

Export log metrics to Prometheus for visualization in Grafana.

### Alerting

Set up alerts for critical events:

- Error rate above threshold
- Failed authentication attempts
- Unusual upload patterns
- System health issues

## Privacy Considerations

The logging system is designed with privacy in mind:

- Passwords are never logged
- Personal data is minimal (user IDs, not emails in most cases)
- File contents are never logged
- IP addresses can be anonymized if needed

### Anonymizing Logs

To anonymize IP addresses:

```bash
# Replace last octet with 0
sed -i 's/"ipAddress":"[0-9]*\.[0-9]*\.[0-9]*\.[0-9]*"/"ipAddress":"xxx.xxx.xxx.0"/g' logs/flare-*.log
```

## API for Log Access

Access logs programmatically:

```typescript
// Get logs via API (admin only)
const response = await fetch('/api/admin/logs', {
  headers: { Authorization: `Bearer ${token}` },
})

const logs = await response.json()
```

## Best Practices

1. **Regular Monitoring**: Check logs daily for errors and unusual patterns
2. **Retention Policy**: Implement appropriate log retention based on your needs
3. **Backup**: Include logs in your backup strategy
4. **Analysis**: Use log analysis tools to gain insights
5. **Alerting**: Set up alerts for critical issues
6. **Privacy**: Regularly review logged data for privacy compliance

## Example Use Cases

### Monitoring User Activity

```typescript
// Track user file uploads
const uploads = logViewer.getLogs({
  category: 'upload',
  userId: 'user123',
  startDate: new Date('2024-01-01'),
})
```

### Performance Analysis

```typescript
// Find slow API endpoints
const slowEndpoints = logViewer.getApiStats(24).slowestEndpoints
```

### Security Auditing

```typescript
// Monitor authentication failures
const authFailures = logViewer.getLogs({
  category: 'auth',
  search: 'failed',
  startDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
})
```

### System Health

```typescript
// Check recent errors
const recentErrors = logViewer.getRecentErrors(50)
```

This comprehensive logging system provides complete visibility into your Flare instance, helping you maintain security, performance, and reliability.
