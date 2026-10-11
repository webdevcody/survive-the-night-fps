-- The Skull shop (shared/skullshop.js): cosmetics each owner (account or guest) has bought with Zombie Skulls, once
-- each. The Skulls go through the Skull ledger (kind 'cosmetic_buy'); this says what was bought.
CREATE TABLE loadout_cosmetics (
  owner       text NOT NULL CHECK (owner ~ '^(a:[0-9a-f-]{36}|g:[0-9a-f]{64})$'),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  cosmetic_id smallint NOT NULL CHECK (cosmetic_id > 0),
  ledger_id   text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner, cosmetic_id),
  CHECK ((owner LIKE 'a:%') = (user_id IS NOT NULL))
);

-- Zombie Skulls week by week (npm run report): what play paid out, what left the game (Skull shop purchases and the
-- auction house's fee: an auction sale only moves the rest between players) and the change in all the Skulls held.
CREATE FUNCTION analytics_skulls(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (week date, earned bigint, cosmetics bigint, auction_fees bigint, spent bigint, net bigint, earners bigint, buyers bigint)
LANGUAGE sql STABLE AS $$
  SELECT date_trunc('week', l.at)::date,
         COALESCE(sum(e.delta) FILTER (WHERE l.kind = 'earn'), 0)::bigint,
         COALESCE(-sum(e.delta) FILTER (WHERE l.kind = 'cosmetic_buy'), 0)::bigint,
         COALESCE(-sum(e.delta) FILTER (WHERE l.kind = 'auction_buy'), 0)::bigint,
         COALESCE(-sum(e.delta) FILTER (WHERE l.kind IN ('cosmetic_buy', 'auction_buy')), 0)::bigint,
         COALESCE(sum(e.delta), 0)::bigint,
         count(DISTINCT e.owner) FILTER (WHERE l.kind = 'earn'),
         count(DISTINCT e.owner) FILTER (WHERE l.kind = 'cosmetic_buy')
    FROM loadout_skull_ledger l JOIN loadout_skull_entries e ON e.ledger_id = l.id
   WHERE l.at >= since
   GROUP BY 1 ORDER BY 1 DESC
$$;
