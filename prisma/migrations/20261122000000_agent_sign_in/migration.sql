-- Browser sign-in for agents: Flare as the OAuth 2.1 authorization server of
-- its own MCP endpoint. Codes and tokens are stored as digests only.

-- Apps that registered themselves. What they claim is not a verified identity.
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- What a person approved, waiting 60 seconds to be redeemed once.
CREATE TABLE "OAuthCode" (
    "hash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" TEXT[],
    "sessionVersion" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "connectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("hash")
);

-- An agent a person signed in: the family its token pairs belong to.
CREATE TABLE "AgentConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "AgentConnection_pkey" PRIMARY KEY ("id")
);

-- One access token and the refresh token issued with it.
CREATE TABLE "AgentToken" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accessHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshHash" TEXT NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "narrowed" BOOLEAN NOT NULL DEFAULT false,
    "scopes" TEXT[],
    "rotatedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentToken_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OAuthClient_usedAt_createdAt_idx" ON "OAuthClient"("usedAt", "createdAt");
CREATE INDEX "OAuthCode_clientId_idx" ON "OAuthCode"("clientId");
CREATE INDEX "OAuthCode_userId_idx" ON "OAuthCode"("userId");
CREATE INDEX "OAuthCode_expiresAt_idx" ON "OAuthCode"("expiresAt");
CREATE INDEX "AgentConnection_userId_idx" ON "AgentConnection"("userId");
CREATE INDEX "AgentConnection_clientId_idx" ON "AgentConnection"("clientId");
CREATE UNIQUE INDEX "AgentToken_accessHash_key" ON "AgentToken"("accessHash");
CREATE UNIQUE INDEX "AgentToken_refreshHash_key" ON "AgentToken"("refreshHash");
CREATE INDEX "AgentToken_connectionId_idx" ON "AgentToken"("connectionId");
CREATE INDEX "AgentToken_parentId_idx" ON "AgentToken"("parentId");
CREATE INDEX "AgentToken_refreshExpiresAt_idx" ON "AgentToken"("refreshExpiresAt");

ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentToken" ADD CONSTRAINT "AgentToken_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AgentConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
