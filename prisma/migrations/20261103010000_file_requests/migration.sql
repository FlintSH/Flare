-- File requests let people without an account send files to the owner. No
-- permissions change here: Administrator includes fileRequests.manage
-- automatically, and Everyone receives it only when an administrator grants it.
CREATE TABLE "FileRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT NOT NULL DEFAULT 'optional',
    "profileId" TEXT,
    "folderId" TEXT,
    "maxFiles" INTEGER,
    "maxBytes" BIGINT,
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notify" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "bytesReceived" BIGINT NOT NULL DEFAULT 0,
    "lastReceivedAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FileRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FileRequestSubmission" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "FileRequestSubmission_pkey" PRIMARY KEY ("id")
);

-- Files senders have started but not finished, held against the request's limits.
CREATE TABLE "FileRequestUpload" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "clientKey" TEXT,
    "bytes" BIGINT NOT NULL,
    "touchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileRequestUpload_pkey" PRIMARY KEY ("id")
);

-- A nullable column without a default leaves existing file rows untouched.
ALTER TABLE "File" ADD COLUMN "fileRequestSubmissionId" TEXT;

CREATE UNIQUE INDEX "FileRequest_token_key" ON "FileRequest"("token");
CREATE INDEX "FileRequest_userId_createdAt_idx" ON "FileRequest"("userId", "createdAt");
-- Deleting a profile or folder clears it on every request that uses it.
CREATE INDEX "FileRequest_profileId_idx" ON "FileRequest"("profileId");
CREATE INDEX "FileRequest_folderId_idx" ON "FileRequest"("folderId");
CREATE UNIQUE INDEX "FileRequestSubmission_keyHash_key" ON "FileRequestSubmission"("keyHash");
CREATE INDEX "FileRequestSubmission_requestId_createdAt_idx" ON "FileRequestSubmission"("requestId", "createdAt");
CREATE INDEX "FileRequestSubmission_requestId_completedAt_idx" ON "FileRequestSubmission"("requestId", "completedAt");
CREATE INDEX "FileRequestUpload_requestId_touchedAt_idx" ON "FileRequestUpload"("requestId", "touchedAt");
-- A retried start finds its upload by the key the sender's page chose.
CREATE UNIQUE INDEX "FileRequestUpload_submissionId_clientKey_key" ON "FileRequestUpload"("submissionId", "clientKey");
CREATE INDEX "File_fileRequestSubmissionId_idx" ON "File"("fileRequestSubmissionId");

ALTER TABLE "File" ADD CONSTRAINT "File_fileRequestSubmissionId_fkey" FOREIGN KEY ("fileRequestSubmissionId") REFERENCES "FileRequestSubmission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UploadProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FileRequestSubmission" ADD CONSTRAINT "FileRequestSubmission_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FileRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileRequestUpload" ADD CONSTRAINT "FileRequestUpload_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FileRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileRequestUpload" ADD CONSTRAINT "FileRequestUpload_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "FileRequestSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
