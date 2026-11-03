// How long Node gives each address when it connects (F4, D-097; GOTCHAS "SnapPool's Neon from the SER9").
// A host name with both IPv6 and IPv4 addresses is tried address by address (`autoSelectFamily`, on by default), and
// Node gives each try 250 ms. SnapPool's database is in us-east-1 and the SER9 has no IPv6: the IPv4 handshake to the
// US often needs longer than 250 ms, so about 3 in 4 connections failed with ETIMEDOUT. Raised once, at the start of
// the worker and the CLI, for every connection the process makes. A longer setting given on the command line
// (`--network-family-autoselection-attempt-timeout`) is kept.
import net from 'node:net';

/** Each address's connect attempt, in milliseconds (Node's default is 250). */
export const CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

export interface AttemptTimeoutSetting {
  get(): number;
  set(ms: number): void;
}

const NODE_SETTING: AttemptTimeoutSetting = {
  get: () => net.getDefaultAutoSelectFamilyAttemptTimeout(),
  set: (ms) => net.setDefaultAutoSelectFamilyAttemptTimeout(ms),
};

/** Raises the per-address connect attempt to at least `minMs`. Returns the setting now in force. */
export function raiseConnectAttemptTimeout(
  minMs: number = CONNECT_ATTEMPT_TIMEOUT_MS,
  setting: AttemptTimeoutSetting = NODE_SETTING,
): number {
  if (setting.get() < minMs) setting.set(minMs);
  return setting.get();
}
