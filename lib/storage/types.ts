import type { Writable as NodeWritable, Readable } from 'node:stream'

export interface RangeOptions {
  start?: number
  end?: number
}

export interface StorageProvider {
  // Discriminates the backend without resorting to `instanceof` checks.
  readonly kind: 'local' | 's3'
  uploadFile(file: Buffer, path: string, mimeType: string): Promise<void>
  uploadStream(
    stream: Readable,
    path: string,
    mimeType: string
  ): Promise<{ size: number }>
  uploadChunkedFile(
    chunksDir: string,
    targetPath: string,
    mimeType: string
  ): Promise<void>
  createWriteStream(path: string, mimeType: string): Promise<NodeWritable>
  deleteFile(path: string): Promise<void>
  getFileStream(path: string, range?: RangeOptions): Promise<Readable>
  getFileUrl(path: string): Promise<string>
  getFileSize(path: string): Promise<number>
  renameFolder(oldPath: string, newPath: string): Promise<void>
  initializeMultipartUpload(path: string, mimeType: string): Promise<string>
  getPresignedPartUploadUrl(
    path: string,
    uploadId: string,
    partNumber: number
  ): Promise<string>
  uploadPart(
    path: string,
    uploadId: string,
    partNumber: number,
    data: Buffer
  ): Promise<{ ETag: string }>
  completeMultipartUpload(
    path: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[]
  ): Promise<void>
  /**
   * Returns a URL a client can be redirected to in order to fetch the object
   * directly from the backend (e.g. an S3 presigned/public URL), or `null` when
   * the backend has no such URL and the caller must stream the bytes itself
   * (e.g. local filesystem).
   */
  getPublicUrl(path: string): Promise<string | null>
  /**
   * Like {@link getPublicUrl} but for forced downloads (attachment). Returns a
   * URL to redirect to, or `null` when the caller must stream the bytes with
   * attachment headers itself.
   */
  getDownloadUrl(path: string, filename?: string): Promise<string | null>
}

export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  forcePathStyle?: boolean
}
