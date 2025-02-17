interface DashboardShellProps {
  children: React.ReactNode
  className?: string
}

export function DashboardShell({ children, className }: DashboardShellProps) {
  return (
    <div className={`flex-1 space-y-4 p-8 pt-6 ${className || ''}`}>
      {children}
    </div>
  )
}
