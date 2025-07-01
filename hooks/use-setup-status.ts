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
    // Setup status is critical for app functionality
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    // Refetch on window focus to ensure fresh status
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  })
}

// Hook to manage setup status updates
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
