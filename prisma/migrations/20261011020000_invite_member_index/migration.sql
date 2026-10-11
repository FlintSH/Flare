-- Invite lists find and count joined accounts by inviteId, and deleting an
-- invite's creator clears it on each joined account. Avoid account-table scans.
CREATE INDEX "User_inviteId_idx" ON "User"("inviteId");
