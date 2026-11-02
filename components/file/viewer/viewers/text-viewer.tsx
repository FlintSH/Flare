import { languageFromFilename } from '@/lib/files/text-language'

import { TextContent } from '../components/text-content'
import { useFileViewer } from '../context'

export function TextViewer() {
  const { file } = useFileViewer()
  // Pastes are stored as text/plain; their extension names the language. The
  // share page sends it from the real name, which may be hidden.
  return (
    <TextContent
      language={file.textLanguage ?? languageFromFilename(file.name)}
    />
  )
}
