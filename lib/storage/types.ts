import type { Readable } from 'node:stream'

import type { StorageTarget } from './targets'

export interface RangeOptions {
  start?: number
  end?: number
}

/** Positional reads from one stored object, for archive indexes. */
export interface RandomAccessFile {
  readonly size: number
  read(position: number, length: number): Promise<Buffer>
  close(): Promise<void>
}

export interface StorageProvider {
  // Discriminates the backend without resorting to `instanceof` checks.
  readonly kind: 'local' | 's3'
  /** Immutable, nonsecret identity of the backend this instance actually uses. */
  readonly target: Readonly<StorageTarget>
  uploadFile(file: Buffer, path: string, mimeType: string): Promise<void>
  uploadStream(
    stream: Readable,
    path: string,
    mimeType: string,
    signal?: AbortSignal
  ): Promise<{ size: number }>
  deleteFile(path: string): Promise<void>
  getFileStream(
    path: string,
    range?: RangeOptions,
    signal?: AbortSignal
  ): Promise<Readable>
  /**
   * Optional cheap positional reads. Providers without it serve archive reads
   * through ranged {@link getFileStream} requests instead.
   */
  openRandomAccess?(path: string): Promise<RandomAccessFile>
  /**
   * Where a stored object sits on this machine's disk, for tools that read
   * files by name. Only local storage has one.
   */
  localPath?(path: string): string
  getFileSize(path: string): Promise<number>
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
   * (e.g. local filesystem). `contentType` is the type to send the bytes
   * under, where the backend can be told: the type Flare recorded for the
   * file, which can differ from the one the object was stored with.
   */
  getPublicUrl(path: string, contentType?: string): Promise<string | null>
  /**
   * Like {@link getPublicUrl} but for forced downloads (attachment). Returns a
   * URL to redirect to, or `null` when the caller must stream the bytes with
   * attachment headers itself.
   */
  getDownloadUrl(
    path: string,
    filename?: string,
    contentType?: string
  ): Promise<string | null>
}

export interface S3Config {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  endpoint?: string
  forcePathStyle?: boolean
}
