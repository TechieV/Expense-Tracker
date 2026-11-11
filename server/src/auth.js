import jwt from 'jsonwebtoken';
import { HttpError } from './util.js';

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set in server/.env');
  return process.env.JWT_SECRET;
};

export const signToken = (userId) => jwt.sign({ uid: userId }, secret(), { expiresIn: '7d' });

export function requireAuth(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Please log in'));
  try {
    req.userId = jwt.verify(token, secret()).uid;
    next();
  } catch {
    next(new HttpError(401, 'Session expired, please log in again'));
  }
}
