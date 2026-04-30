/**
 * Fantrax data fetching service
 *
 * Fetches all data needed for the season review from Fantrax's API via our
 * edge function proxy (/fantrax/*). All requests go through the proxy so the
 * app works from the browser without CORS issues.
 *
 * The main export is fetchLeagueData(), which returns a single object
 * containing standings, matchups, draft picks, transfers, and roster changes.
 */

const FANTRAX = '/fantrax'

/**
 * Extracts the league ID from a full Fantrax URL or a bare ID string.
 * Accepts: "https://www.fantrax.com/fantasy/league/abc123/standings" → "abc123"
 * Also accepts a bare ID directly: "abc123" → "abc123"
 * Strips non-alphanumeric characters as a safety measure against injection.
 */
export function extractLeagueId(input) {
  const match = input.match(/\/league\/([a-z0-9]+)/i)
  if (match) return match[1]
  const bare = input.trim().replace(/[^a-z0-9]/gi, '')
  if (!bare) throw new Error('Invalid league URL or ID — could not find a league ID.')
  return bare
}

/**
 * Posts to Fantrax's internal fxpa API (used for standings, draft results, etc.).
 * The fxpa API expects a "msgs" array wrapping the actual method and data payload.
 */
async function fxpaPost(leagueId, method, extra = {}) {
  const res = await fetch(`${FANTRAX}/fxpa/req?leagueId=${leagueId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgs: [{ method, data: { leagueId, ...extra } }] }),
  })
  const json = await res.json()
  return json.responses?.[0]?.data
}

/**
 * Parses a Fantrax tableList into our matchup format, keeping only played weeks.
 *
 * The SCHEDULE view returns all 38 gameweeks including future unplayed weeks
 * (which have zero scores), so we filter those out. We also reverse the list
 * so gameweeks run oldest-first, which is easier to reason about in analysis.
 */
function extractMatchups(tableList) {
  return (tableList || [])
    .filter(t => (t.tableType === 'H2hPointsBased2' || t.tableType === 'H2hPointsBased3') && t.caption)
    .map(t => ({
      caption: t.caption,
      matchups: (t.rows || [])
        .map(row => ({
          awayTeam: row.cells[0]?.content,
          awayFpts: parseFloat(row.cells[1]?.content) || 0,
          homeTeam: row.cells[2]?.content,
          homeFpts: parseFloat(row.cells[3]?.content) || 0,
        }))
        .filter(m => m.awayFpts > 0 || m.homeFpts > 0),
    }))
    .filter(t => t.matchups.length > 0)
    .reverse()
}

/**
 * Looks up a player's display info from the Fantrax player database.
 * Falls back to the raw scorerId if the player isn't found (e.g. unknown pick).
 */
function lookupPlayer(playerDb, scorerId) {
  const info = playerDb[scorerId] || {}
  return {
    playerName: info.name || scorerId,
    position: info.position || '',
    club: info.team || '',
  }
}

/**
 * Fetches all league data from Fantrax and returns it as a structured object.
 * Uses onProgress callbacks to update the UI loading message during the fetch.
 *
 * Fetch strategy: standings must come first (we need the current period to know
 * which roster period to fetch). Everything else is independent and runs in parallel.
 */
export async function fetchLeagueData(leagueInput, onProgress) {
  const leagueId = extractLeagueId(leagueInput)

  // Step 1: fetch standings (needed to derive currentPeriod for the roster fetch)
  onProgress?.('Fetching standings...')
  const [rawStandings, richStandings] = await Promise.all([
    fetch(`${FANTRAX}/fxea/general/getStandings?leagueId=${leagueId}`).then(r => r.json()),
    fxpaPost(leagueId, 'getStandings'),
  ])

  if (!Array.isArray(rawStandings) || rawStandings.length === 0) {
    throw new Error('League not found or set to private. Make your Fantrax league public in league settings.')
  }

  // Derive currentPeriod from the first team's W-D-L record
  const totalPeriods = 38
  const [fw = 0, fd = 0, fl = 0] = (rawStandings[0]?.points || '').split('-').map(Number)
  const currentPeriod = Math.max(fw + fd + fl, 1)

  // Step 2: fetch everything else in parallel — none of these depend on each other
  onProgress?.('Fetching league data...')
  const [scheduleData, draftData, playerDb, roster1, rosterCurrent, leaderboardData] = await Promise.all([
    // SCHEDULE view gives the full season's results week-by-week
    // It can fail if the proxy strips the POST body, so we fall back gracefully
    fxpaPost(leagueId, 'getStandings', { view: 'SCHEDULE' }).catch(() => null),
    fxpaPost(leagueId, 'getDraftResults'),
    fetch(`${FANTRAX}/fxea/general/getPlayerIds?sport=EPL`).then(r => r.json()),
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=1`).then(r => r.json()),
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=${currentPeriod}`).then(r => r.json()),
    fxpaPost(leagueId, 'getLeaderboard').catch(() => null),
  ])
  console.log('[fantrax] leaderboardData:', leaderboardData)
  console.log('[fantrax] richStandings tableTypes:', richStandings?.tableList?.map(t => t.tableType))

  // --- Standings ---
  const standings = rawStandings.map(t => {
    const [wins = 0, draws = 0, losses = 0] = (t.points || '').split('-').map(Number)
    return {
      teamId: t.teamId, teamName: t.teamName, rank: t.rank,
      wins, draws, losses, totalPointsFor: t.totalPointsFor, winPercentage: t.winPercentage,
    }
  })
  const teamById = Object.fromEntries(standings.map(t => [t.teamId, t.teamName]))

  // --- Weekly matchups ---
  // Prefer the full SCHEDULE view; fall back to the YTD view (only last 2 GWs)
  // if the schedule fetch failed or the proxy dropped the POST body
  let weeklyMatchups = extractMatchups(scheduleData?.tableList)
  if (!weeklyMatchups.length) {
    weeklyMatchups = extractMatchups(richStandings?.tableList)
  }

  // --- Single pass over current rosters ---
  // Builds three things at once to avoid iterating the same data multiple times:
  //   currentRosterIds — Set of all player IDs currently on any team's roster
  //   activeStatusById — map of player ID → roster status (ACTIVE, BENCH, etc.)
  //   nameChanges      — teams that renamed themselves since period 1
  const currentRosterIds = new Set()
  const activeStatusById = {}
  const playerPointsById = {}
  const currentTeamByPlayerId = {}
  const nameChanges = []

  for (const [teamId, team] of Object.entries(rosterCurrent?.rosters || {})) {
    for (const player of (team.rosterItems || [])) {
      currentRosterIds.add(player.id)
      activeStatusById[player.id] = player.status
      currentTeamByPlayerId[player.id] = teamId
      const pts = player.totalFpts ?? player.fpts ?? player.seasonFpts ?? null
      if (pts !== null) playerPointsById[player.id] = pts
    }
    const oldName = roster1?.rosters[teamId]?.teamName
    if (oldName && team.teamName && oldName !== team.teamName) {
      nameChanges.push({ oldName, newName: team.teamName })
    }
  }

  // --- Draft analysis ---
  const allPicks = draftData?.draftPicksOrdered || []

  // Top picks: drafted players with the highest total fantasy points
  const hasPointsData = Object.keys(playerPointsById).length > 0
  const topPicks = allPicks
    .filter(p => hasPointsData ? playerPointsById[p.scorerId] !== undefined : (p.round <= 2 && currentRosterIds.has(p.scorerId)))
    .sort((a, b) => hasPointsData
      ? (playerPointsById[b.scorerId] || 0) - (playerPointsById[a.scorerId] || 0)
      : a.round - b.round || a.pickNumber - b.pickNumber)
    .slice(0, 5)
    .map(p => {
      const draftedByTeamId = p.teamId
      const currentTeamId = currentTeamByPlayerId[p.scorerId]
      const traded = currentTeamId && currentTeamId !== draftedByTeamId
      return {
        ...lookupPlayer(playerDb, p.scorerId),
        teamName: teamById[draftedByTeamId] || draftedByTeamId,
        currentTeamName: traded ? (teamById[currentTeamId] || currentTeamId) : null,
        traded,
        draftRound: p.round,
        draftPick: p.pickNumber,
        totalFpts: playerPointsById[p.scorerId] ?? null,
      }
    }))

  // Worst picks: rounds 1–4 players no longer on any roster (dropped = busts)
  // We also flag whether the player is still in the EPL — this distinguishes
  // genuine busts from players who transferred clubs and got a new Fantrax ID
  // (e.g. Eze moving from Crystal Palace to Arsenal gets a new scorer ID,
  // making him appear "dropped" even though he's still playing)
  const worstPicks = allPicks
    .filter(p => p.round <= 4 && !currentRosterIds.has(p.scorerId))
    .sort((a, b) => a.round - b.round || a.pickNumber - b.pickNumber)
    .slice(0, 3)
    .map(p => ({
      ...lookupPlayer(playerDb, p.scorerId),
      teamName: teamById[p.teamId] || p.teamId,
      draftRound: p.round,
      draftPick: p.pickNumber,
      stillInEpl: !!(playerDb[p.scorerId]?.team),
    }))

  // --- Transfer analysis ---

  // Build a reverse lookup: player name → player ID, used to check active status
  const playerIdByName = {}
  for (const [id, info] of Object.entries(playerDb)) {
    if (info.name) playerIdByName[info.name] = id
  }

  // Compare period-1 rosters to current rosters to find all player movements
  const rosterChanges = []
  if (roster1?.rosters && rosterCurrent?.rosters) {
    for (const teamId of Object.keys(rosterCurrent.rosters)) {
      const early = roster1.rosters[teamId]
      const late = rosterCurrent.rosters[teamId]
      if (!early) continue

      const earlyIds = new Set(early.rosterItems.map(p => p.id))
      const lateIds = new Set(late.rosterItems.map(p => p.id))

      const added = [...lateIds].filter(id => !earlyIds.has(id)).map(id => playerDb[id]?.name).filter(Boolean)
      const removed = [...earlyIds].filter(id => !lateIds.has(id)).map(id => playerDb[id]?.name).filter(Boolean)

      if (added.length || removed.length) {
        rosterChanges.push({ teamName: late.teamName, added, removed })
      }
    }
  }

  // Best incoming transfers: added players who are now active starters.
  // Being an active starter is used as a proxy for being a good signing.
  const bestIncomings = []
  for (const change of rosterChanges) {
    for (const name of change.added) {
      const id = playerIdByName[name]
      if (id && activeStatusById[id] === 'ACTIVE') {
        bestIncomings.push({
          playerName: name,
          teamName: change.teamName,
          position: playerDb[id]?.position || '',
          club: playerDb[id]?.team || '',
        })
      }
    }
  }

  // Undrafted pickups: active starters who were never in the original draft pool
  const draftedNames = new Set(allPicks.map(p => playerDb[p.scorerId]?.name).filter(Boolean))
  const undraftedPickups = bestIncomings.filter(p => !draftedNames.has(p.playerName)).slice(0, 5)

  return {
    leagueId,
    leagueName: richStandings?.miscData?.heading || 'Fantasy League',
    currentPeriod,
    totalPeriods,
    standings,
    weeklyMatchups,
    rosterChanges,
    nameChanges,
    draftAnalysis: { topPicks, worstPicks },
    transferAnalysis: { bestIncomings, undraftedPickups },
  }
}
