import * as React from 'react';
import { AuthContextType } from './types';

const AuthContext = React.createContext<AuthContextType<any> | null>(null);

export default AuthContext;


