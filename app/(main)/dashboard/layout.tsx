import { DashboardNav } from '@/components/dashboard/nav'
import { UserNav } from '@/components/dashboard/user-nav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex flex-col flex-1">
      <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/75 backdrop-blur-md supports-[backdrop-filter]:bg-background/40 transition-all duration-200">
        <div className="max-w-7xl mx-auto flex h-14 items-center px-4">
          <DashboardNav />
          <div className="ml-auto flex items-center space-x-4">
            <UserNav />
          </div>
        </div>
      </header>
      <main className="flex-1 w-full mt-14">
        <div className="max-w-7xl mx-auto py-6 px-4">{children}</div>
      </main>
    </div>
  )
}
