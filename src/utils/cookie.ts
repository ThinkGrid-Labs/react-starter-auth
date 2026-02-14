import Cookies from "js-cookie";

const tokenName = 'starter_auth_token'

const setAuthToken = (token: string, secure: boolean) => {
    // Default to strict security
    const isIdsProduction = process.env.NODE_ENV === 'production';
    const isSecure = typeof secure === 'boolean' ? secure : isIdsProduction;

    Cookies.set(tokenName, token, {
        secure: isSecure,
        sameSite: 'Strict',
        expires: 7 // 7 days default
    });
};

const getAuthToken = (): string | null => {
    return Cookies.get(tokenName) || null;
};

const clearAuthToken = () => {
    Cookies.remove(tokenName);
};

export { setAuthToken, getAuthToken, clearAuthToken }