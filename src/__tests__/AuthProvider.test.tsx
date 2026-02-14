import React from 'react';
import { render, screen, act } from '@testing-library/react';
import AuthProvider from '../AuthProvider';

import useAuth from '../useAuth';
import * as CookieUtils from '../utils/cookie';
import * as Helpers from '../utils/helpers';

// Mocks
jest.mock('../utils/cookie');
jest.mock('../utils/helpers');

const TestComponent = () => {
    const { isAuthenticated, user, signIn, logOut } = useAuth();
    return (
        <div>
            <div data-testid="auth-status">{isAuthenticated ? 'Authenticated' : 'Not Authenticated'}</div>
            <div data-testid="user-name">{user ? user.name : 'No User'}</div>
            <button onClick={() => signIn({ token: 'new-token', user: { name: 'New User', email: 'new@example.com' } })}>
                Sign In
            </button>
            <button onClick={() => logOut()}>Log Out</button>
        </div>
    );
};

describe('AuthProvider', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Default mock implementations
        (CookieUtils.getAuthToken as jest.Mock).mockReturnValue(null);
        (Helpers.getStateUser as jest.Mock).mockReturnValue(null);
        (Helpers.isTokenValid as jest.Mock).mockReturnValue(false);
    });

    it('renders children', () => {
        render(
            <AuthProvider>
                <div>Child Content</div>
            </AuthProvider>
        );
        expect(screen.getByText('Child Content')).toBeTruthy();
    });

    it('initializes as not authenticated by default', () => {
        render(
            <AuthProvider>
                <TestComponent />
            </AuthProvider>
        );
        expect(screen.getByText('Not Authenticated')).toBeTruthy();
    });

    it('loads user from cookies if token is valid', async () => {
        const mockUser = { name: 'Existing User' };
        (CookieUtils.getAuthToken as jest.Mock).mockReturnValue('valid-token');
        (Helpers.isTokenValid as jest.Mock).mockReturnValue(true);
        (Helpers.getStateUser as jest.Mock).mockReturnValue(mockUser);

        await act(async () => {
            render(
                <AuthProvider>
                    <TestComponent />
                </AuthProvider>
            );
        });

        expect(screen.getByText('Authenticated')).toBeTruthy();
        expect(screen.getByText('Existing User')).toBeTruthy();
    });

    it('signs in user and updates state', () => {
        render(
            <AuthProvider>
                <TestComponent />
            </AuthProvider>
        );

        act(() => {
            screen.getByText('Sign In').click();
        });

        expect(CookieUtils.setAuthToken).toHaveBeenCalled();
        expect(Helpers.setStateUser).toHaveBeenCalled();
    });
});
