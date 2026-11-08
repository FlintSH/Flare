import { GlobalDropZone } from '@/components/dashboard/global-drop-zone'
import { DashboardNav } from '@/components/dashboard/nav'
import { UploadProgress } from '@/components/dashboard/upload-progress'
import { UserNav } from '@/components/dashboard/user-nav'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'
import { DraftLeaveProvider } from '@/components/providers/draft-leave-provider'
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
    <DraftLeaveProvider>
      <div className="relative flex flex-col flex-1 min-h-screen">
        <DynamicBackground />
        <PermissionGate permission="files.upload">
          <GlobalDropZone maxSize={maxUploadSize} />
          <UploadProgress />
        </PermissionGate>

        <a
          href="#main-content"
          className="fixed left-6 top-6 z-[100] -translate-y-[200%] rounded-lg bg-primary px-4 py-3 text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to content
        </a>
        {/* The bar shares the content column's width and gutters. */}
        <header
          data-dashboard-header=""
          className="fixed inset-x-0 top-0 z-40 pt-[8px] sm:pt-4"
        >
          {/* Fades scrolled content out above and behind the floating bar. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-background from-15% via-background/90 via-70% to-transparent"
          />
          <div className="relative mx-auto max-w-7xl px-[16px]">
            <div
              data-dashboard-bar=""
              className="flex min-h-[56px] items-center gap-[12px] rounded-[16px] border border-border/60 bg-background/95 px-[16px] py-[5px] shadow-sm backdrop-blur-xl sm:h-16 sm:rounded-2xl sm:px-6 sm:py-0"
            >
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
          className="relative z-10 w-full min-w-0 flex-1 pt-[80px] outline-none sm:pt-24"
        >
          <div className="mx-auto max-w-7xl px-4 py-3 sm:py-6">{children}</div>
        </main>
        {showFooter && <Footer compact />}
      </div>
    </DraftLeaveProvider>
  )
}
