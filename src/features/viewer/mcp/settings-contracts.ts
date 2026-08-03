export type CoreyMcpSettings = {
  deploymentReady: boolean;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  apiKeyRotatedAt: string | null;
  mcpUrl: string | null;
  appUrl: string;
  oauthAvailable: boolean;
};

export type CoreyMcpSettingsMutation = {
  settings: CoreyMcpSettings;
  apiKey?: string;
};

export type CoreyMcpOAuthClient = {
  client_id: string;
  client_id_issued_at?: number;
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method: "none";
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
};

export type CoreyMcpOAuthTokens = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

export type CoreyMcpCredentialInfo = {
  userId: string;
  clientId: string;
  scopes: string[];
  expiresAt?: number;
};
