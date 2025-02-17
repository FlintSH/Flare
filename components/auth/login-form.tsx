'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { signIn } from 'next-auth/react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface LoginFormProps {
  registrationsEnabled: boolean
  disabledMessage: string
}

export function LoginForm({
  registrationsEnabled,
  disabledMessage,
}: LoginFormProps) {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)
    setError(null)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    console.log('[Login] Attempting login for email:', email)

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
        callbackUrl: '/dashboard',
      })

      console.log('[Login] Sign in result:', {
        ok: result?.ok,
        error: result?.error,
        url: result?.url,
      })

      if (result?.error) {
        console.log('[Login] Login failed:', result.error)
        setError('Invalid email or password')
        return
      }

      console.log('[Login] Login successful, redirecting to dashboard')
      router.push((result?.url as string) || '/dashboard')
    } catch (error) {
      console.error('[Login] Unexpected error during login:', error)
      setError('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full border bg-card shadow-xl">
      <form onSubmit={onSubmit}>
        <CardHeader className="space-y-2 text-center pb-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome back
          </h1>
          <p className="text-base text-muted-foreground">
            {registrationsEnabled ? (
              <>
                Don&apos;t have an account?{' '}
                <Link
                  href="/auth/register"
                  className="text-primary hover:text-primary/90 hover:underline transition-colors font-medium"
                >
                  Sign up now
                </Link>
              </>
            ) : (
              disabledMessage || 'Registrations are currently disabled'
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium" htmlFor="email">
              Email address
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="name@example.com"
              required
              disabled={isLoading}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="email"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium" htmlFor="password">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="Enter your password"
              required
              disabled={isLoading}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md flex items-center space-x-2">
              <Icons.alertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="pb-6">
          <Button
            type="submit"
            className="w-full h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
