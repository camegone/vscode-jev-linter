// Safe TypeScript Example: User Management Service
import { Request, Response } from 'express';
import { Pool } from 'pg';
import * as bcrypt from 'bcrypt';

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: 'admin' | 'user';
  createdAt: Date;
}

export class UserService {
  constructor(private pool: Pool) {}

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    if (!email || typeof email !== 'string') {
      throw new Error('Invalid email argument');
    }

    // Safe parameterized SQL query
    const sql = 'SELECT id, email, password_hash as "passwordHash", role, created_at as "createdAt" FROM users WHERE email = $1';
    const result = await this.pool.query<UserRecord>(sql, [email]);
    return result.rows[0] || null;
  }

  async verifyCredentials(email: string, plainPass: string): Promise<boolean> {
    const user = await this.findUserByEmail(email);
    if (!user) {
      return false;
    }
    return bcrypt.compare(plainPass, user.passwordHash);
  }

  async getUserById(id: string): Promise<UserRecord | null> {
    const sql = 'SELECT id, email, password_hash as "passwordHash", role, created_at as "createdAt" FROM users WHERE id = $1';
    const result = await this.pool.query<UserRecord>(sql, [id]);
    return result.rows[0] || null;
  }

  public sanitizeInput(val: string): string {
    return val.trim().replace(/[<>]/g, '');
  }
}

export async function handleLogin(req: Request, res: Response, service: UserService) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const isValid = await service.verifyCredentials(email, password);
  if (!isValid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return res.json({ status: 'ok', token: 'signed_jwt_token' });
}

export async function handleProfile(req: Request, res: Response, service: UserService) {
  const userId = req.params.userId;
  const user = await service.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  return res.json({ id: user.id, email: user.email, role: user.role });
}
