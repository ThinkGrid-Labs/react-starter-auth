import * as React from 'react';

import AuthContext from './AuthContext';
import { deleteStateUser, getStateUser, isTokenValid, setStateUser } from './utils/helpers';
import { setAuthToken, getAuthToken } from './utils/cookie';
import { AuthStateInterface } from './types';

export interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider<TUser = Record<string, any>>({ children }: AuthProviderProps) {
  const [authUser, setAuthUser] = React.useState<TUser | null>(null);
  const [isLoading, setLoading] = React.useState(true);

  const logOut = React.useCallback((redirectPath?: string) => {
    deleteStateUser();
    setAuthUser(null);
    if (typeof window !== 'undefined' && redirectPath !== null) {
      window.location.href = redirectPath || '/';
    }
  }, []);

  React.useEffect(() => {
    async function loadUserFromCookies() {
      try {
        const token = getAuthToken();
        if (token) {
          if (isTokenValid(token)) {
            const user = getStateUser<TUser>();
            setAuthUser(user);
          } else {
            logOut(null as any); // Logout without redirect during init
          }
        }
      } catch (error) {
        console.error('Failed to load auth state:', error);
      } finally {
        setLoading(false);
      }
    }
    loadUserFromCookies();
  }, [logOut]);

  const signIn = React.useCallback((state: AuthStateInterface<TUser>) => {
    if (state?.token) {
      const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
      setAuthToken(state.token, isSecure);

      const user = state.user || ({ name: 'Anonymous' } as unknown as TUser);
      setStateUser(user);
      setAuthUser(user);
    }
  }, []);

  const value = React.useMemo(() => ({
    isLoading,
    isAuthenticated: !!authUser,
    user: authUser,
    signIn,
    logOut,
  }), [isLoading, authUser, signIn, logOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export default AuthProvider;
