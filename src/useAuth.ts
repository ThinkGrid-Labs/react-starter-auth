import * as React from 'react';
import AuthContext from './AuthContext';
import { AuthError } from './errors';
import { AuthContextType } from './types';

const useAuth = <TUser = Record<string, any>>(): AuthContextType<TUser> => {
    const context = React.useContext(AuthContext);
    if (context === null) {
        throw new AuthError('AuthProvider is missing. Please add the AuthProvider');
    }
    return context as AuthContextType<TUser>;
};

export default useAuth;
