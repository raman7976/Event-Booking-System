// Unit tests for the production secret guard. validateProductionSecrets is a
// pure function taking an env object, so no infra/mocks are needed. (Importing
// env.js runs the import-time guard only when NODE_ENV=production; tests run
// under NODE_ENV=test, so the import is inert here.)
import { describe, it, expect } from 'vitest';
import { validateProductionSecrets } from '../../src/config/env.js';

describe('validateProductionSecrets', () => {
  it('throws when a runtime-critical secret is missing', () => {
    expect(() => validateProductionSecrets({})).toThrow(/JWT_SECRET/);
  });

  it('names every defaulted secret in the error', () => {
    expect(() =>
      validateProductionSecrets({
        JWT_SECRET: 'dev_super_secret_change_me_in_production',
        PG_PASSWORD: 'booking_pass',
      }),
    ).toThrow(/JWT_SECRET, PG_PASSWORD/);
  });

  it('passes when JWT_SECRET and PG_PASSWORD are real values', () => {
    expect(() =>
      validateProductionSecrets({ JWT_SECRET: 'a_real_secret', PG_PASSWORD: 'a_real_pw' }),
    ).not.toThrow();
  });

  it('does not block boot on ADMIN_PASSWORD (seed-only, not runtime-critical)', () => {
    expect(() =>
      validateProductionSecrets({ JWT_SECRET: 'a_real_secret', PG_PASSWORD: 'a_real_pw' }),
    ).not.toThrow();
  });
});
