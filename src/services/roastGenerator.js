const pick = arr => arr[Math.floor(Math.random() * arr.length)]
const fmt = n => Number(n).toFixed(2)
const ordinal = n => { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]) }

function analyzeStandings(standings) {
  const sorted = [...standings].sort((a, b) => a.rank - b.rank)
  const winner = sorted[0]
  const last = sorted[sorted.length - 1]
  const mostFPts = [...standings].sort((a, b) => b.totalPointsFor - a.totalPointsFor)[0]
  return { winner, last, mostFPts }
}

function analyzeWeekly(weeklyMatchups) {
  if (!weeklyMatchups.length) return {}
  const teamWeeks = {}
  let lowestScore = { team: '', fpts: Infinity, gw: '', opponent: '', opponentFpts: 0 }
  let highestScore = { team: '', fpts: -Infinity, gw: '' }
  let biggestMargin = { winner: '', loser: '', margin: 0, gw: '', winFpts: 0, loseFpts: 0 }
  let closestGame = { teams: '', margin: Infinity, gw: '', score: '' }

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
      if (margin < closestGame.margin && margin > 0) {
        closestGame = { teams: `${m.awayTeam} vs ${m.homeTeam}`, margin, gw: gw.caption, score: `${m.awayFpts} - ${m.homeFpts}` }
      }
    }
  }

  const teamStats = {}
  for (const [team, weeks] of Object.entries(teamWeeks)) {
    const scores = weeks.map(w => w.fpts)
    const best = Math.max(...scores), worst = Math.min(...scores)
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    let winStreak = 0, loseStreak = 0, curW = 0, curL = 0
    for (const w of weeks) {
      if (w.won) { curW++; winStreak = Math.max(winStreak, curW); curL = 0 }
      else { curL++; loseStreak = Math.max(loseStreak, curL); curW = 0 }
    }
    teamStats[team] = { best, worst, avg, winStreak, loseStreak, bestWeek: weeks.reduce((b, w) => w.fpts > b.fpts ? w : b), worstWeek: weeks.reduce((b, w) => w.fpts < b.fpts ? w : b) }
  }

  return { lowestScore, highestScore, biggestMargin, closestGame, teamStats }
}

function seasonLabel(current, total) {
  if (current >= total) return 'end of season'
  const pct = current / total
  if (pct < 0.33) return 'early season'
  if (pct < 0.66) return 'mid-season'
  return 'late season'
}

// ─── Section generators ──────────────────────────────────────────────────────

function generateIntro(leagueName, standings, weeklyMatchups, currentPeriod, totalPeriods) {
  const played = currentPeriod
  const remaining = totalPeriods - currentPeriod
  const isComplete = currentPeriod >= totalPeriods
  const totalFPts = Math.round(standings.reduce((s, t) => s + t.totalPointsFor, 0))
  const teams = standings.length

  const timePhrase = isComplete
    ? 'The season is done.'
    : `${remaining} gameweek${remaining !== 1 ? 's' : ''} still to play.`

  return `════════════════════════════════════════
${leagueName.toUpperCase()}
GAMEWEEK ${currentPeriod} OF ${totalPeriods} — SEASON REPORT
════════════════════════════════════════

${teams} managers. ${played} gameweek${played !== 1 ? 's' : ''} played. ${totalFPts.toLocaleString()} total fantasy points on the board. ${timePhrase}

Here's the honest version of events so far.`
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

${winner.wins} wins from ${winner.wins + winner.draws + winner.losses} games. ${fmt(winner.totalPointsFor)} fantasy points. The numbers don't lie — they've been better than everyone else, and they'd like you to know it.`
  ] : [
    `🏆 ${label}: ${winner.teamName}
${'─'.repeat(40)}
${winner.wins}W - ${winner.draws}D - ${winner.losses}L | ${fmt(winner.totalPointsFor)} FPts

${isComplete ? 'Champions, though not without wobbles.' : 'Out in front, though ' + winner.losses + ' defeats suggest it\'s not been plain sailing.'} ${gap <= 1 ? 'This could go right to the wire.' : ''}`,
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

${last.wins} win${last.wins !== 1 ? 's' : ''} from ${gamesPlayed} games. ${parseFloat(winRate) < 15 ? 'That\'s below the average relegation-zone win rate in the actual Premier League.' : ''}

${ts?.worstWeek ? `Their lowest point: ${fmt(ts.worstWeek.fpts)} points in ${ts.worstWeek.gw} against ${ts.worstWeek.opponent}.` : ''}${isComplete ? '' : ` ${remaining} games left to turn it around. It\'s not impossible. It just looks it.`}`,

    `🥄 ${label}: ${last.teamName}
${'─'.repeat(40)}
${last.wins}W - ${last.draws}D - ${last.losses}L

Let's be honest: ${last.losses} losses is a tough return. ${fmt(last.totalPointsFor)} fantasy points, ${fmt(standings[0].totalPointsFor - last.totalPointsFor)} behind the top.${isComplete ? '' : ` ${remaining} gameweeks to salvage some dignity.`}

${last.wins === 1 ? 'One win. One. There\'s a certain purity to it.' : last.wins <= 4 ? `${last.wins} wins. At least they\'re not winless.` : `${last.wins} wins, which suggests there were signs of life — just not enough.`}`
  ])
}

function generateWeeklyDrama(lowestScore, highestScore, biggestMargin, closestGame, teamStats, weeklyMatchups) {
  if (!lowestScore?.team) return ''
  const lines = [`⚡ NOTABLE MOMENTS (GW1–GW${weeklyMatchups.length})\n${'─'.repeat(40)}`]

  lines.push(pick([
    `BEST WEEK: ${highestScore.team} — ${fmt(highestScore.fpts)} pts (${highestScore.gw})\n${highestScore.fpts > 150 ? 'An absolute hauling. Everything landed that week.' : 'The kind of week that makes the group chat go quiet.'}`,
    `SEASON HIGH: ${fmt(highestScore.fpts)} points from ${highestScore.team} in ${highestScore.gw}. The benchmark no one else hit.`,
  ]))

  const beatDespiteScore = lowestScore.opponentFpts < lowestScore.fpts
  lines.push(pick([
    `WORST WEEK: ${lowestScore.team} — ${fmt(lowestScore.fpts)} pts (${lowestScore.gw})\n${beatDespiteScore ? `Somehow still won, because ${lowestScore.opponent} managed only ${fmt(lowestScore.opponentFpts)}. Glorious.` : `Lost to ${lowestScore.opponent} (${fmt(lowestScore.opponentFpts)} pts). A week to forget.`}`,
    `ROCK BOTTOM: ${fmt(lowestScore.fpts)} points from ${lowestScore.team} in ${lowestScore.gw}. ${beatDespiteScore ? 'Opponent was worse. The game was played.' : 'No moral victories here.'}`,
  ]))

  if (biggestMargin?.winner) {
    lines.push(`BIGGEST WIN: ${biggestMargin.winner} ${fmt(biggestMargin.winFpts)} - ${fmt(biggestMargin.loseFpts)} ${biggestMargin.loser} (${biggestMargin.gw})\nA ${fmt(biggestMargin.margin)}-point margin. ${biggestMargin.loser} had a day to forget.`)
  }

  if (closestGame?.margin < 5) {
    lines.push(`CLOSEST MATCH: ${closestGame.teams} — ${closestGame.score} (${closestGame.gw})\nSeparated by ${fmt(closestGame.margin)} points. One substitution decision away from a different result.`)
  }

  const bestStreak = Object.entries(teamStats).sort((a, b) => b[1].winStreak - a[1].winStreak)[0]
  if (bestStreak?.[1].winStreak >= 4) {
    lines.push(`BEST RUN: ${bestStreak[0]} went on a ${bestStreak[1].winStreak}-game winning streak. On form, they were untouchable.`)
  }

  const worstStreak = Object.entries(teamStats).sort((a, b) => b[1].loseStreak - a[1].loseStreak)[0]
  if (worstStreak?.[1].loseStreak >= 4) {
    lines.push(`ROUGH PATCH: ${worstStreak[0]} lost ${worstStreak[1].loseStreak} in a row. The group chat was not kind.`)
  }

  return lines.join('\n\n')
}

function generatePlayerHighlights(standings, teamPlayerHighlights) {
  if (!teamPlayerHighlights || !Object.keys(teamPlayerHighlights).length) return ''
  const lines = [`👤 SQUAD REPORT\n${'─'.repeat(40)}`]

  const sortedTeams = [...standings].sort((a, b) => a.rank - b.rank)

  for (const t of sortedTeams) {
    const h = teamPlayerHighlights[t.teamName]
    if (!h) continue
    const parts = []

    if (h.star?.name && h.star.totalPts > 0) {
      parts.push(pick([
        `Star: ${h.star.name} (${fmt(h.star.totalPts)} pts${h.star.draftRound ? `, drafted R${h.star.draftRound}` : ''})`,
        `Top performer: ${h.star.name} — ${fmt(h.star.totalPts)} pts YTD${h.star.avgPts > 0 ? `, avg ${fmt(h.star.avgPts)}/GW` : ''}`,
      ]))
    }

    if (h.worst?.name && h.worst.totalPts > 0 && h.worst.name !== h.star?.name) {
      parts.push(pick([
        `Liability: ${h.worst.name} (${fmt(h.worst.totalPts)} pts YTD)`,
        `Worst return: ${h.worst.name} — only ${fmt(h.worst.totalPts)} pts all season`,
      ]))
    }


    if (parts.length) {
      lines.push(`${t.teamName} (${ordinal(t.rank)}):\n  ${parts.join('\n  ')}`)
    }
  }

  return lines.length > 1 ? lines.join('\n\n') : ''
}

function generateDraftSection(pick1, pick1Team, round1, standings) {
  if (!pick1) return ''
  const lines = [`📋 DRAFT DAY\n${'─'.repeat(40)}`]

  if (pick1Team) {
    const rank = pick1Team.rank
    lines.push(pick(rank <= 3 ? [
      `First overall pick: ${pick1.teamName} took ${pick1.playerName} (${pick1.position}). They're currently ${ordinal(rank)}. The top pick delivered.`,
    ] : rank <= 6 ? [
      `First overall pick: ${pick1.teamName} selected ${pick1.playerName}. Currently ${ordinal(rank)} — mid-table. Not the return you'd hope for from pick one.`,
    ] : [
      `First overall pick: ${pick1.teamName} went with ${pick1.playerName} (${pick1.position}). They're currently ${ordinal(rank)}. Having first pick is an advantage. Not an automatic one.`,
    ]))
  }

  if (round1.length > 0) {
    lines.push(`Round 1:\n${round1.map(p => `  Pick ${p.pickNumber} (${p.teamName}): ${p.playerName}${p.position ? ' — ' + p.position : ''}${p.club ? ', ' + p.club : ''}`).join('\n')}`)
  }

  return lines.join('\n\n')
}

function generateTransfers(rosterChanges) {
  if (!rosterChanges.length) return ''
  const sorted = [...rosterChanges].sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))
  const most = sorted[0]
  const least = sorted[sorted.length - 1]
  const lines = [`🔄 TRANSFER ACTIVITY\n${'─'.repeat(40)}`]

  if (most) {
    const total = most.added.length + most.removed.length
    lines.push(`Most active: ${most.teamName} — ${total} moves\n${most.added.length ? '  In: ' + most.added.slice(0, 5).join(', ') : ''}${most.removed.length ? '\n  Out: ' + most.removed.slice(0, 5).join(', ') : ''}`)
  }

  if (least && least.teamName !== most?.teamName) {
    const total = least.added.length + least.removed.length
    lines.push(`Least active: ${least.teamName} — ${total} move${total !== 1 ? 's' : ''}. ${total === 0 ? 'Not a single change all season.' : 'Set-and-forget approach.'}`)
  }

  return lines.join('\n\n')
}

function generateShouldHaveSold(standings, teamPlayerHighlights) {
  const lines = [`🚮 SHOULD HAVE BEEN TRANSFERRED OUT\n${'─'.repeat(40)}`]
  let hasAny = false

  for (const t of [...standings].sort((a, b) => a.rank - b.rank)) {
    const h = teamPlayerHighlights[t.teamName]
    if (!h?.shouldSell?.name) continue

    const s = h.shouldSell
    const draftCtx = s.draftRound ? `, a round ${s.draftRound} pick` : ''
    const ptsCtx = s.totalPts > 0 ? ` — ${fmt(s.totalPts)} pts all season` : ''
    const avgCtx = s.avgPts > 0 ? ` (avg ${fmt(s.avgPts)}/GW)` : ''

    lines.push(pick([
      `${t.teamName}: ${s.name}${draftCtx}${ptsCtx}${avgCtx}. Still on the squad. The window is still open.`,
      `${t.teamName}: ${s.name}${ptsCtx}${avgCtx}${draftCtx ? `. Taken in round ${s.draftRound}` : ''}. The return has not matched the investment.`,
      `${t.teamName}: ${s.name}${draftCtx}${ptsCtx}. Sometimes you have to accept it isn't working.`,
    ]))
    hasAny = true
  }

  return hasAny ? lines.join('\n\n') : ''
}

function generateAwards(standings, teamStats, lowestScore, highestScore, rosterChanges, currentPeriod, totalPeriods) {
  const isComplete = currentPeriod >= totalPeriods
  const lines = [`🏅 ${isComplete ? 'END OF SEASON' : 'SO FAR'} — AWARDS\n${'─'.repeat(40)}`]

  const statEntries = Object.entries(teamStats)
  if (statEntries.length) {
    const ranges = statEntries.map(([t, s]) => ({ team: t, range: s.best - s.worst })).sort((a, b) => a.range - b.range)
    if (ranges[0]) lines.push(`📊 Most Consistent: ${ranges[0].team}\nScored between ${fmt(teamStats[ranges[0].team].worst)} and ${fmt(teamStats[ranges[0].team].best)} pts — a ${fmt(ranges[0].range)}-point range. Reliable, for better or worse.`)
    const volatile = ranges[ranges.length - 1]
    if (volatile) lines.push(`🎢 Boom or Bust: ${volatile.team}\nBest: ${fmt(teamStats[volatile.team].best)} pts. Worst: ${fmt(teamStats[volatile.team].worst)} pts. A ${fmt(volatile.range)}-point swing. You never knew which version was turning up.`)
  }

  if (lowestScore?.team) lines.push(`💀 Worst Week: ${lowestScore.team} — ${fmt(lowestScore.fpts)} pts (${lowestScore.gw})`)
  if (highestScore?.team) lines.push(`🚀 Best Week: ${highestScore.team} — ${fmt(highestScore.fpts)} pts (${highestScore.gw})`)

  if (rosterChanges.length) {
    const sorted = [...rosterChanges].sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))
    if (sorted[0].added.length + sorted[0].removed.length > 8) {
      lines.push(`🛒 Busiest in the Market: ${sorted[0].teamName}\nMost transfer moves of any team. Whether that activity was necessary is a separate question.`)
    }
    const still = sorted[sorted.length - 1]
    lines.push(`🤝 Loyalty Award: ${still.teamName}\n${still.added.length + still.removed.length === 0 ? 'Zero transfers. Not one change all season.' : 'Barely touched the squad.'} Commitment to the cause.`)
  }

  lines.push(isComplete ? '\nSee you next season.' : `\n${totalPeriods - currentPeriod} gameweek${totalPeriods - currentPeriod !== 1 ? 's' : ''} remaining. The table doesn't lie, but it can still change.`)
  return lines.join('\n\n')
}

// ─── New section generators ───────────────────────────────────────────────────

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

  return lines.join('\n')
}

function generateTransferAnalysisSection(rosterChanges, bestIncomings) {
  const lines = []
  const sorted = [...rosterChanges].sort((a, b) => (b.added.length + b.removed.length) - (a.added.length + a.removed.length))

  if (sorted.length) {
    const most = sorted[0]
    const least = sorted[sorted.length - 1]
    const mostTotal = most.added.length + most.removed.length
    const leastTotal = least.added.length + least.removed.length

    lines.push(`MOST ACTIVE: ${most.teamName} — ${mostTotal} move${mostTotal !== 1 ? 's' : ''}`)
    if (most.added.length) lines.push(`  Signed: ${most.added.slice(0, 5).join(', ')}`)
    if (most.removed.length) lines.push(`  Moved on: ${most.removed.slice(0, 5).join(', ')}`)

    lines.push('')
    lines.push(`LEAST ACTIVE: ${least.teamName} — ${leastTotal === 0 ? 'zero changes all season' : `${leastTotal} move${leastTotal !== 1 ? 's' : ''}`}`)
  }

  if (bestIncomings.length) {
    lines.push('')
    lines.push('BEST PLAYERS TRANSFERRED IN — now starting regulars')
    bestIncomings.forEach((p, i) => {
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
      if (winnerRank > loserRank && (!best || margin > best.margin)) {
        best = { winner, loser, winFpts, loseFpts, margin, gw: gw.caption, winnerRank, loserRank }
      }
    }
  }
  return best
}

function generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods) {
  const isComplete = currentPeriod >= totalPeriods
  const lines = []
  const { biggestMargin } = analyzeWeekly(weeklyMatchups)

  if (biggestMargin?.winner) {
    lines.push('BIGGEST WIN')
    lines.push(`${biggestMargin.winner} ${fmt(biggestMargin.winFpts)} — ${fmt(biggestMargin.loseFpts)} ${biggestMargin.loser}`)
    lines.push(`${biggestMargin.gw} · winning margin: ${fmt(biggestMargin.margin)} pts`)
  }

  const upset = analyzeBiggestUpset(weeklyMatchups, standings)
  if (upset) {
    if (lines.length) lines.push('')
    lines.push('BIGGEST UPSET')
    lines.push(`${upset.winner} (${ordinal(upset.winnerRank)} place) beat ${upset.loser} (${ordinal(upset.loserRank)} place)`)
    lines.push(`${fmt(upset.winFpts)} — ${fmt(upset.loseFpts)} · ${upset.gw}`)
  }

  if (!lines.length) return ''

  lines.push('')
  lines.push(isComplete ? 'Season complete.' : `${totalPeriods - currentPeriod} gameweek${totalPeriods - currentPeriod !== 1 ? 's' : ''} remaining.`)
  return lines.join('\n')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Strip the first two lines of a section (emoji title + dash separator)
// so the tile header can display the title separately from the content.
function stripHeader(text) {
  if (!text) return ''
  const lines = text.split('\n')
  let i = 0
  if (i < lines.length) i++ // emoji + title line
  if (i < lines.length && /^[─═]+$/.test(lines[i].trim())) i++ // separator
  while (i < lines.length && !lines[i].trim()) i++ // leading blank lines
  return lines.slice(i).join('\n').trim()
}

// ─── Structured export (used by tile UI) ─────────────────────────────────────

export function generateRoastSections(leagueData) {
  const {
    standings, draftPicks = [], weeklyMatchups = [],
    rosterChanges = [], currentPeriod = 34, totalPeriods = 38,
    draftAnalysis = {}, transferAnalysis = {}
  } = leagueData

  if (!standings?.length) throw new Error('No standings data available.')

  const { winner, last } = analyzeStandings(standings)
  const weekly = analyzeWeekly(weeklyMatchups)
  const isComplete = currentPeriod >= totalPeriods
  const out = []

  // 1. Current Leaders
  const champText = generateChampions(winner, standings, currentPeriod, totalPeriods)
  if (champText) out.push({
    id: 'leaders', icon: '🏆', accent: 'gold',
    title: isComplete ? 'Champions' : 'Current Leaders',
    subtitle: winner.teamName,
    content: stripHeader(champText)
  })

  // 2. Bottom of the Table
  const spoonText = generateWoodenSpoon(last, standings, weekly.teamStats || {}, currentPeriod, totalPeriods)
  if (spoonText) out.push({
    id: 'spoon', icon: '🥄', accent: 'red',
    title: 'Bottom of the Table',
    subtitle: last.teamName,
    content: stripHeader(spoonText)
  })

  // 3. Draft Day
  const { topPicks = [], worstPicks = [] } = draftAnalysis
  if (topPicks.length || worstPicks.length) out.push({
    id: 'draft', icon: '📋', accent: 'teal',
    title: 'Draft Day',
    content: generateDraftAnalysisSection(topPicks, worstPicks)
  })

  // 4. Transfer Activity
  const { bestIncomings = [] } = transferAnalysis
  if (rosterChanges.length) out.push({
    id: 'transfers', icon: '🔄', accent: 'teal',
    title: 'Transfer Activity',
    content: generateTransferAnalysisSection(rosterChanges, bestIncomings)
  })

  // 5. Awards
  const awardsContent = generateAwardsSection(weeklyMatchups, standings, currentPeriod, totalPeriods)
  if (awardsContent) out.push({
    id: 'awards', icon: '🏅', accent: 'gold', fullWidth: true,
    title: isComplete ? 'End of Season Awards' : 'Awards So Far',
    content: awardsContent
  })

  return out
}

// ─── String export (kept for compatibility) ───────────────────────────────────

export function generateRoast(leagueData) {
  const {
    leagueName, standings, draftPicks = [], weeklyMatchups = [],
    rosterChanges = [], teamPlayerHighlights = {},
    currentPeriod = 34, totalPeriods = 38
  } = leagueData

  if (!standings?.length) throw new Error('No standings data available.')

  const { winner, last } = analyzeStandings(standings)
  const weekly = analyzeWeekly(weeklyMatchups)
  const round1 = draftPicks.filter(p => p.round === 1).sort((a, b) => a.pickNumber - b.pickNumber)
  const pick1 = round1[0]
  const pick1Team = pick1 ? standings.find(t => t.teamName === pick1.teamName) : null

  const sections = [
    generateIntro(leagueName, standings, weeklyMatchups, currentPeriod, totalPeriods),
    generateChampions(winner, standings, currentPeriod, totalPeriods),
    generateWoodenSpoon(last, standings, weekly.teamStats || {}, currentPeriod, totalPeriods),
    weekly.lowestScore?.team ? generateWeeklyDrama(weekly.lowestScore, weekly.highestScore, weekly.biggestMargin, weekly.closestGame, weekly.teamStats, weeklyMatchups) : '',
    generatePlayerHighlights(standings, teamPlayerHighlights),
    draftPicks.length ? generateDraftSection(pick1, pick1Team, round1, standings) : '',
    generateShouldHaveSold(standings, teamPlayerHighlights),
    rosterChanges.length ? generateTransfers(rosterChanges) : '',
    generateAwards(standings, weekly.teamStats || {}, weekly.lowestScore || {}, weekly.highestScore || {}, rosterChanges, currentPeriod, totalPeriods),
  ]

  return sections.filter(Boolean).join('\n\n')
}
