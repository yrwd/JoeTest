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

// Fetch YTD player stats across multiple pages, stopping once we have all rostered players
async function fetchPlayerStats(leagueId, rosteredIds) {
  const stats = {}
  const needed = new Set(rosteredIds)
  const maxPages = 15

  for (let page = 1; page <= maxPages; page++) {
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
      stats[id] = {
        name: row.scorer.name,
        totalPts: parseFloat(row.cells?.[3]?.content) || 0,
        avgPts: parseFloat(row.cells?.[4]?.content) || 0,
        startPct: row.cells?.[5]?.content || '0%'
      }
      needed.delete(id)
    }

    if (needed.size === 0) break
    if (page >= (data?.paginatedResultSet?.totalNumPages || 1)) break
  }

  return stats
}

export async function fetchLeagueData(leagueInput, onProgress) {
  const leagueId = extractLeagueId(leagueInput)

  onProgress?.('Fetching standings...')
  // Use view:SCHEDULE to get ALL gameweek results, not just the last 2
  const [rawStandings, scheduleData, richStandings] = await Promise.all([
    fetch(`${FANTRAX}/fxea/general/getStandings?leagueId=${leagueId}`).then(r => r.json()),
    fxpaPost(leagueId, 'getStandings', { view: 'SCHEDULE' }),
    fxpaPost(leagueId, 'getStandings')
  ])

  if (!Array.isArray(rawStandings) || rawStandings.length === 0) {
    throw new Error('League not found or set to private. Make your Fantrax league public in league settings.')
  }

  onProgress?.('Fetching draft results...')
  const draftData = await fxpaPost(leagueId, 'getDraftResults')

  onProgress?.('Loading player database...')
  const playerDb = await fetch(`${FANTRAX}/fxea/general/getPlayerIds?sport=EPL`).then(r => r.json())

  // Determine played periods
  const allPeriods = richStandings?.displayedLists?.periods || []
  const totalPeriods = 38
  // Find the last period that has actually been played by checking displayedSelections
  const currentPeriod = richStandings?.displayedSelections?.period || allPeriods.length || 34

  onProgress?.('Fetching rosters...')
  const [roster1, rosterCurrent] = await Promise.all([
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=1`).then(r => r.json()),
    fetch(`${FANTRAX}/fxea/general/getTeamRosters?leagueId=${leagueId}&period=${currentPeriod}`).then(r => r.json())
  ])

  // Collect all currently rostered player IDs for targeted stats fetch
  const allRosteredIds = []
  if (rosterCurrent?.rosters) {
    for (const team of Object.values(rosterCurrent.rosters)) {
      for (const p of team.rosterItems || []) allRosteredIds.push(p.id)
    }
  }

  onProgress?.('Fetching player stats...')
  const playerStats = await fetchPlayerStats(leagueId, allRosteredIds)

  // --- Process standings ---
  const standings = rawStandings.map(t => {
    const [wins = 0, draws = 0, losses = 0] = (t.points || '').split('-').map(Number)
    return {
      teamId: t.teamId,
      teamName: t.teamName,
      rank: t.rank,
      wins, draws, losses,
      totalPointsFor: t.totalPointsFor,
      winPercentage: t.winPercentage
    }
  })

  const teamById = Object.fromEntries(standings.map(t => [t.teamId, t.teamName]))

  // --- Process draft picks (rounds 1-4) ---
  const allPicks = draftData?.draftPicksOrdered || []
  const draftPicks = allPicks
    .filter(p => p.round <= 4)
    .map(p => ({
      round: p.round,
      pickNumber: p.pickNumber,
      teamName: teamById[p.teamId] || p.teamId,
      scorerId: p.scorerId,
      playerName: playerDb[p.scorerId]?.name || `Unknown (${p.scorerId})`,
      position: playerDb[p.scorerId]?.position || '',
      club: playerDb[p.scorerId]?.team || ''
    }))

  // Build per-team draft lookup: teamName -> [{scorerId, round, pick, playerName}]
  const draftByTeam = {}
  for (const p of allPicks) {
    const tName = teamById[p.teamId] || p.teamId
    if (!draftByTeam[tName]) draftByTeam[tName] = []
    draftByTeam[tName].push({
      scorerId: p.scorerId,
      round: p.round,
      pickNumber: p.pickNumber,
      playerName: playerDb[p.scorerId]?.name || ''
    })
  }

  // --- Process ALL weekly matchups via SCHEDULE view ---
  const scheduleTableList = scheduleData?.tableList || []
  const weeklyMatchups = scheduleTableList
    .filter(t => t.tableType === 'H2hPointsBased2' && t.caption)
    .map(t => ({
      caption: t.caption,
      matchups: (t.rows || []).map(row => ({
        awayTeam: row.cells[0]?.content,
        awayFpts: parseFloat(row.cells[1]?.content) || 0,
        homeTeam: row.cells[2]?.content,
        homeFpts: parseFloat(row.cells[3]?.content) || 0
      })).filter(m => m.awayFpts > 0 || m.homeFpts > 0) // skip unplayed weeks
    }))
    .filter(t => t.matchups.length > 0)
    .reverse() // oldest to newest

  // --- Process per-team player highlights ---
  const teamPlayerHighlights = {}
  if (roster1?.rosters && rosterCurrent?.rosters) {
    for (const teamId of Object.keys(rosterCurrent.rosters)) {
      const earlyRoster = roster1.rosters[teamId]
      const currentRoster = rosterCurrent.rosters[teamId]
      if (!currentRoster) continue

      const teamName = currentRoster.teamName
      const earlyIds = new Set((earlyRoster?.rosterItems || []).map(p => p.id))
      const currentItems = currentRoster.rosterItems || []

      // Enrich current roster with stats + draft info
      const teamDraft = draftByTeam[teamName] || []
      const draftMap = Object.fromEntries(teamDraft.map(d => [d.scorerId, d]))

      const enriched = currentItems.map(p => {
        const s = playerStats[p.id] || {}
        const d = draftMap[p.id]
        return {
          id: p.id,
          name: playerDb[p.id]?.name || s.name || p.id,
          position: playerDb[p.id]?.position || '',
          status: p.status, // ACTIVE or RESERVE
          totalPts: s.totalPts || 0,
          avgPts: s.avgPts || 0,
          startPct: s.startPct || '?%',
          wasHereSeason1: earlyIds.has(p.id),
          draftRound: d?.round,
          draftPick: d?.pickNumber
        }
      })

      // Star: highest total pts on current roster with stats
      const withStats = enriched.filter(p => p.totalPts > 0)
      const star = withStats.length
        ? withStats.reduce((best, p) => p.totalPts > best.totalPts ? p : best)
        : null

      // Worst: lowest total pts (among those with any stats)
      const worst = withStats.length
        ? withStats.reduce((worst, p) => p.totalPts < worst.totalPts ? p : worst)
        : null

      // Should have sold: was on team from week 1, currently RESERVE, has stats
      const shouldSell = enriched
        .filter(p => p.wasHereSeason1 && p.status === 'RESERVE' && p.totalPts > 0)
        .sort((a, b) => {
          // Prioritise early draft picks (expected to be stars but now benched)
          if (a.draftRound && b.draftRound) return a.draftRound - b.draftRound || a.draftPick - b.draftPick
          return b.totalPts - a.totalPts // otherwise highest pts benched player = saddest
        })[0] || null

      teamPlayerHighlights[teamName] = { star, worst, shouldSell }
    }
  }

  // --- Process transfer changes ---
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

  const leagueName = richStandings?.miscData?.heading || 'Fantasy League'

  return {
    leagueId,
    leagueName,
    currentPeriod,
    totalPeriods,
    standings,
    draftPicks,
    weeklyMatchups,
    rosterChanges,
    teamPlayerHighlights
  }
}
