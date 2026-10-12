# Who the game is for

Read this before you add or grow a feature. Building a feature is cheap; deciding which ones belong is the hard part.

## Who it's for

**A group of friends, together on voice, seeing how far they can get through the whole campaign.**

The fantasy is *the group that made it out together*: off the island, across the bridge, onto the plane.

## Pillars

Every feature should make at least one of these stronger and none of them weaker.

1. **Together or not at all.** Friends need each other: one carries, one covers, one revives. Anything that lets a
   player go it alone, or turns players against each other, weakens the game.
2. **How far can we get.** The campaign is the score. Progress through the objectives (fix the car, cross the bridge,
   fly out) is what a group talks about afterwards, and losing partway is a story, not a waste.
3. **Fast pace.** Always moving toward the next objective. Days are for running and scavenging, nights are for
   holding on. A minute spent in a menu is a minute not playing.
4. **The base buys time, nothing more.** A barricade, a turret or a workbench is there to keep the group alive long
   enough to reach the objective. It is not a building game: no decorating, no long crafting trees, no base to
   come back to.

## Not this game

- **Base building or crafting for its own sake.** If it takes longer to build than the night it saves, it is too much.
- **PvP** as a goal in itself.
- **Solo grind** or progress that only pays off over many sessions apart from the group.
- **Side games** that pull the group out of the run (card games, markets, rides) and do not feed the objectives.

## Before a PR

Every PR says which pillar it serves (`.claude/skills/create-pr/SKILL.md`), or "none, tooling/infra".

## Experiments

Sandbox pages (`client/sandbox/`) and admin-only spawns are the place to mess around. Before one reaches the
public game, write down in its PR which pillar it serves and what it costs the others. If no pillar fits, it stays an
experiment or goes.
