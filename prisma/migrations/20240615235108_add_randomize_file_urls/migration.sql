-- Add randomizeFileUrls field to User table
ALTER TABLE "User" ADD COLUMN "randomizeFileUrls" BOOLEAN NOT NULL DEFAULT false; 