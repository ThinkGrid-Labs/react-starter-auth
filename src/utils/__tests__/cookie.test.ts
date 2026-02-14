import Cookies from 'js-cookie';
import { setAuthToken, getAuthToken, clearAuthToken } from '../cookie';

jest.mock('js-cookie', () => ({
    set: jest.fn(),
    get: jest.fn(),
    remove: jest.fn(),
}));

describe('Cookie Utils', () => {
    const token = 'test-token';

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should set auth token with secure flag', () => {
        setAuthToken(token, true);
        expect(Cookies.set).toHaveBeenCalledWith('starter_auth_token', token, expect.objectContaining({ secure: true }));
    });

    it('should set auth token without secure flag', () => {
        setAuthToken(token, false);
        expect(Cookies.set).toHaveBeenCalledWith('starter_auth_token', token, expect.objectContaining({ secure: false }));
    });

    it('should get auth token', () => {
        (Cookies.get as jest.Mock).mockReturnValue(token);
        const result = getAuthToken();
        expect(Cookies.get).toHaveBeenCalledWith('starter_auth_token');
        expect(result).toBe(token);
    });

    it('should clear auth token', () => {
        clearAuthToken();
        expect(Cookies.remove).toHaveBeenCalledWith('starter_auth_token');
    });
});
