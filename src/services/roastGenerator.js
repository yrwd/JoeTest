const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const fmt = n => Number(n).toFixed(2)
const ordinal = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]) }

function analyzeStandings(standings) {
  const sorted = [...standings].sort((a, b) => a.rank - b.rank)
  return { winner: sorted[0], last: sorted[sorted.length - 1] }
}

function analyzeWeekly(weeklyMatchups) {
  if (!weeklyMatchups.length) return {}
  const teamWeeks = {}
  let lowestScore = { team: '', fpts: Infinity, gw: '', opponent: '', opponentFpts: 0 }
  let highestScore = { team: '', fpts: -Infinity, gw: '' }
  let biggestMargin = { winner: '', loser: '', margin: 0, gw: '', winFpts: 0, loseFpts: 0 }

  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayTeam || !m.homeTeam || (m.awayFpts === 0 && m.homeFpts === 0)) continue
      ;[
        { team: m.awayTeam, fpts: m.awayFpts, opp: m.homeTeam, oppFpts: m.homeFpts },
        { team: m.homeTeam, fpts: m.homeFpts, opp: m.awayTeam, oppFpts: m.awayFpts }
      ].forEach(({ team, fpts, opp, oppFpts }) => {
        if (!teamWeeks[team]) teamWeeks[team] = []
        teamWeeks[team].push({ fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts, won: fpts > oppFpts })
        if (fpts < lowestScore.fpts) lowestScore = { team, fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts }
        if (fpts > highestScore.fpts) highestScore = { team, fpts, gw: gw.caption, opponent: opp, opponentFpts: oppFpts }
      })
      const margin = Math.abs(m.awayFpts - m.homeFpts)
      if (margin > biggestMargin.margin) {
        const aw = m.awayFpts > m.homeFpts
        biggestMargin = { winner: aw ? m.awayTeam : m.homeTeam, loser: aw ? m.homeTeam : m.awayTeam, margin, gw: gw.caption, winFpts: Math.max(m.awayFpts, m.homeFpts), loseFpts: Math.min(m.awayFpts, m.homeFpts) }
      }
    }
  }

  const teamStats = {}
  for (const [team, weeks] of Object.entries(teamWeeks)) {
    const scores = weeks.map(w => w.fpts)
    teamStats[team] = {
      best: Math.max(...scores), worst: Math.min(...scores),
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
      worstWeek: weeks.reduce((b, w) => w.fpts < b.fpts ? w : b)
    }
  }
  return { lowestScore, highestScore, biggestMargin, teamStats }
}

function generateChampions(winner, standings, currentPeriod, totalPeriods) {
  const second = standings.find(t => t.rank === 2)
  const isComplete = currentPeriod >= totalPeriods
  const winRate = (winner.winPercentage * 100).toFixed(1)
  const gap = winner.wins - (second?.wins ?? 0)
  const label = isComplete ? 'CHAMPIONS' : 'CURRENT LEADERS'

  return pick(winner.winPercentage > 0.6 ? [
    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${fmt(winner.totalPointsFor)} FPts | ${winRate}% win rate

${gap > 3 ? `${gap} wins clear of ${second?.teamName ?? 'second place'}. That's not a title race, that's a procession.` : `${second?.teamName} are keeping it close. ${gap} win${gap !== 1 ? 's' : ''} in it.`} ${isComplete ? 'Genuinely well managed.' : 'Strong position with ' + (totalPeriods - currentPeriod) + ' weeks remaining.'}`,

    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${winRate}% win rate

${winner.wins} wins from ${winner.wins + winner.draws + winner.losses} games. ${fmt(winner.totalPointsFor)} fantasy points. The numbers don't lie.`
  ] : [
    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${fmt(winner.totalPointsFor)} FPts

${isComplete ? 'Champions, though not without wobbles.' : 'Out in front, though ' + winner.losses + " defeats suggest it's not been plain sailing."} ${gap <= 1 ? 'This could go right to the wire.' : ''}`,
  ])
}

function generateWoodenSpoon(last, standings, teamStats, currentPeriod, totalPeriods) {
  const gamesPlayed = last.wins + last.draws + last.losses
  const winRate = ((last.wins / gamesPlayed) * 100).toFixed(1)
  const ts = teamStats[last.teamName]
  const isComplete = currentPeriod >= totalPeriods
  const remaining = totalPeriods - currentPeriod
  const label = isComplete ? 'WOODEN SPOON' : 'BOTTOM OF THE TABLE'

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

${last.wins <= 4 ? `${last.wins} win${last.wins !== 1 ? 's' : ''} all season.` : `${last.wins} wins, which suggests signs of life — just not enough.`}`
  ])
}

function generateDraftAnalysisSection(topPicks, worstPicks) {
  const lines = []
  if (topPicks.length) {
    lines.push('TOP PICKS — Still on the squad')
    topPicks.forEach((p, i) => {
      const ctx = [p.position, p.club].filter(Boolean).join(', ')
      lines.push(`${i + 1}. ${p.playerName}${ctx ? ` (${ctx})` : ''} — drafted R${p.draftRound} P${p.draftPick} by ${p.teamName}`)
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

function generateTransferAnalysisSection(rosterChanges, bestIncomings) {
  if (!rosterChanges.length) return 'No transfer data available — roster comparison may still be loading.'
  const lines = []
  const sorted = [...rosterChanges].sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))
  const most = sorted[0]
  const least = sorted[sorted.length - 1]
  const mostTotal = most.added.length + most.removed.length
  const leastTotal = least.added.length + least.removed.length

  lines.push(`MOST ACTIVE: ${most.teamName} — ${mostTotal} move${mostTotal !== 1 ? 's' : ''}`)
  if (most.added.length) lines.push(`  Signed: ${most.added.slice(0, 5).join(', ')}`)
  if (most.removed.length) lines.push(`  Moved on: ${most.removed.slice(0, 5).join(', ')}`)
  lines.push('')
  lines.push(`LEAST ACTIVE: ${least.teamName} — ${leastTotal === 0 ? 'zero changes all season' : `${leastTotal} move${leastTotal !== 1 ? 's' : ''}`}`)

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

function analyzeBiggestUpset(weeklyMatchups, standings) {
  const rankMap = Object.fromEntries(standings.map(t => [t.teamName, t.rank]))
  let best = null
  for (const gw of weeklyMatchups) {
    for (const m of gw.matchups) {
      if (!m.awayFpts && !m.homeFpts) continue
      const winnerIsAway = m.awayFpts > m.homeFpts
      const winner = winnerIsAway ? m.awayTeam : m.homeTeam
      const loser = winnerIsAway ? m.homeTeam : m.awayTeam
      const winFpts = Math.max(m.awayFpts, m.homeFpts)
      const loseFpts = Math.min(m.awayFpts, m.homeFpts)
      const winnerRank = rankMap[winner] || 0
      const loserRank = rankMap[loser] || 0
      const margin = winFpts - loseFpts
      if (winnerRank > loserRank && (!best || margin > best.margin))
        best = { winner, loser, winFpts, loseFpts, margin, gw: gw.caption, winnerRank, loserRank }
    }
  }
  return best
}

function generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods, nameChanges) {
  try {
    const isComplete = currentPeriod >= totalPeriods
    const remaining = totalPeriods - currentPeriod
    const out = []
    const wm = weeklyMatchups || []
    const s = standings || []

    const { biggestMargin } = analyzeWeekly(wm)
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

    if (wm.length > 0) {
      let highGW = null, lowGW = null
      for (const gw of wm) {
        const total = gw.matchups.reduce((sum, m) => sum + (m.awayFpts || 0) + (m.homeFpts || 0), 0)
        if (total > 0) {
          if (!highGW || total > highGW.total) highGW = { caption: gw.caption, total }
          if (!lowGW || total < lowGW.total) lowGW = { caption: gw.caption, total }
        }
      }
      if (highGW) { out.push(`HIGHEST SCORING GAMEWEEK: ${highGW.caption}`); out.push(`${fmt(highGW.total)} combined pts`); out.push('') }
      if (lowGW && lowGW.caption !== highGW?.caption) { out.push(`LOWEST SCORING GAMEWEEK: ${lowGW.caption}`); out.push(`${fmt(lowGW.total)} combined pts`); out.push('') }
    }

    if (s.length > 0) {
      const byPts = [...s].sort((a, b) => (b.totalPointsFor || 0) - (a.totalPointsFor || 0))
      const byRank = [...s].sort((a, b) => (a.rank || 99) - (b.rank || 99))
      const first = byRank[0], last = byRank[byRank.length - 1]
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

function stripHeader(text) {
  if (!text) return ''
  const lines = text.split('\n')
  let i = 0
  if (i < lines.length) i++
  if (i < lines.length && /^[─═]+$/.test(lines[i].trim())) i++
  while (i < lines.length && !lines[i].trim()) i++
  return lines.slice(i).join('\n').trim()
}

export function generateRoastSections(leagueData) {
  const {
    standings, weeklyMatchups = [],
    rosterChanges = [], currentPeriod = 34, totalPeriods = 38,
    draftAnalysis = {}, transferAnalysis = {}, nameChanges = []
  } = leagueData

  if (!standings?.length) throw new Error('No standings data available.')

  const { winner, last } = analyzeStandings(standings)
  const weekly = analyzeWeekly(weeklyMatchups)
  const isComplete = currentPeriod >= totalPeriods
  const out = []

  const champText = generateChampions(winner, standings, currentPeriod, totalPeriods)
  if (champText) out.push({ id: 'leaders', icon: '🏆', accent: 'gold', title: isComplete ? 'Champions' : 'Current Leaders', subtitle: winner.teamName, content: stripHeader(champText) })

  const spoonText = generateWoodenSpoon(last, standings, weekly.teamStats || {}, currentPeriod, totalPeriods)
  if (spoonText) out.push({ id: 'spoon', icon: '🥄', accent: 'red', title: 'Bottom of the Table', subtitle: last.teamName, content: stripHeader(spoonText) })

  const { topPicks = [], worstPicks = [] } = draftAnalysis
  out.push({ id: 'draft', icon: '📋', accent: 'teal', title: 'Draft Day', content: generateDraftAnalysisSection(topPicks, worstPicks) })

  const { bestIncomings = [] } = transferAnalysis
  out.push({ id: 'transfers', icon: '🔄', accent: 'teal', title: 'Transfer Activity', content: generateTransferAnalysisSection(rosterChanges, bestIncomings) })

  out.push({ id: 'awards', icon: '🏅', accent: 'gold', fullWidth: true, title: isComplete ? 'End of Season Awards' : 'Awards So Far', content: generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods, nameChanges) })

  return out
}
