// Who may switch on DEV_ADMIN (every player may run the admin chat commands, signed in or not): only a server whose
// NODE_ENV is development or test. `npm start` (and so every deploy) sets NODE_ENV=production, where it is ignored
// whatever DEV_ADMIN says; nothing a client sends reaches it.
export function devAdminAllowed(env = process.env) {
  return ['development', 'test'].includes(env.NODE_ENV) && env.DEV_ADMIN === '1';
}
