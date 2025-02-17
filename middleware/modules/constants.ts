export const FILE_URL_PATTERN = /^\/[A-Za-z0-9]{4}\/[^\/]+\.[^\/]+(?:\/raw)?$/

export const PUBLIC_PATHS = [
  '/api/auth',
  '/_next',
  '/favicon.ico',
  '/icon.svg',
  '/api/setup/check',
  '/api/health',
  '/api/files',
  '/api/storage/type',
  '/auth/login',
  '/auth/register',
]

export const SETUP_PATHS = ['/setup', '/api/setup']

export const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv']
