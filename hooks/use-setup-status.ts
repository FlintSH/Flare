import { useQuery, useQueryClient } from '@tanstack/react-query'

interface SetupStatus {
  completed: boolean
}

const SETUP_STATUS_QUERY_KEY = ['setup-status']

async function fetchSetupStatus(): Promise<SetupStatus> {
  const response = await fetch('/api/setup/check')

  if (!response.ok) {
    throw new Error(`Setup check failed: ${response.status}`)
  }

  return response.json()
}

export function useSetupStatus(enabled = true) {
  return useQuery({
    queryKey: SETUP_STATUS_QUERY_KEY,
    queryFn: fetchSetupStatus,
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  })
}

export function useSetupStatusMutations() {
  const queryClient = useQueryClient()

  const invalidateSetupStatus = () => {
    queryClient.invalidateQueries({ queryKey: SETUP_STATUS_QUERY_KEY })
  }

  const updateSetupStatus = (completed: boolean) => {
    queryClient.setQueryData(SETUP_STATUS_QUERY_KEY, { completed })
  }

  const refetchSetupStatus = () => {
    return queryClient.refetchQueries({ queryKey: SETUP_STATUS_QUERY_KEY })
  }

  return {
    invalidateSetupStatus,
    updateSetupStatus,
    refetchSetupStatus,
  }
}
