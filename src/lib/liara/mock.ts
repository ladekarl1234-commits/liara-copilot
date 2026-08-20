// Mock Liara provider — Phase 1 has no real account. RealLiaraProvider slots
// in behind getLiaraProvider() later; the LiaraProvider interface exposes no
// destructive operations by design, so nothing here (or later) can mutate an
// account. All values below are fake.

import type { LiaraApp, LiaraDeployment, LiaraProvider } from '@/types';

const APPS: LiaraApp[] = [
  { name: 'my-next-app', platform: 'nextjs', status: 'running' },
  { name: 'shop-api', platform: 'django', status: 'failed' },
  { name: 'blog', platform: 'wordpress', status: 'running' },
];

const DEPLOYMENTS: LiaraDeployment[] = [
  { id: 'dep-1001', appName: 'my-next-app', status: 'ready', createdAt: '2026-08-18T09:12:00Z' },
  { id: 'dep-1002', appName: 'my-next-app', status: 'ready', createdAt: '2026-08-19T14:30:00Z' },
  { id: 'dep-2001', appName: 'shop-api', status: 'ready', createdAt: '2026-08-17T08:00:00Z' },
  { id: 'dep-2002', appName: 'shop-api', status: 'failed', createdAt: '2026-08-19T18:45:00Z' },
  { id: 'dep-3001', appName: 'blog', status: 'ready', createdAt: '2026-08-10T11:00:00Z' },
];

const LOGS: Record<string, string[]> = {
  'my-next-app': [
    '2026-08-19T14:30:12Z  ▲ Next.js 15.4.6',
    '2026-08-19T14:30:12Z  - Local:   http://localhost:3000',
    '2026-08-19T14:30:13Z  ✓ Ready in 812ms',
    '2026-08-19T14:35:02Z  GET / 200 in 41ms',
    '2026-08-19T14:35:09Z  GET /api/products 200 in 87ms',
  ],
  'shop-api': [
    '2026-08-19T18:45:10Z [uwsgi] spawned worker 1 (pid: 12)',
    '2026-08-19T18:45:11Z Watching for file changes with StatReloader',
    '2026-08-19T18:45:14Z django.db.utils.OperationalError: could not connect to server',
    '2026-08-19T18:45:14Z Error: connect ECONNREFUSED 10.0.0.5:5432',
    '2026-08-19T18:45:15Z [uwsgi] worker 1 exited with code 1',
  ],
  blog: [
    '2026-08-19T10:00:01Z [apache] AH00558: httpd started',
    '2026-08-19T10:02:40Z GET /wp-login.php 200',
  ],
};

// FAKE values only — clearly not real credentials.
const ENVS: Record<string, Record<string, string>> = {
  'my-next-app': {
    NODE_ENV: 'production',
    NEXT_PUBLIC_API_URL: 'https://shop-api.liara.run',
  },
  'shop-api': {
    DEBUG: 'False',
    DATABASE_URL: 'postgresql://user:pass@host:5432/db',
    ALLOWED_HOSTS: 'shop-api.liara.run',
  },
  blog: {
    WORDPRESS_DB_HOST: 'db-host:3306',
    WORDPRESS_DB_PASSWORD: 'fake-password',
  },
};

const DOMAINS: Record<string, { domain: string; status: string }[]> = {
  'my-next-app': [
    { domain: 'my-next-app.liara.run', status: 'active' },
    { domain: 'www.example-shop.ir', status: 'active' },
  ],
  'shop-api': [{ domain: 'shop-api.liara.run', status: 'active' }],
  blog: [{ domain: 'blog.liara.run', status: 'pending' }],
};

const DATABASES = [
  { name: 'shop-db', type: 'postgresql', status: 'running' },
  { name: 'cache', type: 'redis', status: 'running' },
];

export class MockLiaraProvider implements LiaraProvider {
  async getApplications(): Promise<LiaraApp[]> {
    return APPS.map((a) => ({ ...a }));
  }

  async getApplication(name: string): Promise<LiaraApp | null> {
    const app = APPS.find((a) => a.name === name);
    return app ? { ...app } : null;
  }

  async getDeployments(appName: string): Promise<LiaraDeployment[]> {
    return DEPLOYMENTS.filter((d) => d.appName === appName).map((d) => ({ ...d }));
  }

  async getLogs(appName: string, lines = 100): Promise<string[]> {
    return (LOGS[appName] ?? []).slice(-lines);
  }

  async getEnvironmentVariables(appName: string): Promise<Record<string, string>> {
    return { ...(ENVS[appName] ?? {}) };
  }

  async getDomains(appName: string): Promise<{ domain: string; status: string }[]> {
    return (DOMAINS[appName] ?? []).map((d) => ({ ...d }));
  }

  async getDatabases(): Promise<{ name: string; type: string; status: string }[]> {
    return DATABASES.map((d) => ({ ...d }));
  }
}

const provider = new MockLiaraProvider();

export function getLiaraProvider(): LiaraProvider {
  return provider;
}
