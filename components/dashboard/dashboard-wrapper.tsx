import { GlobalDropZone } from '@/components/dashboard/global-drop-zone'
import { DashboardNav } from '@/components/dashboard/nav'
import { UserNav } from '@/components/dashboard/user-nav'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { PermissionGate } from '@/components/roles/permission-gate'

interface DashboardWrapperProps {
  children: React.ReactNode
  showFooter: boolean
  maxUploadSize: number
}

export function DashboardWrapper({
  children,
  showFooter,
  maxUploadSize,
}: DashboardWrapperProps) {
  return (
    <div className="relative flex flex-col flex-1 min-h-screen">
      <DynamicBackground />
      <PermissionGate permission="files.upload">
        <GlobalDropZone maxSize={maxUploadSize} />
      </PermissionGate>

      <a
        href="#main-content"
        className="fixed left-6 top-6 z-[100] -translate-y-[200%] rounded-lg bg-primary px-4 py-3 text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Skip to content
      </a>
      {/* The bar shares the content column's width and gutters. */}
      <header className="fixed inset-x-0 top-0 z-40 pt-4">
        {/* Fades scrolled content out above and behind the floating bar. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background via-background/70 to-transparent"
        />
        <div className="relative mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center gap-3 rounded-2xl border border-border/60 bg-background/85 px-4 shadow-sm backdrop-blur-xl sm:px-6">
            <DashboardNav />
            <div className="ml-auto flex shrink-0 items-center">
              <UserNav />
            </div>
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 w-full min-w-0 flex-1 pt-24 outline-none"
      >
        <div className="mx-auto max-w-7xl px-4 py-6">{children}</div>
      </main>
      {showFooter && <Footer compact />}
    </div>
  )
}
