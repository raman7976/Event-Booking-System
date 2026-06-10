// JWT auth. requireAuth -> 401 if missing/invalid; optionalAuth attaches user if present.
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { Errors } from '../utils/errors.js';

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function decode(token) {
  const p = jwt.verify(token, config.jwt.secret);
  return { id: p.sub, email: p.email, name: p.name, sid: p.sid };
}

export function requireAuth(req, _res, next) {
  const token = extractToken(req);
  if (!token) return next(Errors.unauthorized('Missing bearer token'));
  try {
    req.user = decode(token);
    next();
  } catch {
    next(Errors.unauthorized('Invalid or expired token'));
  }
}

export function optionalAuth(req, _res, next) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = decode(token);
    } catch {
      /* ignore — anonymous request */
    }
  }
  next();
}
