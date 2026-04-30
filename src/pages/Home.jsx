import { useState, useEffect } from 'react'
import LZString from 'lz-string'
import { fetchLeagueData } from '../services/fantrax'
import { generateRoastSections } from '../services/roastGenerator'

// Maximum allowed size (in characters) of a decompressed share link payload.
// Prevents decompression bomb attacks where a tiny URL expands to gigabytes of data.
const MAX_SHARE_PAYLOAD = 200_000

export default function Home() {
  const [leagueUrl, setLeagueUrl] = useState('')
  const [status,    setStatus]    = useState('idle')  // idle | loading | done | error
  const [progress,  setProgress]  = useState('')
  const [sections,  setSections]  = useState([])
  const [error,     setError]     = useState('')
  const [copied,    setCopied]    = useState(false)

  // On first load, check if the URL hash contains a shared report (#r=...).
  // If so, decode and display it without needing to re-fetch from Fantrax.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1)).get('r')
    if (!hash) return
    try {
      const raw = LZString.decompressFromEncodedURIComponent(hash)
      // Guard against decompression bombs — reject anything suspiciously large
      if (!raw || raw.length > MAX_SHARE_PAYLOAD) return
      const decoded = JSON.parse(raw)
      if (Array.isArray(decoded) && decoded.length) {
        setSections(decoded)
        setStatus('done')
      }
    } catch {
      // Silently ignore malformed share links — the user just sees the input form
    }
  }, [])

  async function handleRoast() {
    if (!leagueUrl.trim() || status === 'loading') return
    setStatus('loading')
    setSections([])
    setError('')
    setProgress('Starting...')
    try {
      const leagueData = await fetchLeagueData(leagueUrl.trim(), setProgress)
      setProgress('Building report...')
      const result = generateRoastSections(leagueData)
      setSections(result)
      setStatus('done')
      // Encode the result into the URL hash so users can share a direct link.
      // The hash is never sent to servers, so the data stays client-side.
      const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(result))
      window.history.replaceState(null, '', `#r=${compressed}`)
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        <div className="results">
          <div className="share-bar">
            <button onClick={handleCopyLink} className="share-btn">
              {copied ? '✅ Link copied!' : '📋 Copy share link'}
            </button>
          </div>
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
        </div>
      )}
      <footer className="footer">
        <p>
          Free to use, no login required.{' '}
          If it&apos;s useful, <a href="https://buymeacoffee.com/jvothe" target="_blank" rel="noopener noreferrer">buy me a coffee</a> — helps cover the server costs that keep it running. ☕
        </p>
      </footer>
    </main>
  )
}
