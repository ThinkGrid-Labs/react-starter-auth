import Cookies from 'js-cookie';
import { FetcherOptions } from './types';

const AUTH_TOKEN_KEY = 'starter_auth_token';

function updateOptions(options: FetcherOptions): RequestInit {
  const { headers, ...rest } = options;
  const token = Cookies.get(AUTH_TOKEN_KEY);

  const updatedHeaders = new Headers(headers);

  if (token && !updatedHeaders.has('Authorization')) {
    updatedHeaders.set('Authorization', `Bearer ${token}`);
  }

  return {
    ...rest,
    headers: updatedHeaders,
  };
}

export default function fetcher(url: string, options: FetcherOptions = {}): Promise<Response> {
  return fetch(url, updateOptions(options));
}
