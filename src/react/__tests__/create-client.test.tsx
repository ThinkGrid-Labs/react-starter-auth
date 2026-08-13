import { render, renderHook, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import * as React from 'react';

import { AuthError } from '../../errors';
import { ClientConfig } from '../types';
import { createAuthClient } from '../create-client';

interface User extends Record<string, unknown> {
  id: string;
  name: string;
}

const ADA: User = { id: '1', name: 'Ada' };
const farFuture = () => Date.now() + 3_600_000;

function res(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  document.cookie = 'csrf=token-abc';
});

afterEach(() => {
  document.cookie = 'csrf=; max-age=0';
  jest.clearAllMocks();
});

function makeClient(config: ClientConfig = {}) {
  const navigate = jest.fn();
  const client = createAuthClient<User>({ basePath: '/api/auth', navigate, ...config });
  return { ...client, navigate };
}

function hookOn(
  client: ReturnType<typeof makeClient>,
  initialSession?: { user: User; expiresAt: number } | null,
) {
  const { AuthProvider, useAuth } = client;
  return renderHook(() => useAuth(), {
    wrapper: ({ children }) => (
      <AuthProvider initialSession={initialSession}>{children}</AuthProvider>
    ),
  });
}

describe('server-rendered handoff', () => {
  it('is authenticated on the first render, with no fetch', () => {
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(ADA);
    expect(result.current.isLoading).toBe(false);
    // The whole point: no loading flash, no fetch waterfall on mount.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is signed out on the first render when the server said so', () => {
    const client = makeClient();
    const { result } = hookOn(client, null);

    expect(result.current.status).toBe('unauthenticated');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to fetching when no session is supplied', async () => {
    fetchMock.mockResolvedValue(res(200, { user: ADA, expiresAt: farFuture() }));
    const client = makeClient();
    const { result } = hookOn(client, undefined);

    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/session',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('stays in loading until the fetch settles', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const client = makeClient();
    const { result } = hookOn(client, undefined);

    expect(result.current.status).toBe('loading');
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('resolves to signed out on a 401', async () => {
    fetchMock.mockResolvedValue(res(401, { error: 'unauthenticated' }));
    const client = makeClient();
    const { result } = hookOn(client, undefined);

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'));
  });
});

describe('derived flags', () => {
  it('never contradicts status', async () => {
    fetchMock.mockResolvedValue(res(200, { user: ADA, expiresAt: farFuture() }));
    const client = makeClient();
    const { result } = hookOn(client, undefined);

    expect([result.current.isLoading, result.current.isAuthenticated]).toEqual([true, false]);
    await waitFor(() => expect(result.current.status).toBe('authenticated'));
    expect([result.current.isLoading, result.current.isAuthenticated]).toEqual([false, true]);
  });
});

describe('signIn', () => {
  it('posts credentials and never receives a token', async () => {
    fetchMock.mockResolvedValue(res(200, { user: ADA, expiresAt: farFuture() }));
    const client = makeClient();
    const { result } = hookOn(client, null);

    await act(async () => {
      await result.current.signIn({ email: 'ada@example.com', password: 'hunter2' });
    });

    expect(result.current.status).toBe('authenticated');
    expect(result.current.user).toEqual(ADA);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['x-csrf-token']).toBe('token-abc');
    expect(JSON.parse(init.body)).toEqual({ email: 'ada@example.com', password: 'hunter2' });
  });

  it('throws the server error code and stays signed out', async () => {
    fetchMock.mockResolvedValue(res(401, { error: 'invalid_credentials' }));
    const client = makeClient();
    const { result } = hookOn(client, null);

    let caught: unknown;
    await act(async () => {
      await result.current.signIn({ password: 'wrong' }).catch((error) => {
        caught = error;
      });
    });

    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).message).toBe('invalid_credentials');
    expect(result.current.status).toBe('unauthenticated');
  });

  it('fetches a CSRF token first when the cookie is missing', async () => {
    document.cookie = 'csrf=; max-age=0';
    fetchMock.mockResolvedValue(res(200, { user: ADA, expiresAt: farFuture() }));
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    await act(async () => {
      await result.current.signIn({ password: 'hunter2' }).catch(() => undefined);
    });

    // Server-rendered apps never hit GET /session, so the token is fetched.
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      '/api/auth/csrf',
      '/api/auth/login',
    ]);
  });
});

describe('signOut', () => {
  it('clears state without navigating by default', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true }));
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    await act(async () => {
      await result.current.signOut();
    });

    expect(result.current.status).toBe('unauthenticated');
    expect(result.current.user).toBeNull();
    expect(client.navigate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('navigates when asked', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: true }));
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    await act(async () => {
      await result.current.signOut({ redirectTo: '/goodbye' });
    });

    expect(client.navigate).toHaveBeenCalledWith('/goodbye');
  });

  it('still drops local state when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    await act(async () => {
      await result.current.signOut().catch(() => undefined);
    });

    // Rendering a signed-in UI after an explicit sign-out is worse than the
    // cookie possibly outliving it.
    expect(result.current.status).toBe('unauthenticated');
  });
});

describe('revalidate', () => {
  it('keeps the session on a network error rather than signing out', async () => {
    const client = makeClient();
    const { result } = hookOn(client, { user: ADA, expiresAt: farFuture() });

    fetchMock.mockRejectedValue(new Error('offline'));
    await act(async () => {
      await result.current.revalidate();
    });

    expect(result.current.status).toBe('authenticated');
  });
});

describe('guards', () => {
  function Probe({ client }: { client: ReturnType<typeof makeClient> }) {
    const { SignedIn, SignedOut } = client;
    return (
      <>
        <SignedIn fallback={<span>checking</span>}>
          <span>secret</span>
        </SignedIn>
        <SignedOut>
          <span>please sign in</span>
        </SignedOut>
      </>
    );
  }

  it('shows the fallback while loading, and nothing signed-out', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const client = makeClient();
    const { AuthProvider } = client;

    render(
      <AuthProvider>
        <Probe client={client} />
      </AuthProvider>,
    );

    expect(screen.getByText('checking')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.queryByText('please sign in')).toBeNull();
  });

  it('shows protected content when authenticated', () => {
    const client = makeClient();
    const { AuthProvider } = client;

    render(
      <AuthProvider initialSession={{ user: ADA, expiresAt: farFuture() }}>
        <Probe client={client} />
      </AuthProvider>,
    );

    expect(screen.getByText('secret')).toBeTruthy();
    expect(screen.queryByText('please sign in')).toBeNull();
  });

  it('shows the signed-out branch when unauthenticated', () => {
    const client = makeClient();
    const { AuthProvider } = client;

    render(
      <AuthProvider initialSession={null}>
        <Probe client={client} />
      </AuthProvider>,
    );

    expect(screen.getByText('please sign in')).toBeTruthy();
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('re-renders guards when auth state changes', async () => {
    fetchMock.mockResolvedValue(res(200, { user: ADA, expiresAt: farFuture() }));
    const client = makeClient();
    const { AuthProvider, useAuth } = client;

    const SignOutButton = () => {
      const { signOut } = useAuth();
      return <button onClick={() => void signOut()}>out</button>;
    };

    render(
      <AuthProvider initialSession={{ user: ADA, expiresAt: farFuture() }}>
        <Probe client={client} />
        <SignOutButton />
      </AuthProvider>,
    );

    expect(screen.getByText('secret')).toBeTruthy();

    // 0.1.x read cookies instead of context here, so this never updated.
    await act(async () => {
      screen.getByText('out').click();
    });

    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('please sign in')).toBeTruthy();
  });
});

describe('useRequireAuth', () => {
  it('redirects signed-out visitors', async () => {
    const client = makeClient();
    const { AuthProvider, useRequireAuth } = client;

    renderHook(() => useRequireAuth(), {
      wrapper: ({ children }) => <AuthProvider initialSession={null}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(client.navigate).toHaveBeenCalledWith('/login'));
  });

  it('honours a custom destination', async () => {
    const client = makeClient();
    const { AuthProvider, useRequireAuth } = client;

    renderHook(() => useRequireAuth({ redirectTo: '/enter' }), {
      wrapper: ({ children }) => <AuthProvider initialSession={null}>{children}</AuthProvider>,
    });

    await waitFor(() => expect(client.navigate).toHaveBeenCalledWith('/enter'));
  });

  it('does not redirect while loading or when authenticated', () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    const client = makeClient();
    const { AuthProvider, useRequireAuth } = client;

    renderHook(() => useRequireAuth(), {
      wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
    });
    expect(client.navigate).not.toHaveBeenCalled();

    const authed = makeClient();
    renderHook(() => authed.useRequireAuth(), {
      wrapper: ({ children }) => (
        <authed.AuthProvider initialSession={{ user: ADA, expiresAt: farFuture() }}>
          {children}
        </authed.AuthProvider>
      ),
    });
    expect(authed.navigate).not.toHaveBeenCalled();
  });
});

describe('useAuth outside a provider', () => {
  it('throws a named AuthError', () => {
    const { useAuth } = makeClient();
    // React logs the thrown error; silence it for this assertion.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useAuth())).toThrow(AuthError);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isolation between clients', () => {
  it('gives each client its own context', () => {
    const a = makeClient();
    const b = makeClient();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // b's hook cannot read a's provider.
      expect(() =>
        renderHook(() => b.useAuth(), {
          wrapper: ({ children }) => <a.AuthProvider initialSession={null}>{children}</a.AuthProvider>,
        }),
      ).toThrow(AuthError);
    } finally {
      spy.mockRestore();
    }
  });
});
