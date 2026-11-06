import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apiRequest } from '@/lib/client/request'

interface SetupStatus {
  completed: boolean
}

const SETUP_STATUS_QUERY_KEY = ['setup-status']

/**
 * Whether this instance has its first account. Pass the answer the server
 * rendered the page with, so the browser asks `/api/setup/check` only when
 * there is none or once it is stale.
 */
export function useSetupStatus(completed?: boolean) {
  return useQuery({
    queryKey: SETUP_STATUS_QUERY_KEY,
    queryFn: ({ signal }) =>
      apiRequest<SetupStatus>('/api/setup/check', { signal }),
    initialData: completed === undefined ? undefined : { completed },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    refetchOnWindowFocus: true,
    refetchOnMount: true,
    refetchOnReconnect: true,
  })
}

/**
 * Records that this browser just completed setup, so pages stop being sent
 * to setup without waiting for the stored status to expire.
 */
export function useMarkSetupComplete() {
  const queryClient = useQueryClient()
  return () =>
    queryClient.setQueryData<SetupStatus>(SETUP_STATUS_QUERY_KEY, {
      completed: true,
    })
}
