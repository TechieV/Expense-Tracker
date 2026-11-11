import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models.js';
import { signToken, requireAuth } from '../auth.js';
import { asyncH, HttpError } from '../util.js';

const r = Router();
const emailOk = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 150;
const pub = (u) => ({ id: String(u._id), name: u.name, email: u.email });

r.post('/register', asyncH(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (typeof name !== 'string' || name.trim().length < 2) throw new HttpError(400, 'Please enter your name');
  if (!emailOk(email)) throw new HttpError(400, 'Please enter a valid email');
  if (typeof password !== 'string' || password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (await User.exists({ email: email.toLowerCase() })) throw new HttpError(409, 'An account with this email already exists');
  const user = await User.create({ name: name.trim(), email, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json({ token: signToken(String(user._id)), user: pub(user) });
}));

r.post('/login', asyncH(async (req, res) => {
  const { email, password } = req.body || {};
  if (!emailOk(email) || typeof password !== 'string') throw new HttpError(400, 'Email and password are required');
  const u = await User.findOne({ email: email.toLowerCase() });
  if (!u || !(await bcrypt.compare(password, u.passwordHash))) throw new HttpError(401, 'Incorrect email or password');
  res.json({ token: signToken(String(u._id)), user: pub(u) });
}));

r.get('/me', requireAuth, asyncH(async (req, res) => {
  const u = await User.findById(req.userId);
  if (!u) throw new HttpError(401, 'Account not found');
  res.json({ user: pub(u) });
}));

export default r;
