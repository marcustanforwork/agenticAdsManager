// drizzle-kit config: generates SQL migrations from src/schema.ts into migrations/.
// Only `db:generate` uses it; migrations are applied by scripts/migrate.ts (no drizzle-kit at runtime).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations',
  strict: true,
});
