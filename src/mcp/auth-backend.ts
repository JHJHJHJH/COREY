import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import {
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  CoreyMcpCredentialInfo,
  CoreyMcpOAuthClient,
  CoreyMcpOAuthTokens,
} from "@/features/viewer/mcp/settings-contracts";

type BackendOptions = {
  baseUrl: string;
  appPublicUrl: string;
  serviceSecret: string;
};

class McpAuthBackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class McpAuthBackend implements OAuthRegisteredClientsStore, OAuthServerProvider {
  readonly clientsStore = this;
  readonly skipLocalPkceValidation = false;
  private readonly baseUrl: string;
  private readonly appPublicUrl: string;
  private readonly serviceSecret: string;

  constructor(options: BackendOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.appPublicUrl = options.appPublicUrl.replace(/\/+$/, "");
    this.serviceSecret = options.serviceSecret;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("x-corey-mcp-service-secret", this.serviceSecret);
    if (init.body) headers.set("Content-Type", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
      throw new McpAuthBackendError(
        response.status,
        typeof body?.error === "string"
          ? body.error
          : `MCP auth backend failed (${response.status}).`,
      );
    }
    return (await response.json()) as T;
  }

  private oauth<T>(body: Record<string, unknown>) {
    return this.request<T>("/api/mcp/internal/oauth", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async enabled() {
    const result = await this.request<{ enabled: boolean }>("/api/mcp/internal/status");
    return result.enabled;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const result = await this.oauth<{ client: CoreyMcpOAuthClient | null }>({
      action: "getClient",
      clientId,
    });
    return result.client ?? undefined;
  }

  async registerClient(
    input: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const generated = input as OAuthClientInformationFull;
    const client: CoreyMcpOAuthClient = {
      client_id: generated.client_id || randomUUID(),
      client_id_issued_at: generated.client_id_issued_at ?? Math.floor(Date.now() / 1000),
      client_name: generated.client_name,
      redirect_uris: generated.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: generated.scope,
    };
    const result = await this.oauth<{ client: CoreyMcpOAuthClient }>({
      action: "registerClient",
      client,
    });
    return result.client;
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    response: Response,
  ) {
    const result = await this.oauth<{ requestId: string }>({
      action: "startAuthorization",
      input: {
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        state: params.state,
        scopes: params.scopes ?? [],
        codeChallenge: params.codeChallenge,
        resource: params.resource?.toString(),
      },
    });
    const consentUrl = new URL("/mcp/authorize", this.appPublicUrl);
    consentUrl.searchParams.set("request", result.requestId);
    response.redirect(302, consentUrl.toString());
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ) {
    const result = await this.oauth<{ challenge: string | null }>({
      action: "challenge",
      clientId: client.client_id,
      code: authorizationCode,
    });
    if (!result.challenge) throw new InvalidGrantError("Invalid authorization code.");
    return result.challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const result = await this.oauth<{ tokens: CoreyMcpOAuthTokens | null }>({
      action: "exchangeCode",
      input: {
        clientId: client.client_id,
        code: authorizationCode,
        redirectUri,
        resource: resource?.toString(),
      },
    });
    if (!result.tokens) throw new InvalidGrantError("Invalid authorization code.");
    return result.tokens;
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const result = await this.oauth<{ tokens: CoreyMcpOAuthTokens | null }>({
      action: "refresh",
      input: {
        clientId: client.client_id,
        refreshToken,
        scopes,
        resource: resource?.toString(),
      },
    });
    if (!result.tokens) throw new InvalidGrantError("Invalid refresh token.");
    return result.tokens;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let result: CoreyMcpCredentialInfo;
    try {
      result = await this.request<CoreyMcpCredentialInfo>(
        "/api/mcp/internal/authenticate",
        {
          method: "POST",
          body: JSON.stringify({ token }),
        },
      );
    } catch (error) {
      if (error instanceof McpAuthBackendError && error.status === 401) {
        throw new InvalidTokenError("The MCP credential is invalid or disabled.");
      }
      throw error;
    }
    return {
      token,
      clientId: result.clientId,
      scopes: result.scopes,
      expiresAt: result.expiresAt,
      extra: { userId: result.userId },
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ) {
    await this.oauth({ action: "revoke", token: request.token });
  }
}
