import { GlobalDropZone } from '@/components/dashboard/global-drop-zone'
import { DashboardNav } from '@/components/dashboard/nav'
import { UserNav } from '@/components/dashboard/user-nav'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Footer } from '@/components/layout/footer'

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
      <GlobalDropZone maxSize={maxUploadSize} />

      <a
        href="#main-content"
        className="sr-only fixed left-6 top-6 z-[100] rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center gap-3 px-4 sm:px-6">
          <DashboardNav />
          <div className="shrink-0 border-l border-border/60 pl-3 sm:pl-5">
            <UserNav />
          </div>
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="relative z-10 w-full min-w-0 flex-1 outline-none"
      >
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
          {children}
        </div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
