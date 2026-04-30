/**
 * Report generator — turns raw Fantrax league data into display-ready sections.
 *
 * The main export is generateRoastSections(), which returns an array of section
 * objects (id, icon, title, content, etc.) that Home.jsx renders as tiles.
 *
 * Structure:
 *   Utility helpers        — pick, fmt, ordinal
 *   Analyze functions      — pure data crunching, return plain objects
 *   Generate functions     — turn analysis results into formatted strings
 *   generateRoastSections  — orchestrates everything, exported
 */

// ─── Utility helpers ────────────────────────────────────────────────────────

// Returns a random element from an array (used for varied champion/spoon text)
const pick = arr => arr[Math.floor(Math.random() * arr.length)]

// Formats a number to 2 decimal places
const fmt = n => Number(n).toFixed(2)

// Converts a number to its ordinal string: 1 → "1st", 2 → "2nd", 11 → "11th"
// The modulo trick handles the special cases for 11th, 12th, 13th correctly
function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0])
}

// ─── Analyze functions ───────────────────────────────────────────────────────

/** Returns the league leader (rank 1) and bottom team from the standings array */
function analyzeStandings(standings) {
  const sorted = [...standings].sort((a, b) => a.rank - b.rank)
  return { winner: sorted[0], last: sorted[sorted.length - 1] }
}

/**
 * Single-pass scan over all played matchups.
 * Returns per-team stats (best/worst/avg score, worst week) plus overall
 * records for lowest score, highest score, and biggest winning margin.
 */
function analyzeWeekly(weeklyMatchups) {
  if (!weeklyMatchups.length) return {}

  const teamWeeks = {}
  let lowestScore  = { team: '', fpts: Infinity,  gw: '', opponent: '', opponentFpts: 0 }
  let highestScore = { team: '', fpts: -Infinity, gw: '' }
  let biggestMargin = { winner: '', loser: '', margin: 0, gw: '', winFpts: 0, loseFpts: 0 }

  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayTeam || !m.homeTeam || (m.awayFpts === 0 && m.homeFpts === 0)) continue

      // Process both sides of each matchup so every team gets a data point
      const sides = [
        { team: m.awayTeam, fpts: m.awayFpts, opp: m.homeTeam, oppFpts: m.homeFpts },
        { team: m.homeTeam, fpts: m.homeFpts, opp: m.awayTeam, oppFpts: m.awayFpts },
      ]
      for (const { team, fpts, opp, oppFpts } of sides) {
        if (!teamWeeks[team]) teamWeeks[team] = []
        teamWeeks[team].push({ fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts, won: fpts > oppFpts })
        if (fpts < lowestScore.fpts)  lowestScore  = { team, fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts }
        if (fpts > highestScore.fpts) highestScore = { team, fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts }
      }

      const margin = Math.abs(m.awayFpts - m.homeFpts)
      if (margin > biggestMargin.margin) {
        const [gwWinner, gwLoser] = m.awayFpts > m.homeFpts
          ? [m.awayTeam, m.homeTeam]
          : [m.homeTeam, m.awayTeam]
        biggestMargin = {
          winner: gwWinner, loser: gwLoser, margin,
          gw: gw.caption,
          winFpts: Math.max(m.awayFpts, m.homeFpts),
          loseFpts: Math.min(m.awayFpts, m.homeFpts),
        }
      }
    }
  }

  // Summarise each team's weekly scores into a single stats object
  const teamStats = {}
  for (const [team, weeks] of Object.entries(teamWeeks)) {
    const scores = weeks.map(w => w.fpts)
    teamStats[team] = {
      best:  Math.max(...scores),
      worst: Math.min(...scores),
      avg:   scores.reduce((a, b) => a + b, 0) / scores.length,
      worstWeek: weeks.reduce((best, w) => w.fpts < best.fpts ? w : best),
    }
  }

  return { lowestScore, highestScore, biggestMargin, teamStats }
}

/**
 * Builds a head-to-head win record for every pair of teams that has played
 * at least twice. Returns pairs sorted by dominance margin (biggest gap first).
 * Pairs with equal or near-equal records (margin < 2) are excluded as uninteresting.
 */
function analyzeBogeyTeams(weeklyMatchups) {
  const h2h = {}
  const teams = new Set()

  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayFpts && !m.homeFpts) continue
      teams.add(m.awayTeam)
      teams.add(m.homeTeam)
      const [winner, loser] = m.awayFpts > m.homeFpts
        ? [m.awayTeam, m.homeTeam]
        : [m.homeTeam, m.awayTeam]
      if (!h2h[winner]) h2h[winner] = {}
      h2h[winner][loser] = (h2h[winner][loser] || 0) + 1
    }
  }

  const teamList = [...teams]
  const pairs = []

  for (let i = 0; i < teamList.length; i++) {
    for (let j = i + 1; j < teamList.length; j++) {
      const a = teamList[i]
      const b = teamList[j]
      const aWins = (h2h[a]?.[b]) || 0
      const bWins = (h2h[b]?.[a]) || 0
      const total = aWins + bWins
      if (total < 2) continue                  // need at least 2 meetings
      const margin = Math.abs(aWins - bWins)
      if (margin < 2) continue                 // ignore roughly even records

      const dominant   = aWins >= bWins ? a : b
      const submissive = aWins >= bWins ? b : a
      pairs.push({
        dominant, submissive,
        domWins: Math.max(aWins, bWins),
        subWins: Math.min(aWins, bWins),
        total, margin,
      })
    }
  }

  return pairs.sort((a, b) => b.margin - a.margin || b.total - a.total)
}

/**
 * Computes the longest win streak and longest losing streak for each team
 * by replaying their match results in chronological order.
 */
function analyzeStreaksAll(weeklyMatchups) {
  const results = {}

  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayFpts && !m.homeFpts) continue
      const awayWon = m.awayFpts > m.homeFpts
      if (!results[m.awayTeam]) results[m.awayTeam] = []
      if (!results[m.homeTeam]) results[m.homeTeam] = []
      results[m.awayTeam].push(awayWon)
      results[m.homeTeam].push(!awayWon)
    }
  }

  const streaks = {}
  for (const [team, res] of Object.entries(results)) {
    let maxW = 0, maxL = 0, curW = 0, curL = 0
    for (const won of res) {
      if (won) { curW++; maxW = Math.max(maxW, curW); curL = 0 }
      else     { curL++; maxL = Math.max(maxL, curL); curW = 0 }
    }
    streaks[team] = { winStreak: maxW, loseStreak: maxL }
  }
  return streaks
}

/**
 * Detects teams whose final standings rank differs significantly from how they
 * were performing through the first third of the season.
 * Returns the biggest "comeback" (started poorly, finished well) and biggest
 * "fall from grace" (started well, finished poorly).
 * Returns null if there aren't enough gameweeks to be meaningful (< 6).
 */
function analyzeSeasonArc(weeklyMatchups, standings) {
  if (weeklyMatchups.length < 6) return null

  // Use the first third of played gameweeks as the "early season" snapshot
  const checkpoint = Math.max(3, Math.floor(weeklyMatchups.length / 3))
  const earlyWins = {}
  const earlyGames = {}

  for (let i = 0; i < checkpoint; i++) {
    for (const m of weeklyMatchups[i].matchups) {
      if (!m.awayFpts && !m.homeFpts) continue
      const [winner, loser] = m.awayFpts > m.homeFpts
        ? [m.awayTeam, m.homeTeam]
        : [m.homeTeam, m.awayTeam]
      earlyWins[winner]  = (earlyWins[winner]  || 0) + 1
      earlyGames[winner] = (earlyGames[winner] || 0) + 1
      earlyGames[loser]  = (earlyGames[loser]  || 0) + 1
    }
  }

  const finalRank = Object.fromEntries(standings.map(t => [t.teamName, t.rank]))

  // Sort teams by early win rate to assign an "early rank", then compare to final rank
  const arcs = standings
    .map(t => ({
      team: t.teamName,
      earlyRate: (earlyWins[t.teamName] || 0) / (earlyGames[t.teamName] || 1),
      finalRank: finalRank[t.teamName],
    }))
    .sort((a, b) => b.earlyRate - a.earlyRate)
    .map((a, i) => ({ ...a, earlyRank: i + 1, change: (i + 1) - finalRank[a.team] }))

  arcs.sort((a, b) => b.change - a.change)
  return { comeback: arcs[0], fall: arcs[arcs.length - 1] }
}

/**
 * Counts how many times each team scored above the weekly average but still lost.
 * A high count indicates bad luck — good scores that happened to face a better opponent.
 */
function analyzeUnlucky(weeklyMatchups) {
  const unlucky = {}
  for (const gw of weeklyMatchups) {
    const scores = gw.matchups.flatMap(m => [m.awayFpts, m.homeFpts]).filter(s => s > 0)
    if (!scores.length) continue
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    for (const m of gw.matchups) {
      if (m.awayFpts > avg && m.awayFpts < m.homeFpts) unlucky[m.awayTeam] = (unlucky[m.awayTeam] || 0) + 1
      if (m.homeFpts > avg && m.homeFpts < m.awayFpts) unlucky[m.homeTeam] = (unlucky[m.homeTeam] || 0) + 1
    }
  }
  return unlucky
}

/**
 * Finds the biggest upset across all played gameweeks.
 * "Biggest" = highest-ranked team (worst position number) beating a lower-ranked
 * team by the largest margin. Uses final standings as the rank reference.
 */
function analyzeBiggestUpset(weeklyMatchups, standings) {
  const rankMap = Object.fromEntries(standings.map(t => [t.teamName, t.rank]))
  let best = null

  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayFpts && !m.homeFpts) continue
      const [winner, loser, winFpts, loseFpts] = m.awayFpts > m.homeFpts
        ? [m.awayTeam, m.homeTeam, m.awayFpts, m.homeFpts]
        : [m.homeTeam, m.awayTeam, m.homeFpts, m.awayFpts]
      const winnerRank = rankMap[winner] || 0
      const loserRank  = rankMap[loser]  || 0
      const margin = winFpts - loseFpts
      // Only counts as an upset if the winner has a worse (higher number) rank
      if (winnerRank > loserRank && (!best || margin > best.margin)) {
        best = { winner, loser, winFpts, loseFpts, margin, gw: gw.caption, winnerRank, loserRank }
      }
    }
  }
  return best
}

// ─── Generate functions ──────────────────────────────────────────────────────

/** Generates the Champions / Current Leaders tile content */
function generateChampions(winner, standings, currentPeriod, totalPeriods) {
  const second    = standings.find(t => t.rank === 2)
  const isComplete = currentPeriod >= totalPeriods
  const winRate   = (winner.winPercentage * 100).toFixed(1)
  const gap       = winner.wins - (second?.wins ?? 0)
  const label     = isComplete ? 'CHAMPIONS' : 'CURRENT LEADERS'
  const remaining = totalPeriods - currentPeriod

  return pick(winner.winPercentage > 0.6 ? [
    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${fmt(winner.totalPointsFor)} FPts | ${winRate}% win rate

${gap > 3
  ? `${gap} wins clear of ${second?.teamName ?? 'second place'}. That's not a title race, that's a procession.`
  : `${second?.teamName} are keeping it close. ${gap} win${gap !== 1 ? 's' : ''} in it.`
} ${isComplete ? 'Genuinely well managed.' : `Strong position with ${remaining} weeks remaining.`}`,

    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${winRate}% win rate

${winner.wins} wins from ${winner.wins + winner.draws + winner.losses} games. ${fmt(winner.totalPointsFor)} fantasy points. The numbers don't lie.`,
  ] : [
    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${fmt(winner.totalPointsFor)} FPts

${isComplete
  ? 'Champions, though not without wobbles.'
  : `Out in front, though ${winner.losses} defeats suggest it's not been plain sailing.`
} ${gap <= 1 ? 'This could go right to the wire.' : ''}`,
  ])
}

/** Generates the Bottom of the Table / Wooden Spoon tile content */
function generateWoodenSpoon(last, standings, teamStats, currentPeriod, totalPeriods) {
  const gamesPlayed = last.wins + last.draws + last.losses
  const winRate     = ((last.wins / gamesPlayed) * 100).toFixed(1)
  const ts          = teamStats[last.teamName]
  const isComplete  = currentPeriod >= totalPeriods
  const remaining   = totalPeriods - currentPeriod
  const label       = isComplete ? 'WOODEN SPOON' : 'BOTTOM OF THE TABLE'

  return pick([
    `🥄 ${label}: ${last.teamName}
${'─'.repeat(40)}
${last.wins}W - ${last.draws}D - ${last.losses}L | ${fmt(last.totalPointsFor)} FPts | ${winRate}% win rate

${last.wins} win${last.wins !== 1 ? 's' : ''} from ${gamesPlayed} games. ${parseFloat(winRate) < 15 ? "That's below the average relegation-zone win rate in the actual Premier League." : ''}

${ts?.worstWeek ? `Lowest point: ${fmt(ts.worstWeek.fpts)} pts in ${ts.worstWeek.gw} against ${ts.worstWeek.opponent}.` : ''}${isComplete ? '' : ` ${remaining} games left to turn it around.`}`,

    `🥄 ${label}: ${last.teamName}
${'─'.repeat(40)}
${last.wins}W - ${last.draws}D - ${last.losses}L

${last.losses} losses. ${fmt(last.totalPointsFor)} fantasy points, ${fmt(standings[0].totalPointsFor - last.totalPointsFor)} behind the top.${isComplete ? '' : ` ${remaining} gameweeks remaining.`}

${last.wins <= 4
  ? `${last.wins} win${last.wins !== 1 ? 's' : ''} all season.`
  : `${last.wins} wins, which suggests signs of life — just not enough.`}`,
  ])
}

/** Draft Day tile: top early picks still on their squad, and early busts */
function generateDraftAnalysisSection(topPicks, worstPicks) {
  const lines = []

  if (topPicks.length) {
    const hasPoints = topPicks.some(p => p.totalFpts !== null)
    lines.push(hasPoints ? 'TOP PICKS — Most fantasy points scored' : 'TOP PICKS — Highest drafted players still on squad')
    topPicks.forEach((p, i) => {
      const ctx = [p.position, p.club].filter(Boolean).join(', ')
      const pts = p.totalFpts !== null ? ` — ${Number(p.totalFpts).toFixed(1)} pts` : ''
      const owner = p.traded ? `drafted by ${p.teamName}, now at ${p.currentTeamName}` : `drafted by ${p.teamName}`
      lines.push(`${i + 1}. ${p.playerName}${ctx ? ` (${ctx})` : ''}${pts} — R${p.draftRound} P${p.draftPick}, ${owner}`)
    })
  }

  if (worstPicks.length) {
    if (lines.length) lines.push('')
    lines.push('BUSTS — Dropped despite early investment')
    worstPicks.forEach((p, i) => {
      const ctx = [p.position, p.club].filter(Boolean).join(', ')
      lines.push(`${i + 1}. ${p.playerName}${ctx ? ` (${ctx})` : ''} — R${p.draftRound} P${p.draftPick} by ${p.teamName}, no longer on the squad`)
    })
  }

  if (!topPicks.length && !worstPicks.length) lines.push('Draft data unavailable for this league.')
  return lines.join('\n')
}

/** Transfer Activity tile: most/least active managers and best incoming players */
function generateTransferAnalysisSection(rosterChanges, bestIncomings) {
  if (!rosterChanges.length) return 'No transfer data available — roster comparison may still be loading.'

  const sorted = [...rosterChanges].sort((a, b) =>
    (b.added.length + b.removed.length) - (a.added.length + a.removed.length)
  )
  const most  = sorted[0]
  const least = sorted[sorted.length - 1]
  const mostTotal  = most.added.length  + most.removed.length
  const leastTotal = least.added.length + least.removed.length

  const lines = [
    `MOST ACTIVE: ${most.teamName} — ${mostTotal} move${mostTotal !== 1 ? 's' : ''}`,
    '',
    `LEAST ACTIVE: ${least.teamName} — ${leastTotal === 0 ? 'zero changes all season' : `${leastTotal} move${leastTotal !== 1 ? 's' : ''}`}`,
  ]

  if (bestIncomings.length) {
    lines.push('')
    lines.push('BEST PLAYERS TRANSFERRED IN (top 5)')
    bestIncomings.slice(0, 5).forEach((p, i) => {
      const ctx = [p.position, p.club].filter(Boolean).join(', ')
      lines.push(`${i + 1}. ${p.playerName}${ctx ? ` (${ctx})` : ''} → ${p.teamName}`)
    })
  }

  return lines.join('\n')
}

/**
 * Bogey Teams tile: shows only perfect 100% win-rate H2H records (N-0),
 * grouped so teams that dominate multiple opponents appear as one entry.
 * We exclude records where a team has won at least once against an opponent
 * because those tell a less interesting story.
 */
function generateBogeySection(weeklyMatchups) {
  if (!weeklyMatchups.length) return 'Match data needed for head-to-head records.'

  const perfectPairs = analyzeBogeyTeams(weeklyMatchups).filter(p => p.subWins === 0)
  if (!perfectPairs.length) {
    return "No perfect head-to-head records yet — every team has won at least once against each opponent they've faced multiple times."
  }

  // Group victims under each dominant team
  const grouped = {}
  for (const p of perfectPairs) {
    if (!grouped[p.dominant]) grouped[p.dominant] = []
    grouped[p.dominant].push(p)
  }

  // Sort: most victims first, then by total wins as a tiebreaker
  const sortedDominants = Object.entries(grouped)
    .map(([team, victims]) => ({
      team,
      victims,
      totalWins: victims.reduce((sum, p) => sum + p.domWins, 0),
    }))
    .sort((a, b) => b.victims.length - a.victims.length || b.totalWins - a.totalWins)

  return sortedDominants
    .map(({ team, victims }) => {
      const victimList = victims.map(p => `${p.submissive} (${p.domWins}-0)`).join(', ')
      return `${team} — unbeaten vs: ${victimList}`
    })
    .join('\n')
}

/** Season Stories tile: streaks, comebacks, collapses, consistency, and departures */
function generateSeasonStoriesSection(weeklyMatchups, standings, worstPicks, weekly) {
  if (!weeklyMatchups.length) return 'Match data needed for season stories.'
  const lines = []

  // Win/loss streaks
  const streaks = analyzeStreaksAll(weeklyMatchups)
  const teams   = Object.keys(streaks)
  const topWin  = [...teams].sort((a, b) => streaks[b].winStreak  - streaks[a].winStreak)[0]
  const topLoss = [...teams].sort((a, b) => streaks[b].loseStreak - streaks[a].loseStreak)[0]

  if (topWin && streaks[topWin].winStreak >= 3) {
    lines.push(`LONGEST WIN STREAK: ${topWin} — ${streaks[topWin].winStreak} in a row`)
    lines.push('')
  }
  if (topLoss && streaks[topLoss].loseStreak >= 3) {
    lines.push(`LONGEST LOSING STREAK: ${topLoss} — ${streaks[topLoss].loseStreak} consecutive losses`)
    lines.push('')
  }

  // Biggest position change from early season to final standings
  const arc = analyzeSeasonArc(weeklyMatchups, standings)
  if (arc?.comeback?.change > 2) {
    lines.push(`BEST COMEBACK: ${arc.comeback.team}`)
    lines.push(`Tracking ${ordinal(arc.comeback.earlyRank)} early in the season, now ${ordinal(arc.comeback.finalRank)}`)
    lines.push('')
  }
  if (arc?.fall?.change < -2) {
    lines.push(`WORST FALL FROM GRACE: ${arc.fall.team}`)
    lines.push(`Looked like ${ordinal(arc.fall.earlyRank)} place material early on, ended up ${ordinal(arc.fall.finalRank)}`)
    lines.push('')
  }

  // Most consistent scorer (smallest range between best and worst weekly score)
  const { teamStats } = weekly
  if (teamStats) {
    const consistent = Object.keys(teamStats)
      .sort((a, b) => (teamStats[a].best - teamStats[a].worst) - (teamStats[b].best - teamStats[b].worst))[0]
    if (consistent) {
      const range = teamStats[consistent].best - teamStats[consistent].worst
      lines.push(`MOST CONSISTENT: ${consistent}`)
      lines.push(`Scored between ${fmt(teamStats[consistent].worst)} and ${fmt(teamStats[consistent].best)} pts — only a ${fmt(range)}-point range`)
      lines.push('')
    }
  }

  // Unluckiest team: most weeks scoring above average but still losing
  const unlucky   = analyzeUnlucky(weeklyMatchups)
  const unluckiest = Object.entries(unlucky).sort((a, b) => b[1] - a[1])[0]
  if (unluckiest && unluckiest[1] >= 2) {
    lines.push(`MOST UNLUCKY: ${unluckiest[0]}`)
    lines.push(`Scored above the weekly average ${unluckiest[1]} times but still lost`)
    lines.push('')
  }

  // Biggest high-profile departure: an early-round pick who is no longer on any squad
  // We exclude players who merely transferred clubs within the EPL — those get a new
  // Fantrax player ID, making them appear "dropped" even though they're still playing.
  // stillInEpl is true when the player's original Fantrax ID still has an EPL team attached.
  const departure = worstPicks?.find(p => !p.stillInEpl)
  if (departure) {
    const ctx = [departure.position, departure.club].filter(Boolean).join(', ')
    lines.push('BIGGEST HIGH-PROFILE DEPARTURE')
    lines.push(`${departure.playerName}${ctx ? ` (${ctx})` : ''} — picked in R${departure.draftRound} by ${departure.teamName}, no longer on the squad`)
    lines.push("One of the most anticipated picks of the draft. Didn't last the season.")
  }

  return lines.join('\n') || 'Not enough data for season stories yet.'
}

/** Best Undrafted Pickups tile */
function generateUndraftedSection(undraftedPickups) {
  if (!undraftedPickups.length) return 'No undrafted pickups currently starting for their teams.'
  const lines = ['TOP UNDRAFTED PICKUPS — signed off the waiver wire, now starting']
  undraftedPickups.forEach((p, i) => {
    const ctx = [p.position, p.club].filter(Boolean).join(', ')
    lines.push(`${i + 1}. ${p.playerName}${ctx ? ` (${ctx})` : ''} → ${p.teamName}`)
  })
  return lines.join('\n')
}

/** End of Season Awards tile: biggest win, biggest upset, scoring records, points gap */
function generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods, nameChanges, weekly) {
  try {
    const isComplete = currentPeriod >= totalPeriods
    const remaining  = totalPeriods - currentPeriod
    const out = []
    const wm  = weeklyMatchups || []
    const s   = standings

    // Biggest winning margin — already computed in the weekly analysis pass
    const { biggestMargin } = weekly
    if (biggestMargin?.winner) {
      out.push('BIGGEST WIN')
      out.push(`${biggestMargin.winner} ${fmt(biggestMargin.winFpts)} — ${fmt(biggestMargin.loseFpts)} ${biggestMargin.loser}`)
      out.push(`${biggestMargin.gw} · margin: ${fmt(biggestMargin.margin)} pts`)
      out.push('')
    }

    const upset = analyzeBiggestUpset(wm, s)
    if (upset) {
      out.push('BIGGEST UPSET')
      out.push(`${upset.winner} (${ordinal(upset.winnerRank)}) beat ${upset.loser} (${ordinal(upset.loserRank)})`)
      out.push(`${fmt(upset.winFpts)} — ${fmt(upset.loseFpts)} · ${upset.gw}`)
      out.push('')
    }

    // Highest and lowest scoring gameweeks by combined points across all matches
    if (wm.length > 0) {
      let highGW = null, lowGW = null
      for (const gw of wm) {
        const total = gw.matchups.reduce((sum, m) => sum + (m.awayFpts || 0) + (m.homeFpts || 0), 0)
        if (total > 0) {
          if (!highGW || total > highGW.total) highGW = { caption: gw.caption, total }
          if (!lowGW  || total < lowGW.total)  lowGW  = { caption: gw.caption, total }
        }
      }
      if (highGW) {
        out.push(`HIGHEST SCORING GAMEWEEK: ${highGW.caption}`)
        out.push(`${fmt(highGW.total)} combined pts`)
        out.push('')
      }
      if (lowGW && lowGW.caption !== highGW?.caption) {
        out.push(`LOWEST SCORING GAMEWEEK: ${lowGW.caption}`)
        out.push(`${fmt(lowGW.total)} combined pts`)
        out.push('')
      }
    }

    // Points totals and gap between 1st and last
    if (s.length > 0) {
      const byPts  = [...s].sort((a, b) => (b.totalPointsFor || 0) - (a.totalPointsFor || 0))
      const byRank = [...s].sort((a, b) => (a.rank || 99) - (b.rank || 99))
      const first  = byRank[0]
      const last   = byRank[byRank.length - 1]

      out.push(`MOST POINTS SCORED: ${byPts[0].teamName} — ${fmt(byPts[0].totalPointsFor || 0)} pts`)
      out.push('')
      out.push('POINTS GAP (1st vs last)')
      out.push(`${first.teamName}: ${fmt(first.totalPointsFor || 0)} pts`)
      out.push(`${last.teamName}: ${fmt(last.totalPointsFor || 0)} pts`)
      out.push(`Gap: ${fmt((first.totalPointsFor || 0) - (last.totalPointsFor || 0))} pts over ${currentPeriod} GWs`)
      out.push('')
    }

    if (nameChanges?.length > 0) {
      out.push('TEAM NAME CHANGES')
      nameChanges.forEach(c => out.push(`${c.oldName} → ${c.newName}`))
      out.push('')
    }

    out.push(isComplete ? 'Season complete.' : `${remaining} gameweek${remaining !== 1 ? 's' : ''} remaining.`)
    return out.join('\n')
  } catch (e) {
    return `Could not generate awards: ${e.message}\n\n${totalPeriods - currentPeriod} gameweeks remaining.`
  }
}

/**
 * Strips the header line and separator from generated champion/spoon text.
 * Those sections are generated with "🏆 TITLE: Name\n────\nContent" formatting
 * so the title can be used as a subtitle in the tile header instead of repeating it.
 */
function stripHeader(text) {
  if (!text) return ''
  const lines = text.split('\n')
  let i = lines.length > 0 ? 1 : 0
  if (i < lines.length && /^[─═]+$/.test(lines[i].trim())) i++
  while (i < lines.length && !lines[i].trim()) i++
  return lines.slice(i).join('\n').trim()
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Orchestrates all analysis and generation, returning an array of section objects.
 * Each section has: id, icon, accent colour, title, optional subtitle, content string.
 * The weekly analysis is computed once here and passed to functions that need it
 * to avoid scanning all matchup data multiple times.
 */
export function generateRoastSections(leagueData) {
  const {
    standings,
    weeklyMatchups = [],
    rosterChanges  = [],
    currentPeriod  = 34,
    totalPeriods   = 38,
    draftAnalysis  = {},
    transferAnalysis = {},
    nameChanges    = [],
  } = leagueData

  if (!standings?.length) throw new Error('No standings data available.')

  const { winner, last } = analyzeStandings(standings)
  const weekly     = analyzeWeekly(weeklyMatchups)
  const isComplete = currentPeriod >= totalPeriods
  const out        = []

  const champText = generateChampions(winner, standings, currentPeriod, totalPeriods)
  if (champText) out.push({ id: 'leaders', icon: '🏆', accent: 'gold', title: isComplete ? 'Champions' : 'Current Leaders', subtitle: winner.teamName, content: stripHeader(champText) })

  const spoonText = generateWoodenSpoon(last, standings, weekly.teamStats || {}, currentPeriod, totalPeriods)
  if (spoonText) out.push({ id: 'spoon', icon: '🥄', accent: 'red', title: 'Bottom of the Table', subtitle: last.teamName, content: stripHeader(spoonText) })

  const { topPicks = [], worstPicks = [] } = draftAnalysis
  out.push({ id: 'draft', icon: '📋', accent: 'teal', title: 'Draft Day', content: generateDraftAnalysisSection(topPicks, worstPicks) })

  const { bestIncomings = [], undraftedPickups = [] } = transferAnalysis
  out.push({ id: 'transfers', icon: '🔄', accent: 'teal', title: 'Transfer Activity', content: generateTransferAnalysisSection(rosterChanges, bestIncomings) })

  out.push({ id: 'bogey', icon: '👻', accent: 'blue', title: 'Bogey Teams', content: generateBogeySection(weeklyMatchups) })

  out.push({ id: 'undrafted', icon: '🔍', accent: 'green', title: 'Best Undrafted Pickups', content: generateUndraftedSection(undraftedPickups) })

  out.push({ id: 'stories', icon: '📈', accent: 'green', fullWidth: true, title: 'Season Stories', content: generateSeasonStoriesSection(weeklyMatchups, standings, worstPicks, weekly) })

  out.push({ id: 'awards', icon: '🏅', accent: 'gold', fullWidth: true, title: isComplete ? 'End of Season Awards' : 'Awards So Far', content: generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods, nameChanges, weekly) })

  return out
}
