'use client'

import { useEffect, useState } from 'react'

import {
  Activity,
  AlertTriangle,
  Clock,
  Database,
  FileText,
  Shield,
  TrendingUp,
  Users,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import type { FlareConfig } from '@/lib/config'
import type { LogCategory, LogEntry, LogLevel } from '@/lib/logging'

interface LoggingDashboardProps {
  config: FlareConfig
  onSettingChange: <T extends keyof FlareConfig['settings']>(
    section: T,
    value: Partial<FlareConfig['settings'][T]>
  ) => void
  getFieldClasses: (
    section: keyof FlareConfig['settings'],
    fieldPath: string[]
  ) => string
  isFieldChanged: (
    section: keyof FlareConfig['settings'],
    fieldPath: string[]
  ) => boolean
  ChangeIndicator: () => JSX.Element
}

interface LogStats {
  totalLogs: number
  errorCount: number
  warnCount: number
  infoCount: number
  debugCount: number
  categoryCounts: Record<LogCategory, number>
  timeRange: { start: Date | null; end: Date | null }
}

interface ApiStats {
  totalRequests: number
  errorRate: number
  slowestEndpoints: Array<{
    endpoint: string
    avgResponseTime: number
    count: number
  }>
  statusCodes: Record<number, number>
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoggingDashboard({
  config,
  onSettingChange,
  getFieldClasses,
  isFieldChanged,
  ChangeIndicator,
}: LoggingDashboardProps) {
  const [logStats, setLogStats] = useState<LogStats | null>(null)
  const [apiStats, setApiStats] = useState<ApiStats | null>(null)
  const [recentErrors, setRecentErrors] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadDashboardData = async () => {
    try {
      setRefreshing(true)

      // Mock data for development
      // In a real implementation, these would be API calls to server endpoints
      const stats: LogStats = {
        totalLogs: 1234,
        errorCount: 12,
        warnCount: 45,
        infoCount: 890,
        debugCount: 287,
        categoryCounts: {
          api: 567,
          auth: 123,
          upload: 234,
          database: 45,
          system: 178,
          user: 87,
        },
        timeRange: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000),
          end: new Date(),
        },
      }

      const apiStatsData: ApiStats = {
        totalRequests: 2456,
        errorRate: 2.3,
        slowestEndpoints: [
          { endpoint: '/api/files/upload', avgResponseTime: 1234, count: 45 },
          { endpoint: '/api/auth/login', avgResponseTime: 567, count: 123 },
          { endpoint: '/api/users', avgResponseTime: 345, count: 67 },
        ],
        statusCodes: { 200: 2234, 400: 45, 404: 123, 500: 54 },
      }

      const errors: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: 'error',
          category: 'api',
          message: 'Database connection failed',
          error: { name: 'ConnectionError', message: 'Connection timeout' },
        },
        {
          timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          level: 'error',
          category: 'upload',
          message: 'File upload validation failed',
          userId: 'user_123',
        },
      ]

      setLogStats(stats)
      setApiStats(apiStatsData)
      setRecentErrors(errors)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [])

  const handleLoggingSettingChange = (path: string[], value: unknown) => {
    if (!config.settings.logging) return

    const newLoggingConfig = { ...config.settings.logging }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let current = newLoggingConfig as any

    // Navigate to the parent of the field to update
    for (let i = 0; i < path.length - 1; i++) {
      current = current[path[i]]
    }

    // Set the value
    current[path[path.length - 1]] = value

    onSettingChange('logging', { ...newLoggingConfig })
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  const loggingConfig = config.settings.logging || {
    enabled: true,
    level: 'info' as LogLevel,
    console: { enabled: true, format: 'pretty' as const },
    file: {
      enabled: true,
      path: './logs',
      maxSize: 10,
      maxFiles: 5,
      format: 'json' as const,
    },
    categories: {
      api: { enabled: true, level: 'info' as LogLevel },
      auth: { enabled: true, level: 'info' as LogLevel },
      upload: { enabled: true, level: 'info' as LogLevel },
      database: { enabled: true, level: 'warn' as LogLevel },
      system: { enabled: true, level: 'info' as LogLevel },
      user: { enabled: true, level: 'info' as LogLevel },
    },
  }

  return (
    <div className="space-y-6">
      {/* System Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Overview
            </CardTitle>
            <CardDescription>
              Real-time logging statistics and system health
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadDashboardData}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </CardHeader>
        <CardContent>
          {logStats ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  Total Logs
                </div>
                <div className="text-2xl font-bold">
                  {logStats.totalLogs.toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  Errors
                </div>
                <div className="text-2xl font-bold text-red-500">
                  {logStats.errorCount.toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <TrendingUp className="h-4 w-4 text-orange-500" />
                  Warnings
                </div>
                <div className="text-2xl font-bold text-orange-500">
                  {logStats.warnCount.toLocaleString()}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Activity className="h-4 w-4 text-blue-500" />
                  API Requests (24h)
                </div>
                <div className="text-2xl font-bold text-blue-500">
                  {apiStats?.totalRequests.toLocaleString() || 0}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No logging data available. Ensure logging is enabled and some
              activity has occurred.
            </div>
          )}

          {apiStats && (
            <div className="mt-6 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">
                    API Error Rate (24h)
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {apiStats.errorRate.toFixed(1)}%
                  </span>
                </div>
                <Progress value={apiStats.errorRate} className="h-2" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Errors */}
      {recentErrors.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Recent Errors
            </CardTitle>
            <CardDescription>
              Latest error events that require attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentErrors.map((error, index) => (
                <Alert key={index} variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <div className="flex items-center justify-between">
                      <div>
                        <strong>{error.category.toUpperCase()}</strong>:{' '}
                        {error.message}
                      </div>
                      <div className="text-xs opacity-70">
                        {new Date(error.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Logging Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Logging Configuration</CardTitle>
          <CardDescription>
            Configure logging levels, output formats, and categories
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="general" className="space-y-4">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="categories">Categories</TabsTrigger>
              <TabsTrigger value="output">Output</TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Enable Logging</Label>
                  <p className="text-sm text-muted-foreground">
                    Master switch for all logging functionality
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {isFieldChanged('logging', ['enabled']) && (
                    <ChangeIndicator />
                  )}
                  <Switch
                    checked={loggingConfig.enabled}
                    onCheckedChange={(checked) =>
                      handleLoggingSettingChange(['enabled'], checked)
                    }
                    className={getFieldClasses('logging', ['enabled'])}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Global Log Level</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={loggingConfig.level}
                    onValueChange={(value) =>
                      handleLoggingSettingChange(['level'], value)
                    }
                  >
                    <SelectTrigger
                      className={getFieldClasses('logging', ['level'])}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="error">Error</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="debug">Debug</SelectItem>
                    </SelectContent>
                  </Select>
                  {isFieldChanged('logging', ['level']) && <ChangeIndicator />}
                </div>
                <p className="text-sm text-muted-foreground">
                  Only logs at this level and above will be recorded
                </p>
              </div>
            </TabsContent>

            <TabsContent value="categories" className="space-y-4">
              <div className="space-y-4">
                {Object.entries(loggingConfig.categories).map(
                  ([category, settings]) => (
                    <Card key={category}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                          {category === 'api' && (
                            <Activity className="h-4 w-4" />
                          )}
                          {category === 'auth' && (
                            <Shield className="h-4 w-4" />
                          )}
                          {category === 'upload' && (
                            <FileText className="h-4 w-4" />
                          )}
                          {category === 'database' && (
                            <Database className="h-4 w-4" />
                          )}
                          {category === 'system' && (
                            <TrendingUp className="h-4 w-4" />
                          )}
                          {category === 'user' && <Users className="h-4 w-4" />}
                          {category.charAt(0).toUpperCase() +
                            category.slice(1)}{' '}
                          Logging
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label>Enabled</Label>
                          <div className="flex items-center gap-2">
                            {isFieldChanged('logging', [
                              'categories',
                              category,
                              'enabled',
                            ]) && <ChangeIndicator />}
                            <Switch
                              checked={settings.enabled}
                              onCheckedChange={(checked) =>
                                handleLoggingSettingChange(
                                  ['categories', category, 'enabled'],
                                  checked
                                )
                              }
                              className={getFieldClasses('logging', [
                                'categories',
                                category,
                                'enabled',
                              ])}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <Label>Level</Label>
                          <div className="flex items-center gap-2">
                            <Select
                              value={settings.level}
                              onValueChange={(value) =>
                                handleLoggingSettingChange(
                                  ['categories', category, 'level'],
                                  value
                                )
                              }
                              disabled={!settings.enabled}
                            >
                              <SelectTrigger
                                className={getFieldClasses('logging', [
                                  'categories',
                                  category,
                                  'level',
                                ])}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="error">Error</SelectItem>
                                <SelectItem value="warn">Warning</SelectItem>
                                <SelectItem value="info">Info</SelectItem>
                                <SelectItem value="debug">Debug</SelectItem>
                              </SelectContent>
                            </Select>
                            {isFieldChanged('logging', [
                              'categories',
                              category,
                              'level',
                            ]) && <ChangeIndicator />}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                )}
              </div>
            </TabsContent>

            <TabsContent value="output" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Console Logging</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Enable Console Output</Label>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('logging', ['console', 'enabled']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
                        checked={loggingConfig.console.enabled}
                        onCheckedChange={(checked) =>
                          handleLoggingSettingChange(
                            ['console', 'enabled'],
                            checked
                          )
                        }
                        className={getFieldClasses('logging', [
                          'console',
                          'enabled',
                        ])}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Console Format</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={loggingConfig.console.format}
                        onValueChange={(value) =>
                          handleLoggingSettingChange(
                            ['console', 'format'],
                            value
                          )
                        }
                        disabled={!loggingConfig.console.enabled}
                      >
                        <SelectTrigger
                          className={getFieldClasses('logging', [
                            'console',
                            'format',
                          ])}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pretty">
                            Pretty (Human-readable)
                          </SelectItem>
                          <SelectItem value="json">JSON</SelectItem>
                        </SelectContent>
                      </Select>
                      {isFieldChanged('logging', ['console', 'format']) && (
                        <ChangeIndicator />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">File Logging</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Enable File Output</Label>
                    <div className="flex items-center gap-2">
                      {isFieldChanged('logging', ['file', 'enabled']) && (
                        <ChangeIndicator />
                      )}
                      <Switch
                        checked={loggingConfig.file.enabled}
                        onCheckedChange={(checked) =>
                          handleLoggingSettingChange(
                            ['file', 'enabled'],
                            checked
                          )
                        }
                        className={getFieldClasses('logging', [
                          'file',
                          'enabled',
                        ])}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Log Directory Path</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        value={loggingConfig.file.path}
                        onChange={(e) =>
                          handleLoggingSettingChange(
                            ['file', 'path'],
                            e.target.value
                          )
                        }
                        placeholder="./logs"
                        disabled={!loggingConfig.file.enabled}
                        className={getFieldClasses('logging', ['file', 'path'])}
                      />
                      {isFieldChanged('logging', ['file', 'path']) && (
                        <ChangeIndicator />
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Max File Size (MB)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={loggingConfig.file.maxSize}
                          onChange={(e) =>
                            handleLoggingSettingChange(
                              ['file', 'maxSize'],
                              parseInt(e.target.value) || 10
                            )
                          }
                          placeholder="10"
                          disabled={!loggingConfig.file.enabled}
                          className={getFieldClasses('logging', [
                            'file',
                            'maxSize',
                          ])}
                        />
                        {isFieldChanged('logging', ['file', 'maxSize']) && (
                          <ChangeIndicator />
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Max Files to Keep</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={loggingConfig.file.maxFiles}
                          onChange={(e) =>
                            handleLoggingSettingChange(
                              ['file', 'maxFiles'],
                              parseInt(e.target.value) || 5
                            )
                          }
                          placeholder="5"
                          disabled={!loggingConfig.file.enabled}
                          className={getFieldClasses('logging', [
                            'file',
                            'maxFiles',
                          ])}
                        />
                        {isFieldChanged('logging', ['file', 'maxFiles']) && (
                          <ChangeIndicator />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>File Format</Label>
                    <div className="flex items-center gap-2">
                      <Select
                        value={loggingConfig.file.format}
                        onValueChange={(value) =>
                          handleLoggingSettingChange(['file', 'format'], value)
                        }
                        disabled={!loggingConfig.file.enabled}
                      >
                        <SelectTrigger
                          className={getFieldClasses('logging', [
                            'file',
                            'format',
                          ])}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="json">
                            JSON (Recommended)
                          </SelectItem>
                          <SelectItem value="pretty">
                            Pretty (Human-readable)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {isFieldChanged('logging', ['file', 'format']) && (
                        <ChangeIndicator />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* API Performance */}
      {apiStats && apiStats.slowestEndpoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              API Performance (24h)
            </CardTitle>
            <CardDescription>
              Slowest endpoints and response time analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {apiStats.slowestEndpoints.slice(0, 5).map((endpoint, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="space-y-1">
                    <div className="font-mono text-sm">{endpoint.endpoint}</div>
                    <div className="text-xs text-muted-foreground">
                      {endpoint.count} requests
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">
                      {endpoint.avgResponseTime.toFixed(0)}ms
                    </div>
                    <div className="text-xs text-muted-foreground">
                      avg response
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Log Management */}
      <Card>
        <CardHeader>
          <CardTitle>Log Management</CardTitle>
          <CardDescription>Manage log files and disk usage</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertDescription>
              Logs are stored in the configured directory. Consider implementing
              log rotation and cleanup policies to manage disk usage. See the
              documentation for advanced log management options.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  )
}
