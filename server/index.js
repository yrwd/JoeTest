/**
 * Express server — Claude AI roast endpoint
 *
 * Provides POST /api/roast which streams a Claude-generated fantasy football
 * roast back to the client as Server-Sent Events (SSE).
 *
 * This server is separate from the Netlify deployment and must be hosted
 * independently (e.g. Railway, Render). Required env vars:
 *   ANTHROPIC_API_KEY  — Claude API key
 *   ALLOWED_ORIGIN     — frontend URL for CORS (e.g. https://your-site.netlify.app)
 *   API_SECRET         — shared secret the frontend must send as x-api-secret header
 *   PORT               — (optional) defaults to 3001
 */

import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import Anthropic from '@anthropic-ai/sdk'
import 'dotenv/config'

const app = express()
const PORT = process.env.PORT || 3001

// Only allow requests from our own frontend
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || 'http://localhost:5173' }))
app.use(express.json({ limit: '10mb' }))

// Rate limit the roast endpoint: max 5 requests per IP per 15 minutes.
// Prevents API credit abuse if the endpoint is discovered by third parties.
const roastLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
})

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

/**
 * Clamps a value to a string of at most `max` characters.
 * Applied to all user-supplied strings before they enter the LLM prompt
 * to prevent prompt injection via long or crafted team/player names.
 */
const clip = (s, max = 100) => String(s || '').trim().slice(0, max)

/**
 * Middleware: verify the x-api-secret header matches our shared secret.
 * If API_SECRET is not set (e.g. local dev), the check is skipped.
 * This stops third parties from using the Claude endpoint directly even
 * if they discover the URL, since the secret is required from the frontend.
 */
function requireSecret(req, res, next) {
  const secret = process.env.API_SECRET
  if (secret && req.headers['x-api-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

/**
 * Builds the plain-text prompt that gets sent to Claude.
 * All string values are clipped to prevent prompt injection.
 */
function buildRoastPrompt(data) {
  const { leagueName, standings, draftPicks, weeklyMatchups, rosterChanges } = data
  let prompt = `League: ${clip(leagueName, 80)}\n\n`

  prompt += `=== FINAL STANDINGS ===\n`
  for (const t of standings) {
    prompt += `${t.rank}. ${clip(t.teamName)} | ${t.wins}W-${t.draws}D-${t.losses}L | ${t.totalPointsFor} FPts\n`
  }

  if (draftPicks?.length > 0) {
    prompt += `\n=== DRAFT ORDER (Rounds 1-4) ===\n`
    for (const pick of draftPicks) {
      prompt += `R${pick.round} P${pick.pickNumber}: ${clip(pick.teamName)} → ${clip(pick.playerName)} (${clip(pick.position, 20)}${pick.club ? ', ' + clip(pick.club, 50) : ''})\n`
    }
  }

  if (weeklyMatchups?.length > 0) {
    prompt += `\n=== WEEKLY MATCHUP RESULTS ===\n`
    for (const gw of weeklyMatchups) {
      prompt += `\n${clip(gw.caption, 30)}:\n`
      for (const m of gw.matchups) {
        prompt += `  ${clip(m.awayTeam)} ${m.awayFpts} - ${m.homeFpts} ${clip(m.homeTeam)}\n`
      }
    }
  }

  if (rosterChanges?.length > 0) {
    prompt += `\n=== TRANSFER ACTIVITY (Start vs End of Season) ===\n`
    for (const rc of rosterChanges) {
      if (rc.added.length || rc.removed.length) {
        prompt += `\n${clip(rc.teamName)}:\n`
        if (rc.added.length) prompt += `  Signed: ${rc.added.map(n => clip(n)).join(', ')}\n`
        if (rc.removed.length) prompt += `  Sold/Dropped: ${rc.removed.map(n => clip(n)).join(', ')}\n`
      }
    }
  }

  return prompt
}

// Apply secret check first, then rate limiting, then handle the request
app.post('/api/roast', requireSecret, roastLimiter, async (req, res) => {
  try {
    const { leagueData } = req.body

    if (!leagueData?.standings?.length) {
      return res.status(400).json({ error: 'No league data found. Make sure your league is set to public in Fantrax settings.' })
    }

    // Stream the response back using Server-Sent Events so the UI can render
    // the roast text incrementally as Claude produces it
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const prompt = buildRoastPrompt(leagueData)

    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: 'You are a sharp, witty fantasy football commentator writing an end-of-season awards and roast piece for a private league. Write in the style of a sports journalist who has seen it all. Make specific, stats-based observations that are genuinely funny. Use actual numbers from the data. Include sections with headers. Be playful but not cruel — the goal is to make everyone laugh, including the last-place manager.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: prompt }],
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`)
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    // Log the real error server-side but don't expose internals to the client
    console.error('Roast error:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' })
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Internal server error' })}\n\n`)
      res.end()
    }
  }
})

app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`))
