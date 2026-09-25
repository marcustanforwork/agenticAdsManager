import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { buildProgram } from '../src/cli.ts';
import { portFromEnv, startService } from '../src/service.ts';

describe('worker service', () => {
  it('serves /healthz on localhost and stops', async () => {
    const service = await startService({
      name: 'worker',
      logger: pino({ level: 'silent' }),
      host: '127.0.0.1',
      port: 0,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${service.port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok', service: 'worker' });
      expect((await fetch(`http://127.0.0.1:${service.port}/other`)).status).toBe(404);
    } finally {
      await service.stop();
    }
  });

  it('validates the health port', () => {
    expect(portFromEnv(undefined, 8080)).toBe(8080);
    expect(portFromEnv('0', 8080)).toBe(0);
    for (const bad of ['-1', '70000', 'abc', '80.5']) expect(() => portFromEnv(bad, 8080)).toThrow();
  });

  it('logs ready, then exits 0 on SIGTERM', async () => {
    const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));
    const child = spawn(process.execPath, ['--conditions=@ads/source', main], {
      env: { ...process.env, HEALTH_PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    await vi.waitFor(() => expect(out).toContain('"msg":"ready"'), { timeout: 10_000, interval: 50 });
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
    expect(out).toContain('"msg":"stopped"');
  }, 15_000);
});

describe('ads CLI', () => {
  it('prints the version', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await buildProgram().exitOverride().parseAsync(['node', 'ads', '--product', 'demo-product', 'version']);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^ads \d+\.\d+\.\d+$/));
    log.mockRestore();
  });

  it('rejects a malformed --product', async () => {
    const program = buildProgram()
      .exitOverride()
      .configureOutput({ writeErr: () => undefined });
    await expect(program.parseAsync(['node', 'ads', '--product', 'Bad Slug!', 'version'])).rejects.toThrow();
  });
});
