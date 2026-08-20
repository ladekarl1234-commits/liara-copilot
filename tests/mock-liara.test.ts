import { describe, expect, it } from 'vitest';
import { getLiaraProvider, MockLiaraProvider } from '@/lib/liara/mock';

describe('MockLiaraProvider', () => {
  const p = getLiaraProvider();

  it('returns realistic apps', async () => {
    const apps = await p.getApplications();
    expect(apps.length).toBeGreaterThanOrEqual(2);
    const names = apps.map((a) => a.name);
    expect(names).toContain('my-next-app');
    expect(names).toContain('shop-api');
    expect(apps.find((a) => a.name === 'shop-api')?.status).toBe('failed');
    expect(await p.getApplication('my-next-app')).toMatchObject({ platform: 'nextjs' });
    expect(await p.getApplication('nope')).toBeNull();
  });

  it('logs contain an ECONNREFUSED sample', async () => {
    const logs = await p.getLogs('shop-api');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).toContain('ECONNREFUSED');
  });

  it('exposes deployments, envs (fake values), domains and databases', async () => {
    expect((await p.getDeployments('shop-api')).some((d) => d.status === 'failed')).toBe(true);
    const envs = await p.getEnvironmentVariables('shop-api');
    expect(envs.DATABASE_URL).toContain('postgresql://');
    expect((await p.getDomains('my-next-app')).length).toBeGreaterThan(0);
    expect((await p.getDatabases()).length).toBeGreaterThan(0);
  });

  it('no method on the interface mutates anything — all read-only getters, data returned as copies', async () => {
    // every interface method is a get* read
    const methods = Object.getOwnPropertyNames(MockLiaraProvider.prototype).filter(
      (m) => m !== 'constructor',
    );
    expect(methods.length).toBeGreaterThan(0);
    for (const m of methods) expect(m.startsWith('get')).toBe(true);

    // mutating returned values does not leak into the provider
    const apps = await p.getApplications();
    apps.pop();
    apps[0].name = 'hacked';
    apps[0].status = 'stopped';
    const again = await p.getApplications();
    expect(again.map((a) => a.name)).toContain('my-next-app');
    expect(again.length).toBe(apps.length + 1);

    const envs = await p.getEnvironmentVariables('shop-api');
    envs.DATABASE_URL = 'tampered';
    expect((await p.getEnvironmentVariables('shop-api')).DATABASE_URL).toContain('postgresql://');

    const logs = await p.getLogs('shop-api');
    logs.length = 0;
    expect((await p.getLogs('shop-api')).length).toBeGreaterThan(0);
  });
});
