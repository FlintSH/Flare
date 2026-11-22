-- Short-lived URLs MCP tools hand to agents for moving file bytes.
CREATE TABLE "AgentTransfer" (
    "id" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credential" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileId" TEXT,
    "options" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentTransfer_secretHash_key" ON "AgentTransfer"("secretHash");
CREATE INDEX "AgentTransfer_userId_credential_idx" ON "AgentTransfer"("userId", "credential");
CREATE INDEX "AgentTransfer_expiresAt_idx" ON "AgentTransfer"("expiresAt");

ALTER TABLE "AgentTransfer" ADD CONSTRAINT "AgentTransfer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
