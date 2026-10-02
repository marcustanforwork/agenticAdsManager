// The recorder: wraps a real `fetch`, keeps a redacted copy of every exchange, and writes cassettes that
// pass the secret scanner. Used only with RECORD=1, by Marcus or a local session with read credentials.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Cassette, type Exchange, requestKey } from './cassette.ts';
import { Redactor, findSecrets } from './redact.ts';

/** True when the environment asks for recording (`RECORD=1`). */
export const isRecording = (env: NodeJS.ProcessEnv = process.env): boolean => env['RECORD'] === '1';

export interface RecordingFetch {
  fetch: typeof fetch;
  /** The redacted exchanges captured so far. */
  exchanges: Exchange[];
}

export function recordingFetch(inner: typeof fetch, redactor: Redactor = new Redactor()): RecordingFetch {
  const exchanges: Exchange[] = [];
  const record = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : input;
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    const res = await inner(input, init);
    const text = await res.clone().text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON: kept as text (and still redacted)
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const { path, query } = requestKey(url);
    exchanges.push(
      redactor.exchange({ request: { method, path, query }, response: { status: res.status, headers, body } }),
    );
    return res;
  };
  return { fetch: record as typeof fetch, exchanges };
}

/** Writes a cassette, refusing if the secret scanner finds anything. */
export function saveCassette(file: string, cassette: Cassette): void {
  const text = `${JSON.stringify(Cassette.parse(cassette), null, 2)}\n`;
  const secrets = findSecrets(text);
  if (secrets.length > 0) throw new Error(`refusing to write ${file}: ${secrets.join(', ')}`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

export function loadCassette(file: string): Cassette {
  return Cassette.parse(JSON.parse(readFileSync(file, 'utf8')));
}
