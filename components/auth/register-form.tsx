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

export function RegisterForm() {
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
    const confirmPassword = formData.get('confirmPassword') as string
    const name = formData.get('name') as string

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long')
      setIsLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          name,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to register')
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        throw new Error('Failed to sign in after registration')
      }

      router.push('/dashboard')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="w-full border bg-card shadow-xl">
      <form onSubmit={onSubmit}>
        <CardHeader className="space-y-2 text-center pb-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create an account
          </h1>
          <p className="text-base text-muted-foreground">
            Enter your details to get started
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium" htmlFor="name">
              Username
            </Label>
            <Input
              id="name"
              name="name"
              placeholder="Create a username"
              required
              disabled={isLoading}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="name"
              autoFocus
            />
          </div>
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
              required
              disabled={isLoading}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="new-password"
              placeholder="Create a strong password"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium" htmlFor="confirmPassword">
              Confirm password
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              disabled={isLoading}
              className="h-11 bg-background/50 focus:bg-background transition-colors"
              autoComplete="new-password"
              placeholder="Confirm your password"
            />
          </div>
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md flex items-center space-x-2">
              <Icons.alertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-4 pb-6">
          <Button
            type="submit"
            className="w-full h-11 font-medium bg-primary hover:bg-primary/90 transition-colors"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create account'
            )}
          </Button>
          <div className="text-sm text-muted-foreground text-center">
            Already have an account?{' '}
            <Link
              href="/auth/login"
              className="text-primary hover:text-primary/90 hover:underline transition-colors font-medium"
            >
              Sign in
            </Link>
          </div>
        </CardFooter>
      </form>
    </Card>
  )
}
