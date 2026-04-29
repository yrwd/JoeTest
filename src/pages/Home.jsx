import { useState } from 'react'
import { fetchLeagueData } from '../services/fantrax'
import { generateRoastSections } from '../services/roastGenerator'

export default function Home() {
  const [leagueUrl, setLeagueUrl] = useState('')
  const [status, setStatus] = useState('idle')
  const [progress, setProgress] = useState('')
  const [sections, setSections] = useState([])
  const [error, setError] = useState('')

  async function handleRoast() {
    if (!leagueUrl.trim() || status === 'loading') return
    setStatus('loading')
    setSections([])
    setError('')
    setProgress('Starting...')
    try {
      const leagueData = await fetchLeagueData(leagueUrl.trim(), setProgress)
      setProgress('Building report...')
      setSections(generateRoastSections(leagueData))
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
        <div className="hero-badge">⚽ Free and no login required</div>
        <h1>Fantasy Season Review</h1>
        <p>Paste your public Fantrax league URL for a stats-based breakdown of the season so far.</p>
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
            {busy ? '⏳ Loading...' : '🔍 Analyse My League'}
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

      {sections.length > 0 && (
        <>
          <div className="tiles-grid">
            {sections.map(section => (
              <div
                key={section.id}
                className={`tile tile--${section.accent || 'default'}${section.fullWidth ? ' tile--full' : ''}`}
              >
                <div className="tile-header">
                  {section.icon && <span className="tile-icon">{section.icon}</span>}
                  <div className="tile-titles">
                    <span className="tile-title">{section.title}</span>
                    {section.subtitle && <span className="tile-subtitle">{section.subtitle}</span>}
                  </div>
                </div>
                <div className="tile-body">{section.content}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
