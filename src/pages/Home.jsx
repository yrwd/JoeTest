import { useState } from 'react'
import { fetchLeagueData } from '../services/fantrax'
import { generateRoast } from '../services/roastGenerator'

export default function Home() {
  const [leagueUrl, setLeagueUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState('')
  const [roastText, setRoastText] = useState('')
  const [error, setError] = useState('')

  async function handleRoast() {
    if (!leagueUrl.trim() || status === 'loading') return

    setStatus('loading')
    setRoastText('')
    setError('')
    setProgress('Starting...')

    try {
      const leagueData = await fetchLeagueData(leagueUrl.trim(), setProgress)

      setProgress('Generating roast...')
      const roast = generateRoast(leagueData)
      setRoastText(roast)
      setStatus('done')
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  const busy = status === 'loading'

  return (
    <main className="container">
      <header className="hero">
        <div className="hero-badge">⚽ Free · No AI fees</div>
        <h1>Fantasy League Roaster</h1>
        <p>Paste your public Fantrax league URL for an end-of-season breakdown that tells the truth your mates won't.</p>
      </header>

      <div className="input-card">
        <label htmlFor="league-url">Fantrax League URL</label>
        <div className="input-row">
          <input
            id="league-url"
            type="text"
            value={leagueUrl}
            onChange={e => setLeagueUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRoast()}
            placeholder="https://www.fantrax.com/fantasy/league/YOUR_LEAGUE_ID/standings"
            disabled={busy}
          />
          <button onClick={handleRoast} disabled={busy || !leagueUrl.trim()} className="roast-btn">
            {busy ? '⏳ Loading...' : '🔥 Roast My League'}
          </button>
        </div>
        <p className="hint">Your league must be set to <strong>public</strong> in Fantrax settings.</p>
      </div>

      {busy && progress && (
        <div className="progress-card">
          <div className="spinner" />
          <span>{progress}</span>
        </div>
      )}

      {error && (
        <div className="error-card">
          <strong>Error:</strong> {error}
        </div>
      )}

      {roastText && (
        <div className="roast-card">
          <div className="roast-header">
            <span>🏆 End of Season Report</span>
            <button className="copy-btn" onClick={() => navigator.clipboard.writeText(roastText)}>
              Copy
            </button>
          </div>
          <div className="roast-body">{roastText}</div>
        </div>
      )}
    </main>
  )
}
