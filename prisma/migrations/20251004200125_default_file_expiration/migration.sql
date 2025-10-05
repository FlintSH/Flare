-- CreateEnum
CREATE TYPE "public"."FileExpiration" AS ENUM ('DISABLED', 'HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "public"."ExpiryAction" AS ENUM ('DELETE', 'SET_PRIVATE');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "defaultFileExpiration" "public"."FileExpiration" NOT NULL DEFAULT 'DISABLED',
ADD COLUMN     "defaultFileExpirationAction" "public"."ExpiryAction" NOT NULL DEFAULT 'DELETE';
