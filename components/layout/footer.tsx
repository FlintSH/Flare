import Link from 'next/link'

export function Footer() {
  return (
    <footer className="w-full py-4 px-4 bg-background">
      <div className="max-w-7xl mx-auto flex items-center justify-center text-sm text-muted-foreground text-center">
        <p>
          Flare is a free, open source, self-hostable file host.{' '}
          <Link
            href="https://github.com/FlintSH/flare"
            target="_blank"
            className="underline hover:text-foreground transition-colors"
          >
            View on GitHub
          </Link>
        </p>
      </div>
    </footer>
  )
}
