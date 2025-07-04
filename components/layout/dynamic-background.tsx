export function DynamicBackground() {
  return (
    <div className="fixed inset-0 -z-10">
      {}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-background/95" />

      {}
      <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 via-transparent to-transparent" />

      {}
      <div className="absolute inset-0 bg-gradient-to-bl from-transparent via-transparent to-secondary/15" />

      {}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/10 to-transparent" />

      {}
      <div className="absolute inset-0 bg-radial-gradient from-primary/5 via-transparent to-background/50" />

      {}
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-gradient-radial from-primary/20 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-gradient-radial from-accent/15 to-transparent rounded-full blur-3xl" />
        <div className="absolute top-1/2 right-1/3 w-64 h-64 bg-gradient-radial from-secondary/20 to-transparent rounded-full blur-2xl" />
      </div>

      {}
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

      {}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  )
}
