export interface AuthContextType<TUser = Record<string, any>> {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: TUser | null;
  signIn: (state: AuthStateInterface<TUser>) => void;
  logOut: (redirectPath?: string) => void;
}

export interface AuthStateInterface<TUser = Record<string, any>> {
  token: string;
  user?: TUser | null;
}

export interface TokenObject {
  iss?: string;
  sub?: string;
  aud?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  jti?: string;
}

export interface TokenHeader {
  typ?: string;
  alg?: string;
  kid?: string;
}

export interface TokenDecodeOptions {
  header?: boolean;
}

export interface FetcherOptions extends RequestInit {
  headers?: HeadersInit;
}

