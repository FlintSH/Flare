import { HttpError } from '@/lib/http/errors'
import { FORM_FRAMING_BYTES, readForm } from '@/lib/http/request'

import {
  IMAGE_NAMES,
  type ImagePolicy,
  type ImageType,
  imageProblem,
  imageType,
} from './image'

function typeNames(types: readonly ImageType[]) {
  const names = types.map((type) => IMAGE_NAMES[type])
  return names.length > 2
    ? `${names.slice(0, -1).join(', ')}, or ${names.at(-1)}`
    : names.join(' or ')
}

/**
 * The image in a multipart form's `file` field, held to `policy`: by its size
 * and the type its browser reports, then by its bytes, which must be an image
 * of a type the policy takes. Its type is the one its bytes show.
 */
export async function readImageUpload(
  request: Request,
  policy: ImagePolicy
): Promise<{ bytes: Buffer; type: ImageType }> {
  const form = await readForm(request, {
    limit: policy.maxBytes + FORM_FRAMING_BYTES,
  })
  const file = form.get('file')
  if (!(file instanceof File)) throw new HttpError(400, 'No file provided')
  const problem = imageProblem(policy, file)
  if (problem) throw new HttpError(problem.status, problem.message)
  const bytes = Buffer.from(await file.arrayBuffer())
  const type = imageType(bytes)
  if (!type || !policy.types.includes(type))
    throw new HttpError(
      400,
      `File content is not a ${typeNames(policy.types)} image.`
    )
  return { bytes, type }
}
