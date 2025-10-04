-- CreateEnum
CREATE TYPE "public"."FileExpiration" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "public"."ExpiryAction" AS ENUM ('DELETE', 'SET_PRIVATE');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "defaultFileExpiration" "public"."FileExpiration",
ADD COLUMN     "defaultFileExpirationAction" "public"."ExpiryAction" NOT NULL DEFAULT 'DELETE';
