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

// Fetch YTD player stats and group by fantasy team using the ownership cell (cells[1]).
// This is the only reliable way to attribute players to teams — scorerId cross-reference
// breaks when players have been transferred and appear as free agents in the stats endpoint.
async function fetchPlayerStatsByTeam(leagueId, shortNameToTeam) {
  const statsByTeam = {}

  for (let page = 1; page <= 16; page++) {
    const data = await fxpaPost(leagueId, 'getPlayerStats', {
      maxResultsPerPage: 50,
      pageNumber: page,
      timeframeType: 'YEAR_TO_DATE'
    })
    const rows = data?.statsTable || []
    if (!rows.length) break

    for (const row of rows) {
      const id = row.scorer?.scorerId
      if (!id) continue

      // cells[1] = "FA" (free agent), "W (date)" (waiver wire), or team short name
      const ownerRaw = row.cells?.[1]?.content || ''
      const owner = ownerRaw.replace(/<[^>]*>/g, '').trim()
      if (!owner || owner === 'FA' || owner.startsWith('W ')) continue

      const teamName = shortNameToTeam[owner]
      if (!teamName) continue

      if (!statsByTeam[teamName]) statsByTeam[teamName] = []
      statsByTeam[teamName].push({
        id,
        name: row.scorer.name,
        totalPts: parseFloat(row.cells?.[3]?.content) || 0,
        avgPts: parseFloat(row.cells?.[4]?.content) || 0
      })
    }

    if (page >= (data?.paginatedResultSet?.totalNumPages || 1)) break
  }

  return statsByTeam
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

  // Build short name -> team name map from richStandings fantasy team info
  const fantasyTeamInfo = richStandings?.fantasyTeamInfo || {}
  const shortNameToTeam = {}
  for (const info of Object.values(fantasyTeamInfo)) {
    if (info.shortName && info.name) shortNameToTeam[info.shortName] = info.name
  }

  onProgress?.('Fetching player stats...')
  const statsByTeam = await fetchPlayerStatsByTeam(leagueId, shortNameToTeam)

  // --- Process standings ---
  const standings = rawStandings.map(t => {
    const [wins = 0, draws = 0, losses = 0] = (t.points || '').split('-').map(Number)
    return { teamId: t.teamId, teamName: t.teamName, rank: t.rank, wins, draws, losses, totalPointsFor: t.totalPointsFor, winPercentage: t.winPercentage }
  })

  const teamById = Object.fromEntries(standings.map(t => [t.teamId, t.teamName]))

  // --- Draft picks ---
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

  const draftByTeam = {}
  for (const p of allPicks) {
    const tName = teamById[p.teamId] || p.teamId
    if (!draftByTeam[tName]) draftByTeam[tName] = []
    draftByTeam[tName].push({ scorerId: p.scorerId, round: p.round, pickNumber: p.pickNumber, playerName: playerDb[p.scorerId]?.name || '' })
  }

  // --- Weekly matchups ---
  const scheduleTableList = (scheduleData?.tableList?.length ? scheduleData : richStandings)?.tableList || []
  const weeklyMatchups = scheduleTableList
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
    .reverse()

  // --- Per-team player highlights using ownership-attributed stats ---
  const teamPlayerHighlights = {}
  if (rosterCurrent?.rosters) {
    for (const teamId of Object.keys(rosterCurrent.rosters)) {
      const earlyRoster = roster1?.rosters?.[teamId]
      const currentRoster = rosterCurrent.rosters[teamId]
      if (!currentRoster) continue

      const teamName = currentRoster.teamName
      const teamDraft = draftByTeam[teamName] || []
      const draftMap = Object.fromEntries(teamDraft.map(d => [d.scorerId, d]))
      const earlyIds = new Set((earlyRoster?.rosterItems || []).map(p => p.id))

      const players = (statsByTeam[teamName] || [])
        .filter(p => p.totalPts > 0)
        .sort((a, b) => b.totalPts - a.totalPts)
        .map(p => ({ ...p, draftRound: draftMap[p.id]?.round, draftPick: draftMap[p.id]?.pickNumber, wasHereSeason1: earlyIds.has(p.id) }))

      if (!players.length) continue

      const star = players[0]
      const worst = players[players.length - 1]

      // Should sell: underperforming player, prioritising early draft picks who flopped
      const bottomHalf = players.slice(Math.ceil(players.length / 2))
      const shouldSell =
        bottomHalf.filter(p => p.draftRound && p.draftRound <= 4).sort((a, b) => a.draftRound - b.draftRound || a.draftPick - b.draftPick)[0]
        || bottomHalf.find(p => p.wasHereSeason1)
        || bottomHalf[0]
        || null

      teamPlayerHighlights[teamName] = { star, worst, shouldSell }
    }
  }

  // --- Transfer changes ---
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
      if (added.length || removed.length) rosterChanges.push({ teamName: late.teamName, added, removed })
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
    teamPlayerHighlights
  }
}
