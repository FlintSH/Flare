-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passkeyRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PasskeyRecoveryCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "PasskeyRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasskeyRecoveryCode_hash_key" ON "PasskeyRecoveryCode"("hash");

-- CreateIndex
CREATE INDEX "PasskeyRecoveryCode_userId_idx" ON "PasskeyRecoveryCode"("userId");

-- AddForeignKey
ALTER TABLE "PasskeyRecoveryCode" ADD CONSTRAINT "PasskeyRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
