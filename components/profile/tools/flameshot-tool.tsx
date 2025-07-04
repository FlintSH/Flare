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
  useWayland: z.boolean().default(false),
  useCompositor: z.boolean().default(false),
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
        title: 'Success',
        description: 'Flameshot script downloaded successfully',
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
    <div className="flex items-center justify-between">
      <div className="space-y-1">
        <h3 className="font-medium">Flameshot</h3>
        <p className="text-sm text-muted-foreground">
          Powerful cross-platform screenshot software for Linux, MacOS, and
          Windows
        </p>
      </div>
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">Download Script</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Flameshot Upload Script</DialogTitle>
            <DialogDescription>
              Generate a custom upload script for Flameshot on Linux.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(handleFlameshotDownload)}
              className="space-y-6"
            >
              {}
              <div className="flex items-start space-x-3 rounded-md bg-amber-50 dark:bg-amber-950/50 p-3 text-amber-600 dark:text-amber-400">
                <Terminal className="mt-0.5 h-5 w-5 flex-shrink-0" />
                <div className="space-y-1">
                  <div className="text-sm opacity-90">
                    Make sure you have these installed:
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                        flameshot
                      </span>
                      <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                        curl
                      </span>
                      <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                        jq
                      </span>
                      <span className="inline-flex items-center rounded-md bg-amber-100/50 dark:bg-amber-900/50 px-2 py-1 text-xs font-medium">
                        xsel
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-medium mb-1">
                    Environment Settings
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
                              Wayland Clipboard Support
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
                              Hyprland Compatibility
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
                    Reset Options
                  </Button>
                  <Button type="submit" disabled={isLoading}>
                    {isLoading ? 'Downloading...' : 'Download Script'}
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
