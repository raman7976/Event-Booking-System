// Zod validation middleware. `source` is 'body' | 'query' | 'params'.
// On success the parsed (and coerced) value replaces req[source].
import { Errors } from '../utils/errors.js';

export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || source,
      message: i.message,
    }));
    return next(Errors.validation('Validation failed', details));
  }
  req[source] = result.data;
  next();
};
