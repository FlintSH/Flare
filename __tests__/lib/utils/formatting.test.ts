import {
  bytesToMB,
  cn,
  formatBytes,
  formatFileSize,
  mbToBytes,
} from '@/lib/utils/formatting'

describe('Formatting Utilities', () => {
  describe('cn (className merger)', () => {
    it('should merge class names correctly', () => {
      expect(cn('class1', 'class2')).toBe('class1 class2')
      expect(cn('p-4', 'bg-red-500', 'text-white')).toBe(
        'p-4 bg-red-500 text-white'
      )
    })

    it('should handle conditional classes', () => {
      expect(cn('base', { conditional: true, 'not-included': false })).toBe(
        'base conditional'
      )
    })

    it('should handle array inputs', () => {
      expect(cn(['class1', 'class2'])).toBe('class1 class2')
    })

    it('should handle empty or falsy inputs', () => {
      expect(cn('')).toBe('')
      expect(cn(null)).toBe('')
      expect(cn(undefined)).toBe('')
      expect(cn(false)).toBe('')
    })
  })

  describe('formatBytes', () => {
    it('should format bytes correctly', () => {
      expect(formatBytes(0)).toBe('0 Bytes')
      expect(formatBytes(1024)).toBe('1 KB')
      expect(formatBytes(1024 * 1024)).toBe('1 MB')
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
    })

    it('should handle decimal places', () => {
      expect(formatBytes(1536, 1)).toBe('1.5 KB')
      expect(formatBytes(1536, 0)).toBe('2 KB')
      expect(formatBytes(1536, 2)).toBe('1.50 KB')
    })

    it('should handle negative decimals', () => {
      expect(formatBytes(1536, -1)).toBe('2 KB')
    })

    it('should handle large numbers', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1 TB')
      expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1 PB')
    })
  })

  describe('bytesToMB', () => {
    it('should convert bytes to megabytes', () => {
      expect(bytesToMB(1024 * 1024)).toBe(1)
      expect(bytesToMB(5 * 1024 * 1024)).toBe(5)
      expect(bytesToMB(0)).toBe(0)
    })

    it('should handle decimal values', () => {
      expect(bytesToMB(1.5 * 1024 * 1024)).toBe(1.5)
    })
  })

  describe('mbToBytes', () => {
    it('should convert megabytes to bytes', () => {
      expect(mbToBytes(1)).toBe(1024 * 1024)
      expect(mbToBytes(5)).toBe(5 * 1024 * 1024)
      expect(mbToBytes(0)).toBe(0)
    })

    it('should handle decimal values', () => {
      expect(mbToBytes(1.5)).toBe(1.5 * 1024 * 1024)
    })
  })

  describe('formatFileSize', () => {
    it('should format file sizes correctly', () => {
      expect(formatFileSize(0)).toBe('0 Bytes')
      expect(formatFileSize(0.001)).toBe('1024 Bytes')
      expect(formatFileSize(0.01)).toBe('10.24 KB')
      expect(formatFileSize(1)).toBe('1.00 MB')
      expect(formatFileSize(1024)).toBe('1.00 GB')
    })

    it('should handle decimal places', () => {
      expect(formatFileSize(1.5, 1)).toBe('1.5 MB')
      expect(formatFileSize(1.5, 0)).toBe('2 MB')
      expect(formatFileSize(1.5, 3)).toBe('1.500 MB')
    })

    it('should handle very small values', () => {
      expect(formatFileSize(0.0001)).toBe('102 Bytes')
      expect(formatFileSize(0.001)).toBe('1024 Bytes')
    })

    it('should handle very large values', () => {
      expect(formatFileSize(1500)).toBe('1.46 GB')
      expect(formatFileSize(2048)).toBe('2.00 GB')
    })
  })
})
