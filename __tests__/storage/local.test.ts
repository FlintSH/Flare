import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { LocalStorageProvider } from '@/lib/storage/providers/local'

import { runStorageProviderContract } from './provider-contract'

// Each setup gets an isolated temp working directory because LocalStorageProvider
// resolves paths against process.cwd().
runStorageProviderContract('local', async () => {
  const originalCwd = process.cwd()
  const dir = await mkdtemp(join(tmpdir(), 'flare-local-storage-'))
  process.chdir(dir)

  return {
    provider: new LocalStorageProvider(),
    prefix: 'uploads/contract',
    cleanup: async () => {
      process.chdir(originalCwd)
      await rm(dir, { recursive: true, force: true })
    },
  }
})
