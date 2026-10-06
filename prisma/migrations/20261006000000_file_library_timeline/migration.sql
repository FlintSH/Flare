-- Scope chronological pages and timeline aggregation to the account before
-- scanning upload dates. id preserves deterministic ordering for equal dates.
CREATE INDEX "File_userId_uploadedAt_id_idx" ON "File"("userId", "uploadedAt" DESC, "id");
