"use client"

import { useState, useRef, useEffect } from "react"
import dynamic from "next/dynamic"

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false })

interface Tool {
  name: string
  description: string
  parameters: object
}

interface ServerResult {
  serverName: string
  description: string
  tools: Tool[]
  files: {
    "index.ts": string
    "package.json": string
    ".env.example": string
    "README.md": string
  }
  apiType: "KNOWN_API" | "UNKNOWN_API" | "NO_API"
  needsApiKey: boolean
  apiKeyInstructions: string | null
}

type Status = "idle" | "loading" | "question" | "done" | "error"
type TabKey = "Overview" | "index.ts" | "package.json" | ".env.example" | "README.md"

const TABS: TabKey[] = ["Overview", "index.ts", "package.json", ".env.example", "README.md"]

const EXAMPLES = [
  "Search GitHub repos by keyword",
  "Get weather for any city",
  "Search YouTube videos",
  "Fetch Reddit top posts",
  "Look up word definitions",
]

export default function MCPForgePage() {
  const [input, setInput] = useState("")
  const [answer, setAnswer] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [questionText, setQuestionText] = useState("")
  const [result, setResult] = useState<ServerResult | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>("Overview")
  const [history, setHistory] = useState<{ role: string; content: string }[]>([])
  const [errorMsg, setErrorMsg] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [dots, setDots] = useState("")
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const isLoading = status === "loading"

  useEffect(() => {
    if (!isLoading) return
    const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400)
    return () => clearInterval(t)
  }, [isLoading])

  async function callGenerate(message: string, hist: { role: string; content: string }[]) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: hist }),
    })
    if (!res.ok) throw new Error("API request failed")
    return res.json()
  }

  async function handleGenerate() {
    if (!input.trim()) return
    setStatus("loading")
    setResult(null)
    setErrorMsg("")
    setDots("")
    try {
      const data = await callGenerate(input, [])
      if (data.type === "question") {
        setQuestionText(data.message)
        setHistory([{ role: "user", content: input }, { role: "assistant", content: data.message }])
        setStatus("question")
        setTimeout(() => answerRef.current?.focus(), 100)
      } else if (data.type === "server") {
        setResult(data.data)
        setActiveTab("Overview")
        setStatus("done")
      } else {
        throw new Error(data.message || "Unknown error")
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error")
      setStatus("error")
    }
  }

  async function handleAnswer() {
    if (!answer.trim()) return
    setStatus("loading")
    setDots("")
    const updatedHistory = [...history, { role: "user", content: answer }]
    try {
      const data = await callGenerate(answer, history)
      if (data.type === "server") {
        setResult(data.data)
        setActiveTab("Overview")
        setStatus("done")
        setHistory([])
        setAnswer("")
      } else if (data.type === "question") {
        setQuestionText(data.message)
        setHistory([...updatedHistory, { role: "assistant", content: data.message }])
        setStatus("question")
        setAnswer("")
      } else {
        throw new Error(data.message || "Unknown error")
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error")
      setStatus("error")
    }
  }

  async function handleDownloadZip() {
    if (!result) return
    const JSZip = (await import("jszip")).default
    const zip = new JSZip()
    const folder = zip.folder(result.serverName)!
    Object.entries(result.files).forEach(([filename, content]) => folder.file(filename, content))
    const blob = await zip.generateAsync({ type: "blob" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${result.serverName}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCopy(text: string, key: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  function handleReset() {
    setStatus("idle")
    setInput("")
    setAnswer("")
    setResult(null)
    setHistory([])
    setQuestionText("")
    setErrorMsg("")
  }

  function getLanguage(tab: TabKey) {
    if (tab === "index.ts") return "typescript"
    if (tab === "package.json") return "json"
    return tab === "README.md" ? "markdown" : "text"
  }

  const apiColor = result?.apiType === "KNOWN_API" ? "#10b981" : result?.apiType === "UNKNOWN_API" ? "#f59e0b" : "#8b5cf6"
  const apiBg = result?.apiType === "KNOWN_API" ? "#052e16" : result?.apiType === "UNKNOWN_API" ? "#1c1003" : "#1e0a3c"

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Syne:wght@400;600;700;800&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg: #070710;
          --surface: #0d0d1a;
          --surface2: #111122;
          --border: rgba(139,92,246,0.15);
          --border-bright: rgba(139,92,246,0.4);
          --purple: #8b5cf6;
          --purple-bright: #a78bfa;
          --blue: #3b82f6;
          --teal: #10b981;
          --amber: #f59e0b;
          --text: #e2e0f0;
          --muted: #6b6880;
          --muted2: #9290a8;
          --font-display: 'Syne', sans-serif;
          --font-mono: 'JetBrains Mono', monospace;
        }

        body { background: var(--bg); }

        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 20px rgba(139,92,246,0.2); }
          50% { box-shadow: 0 0 40px rgba(139,92,246,0.5); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .fade-up { animation: fadeUp 0.4s ease forwards; }

        .btn-primary {
          background: linear-gradient(135deg, #7c3aed, #3b82f6);
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 13px 28px;
          font-size: 14px;
          font-weight: 700;
          font-family: var(--font-display);
          letter-spacing: 0.3px;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 8px;
          transition: opacity 0.2s, transform 0.15s;
          position: relative;
          overflow: hidden;
        }
        .btn-primary::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
          opacity: 0;
          transition: opacity 0.2s;
        }
        .btn-primary:hover:not(:disabled)::after { opacity: 1; }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }

        .btn-ghost {
          background: transparent;
          color: var(--muted2);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 18px;
          font-size: 13px;
          font-family: var(--font-display);
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
        }
        .btn-ghost:hover { border-color: var(--border-bright); color: var(--text); }

        .chip {
          background: rgba(139,92,246,0.08);
          border: 1px solid rgba(139,92,246,0.2);
          border-radius: 20px;
          color: var(--muted2);
          font-size: 12px;
          padding: 5px 14px;
          cursor: pointer;
          font-family: var(--font-mono);
          transition: all 0.15s;
          white-space: nowrap;
        }
        .chip:hover { background: rgba(139,92,246,0.18); border-color: rgba(139,92,246,0.4); color: var(--purple-bright); }
        .chip:disabled { opacity: 0.4; cursor: not-allowed; }

        .tab-btn {
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--muted);
          font-size: 12px;
          padding: 10px 16px;
          cursor: pointer;
          font-family: var(--font-mono);
          white-space: nowrap;
          margin-bottom: -1px;
          transition: color 0.15s, border-color 0.15s;
        }
        .tab-btn:hover { color: var(--muted2); }
        .tab-btn.active { color: var(--purple-bright); border-bottom-color: var(--purple-bright); }

        textarea {
          background: rgba(0,0,0,0.4);
          border: 1px solid var(--border);
          border-radius: 12px;
          color: var(--text);
          font-size: 14px;
          padding: 16px 18px;
          resize: none;
          font-family: var(--font-mono);
          line-height: 1.7;
          width: 100%;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        textarea:focus { outline: none; border-color: var(--border-bright); box-shadow: 0 0 0 3px rgba(139,92,246,0.1); }

        .loading-bar {
          height: 2px;
          background: linear-gradient(90deg, transparent, var(--purple), var(--blue), var(--purple), transparent);
          background-size: 200% 100%;
          animation: shimmer 1.5s linear infinite;
          border-radius: 2px;
        }
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-display)", display: "flex", flexDirection: "column" }}>

        {/* ── HEADER ── */}
        <header style={{ padding: "32px 48px 28px", borderBottom: "1px solid var(--border)", background: "var(--surface)", position: "relative", overflow: "hidden" }}>
          {/* Subtle grid background */}
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(139,92,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.04) 1px, transparent 1px)", backgroundSize: "40px 40px", pointerEvents: "none" }} />

          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "10px" }}>
                {/* Logo mark */}
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "linear-gradient(135deg, #7c3aed, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", flexShrink: 0 }}>
                  ⚙
                </div>
                <h1 style={{ fontSize: "30px", fontWeight: "800", fontFamily: "var(--font-display)", letterSpacing: "-0.5px", background: "linear-gradient(135deg, #c4b5fd, #93c5fd)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                  MCPForge
                </h1>
                <span style={{ fontSize: "10px", fontWeight: "700", padding: "3px 8px", borderRadius: "4px", background: "rgba(139,92,246,0.15)", color: "var(--purple-bright)", border: "1px solid rgba(139,92,246,0.3)", fontFamily: "var(--font-mono)", letterSpacing: "1px" }}>
                  BETA
                </span>
              </div>
              <p style={{ color: "var(--muted2)", fontSize: "14px", fontFamily: "var(--font-mono)" }}>
                <span style={{ color: "var(--purple-bright)" }}>$</span> describe_tool
                <span style={{ color: "var(--muted)", margin: "0 6px" }}>→</span>
                generate_mcp_server
                <span style={{ color: "var(--teal)", marginLeft: "8px" }}>// in seconds</span>
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {["GitHub", "Weather", "YouTube"].map(s => (
                <span key={s} style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{s}</span>
              ))}
              <span style={{ fontSize: "11px", padding: "4px 10px", borderRadius: "6px", background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>+50 APIs</span>
            </div>
          </div>
        </header>

        <main style={{ flex: 1, padding: "40px 48px", maxWidth: "960px", width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>

          {/* ── INPUT CARD ── */}
          <div className="fade-up" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", overflow: "hidden" }}>
            {/* Top accent */}
            <div style={{ height: "3px", background: "linear-gradient(90deg, #7c3aed, #3b82f6, #10b981)" }} />

            <div style={{ padding: "28px" }}>
              <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--muted2)", fontFamily: "var(--font-mono)", marginBottom: "12px", letterSpacing: "0.5px" }}>
                WHAT SHOULD CLAUDE BE ABLE TO DO?
              </label>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && e.metaKey) handleGenerate() }}
                placeholder='e.g. "Search GitHub repositories by keyword and return name, stars, and URL"'
                disabled={isLoading}
                rows={3}
              />

              {/* Chips */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "14px" }}>
                <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--font-mono)", marginRight: "4px" }}>try →</span>
                {EXAMPLES.map(ex => (
                  <button key={ex} className="chip" onClick={() => setInput(ex)} disabled={isLoading}>{ex}</button>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "12px", marginTop: "20px" }}>
                {(status === "done" || status === "error") && (
                  <button className="btn-ghost" onClick={handleReset}>← start over</button>
                )}
                <button
                  className="btn-primary"
                  onClick={handleGenerate}
                  disabled={isLoading || !input.trim()}
                >
                  {isLoading && !questionText ? (
                    <>
                      <span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                      Forging{dots}
                    </>
                  ) : (
                    <>Generate MCP Server <span style={{ opacity: 0.7 }}>→</span></>
                  )}
                </button>
              </div>
            </div>

            {/* Loading bar */}
            {isLoading && <div className="loading-bar" />}
          </div>

          {/* ── FOLLOW-UP QUESTION ── */}
          {status === "question" && (
            <div className="fade-up" style={{ background: "#0d0a00", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ height: "3px", background: "linear-gradient(90deg, #f59e0b, #fbbf24)" }} />
              <div style={{ padding: "28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                  <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>?</div>
                  <span style={{ fontSize: "14px", fontWeight: "700", color: "#fbbf24", fontFamily: "var(--font-display)" }}>Need a few details about your API</span>
                </div>
                <pre style={{ fontSize: "13px", color: "#d4a800", lineHeight: "1.8", whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)", background: "rgba(245,158,11,0.06)", padding: "16px", borderRadius: "8px", border: "1px solid rgba(245,158,11,0.12)", marginBottom: "16px" }}>{questionText}</pre>
                <textarea
                  ref={answerRef}
                  value={answer}
                  onChange={e => setAnswer(e.target.value)}
                  placeholder="Paste your base URL, a sample request + response, and your auth method..."
                  rows={5}
                />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
                  <button className="btn-primary" onClick={handleAnswer} disabled={!answer.trim() || isLoading}>
                    {isLoading ? <><span style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} /> Forging{dots}</> : <>Generate with these details →</>}
                  </button>
                </div>
              </div>
              {isLoading && <div className="loading-bar" />}
            </div>
          )}

          {/* ── ERROR ── */}
          {status === "error" && (
            <div className="fade-up" style={{ background: "#120406", border: "1px solid rgba(239,68,68,0.25)", borderRadius: "12px", padding: "16px 20px", fontSize: "13px", color: "#f87171", fontFamily: "var(--font-mono)" }}>
              <span style={{ color: "#ef4444", fontWeight: "700" }}>ERROR</span>  {errorMsg}
            </div>
          )}

          {/* ── RESULT ── */}
          {status === "done" && result && (
            <div className="fade-up" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ height: "3px", background: `linear-gradient(90deg, ${apiColor}, ${apiColor}88)` }} />

              {/* Result header */}
              <div style={{ padding: "24px 28px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "22px", fontWeight: "800", fontFamily: "var(--font-mono)", color: "var(--text)", letterSpacing: "-0.5px" }}>
                      {result.serverName}
                    </span>
                    <span style={{ fontSize: "10px", fontWeight: "700", padding: "3px 10px", borderRadius: "4px", background: apiBg, color: apiColor, border: `1px solid ${apiColor}44`, fontFamily: "var(--font-mono)", letterSpacing: "1px" }}>
                      {result.apiType.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p style={{ fontSize: "13px", color: "var(--muted2)", fontFamily: "var(--font-mono)" }}>{result.description}</p>

                  {/* Tool chips */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>tools:</span>
                    {result.tools.map(tool => (
                      <span key={tool.name} style={{ fontSize: "11px", padding: "4px 12px", borderRadius: "4px", background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", color: "var(--purple-bright)", fontFamily: "var(--font-mono)", fontWeight: "500" }}>
                        {tool.name}()
                      </span>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleDownloadZip}
                  style={{ background: "linear-gradient(135deg, #065f46, #047857)", color: "#34d399", border: "1px solid #10b98144", borderRadius: "10px", padding: "11px 22px", fontSize: "13px", fontWeight: "700", cursor: "pointer", whiteSpace: "nowrap", fontFamily: "var(--font-display)", flexShrink: 0, display: "flex", alignItems: "center", gap: "8px" }}
                >
                  ↓ Download ZIP
                </button>
              </div>

              {/* API key notice */}
              {result.needsApiKey && result.apiKeyInstructions && (
                <div style={{ margin: "0 28px 0", borderBottom: "1px solid var(--border)", padding: "12px 16px", background: "rgba(245,158,11,0.06)", fontSize: "12px", color: "#d97706", fontFamily: "var(--font-mono)", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                  <span>⚠</span>
                  <span><strong>API key needed:</strong> {result.apiKeyInstructions}</span>
                </div>
              )}

              {/* Tabs */}
              <div style={{ display: "flex", gap: "0", borderBottom: "1px solid var(--border)", paddingLeft: "12px", overflowX: "auto" }}>
                {TABS.map(tab => (
                  <button key={tab} className={`tab-btn${activeTab === tab ? " active" : ""}`} onClick={() => setActiveTab(tab)}>
                    {tab}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              {activeTab === "Overview" ? (
                <div style={{ padding: "24px 28px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
                  {result.tools.map(tool => (
                    <div key={tool.name} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "12px", padding: "18px", display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--purple-bright)", fontFamily: "var(--font-mono)" }}>{tool.name}()</div>
                      <div style={{ fontSize: "12px", color: "var(--muted2)", lineHeight: "1.6" }}>{tool.description}</div>
                      <div style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--font-mono)", marginTop: "4px" }}>
                        params: {Object.keys((tool.parameters as Record<string, unknown> & { properties?: Record<string, unknown> })?.properties || {}).join(", ") || "none"}
                      </div>
                    </div>
                  ))}

                  <div style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "12px", padding: "18px" }}>
                    <div style={{ fontSize: "12px", fontWeight: "700", color: "#34d399", fontFamily: "var(--font-mono)", marginBottom: "12px" }}>// quick_setup</div>
                    {["unzip the ZIP file", "npm install", result.needsApiKey ? "fill in .env with API key" : null, "node index.js", "add to claude_desktop_config.json"].filter(Boolean).map((step, i) => (
                      <div key={i} style={{ display: "flex", gap: "10px", marginBottom: "8px", alignItems: "flex-start" }}>
                        <span style={{ fontSize: "11px", color: "#10b981", fontFamily: "var(--font-mono)", flexShrink: 0, marginTop: "1px" }}>{String(i + 1).padStart(2, "0")}.</span>
                        <span style={{ fontSize: "12px", color: "var(--muted2)", fontFamily: "var(--font-mono)" }}>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => handleCopy(result.files[activeTab as Exclude<TabKey, "Overview">] || "", activeTab)}
                    style={{ position: "absolute", top: "12px", right: "12px", zIndex: 10, background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.3)", borderRadius: "6px", color: "var(--purple-bright)", fontSize: "11px", padding: "5px 12px", cursor: "pointer", fontFamily: "var(--font-mono)", fontWeight: "500" }}
                  >
                    {copied === activeTab ? "✓ copied" : "copy"}
                  </button>
                  <Editor
                    height="440px"
                    language={getLanguage(activeTab)}
                    value={result.files[activeTab as Exclude<TabKey, "Overview">] || ""}
                    theme="vs-dark"
                    options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", padding: { top: 20 }, fontFamily: "JetBrains Mono, monospace" }}
                  />
                </div>
              )}
            </div>
          )}
        </main>

        {/* ── FOOTER ── */}
        <footer style={{ padding: "16px 48px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            <span style={{ color: "var(--purple-bright)" }}>MCPForge</span> · HackASU 2026 · Claude Builder Club
          </span>
          <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
            powered by <span style={{ color: "var(--blue)" }}>Anthropic Claude</span>
          </span>
        </footer>
      </div>
    </>
  )
}