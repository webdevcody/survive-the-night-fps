-- Bad-luck protection on permanent loadout drops (#275): how many chances in a row an owner has had at one without
-- it dropping. Each miss raises their next chance (server/loadouts.js LOADOUT_*_PITY); a drop of that kind resets it.
CREATE TABLE loadout_pity (
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('boss', 'box')),
  misses      integer NOT NULL DEFAULT 0 CHECK (misses >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, kind),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);
