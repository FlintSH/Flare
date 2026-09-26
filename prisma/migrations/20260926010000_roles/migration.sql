-- Roles replace the legacy binary authority model. Everyone applies implicitly,
-- so new registrations inherit its current permissions without join-table writes.
CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "color" TEXT NOT NULL DEFAULT '#64748b',
  "position" INTEGER NOT NULL DEFAULT 1,
  "permissions" TEXT[] NOT NULL,
  "systemKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Role_systemKey_key" ON "Role"("systemKey");
CREATE INDEX "Role_position_idx" ON "Role"("position");
CREATE TABLE "_RoleToUser" (
  "A" TEXT NOT NULL,
  "B" TEXT NOT NULL,
  CONSTRAINT "_RoleToUser_AB_pkey" PRIMARY KEY ("A", "B")
);
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "Role" ("id", "name", "description", "color", "position", "permissions", "systemKey", "updatedAt") VALUES
('builtin_everyone', 'Everyone', 'Base permissions for every account.', '#64748b', 0, ARRAY['files.read','files.upload','files.update','files.delete','files.share','pastes.create','folders.manage','folders.share','tags.manage','links.read','links.create','links.delete','profile.update','profile.export','uploadProfiles.manage','tokens.manage','webhooks.manage','appearance.personal'], 'everyone', CURRENT_TIMESTAMP),
('builtin_administrator', 'Admin', 'Full control of this instance.', '#ef4444', 100, ARRAY['administrator'], 'administrator', CURRENT_TIMESTAMP);
INSERT INTO "_RoleToUser" ("A", "B") SELECT 'builtin_administrator', "id" FROM "User" WHERE "role" = 'ADMIN';
ALTER TABLE "User" DROP COLUMN "role";
DROP TYPE "UserRole";
