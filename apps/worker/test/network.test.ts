import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { CONNECT_ATTEMPT_TIMEOUT_MS, raiseConnectAttemptTimeout } from '../src/network.ts';

const fakeSetting = (start: number) => {
  let value = start;
  const sets: number[] = [];
  return {
    sets,
    get: () => value,
    set: (ms: number) => {
      sets.push(ms);
      value = ms;
    },
  };
};

describe("the connect attempt timeout (F4: SnapPool's Neon from the SER9)", () => {
  it("raises Node's 250 ms to 2 s, and keeps a longer setting", () => {
    const fromDefault = fakeSetting(250);
    expect(raiseConnectAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS, fromDefault)).toBe(2000);
    expect(fromDefault.sets).toEqual([2000]);
    const longer = fakeSetting(5000); // e.g. --network-family-autoselection-attempt-timeout=5000
    expect(raiseConnectAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS, longer)).toBe(5000);
    expect(longer.sets).toEqual([]);
  });

  it("changes Node's own setting", () => {
    const before = net.getDefaultAutoSelectFamilyAttemptTimeout();
    try {
      net.setDefaultAutoSelectFamilyAttemptTimeout(250);
      expect(raiseConnectAttemptTimeout()).toBe(CONNECT_ATTEMPT_TIMEOUT_MS);
      expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(CONNECT_ATTEMPT_TIMEOUT_MS);
    } finally {
      net.setDefaultAutoSelectFamilyAttemptTimeout(before);
    }
  });

  it('is raised first thing by the worker and the CLI', async () => {
    for (const file of ['../src/main.ts', '../src/cli.ts']) {
      const source = await readFile(new URL(file, import.meta.url), 'utf8');
      expect(source, file).toMatch(/\n {2}raiseConnectAttemptTimeout\(\);/);
    }
  });
});
