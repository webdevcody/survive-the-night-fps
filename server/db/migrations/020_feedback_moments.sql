-- What players liked and hated about a run, not only how hard it was (issue #277): two optional one-tap picks on the
-- end screen, best moment and worst moment, filed on the run's row in difficulty_votes next to the difficulty vote
-- (server/feedback.js). Any of the three can come without the others, so a row can now have no rating.
--   best / worst  boss | horde | looting | building | objectives | teammates | ui | lag | other
--
-- And whether the voter plays this kind of game, asked once per account or guest (feedback_voters), so a vote from
-- someone who never plays survival or FPS games can be told apart from one by someone who does.

ALTER TABLE difficulty_votes ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE difficulty_votes
  ADD COLUMN best  text CHECK (best IN ('boss', 'horde', 'looting', 'building', 'objectives', 'teammates', 'ui', 'lag', 'other')),
  ADD COLUMN worst text CHECK (worst IN ('boss', 'horde', 'looting', 'building', 'objectives', 'teammates', 'ui', 'lag', 'other'));

CREATE TABLE feedback_voters (
  voter       text PRIMARY KEY,           -- 'u:<user id>' or 'g:<guest key>', as difficulty_votes files them
  plays_genre boolean NOT NULL,           -- "Do you play survival / FPS games?"
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- How hard, as before (004), the votes with no rating left out, and split by whether the voter plays the genre too.
CREATE OR REPLACE FUNCTION analytics_difficulty(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (bucket text, votes bigint, avg numeric, too_easy numeric, easy numeric, just_right numeric, hard numeric, too_hard numeric)
LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT d.*, f.plays_genre FROM difficulty_votes d LEFT JOIN feedback_voters f ON f.voter = d.voter
              WHERE d.created_at >= since AND d.rating IS NOT NULL),
  b AS (
    SELECT 0 AS o, 0 AS s, 'all' AS bucket, rating FROM v
    UNION ALL SELECT 1, 0, 'run: ' || COALESCE(outcome, '?'), rating FROM v
    UNION ALL SELECT 2, COALESCE(nights_survived, -1), 'nights survived: ' || COALESCE(nights_survived::text, '?'), rating FROM v
    UNION ALL SELECT 3, CASE WHEN players <= 1 THEN 1 WHEN players <= 3 THEN 2 ELSE 3 END,
                     CASE WHEN players <= 1 THEN 'team: solo' WHEN players <= 3 THEN 'team: 2-3' ELSE 'team: 4+' END, rating FROM v
    UNION ALL SELECT 4, CASE WHEN my_outcome IN ('escaped', 'left_behind') THEN 1 ELSE 2 END,
                     CASE WHEN my_outcome IN ('escaped', 'left_behind') THEN 'me: alive at the end' ELSE 'me: dead or turned' END, rating FROM v
    UNION ALL SELECT 5, CASE WHEN my_matches <= 1 THEN 1 WHEN my_matches <= 5 THEN 2 ELSE 3 END,
                     CASE WHEN my_matches <= 1 THEN 'played: first match' WHEN my_matches <= 5 THEN 'played: 2-5 matches' ELSE 'played: 6+ matches' END, rating FROM v
    UNION ALL SELECT 6, CASE WHEN plays_genre THEN 1 WHEN NOT plays_genre THEN 2 ELSE 3 END,
                     CASE WHEN plays_genre THEN 'genre: plays it' WHEN NOT plays_genre THEN 'genre: does not' ELSE 'genre: not asked' END, rating FROM v
  )
  SELECT bucket, count(*), round(avg(rating), 2),
         round(100.0 * count(*) FILTER (WHERE rating = 1) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 2) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 3) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 4) / count(*), 1),
         round(100.0 * count(*) FILTER (WHERE rating = 5) / count(*), 1)
    FROM b GROUP BY o, s, bucket ORDER BY o, s
$$;

-- What players pick as the best and worst of a run, crossed with how the run went, how far it got, how hard they said
-- it was, the team's size and whether they play the genre. One row per bucket and moment: how many picked it as the
-- best, how many as the worst, and how many answered in that bucket at all (either pick), for the shares.
CREATE FUNCTION analytics_moments(since timestamptz DEFAULT '-infinity')
RETURNS TABLE (bucket text, moment text, best bigint, worst bigint, answered bigint)
LANGUAGE sql STABLE AS $$
  WITH v AS (SELECT d.*, f.plays_genre FROM difficulty_votes d LEFT JOIN feedback_voters f ON f.voter = d.voter
              WHERE d.created_at >= since AND (d.best IS NOT NULL OR d.worst IS NOT NULL)),
  b AS (
    SELECT 0 AS o, 0 AS s, 'all' AS bucket, best, worst FROM v
    UNION ALL SELECT 1, 0, 'run: ' || COALESCE(outcome, '?'), best, worst FROM v
    UNION ALL SELECT 2, COALESCE(nights_survived, -1), 'nights survived: ' || COALESCE(nights_survived::text, '?'), best, worst FROM v
    UNION ALL SELECT 3, COALESCE(rating, 9),
                     'difficulty: ' || COALESCE((ARRAY['too easy', 'easy', 'just right', 'hard', 'too hard'])[rating], 'no vote'), best, worst FROM v
    UNION ALL SELECT 4, CASE WHEN players <= 1 THEN 1 WHEN players <= 3 THEN 2 ELSE 3 END,
                     CASE WHEN players <= 1 THEN 'team: solo' WHEN players <= 3 THEN 'team: 2-3' ELSE 'team: 4+' END, best, worst FROM v
    UNION ALL SELECT 5, CASE WHEN plays_genre THEN 1 WHEN NOT plays_genre THEN 2 ELSE 3 END,
                     CASE WHEN plays_genre THEN 'genre: plays it' WHEN NOT plays_genre THEN 'genre: does not' ELSE 'genre: not asked' END, best, worst FROM v
  ),
  n AS (SELECT o, s, bucket, count(*) AS answered FROM b GROUP BY o, s, bucket),
  m AS (
    SELECT o, s, bucket, best AS moment, 1 AS is_best FROM b WHERE best IS NOT NULL
    UNION ALL SELECT o, s, bucket, worst, 0 FROM b WHERE worst IS NOT NULL
  )
  SELECT m.bucket, m.moment, count(*) FILTER (WHERE is_best = 1), count(*) FILTER (WHERE is_best = 0), n.answered
    FROM m JOIN n USING (o, s, bucket)
   GROUP BY m.o, m.s, m.bucket, m.moment, n.answered
   ORDER BY m.o, m.s, count(*) FILTER (WHERE is_best = 1) DESC, m.moment
$$;
