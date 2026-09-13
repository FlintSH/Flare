'use client'

import Link from 'next/link'

import { Upload } from 'lucide-react'

import { FileGrid } from '@/components/dashboard/file-grid'
import { WorkspacePage } from '@/components/dashboard/page-shell'
import { Button } from '@/components/ui/button'

export function DashboardClient() {
  return (
    <WorkspacePage
      title="Files"
      description="A home for everything you share. Find a file, grab its link, and make it yours."
      actions={
        <Button asChild className="rounded-xl">
          <Link href="/dashboard/upload">
            <Upload className="mr-2 h-4 w-4" />
            Upload files
          </Link>
        </Button>
      }
    >
      <FileGrid />
    </WorkspacePage>
  )
}
