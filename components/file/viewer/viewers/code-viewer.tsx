import { CODE_FILE_TYPES } from '../../protected/mime-types'
import { TextContent } from '../components/text-content'
import { useFileViewer } from '../context'

export function CodeViewer() {
  const { file } = useFileViewer()
  return <TextContent language={CODE_FILE_TYPES[file.mimeType] || 'text'} />
}
