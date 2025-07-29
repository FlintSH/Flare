interface LoadingStateProps {
  message?: string
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  return (
    <div className="w-full flex items-center justify-center p-8">
      <p className="text-muted-foreground">{message}</p>
    </div>
  )
}
