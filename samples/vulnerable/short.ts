// Vulnerable TypeScript Example: User Management Service
import { Request, Response } from 'express';
import { Pool } from 'pg';

export interface UserRecord {
  id: string;
  email: string;
  role: string;
}

export class UserService {
  // VULNERABILITY 1: Hardcoded Master Database Key
  private readonly dbApiKey = "sk-live-db-super-secret-key-prod-9998";

  constructor(private pool: Pool) {}

  // VULNERABILITY 2: SQL Injection through template string
  async findUserByEmailUnsafe(email: string): Promise<UserRecord[]> {
    // Unsanitized email parameter interpolated into query
    const rawSql = `SELECT id, email, role FROM users WHERE email = '${email}'`;
    const result = await this.pool.query(rawSql);
    return result.rows;
  }

  // VULNERABILITY 3: Server-Side Request Forgery (SSRF) / Arbitrary Fetch
  async fetchRemoteAvatar(avatarUrl: string): Promise<ArrayBuffer> {
    // Untrusted user URL fetched directly without domain or IP whitelist
    const response = await fetch(avatarUrl);
    return response.arrayBuffer();
  }

  // VULNERABILITY 4: Command Execution via dynamic eval
  executeUserRule(ruleScript: string, context: Record<string, unknown>): unknown {
    const fn = new Function('context', ruleScript);
    return fn(context);
  }

  // VULNERABILITY 5: Insecure Token Generation using predictable Math.random
  generateInsecureToken(): string {
    return 'token-' + Math.random().toString(36).substring(2);
  }

  // VULNERABILITY 6: Prototype Pollution in configuration merger
  mergeConfig(target: any, source: any): any {
    for (const key in source) {
      if (typeof source[key] === 'object' && source[key] !== null) {
        target[key] = this.mergeConfig(target[key] || {}, source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }
}

export async function handleSearch(req: Request, res: Response, service: UserService) {
  const email = req.query.email as string;
  const users = await service.findUserByEmailUnsafe(email);
  res.json({ users });
}

export async function handleAvatarProxy(req: Request, res: Response, service: UserService) {
  const url = req.query.url as string;
  const image = await service.fetchRemoteAvatar(url);
  res.setHeader('Content-Type', 'image/png');
  res.send(Buffer.from(image));
}
