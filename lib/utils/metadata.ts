export function getFileDescription({
  size,
  uploaderName,
  uploadedAt,
}: {
  size: string
  uploaderName: string
  uploadedAt: Date
}): string {
  const formattedDate = new Date(uploadedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return `${size} • Uploaded by ${uploaderName} • ${formattedDate}`
}
