-- NULL means no unfinished tagging work. Existing OCR is deliberately left
-- alone: adding a rule should not retroactively retag the whole vault.
ALTER TABLE "File" ADD COLUMN "ocrTagsPendingAt" TIMESTAMP(3);
CREATE INDEX "File_ocrTagsPendingAt_idx" ON "File"("ocrTagsPendingAt");
