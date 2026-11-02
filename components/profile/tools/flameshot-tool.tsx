'use client'

import { useState } from 'react'

import Image from 'next/image'

import { FlameshotFormValues } from '@/types/components/profile'
import { zodResolver } from '@hookform/resolvers/zod'
import { Terminal } from 'lucide-react'
import { useForm } from 'react-hook-form'
import * as z from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'

import { useToast } from '@/hooks/use-toast'

const flameshotFormSchema = z.object({
  useWayland: z.boolean(),
  useCompositor: z.boolean(),
})

export function FlameshotTool() {
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const form = useForm<FlameshotFormValues>({
    resolver: zodResolver(flameshotFormSchema),
    defaultValues: {
      useWayland: false,
      useCompositor: false,
    },
  })

  const handleFlameshotDownload = async (values: FlameshotFormValues) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile/flameshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      })

      if (!response.ok) throw new Error('Failed to generate Flameshot script')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const filename =
        response.headers
          .get('content-disposition')
          ?.split('filename=')[1]
          .replace(/"/g, '') || 'flare-flameshot.sh'
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Flameshot script ready',
        description:
          'Run the downloaded script with Bash to capture and upload. Setup instructions are included in the script.',
      })
      setIsDialogOpen(false)
    } catch (error) {
      console.error('Flameshot script download error:', error)
      toast({
        title: 'Error',
        description: 'Failed to download Flameshot configuration',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium">Flameshot</h3>
        <p className="text-pretty text-sm text-muted-foreground">
          Capture and upload on Linux only. Choose your environment options,
          then run the downloaded script with Bash.
        </p>
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Download script</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Flameshot upload script</DialogTitle>
            <DialogDescription>
              Choose your Linux options. Your upload token is already included
              in the script.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleFlameshotDownload)}
              className="space-y-6"
            >
              {}
              <div className="flex items-start gap-3 rounded-xl border border-info/30 bg-info/5 p-3">
                <Terminal
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-info"
                  aria-hidden="true"
                />
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">
                    Make sure you have these installed:
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        flameshot
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        curl
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        jq
                      </span>
                      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
                        xsel
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-1">
                    Environment settings
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Customize the script for your system configuration
                  </p>
                </div>

                <div className="rounded-lg border bg-card divide-y">
                  <FormField
                    control={form.control}
                    name="useWayland"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-3">
                        <div className="flex gap-3 items-center">
                          <div className="relative w-5 h-5 flex-shrink-0">
                            <Image
                              src="/wayland.svg"
                              alt="Wayland"
                              fill
                              className="object-contain"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">
                              Wayland clipboard support
                            </FormLabel>
                            <FormDescription className="text-xs">
                              Enable if you&apos;re using Wayland
                            </FormDescription>
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="useCompositor"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between p-3">
                        <div className="flex gap-3 items-center">
                          <div className="relative w-5 h-5 flex-shrink-0">
                            <Image
                              src="/hyprland.svg"
                              alt="Hyprland"
                              fill
                              className="object-contain"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <FormLabel className="text-sm">
                              Hyprland compatibility
                            </FormLabel>
                            <FormDescription className="text-xs">
                              Enable if you&apos;re using Hyprland
                            </FormDescription>
                          </div>
                        </div>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <DialogFooter>
                <div className="flex w-full justify-between">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => form.reset()}
                  >
                    Reset options
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Downloading…' : 'Download script'}
                  </Button>
                </div>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
