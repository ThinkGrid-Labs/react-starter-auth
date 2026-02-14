import * as React from 'react';
import { deleteStateUser, isAuthenticated } from './utils/helpers';

export interface ProtectedRouteProps {
  component: React.ComponentType<any>;
  redirectPath?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  component: Component,
  redirectPath = '/login',
}) => {
  const isAuth = isAuthenticated();

  React.useEffect(() => {
    if (!isAuth && typeof window !== 'undefined') {
      deleteStateUser();
      window.location.href = redirectPath;
    }
  }, [isAuth, redirectPath]);

  if (!isAuth) {
    return null;
  }

  return <Component />;
};

export default ProtectedRoute;