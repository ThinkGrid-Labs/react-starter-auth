import * as React from 'react';
import { isAuthenticated } from './utils/helpers';

export function withAuthentication<P extends Record<string, unknown>>(
  Component: React.ComponentType<P>,
  redirectPath: string = '/login'
): React.FC<P> {
  const Auth: React.FC<P> = (props) => {
    const isAuth = isAuthenticated();

    React.useEffect(() => {
      if (!isAuth && typeof window !== 'undefined') {
        window.location.href = redirectPath;
      }
    }, [isAuth]);

    if (!isAuth) {
      return null;
    }

    return <Component {...props} />;
  };

  return Auth;
}

export default withAuthentication;