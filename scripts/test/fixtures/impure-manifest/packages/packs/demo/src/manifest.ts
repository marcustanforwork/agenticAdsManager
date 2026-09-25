import { readFileSync } from 'node:fs';
import { adapter } from './runtime.ts';
export const manifest = { id: 'demo', read: readFileSync, adapter };
