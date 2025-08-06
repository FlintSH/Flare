-- AlterTable
ALTER TABLE "public"."File" ADD COLUMN     "compressionRatio" DOUBLE PRECISION,
ADD COLUMN     "isCompressed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalPath" TEXT,
ADD COLUMN     "originalSize" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "public"."CompressionSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "imageCompression" BOOLEAN NOT NULL DEFAULT true,
    "imageQuality" INTEGER NOT NULL DEFAULT 85,
    "imageFormat" TEXT,
    "videoCompression" BOOLEAN NOT NULL DEFAULT true,
    "videoQuality" INTEGER NOT NULL DEFAULT 80,
    "videoBitrate" TEXT,
    "videoCodec" TEXT,
    "maxWidth" INTEGER,
    "maxHeight" INTEGER,
    "keepOriginal" BOOLEAN NOT NULL DEFAULT true,
    "autoCompress" BOOLEAN NOT NULL DEFAULT true,
    "compressionThreshold" DOUBLE PRECISION DEFAULT 1048576,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompressionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompressionSettings_userId_key" ON "public"."CompressionSettings"("userId");

-- AddForeignKey
ALTER TABLE "public"."CompressionSettings" ADD CONSTRAINT "CompressionSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
