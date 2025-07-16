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
    <div className="relative flex flex-col flex-1 min-h-screen overflow-hidden">
      <DynamicBackground />
      <GlobalDropZone maxSize={maxUploadSize} />

      <header className="fixed top-0 left-0 right-0 z-50 pt-4 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="relative bg-background/80 backdrop-blur-xl border border-border/50 rounded-2xl shadow-lg shadow-black/5 supports-[backdrop-filter]:bg-background/60 transition-all duration-300 hover:shadow-xl hover:shadow-black/10">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-accent/5 rounded-2xl" />
            <div className="relative flex h-16 items-center px-6">
              <DashboardNav />
              <div className="ml-auto flex items-center space-x-4">
                <UserNav />
              </div>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 w-full pt-24 relative z-10">
        <div className="max-w-7xl mx-auto py-6 px-4">{children}</div>
      </main>
      {showFooter && <Footer />}
    </div>
  )
}
