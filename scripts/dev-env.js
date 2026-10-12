// The environment `npm run dev` (scripts/dev.js) starts the game server with: a local development server, a PGlite
// database, a handoff folder, and the admin chat commands (/give, /tp, ...) for every player (DEV_ADMIN=1, which
// server/devadmin.js honours only when NODE_ENV is development or test). Anything already set in the shell wins:
// DEV_ADMIN=0 npm run dev plays without them.
export function devServerEnv(env = process.env) {
  return {
    ...env,
    NODE_ENV: env.NODE_ENV ?? 'development',
    DATABASE_URL: env.DATABASE_URL ?? 'pglite:./data/pglite',
    HANDOFF_DIR: env.HANDOFF_DIR ?? './data/handoff',
    DEV_ADMIN: env.DEV_ADMIN ?? '1',
  };
}
