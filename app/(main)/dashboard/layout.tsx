import { DashboardNav } from '@/components/dashboard/nav'
import { UserNav } from '@/components/dashboard/user-nav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative flex flex-col flex-1 min-h-screen overflow-hidden">
      {/* Dynamic Background */}
      <div className="fixed inset-0 -z-10">
        {/* Base gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background/95" />

        {/* Primary accent gradient */}
        <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 via-transparent to-transparent" />

        {/* Secondary accent gradient */}
        <div className="absolute inset-0 bg-gradient-to-bl from-transparent via-transparent to-secondary/15" />

        {/* Accent highlight */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/10 to-transparent" />

        {/* Radial gradient overlay for depth */}
        <div className="absolute inset-0 bg-radial-gradient from-primary/5 via-transparent to-background/50" />

        {/* Geometric patterns */}
        <div className="absolute inset-0 opacity-30">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-radial from-primary/20 to-transparent rounded-full blur-3xl" />
          <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-gradient-radial from-accent/15 to-transparent rounded-full blur-3xl" />
          <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-gradient-radial from-secondary/20 to-transparent rounded-full blur-2xl" />
        </div>

        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `
              linear-gradient(hsl(var(--muted-foreground)) 1px, transparent 1px),
              linear-gradient(90deg, hsl(var(--muted-foreground)) 1px, transparent 1px)
            `,
            backgroundSize: '60px 60px',
          }}
        />

        {/* Noise texture for depth */}
        <div
          className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          }}
        />
      </div>

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
    </div>
  )
}
