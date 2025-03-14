import Image from 'next/image'

import { Infinity, AlertCircle, Copy, FileIcon, Loader2 } from 'lucide-react'

const FlareIcon = (
  props: Omit<
    React.ComponentProps<typeof Image>,
    'src' | 'alt' | 'width' | 'height'
  >
) => (
  <Image src="/icon.svg" width={24} height={24} alt="Flare Logo" {...props} />
)

export const Icons = {
  logo: FlareIcon,
  spinner: Loader2,
  file: FileIcon,
  alertCircle: AlertCircle,
  copy: Copy,
  infinity: Infinity,
} as const
