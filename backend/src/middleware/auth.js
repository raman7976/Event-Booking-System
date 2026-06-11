// JWT auth + role-based access control.
//   requireAuth        -> 401 if the bearer token is missing/invalid
//   optionalAuth       -> attaches req.user when a valid token is present
//   requireRole(role)  -> 403 unless req.user.role matches (use after requireAuth)
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
  if (p.type === 'refresh') throw new Error('refresh token used as access token');
  return { id: p.sub, email: p.email, name: p.name, role: p.role || 'user' };
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

export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(Errors.unauthorized('Missing bearer token'));
  if (req.user.role !== role) return next(Errors.forbidden(`Requires ${role} access`));
  next();
};
