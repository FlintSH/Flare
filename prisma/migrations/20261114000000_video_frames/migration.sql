-- A still frame of each video, made once by ffmpeg the first time the video's
-- thumbnail or link preview is asked for, so a restart or a large library
-- doesn't make it again. Rows go with their file. Nothing is backfilled.

-- CreateTable
CREATE TABLE "VideoFrame" (
    "fileId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "image" BYTEA,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoFrame_pkey" PRIMARY KEY ("fileId")
);

-- AddForeignKey
ALTER TABLE "VideoFrame" ADD CONSTRAINT "VideoFrame_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

