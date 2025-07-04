import type { Writable as NodeWritable, Readable } from 'node:stream'

export interface RangeOptions {
  start?: number
  end?: number
}

export interface StorageProvider {
  uploadFile(file: Buffer, path: string, mimeType: string): Promise<void>
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
  // Optional method for direct download URLs (S3 specific)
  getDownloadUrl?(path: string, filename?: string): Promise<string>
}

export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  forcePathStyle?: boolean
}
