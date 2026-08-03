CREATE TABLE "mcp_deployment_configs" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "apiKeyHash" TEXT,
    "apiKeyHint" TEXT,
    "apiKeyRotatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_deployment_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_clients" (
    "id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_clients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_authorizations" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "state" TEXT,
    "scopes" JSONB NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "resource" TEXT,
    "codeHash" TEXT,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_authorizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_tokens" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "resource" TEXT,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_oauth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_deployment_configs_apiKeyHash_key" ON "mcp_deployment_configs"("apiKeyHash");
CREATE UNIQUE INDEX "mcp_oauth_authorizations_codeHash_key" ON "mcp_oauth_authorizations"("codeHash");
CREATE INDEX "mcp_oauth_authorizations_clientId_expiresAt_idx" ON "mcp_oauth_authorizations"("clientId", "expiresAt");
CREATE UNIQUE INDEX "mcp_oauth_tokens_accessTokenHash_key" ON "mcp_oauth_tokens"("accessTokenHash");
CREATE UNIQUE INDEX "mcp_oauth_tokens_refreshTokenHash_key" ON "mcp_oauth_tokens"("refreshTokenHash");
CREATE INDEX "mcp_oauth_tokens_clientId_refreshExpiresAt_idx" ON "mcp_oauth_tokens"("clientId", "refreshExpiresAt");

ALTER TABLE "mcp_oauth_authorizations"
ADD CONSTRAINT "mcp_oauth_authorizations_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_oauth_tokens"
ADD CONSTRAINT "mcp_oauth_tokens_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_clients"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
