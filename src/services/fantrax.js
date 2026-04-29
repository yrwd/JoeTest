const FANTRAX = '/fantrax'

export function extractLeagueId(input) {
  const match = input.match(/\/league\/([a-z0-9]+)/i)
  return match ? match[1] : input.trim()
}

async function fxpaPost(leagueId, method, extra = {}) {
  const res = await fetch(`${FANTRAX}/fxpa/req?leagueId=${leagueId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgs: [{ method, data: { leagueId, ...extra } }] })
  })
  const json = await res.json()
  return json.responses?.[0]?.data
}

// Extract played matchups from a Fantrax tableList.
// The SCHEDULE view returns 38 tables (including future unplayed weeks with 0 scores),
// so we filter to only rows where both scores are present.
function extractMatchups(tableList) {
  return (tableList || [])
    .filter(t => t.tableType === 'H2hPointsBased2' && t.caption)
    .map(t => ({
      caption: t.caption,
      matchups: (t.rows || []).map(row => ({
        awayTeam: row.cells[0]?.content,
        awayFpts: parseFloat(row.cells[1]?.content) || 0,
        homeTeam: row.cells[2]?.content,
        homeFpts: parseFloat(row.cells[3]?.content) || 0
      })).filter(m => m.awayFpts > 0 || m.homeFpts > 0)
    }))
    .filter(t => t.matchups.length > 0)
    .reverse() // oldest first
}

export async function fetchLeagueData(leagueInput, onProgress) {
  const leagueId = extractLeagueId(leagueInput)

  onProgress?.('Fetching standings...')
  const [rawStandings, richStandings] = await Promise.all([
    fetch(`${FANTRAX}/fxea/general/getStandings?leagueId=${leagueId}`).then(r => r.json()),
    fxpaPost(leagueId, 'getStandings')
  ])

  if (!Array.isArray(rawStandings) || rawStandings.length === 0) {
    throw new Error('League not found or set to private. Make your Fantrax league public in league settings.')
  }

  onProgress?.('Fetching match results...')
  // Fetch schedule separately to avoid proxy race conditions
  const scheduleData = await fxpaPost(leagueId, 'getStandings', { view: 'SCHEDULE' }).catch(() => null)

  onProgress?.('Fetching draft results...')
  const draftData = await fxpaPost(leagueId, 'getDraftResults')

  onProgress?.('Loading player database...')
  const playerDb = await fetch(`${FANTRAX}/fxea/general/getPlayerIds?sport=EPL`).then(r => r.json())

  const totalPeriods = 38
  const firstTeam = rawStandings[0]
  const [fw = 0, fd = 0, fl = 0] = (firstTeam?.points || '').split('-').map(Number)
  const currentPeriod = Math.max(fw + fd + fl, 1)

  onProgress?.('Fetching rosters...')
  const [roster1, rosterCurrent] = await Promise.all([
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=1`).then(r => r.json()),
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=${currentPeriod}`).then(r => r.json())
  ])

  // --- Standings ---
  const standings = rawStandings.map(t => {
    const [wins = 0, draws = 0, losses = 0] = (t.points || '').split('-').map(Number)
    return { teamId: t.teamId, teamName: t.teamName, rank: t.rank, wins, draws, losses, totalPointsFor: t.totalPointsFor, winPercentage: t.winPercentage }
  })
  const teamById = Object.fromEntries(standings.map(t => [t.teamId, t.teamName]))

  // --- Weekly matchups: try schedule view, fall back to YTD (last 2 GWs) ---
  // Critical: check that the schedule view actually produced scored matchups before using it.
  // The schedule view returns 38 tables including future weeks with 0 scores — if the proxy
  // strips the POST body, all 38 tables are blank and we'd wrongly skip the fallback.
  let weeklyMatchups = extractMatchups(scheduleData?.tableList)
  if (!weeklyMatchups.length) {
    weeklyMatchups = extractMatchups(richStandings?.tableList)
  }

  // --- Draft ---
  const allPicks = draftData?.draftPicksOrdered || []
  const draftPicks = allPicks
    .filter(p => p.round <= 4)
    .map(p => ({
      round: p.round, pickNumber: p.pickNumber,
      teamName: teamById[p.teamId] || p.teamId,
      scorerId: p.scorerId,
      playerName: playerDb[p.scorerId]?.name || `Unknown (${p.scorerId})`,
      position: playerDb[p.scorerId]?.position || '',
      club: playerDb[p.scorerId]?.team || ''
    }))

  // Build current roster IDs from the actual roster endpoint — reliable;
  // getPlayerStats only returns free agents so can't be used for rostered players.
  const currentRosterIds = new Set()
  for (const team of Object.values(rosterCurrent?.rosters || {})) {
    for (const p of (team.rosterItems || [])) currentRosterIds.add(p.id)
  }

  // Top picks: rounds 1–2 picks still on their team (kept = delivered)
  const topPicks = allPicks
    .filter(p => p.round <= 2 && currentRosterIds.has(p.scorerId))
    .sort((a, b) => a.round - b.round || a.pickNumber - b.pickNumber)
    .slice(0, 3)
    .map(p => ({
      playerName: playerDb[p.scorerId]?.name || p.scorerId,
      position: playerDb[p.scorerId]?.position || '',
      club: playerDb[p.scorerId]?.team || '',
      teamName: teamById[p.teamId] || p.teamId,
      draftRound: p.round, draftPick: p.pickNumber
    }))

  // Worst picks: rounds 1–4 picks that were dropped (not in current roster)
  const worstPicks = allPicks
    .filter(p => p.round <= 4 && !currentRosterIds.has(p.scorerId))
    .sort((a, b) => a.round - b.round || a.pickNumber - b.pickNumber)
    .slice(0, 3)
    .map(p => ({
      playerName: playerDb[p.scorerId]?.name || p.scorerId,
      position: playerDb[p.scorerId]?.position || '',
      club: playerDb[p.scorerId]?.team || '',
      teamName: teamById[p.teamId] || p.teamId,
      draftRound: p.round, draftPick: p.pickNumber
    }))

  // --- Transfers ---
  const rosterChanges = []
  // Build a name→id map for looking up active status of added players
  const playerIdByName = {}
  for (const [id, info] of Object.entries(playerDb)) {
    if (info.name) playerIdByName[info.name] = id
  }

  if (roster1?.rosters && rosterCurrent?.rosters) {
    for (const teamId of Object.keys(rosterCurrent.rosters)) {
      const early = roster1.rosters[teamId]
      const late = rosterCurrent.rosters[teamId]
      if (!early) continue
      const earlyIds = new Set(early.rosterItems.map(p => p.id))
      const lateIds = new Set(late.rosterItems.map(p => p.id))
      const added = [...lateIds].filter(id => !earlyIds.has(id)).map(id => playerDb[id]?.name).filter(Boolean)
      const removed = [...earlyIds].filter(id => !lateIds.has(id)).map(id => playerDb[id]?.name).filter(Boolean)
      if (added.length || removed.length) rosterChanges.push({ teamName: late.teamName, added, removed })
    }
  }

  // Best incoming transfers: added players who are now ACTIVE starters
  // Using roster status as a proxy for performance (if they're starting, they earned it)
  const activeStatusById = {}
  for (const team of Object.values(rosterCurrent?.rosters || {})) {
    for (const p of (team.rosterItems || [])) activeStatusById[p.id] = p.status
  }

  const bestIncomings = []
  for (const change of rosterChanges) {
    for (const name of change.added) {
      const id = playerIdByName[name]
      if (id && activeStatusById[id] === 'ACTIVE') {
        bestIncomings.push({ playerName: name, teamName: change.teamName, position: playerDb[id]?.position || '', club: playerDb[id]?.team || '' })
      }
    }
  }

  // Undrafted pickups: active starters who were never in the original draft
  const draftedNames = new Set(allPicks.map(p => playerDb[p.scorerId]?.name).filter(Boolean))
  const undraftedPickups = bestIncomings.filter(p => !draftedNames.has(p.playerName)).slice(0, 5)

  // Detect team name changes (period 1 name vs current name)
  const nameChanges = []
  if (roster1?.rosters && rosterCurrent?.rosters) {
    for (const teamId of Object.keys(rosterCurrent.rosters)) {
      const oldName = roster1.rosters[teamId]?.teamName
      const newName = rosterCurrent.rosters[teamId]?.teamName
      if (oldName && newName && oldName !== newName) {
        nameChanges.push({ oldName, newName })
      }
    }
  }

  return {
    leagueId,
    leagueName: richStandings?.miscData?.heading || 'Fantasy League',
    currentPeriod,
    totalPeriods,
    standings,
    draftPicks,
    weeklyMatchups,
    rosterChanges,
    nameChanges,
    draftAnalysis: { topPicks, worstPicks },
    transferAnalysis: { bestIncomings, undraftedPickups }
  }
}
