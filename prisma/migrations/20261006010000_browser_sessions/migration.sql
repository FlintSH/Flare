CREATE TABLE "BrowserSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionVersion" INTEGER NOT NULL,
  "authMethod" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "BrowserSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BrowserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "BrowserSession_userId_revokedAt_expiresAt_idx" ON "BrowserSession"("userId", "revokedAt", "expiresAt");
CREATE INDEX "BrowserSession_expiresAt_idx" ON "BrowserSession"("expiresAt");
CREATE TABLE "LoginAttempt" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "authMethod" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LoginAttempt_userId_createdAt_id_idx" ON "LoginAttempt"("userId", "createdAt", "id");
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");
