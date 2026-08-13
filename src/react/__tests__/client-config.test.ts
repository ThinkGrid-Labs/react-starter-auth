/**
 * @jest-environment node
 *
 * Client config under SSR — deliberately the node environment, with no `window`
 * at all. The default `navigate` must be inert there rather than throwing
 * during a server render.
 */
import { resolveClientConfig } from '../types';

describe('resolveClientConfig', () => {
  it('fills in defaults', () => {
    const config = resolveClientConfig();

    expect(config).toMatchObject({
      basePath: '/api/auth',
      csrfCookieName: 'csrf',
      csrfHeaderName: 'x-csrf-token',
      revalidateOnFocus: true,
      refreshSkewSeconds: 60,
      syncAcrossTabs: true,
    });
  });

  it('strips a trailing slash from basePath', () => {
    expect(resolveClientConfig({ basePath: '/auth/' }).basePath).toBe('/auth');
    expect(resolveClientConfig({ basePath: '/auth' }).basePath).toBe('/auth');
  });

  it('lets callers override any field', () => {
    const navigate = jest.fn();
    const config = resolveClientConfig({
      navigate,
      revalidateOnFocus: false,
      refreshSkewSeconds: 5,
      syncAcrossTabs: false,
      csrfHeaderName: 'x-my-token',
    });

    expect(config.navigate).toBe(navigate);
    expect(config.revalidateOnFocus).toBe(false);
    expect(config.refreshSkewSeconds).toBe(5);
    expect(config.syncAcrossTabs).toBe(false);
    expect(config.csrfHeaderName).toBe('x-my-token');
  });

  it('has a default navigate that is a no-op without a window', () => {
    expect(typeof window).toBe('undefined');
    // A server render must not blow up because something asked to navigate.
    expect(() => resolveClientConfig().navigate('/login')).not.toThrow();
  });
});
