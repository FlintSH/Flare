-- Invite links let selected people create accounts while public registration is
-- closed. No permissions change here: Administrator includes the new invite
-- permissions automatically, and Everyone receives them only when granted.
ALTER TABLE "User" ADD COLUMN "inviteId" TEXT;

CREATE TABLE "Invite" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "maxUses" INTEGER,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "_InviteToRole" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_InviteToRole_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE UNIQUE INDEX "Invite_tokenHash_key" ON "Invite"("tokenHash");
CREATE INDEX "Invite_creatorId_createdAt_idx" ON "Invite"("creatorId", "createdAt");
CREATE INDEX "Invite_createdAt_idx" ON "Invite"("createdAt");
CREATE INDEX "_InviteToRole_B_index" ON "_InviteToRole"("B");
ALTER TABLE "User" ADD CONSTRAINT "User_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "Invite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_InviteToRole" ADD CONSTRAINT "_InviteToRole_A_fkey" FOREIGN KEY ("A") REFERENCES "Invite"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_InviteToRole" ADD CONSTRAINT "_InviteToRole_B_fkey" FOREIGN KEY ("B") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
