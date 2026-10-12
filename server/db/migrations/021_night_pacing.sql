-- The pacing director and the moon (server/director.js, issue #297): each night's moon (normal | blood | clear), and
-- how many breathers (relaxes) and early groups (pulls) the director gave it.
ALTER TABLE match_nights ADD COLUMN moon text;
ALTER TABLE match_nights ADD COLUMN relaxes smallint;
ALTER TABLE match_nights ADD COLUMN pulls smallint;

-- by team size and moon: how often the director stepped in, and how those nights went
CREATE FUNCTION analytics_night_pacing(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (team smallint, moon text, nights bigint, avg_relaxes numeric, avg_pulls numeric, relaxed_pct numeric,
               pulled_pct numeric, survive_pct numeric, avg_downs numeric, avg_deaths numeric)
LANGUAGE sql STABLE AS $$
  SELECT n.players_start, COALESCE(n.moon, 'normal'), count(*),
         round(avg(n.relaxes), 2), round(avg(n.pulls), 2),
         round(100.0 * count(*) FILTER (WHERE n.relaxes > 0) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE n.pulls > 0) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE n.outcome IN ('dawn', 'escaped')) / NULLIF(count(*) FILTER (WHERE n.outcome <> 'abandoned'), 0), 1),
         round(avg(n.downs), 2), round(avg(n.deaths), 2)
    FROM match_nights n JOIN matches m ON m.id = n.match_id
   WHERE m.started_at >= since AND n.relaxes IS NOT NULL
   GROUP BY n.players_start, COALESCE(n.moon, 'normal') ORDER BY n.players_start, 2
$$;
