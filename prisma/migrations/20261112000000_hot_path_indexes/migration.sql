-- Publishing an upload checks that no file already uses its storage path, and
-- every part of a chunked upload does the same. Without an index that read
-- every one of the owner's files (or, for a part, every file on the instance)
-- inside the publish transaction.
CREATE INDEX "File_path_idx" ON "File"("path");

-- The library's type filter lists an account's distinct file types by walking
-- this index from one type to the next instead of reading every file.
CREATE INDEX "File_userId_mimeType_idx" ON "File"("userId", "mimeType");

-- A library page looks up the pending expiry of each file it lists. Jobs keep
-- the file's ID in their JSON payload, so index that expression; Prisma's
-- schema cannot describe an expression index and leaves it alone.
CREATE INDEX "Event_payload_fileId_idx" ON "Event"((payload ->> 'fileId'));

-- An account's short links are listed newest first.
CREATE INDEX "ShortenedUrl_userId_createdAt_idx" ON "ShortenedUrl"("userId", "createdAt" DESC);
