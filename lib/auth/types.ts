export type AuthPrincipal = {
  subject: string;
  name: string;
  phone?: string;
  email?: string | null;
  avatarUrl?: string | null;
  permissions: string[];
};

export type AuthSession = {
  providerId: string;
  /** Short-lived access tokens are intentionally not persisted in the cookie. */
  accessToken?: string;
  refreshToken: string;
  expiresAt: number;
  principal: AuthPrincipal;
};

export type AuthTransaction = {
  providerId: string;
  state: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
};

export type ProviderTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export interface IdentityProvider {
  readonly id: string;
  authorizationUrl(input: { state: string; codeChallenge: string }): string;
  exchangeCode(input: { code: string; verifier: string }): Promise<ProviderTokens>;
  refresh(refreshToken: string): Promise<ProviderTokens>;
  userInfo(accessToken: string): Promise<AuthPrincipal>;
}

export class IdentityProviderError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = "IdentityProviderError";
  }
}
