/**
 * Every error this package throws.
 *
 * `name` is set explicitly because the 0.1.x version did not, so errors
 * stringified as "Error: ..." and were indistinguishable from anything else in
 * a log. The prototype is restored for the same reason `instanceof` needs it
 * when the class is transpiled down.
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
    Object.setPrototypeOf(this, AuthError.prototype);
  }
}
