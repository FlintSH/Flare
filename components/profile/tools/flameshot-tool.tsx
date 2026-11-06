'use client'

import { useState } from 'react'

import Image from 'next/image'

import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'

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

import {
  type UploaderOptions,
  uploaderClients,
} from '@/lib/uploads/uploader-clients'

import { DependencyNotice, ToolRow, type UploaderToolProps } from './tool-parts'
import { useUploaderDownload } from './use-uploader-download'

const flameshot = uploaderClients.flameshot

export function FlameshotTool({
  profileId,
  compact,
  disabled,
}: UploaderToolProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const form = useForm<UploaderOptions<'flameshot'>>({
    resolver: zodResolver(flameshot.options),
    defaultValues: flameshot.defaults,
  })
  const { download, isLoading } = useUploaderDownload('flameshot', {
    ready: {
      title: 'Flameshot script ready',
      description:
        'Run the downloaded script with Bash to capture and upload. Setup instructions are included in the script.',
    },
    failed: {
      title: 'Error',
      description: 'Failed to download Flameshot configuration',
    },
  })

  const dialog = (
    <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          disabled={disabled}
        >
          {compact ? flameshot.label : 'Download script'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Flameshot upload script</DialogTitle>
          <DialogDescription>
            Choose your Linux options. Your upload token is already included in
            the script.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(async (values) => {
              if (await download(values, profileId)) setIsDialogOpen(false)
            })}
            className="space-y-6"
          >
            <DependencyNotice commands={flameshot.dependencies(form.watch())} />

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
  )
  if (compact) return dialog

  return (
    <ToolRow
      title="Flameshot"
      description="Capture and upload on Linux only. Choose your environment options, then run the downloaded script with Bash."
      action={dialog}
    />
  )
}
