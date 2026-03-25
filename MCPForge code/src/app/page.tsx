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

interface HistoryItem {
  id: string
  serverName: string
  description: string
  apiType: "KNOWN_API" | "UNKNOWN_API" | "NO_API"
  result: ServerResult
  prompt: string
  createdAt: number
  version: number
}

interface VersionGroup {
  serverName: string
  prompt: string
  versions: HistoryItem[]
  latestCreatedAt: number
}

type Status = "idle" | "loading" | "question" | "done" | "error"
type TabKey = "Overview" | "Test" | "index.ts" | "package.json" | ".env.example" | "README.md"
type ToolCount = 1 | 2 | 3

const TABS: TabKey[] = ["Overview", "Test", "index.ts", "package.json", ".env.example", "README.md"]
const HISTORY_KEY = "mcpforge_history"
const MAX_HISTORY = 40

const EXAMPLES = [
  "Search GitHub repos by keyword",
  "Get weather for any city",
  "Search YouTube videos",
  "Fetch Reddit top posts",
  "Look up word definitions",
]

function loadHistory(): HistoryItem[] {
  if (typeof window === "undefined") return []
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") } catch { return [] }
}
function saveHistory(items: HistoryItem[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))) } catch {}
}
function groupByServer(items: HistoryItem[]): VersionGroup[] {
  const map = new Map<string, HistoryItem[]>()
  items.forEach(item => {
    const key = item.serverName
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  })
  return Array.from(map.entries())
    .map(([serverName, versions]) => ({
      serverName,
      prompt: versions[0].prompt,
      versions: versions.sort((a, b) => b.createdAt - a.createdAt),
      latestCreatedAt: Math.max(...versions.map(v => v.createdAt)),
    }))
    .sort((a, b) => b.latestCreatedAt - a.latestCreatedAt)
}
function compressResult(result: ServerResult): string {
  try { return btoa(encodeURIComponent(JSON.stringify(result))) } catch { return "" }
}
function decompressResult(encoded: string): ServerResult | null {
  try { return JSON.parse(decodeURIComponent(atob(encoded))) } catch { return null }
}

// ── OpenAPI parser ──────────────────────────────────────────────────────────
function parseOpenAPISpec(spec: any): string {
  try {
    const title = spec.info?.title || "API"
    const version = spec.info?.version || ""
    const baseUrl = spec.servers?.[0]?.url || spec.host
      ? (spec.schemes?.[0] || "https") + "://" + spec.host + (spec.basePath || "")
      : ""
    const paths = spec.paths || {}
    const securityDefs = spec.securityDefinitions || spec.components?.securitySchemes || {}
    const authKeys = Object.keys(securityDefs)
    const authType = authKeys.length > 0
      ? `Auth: ${authKeys[0]} (${securityDefs[authKeys[0]]?.type || "apiKey"})`
      : "No auth detected"

    const endpoints: string[] = []
    Object.entries(paths).slice(0, 6).forEach(([path, methods]: [string, any]) => {
      Object.entries(methods).forEach(([method, op]: [string, any]) => {
        if (["get","post","put","delete","patch"].includes(method)) {
          const params = (op.parameters || [])
            .slice(0, 4)
            .map((p: any) => `${p.name} (${p.in})`)
            .join(", ")
          endpoints.push(`${method.toUpperCase()} ${path}${params ? ` — params: ${params}` : ""}${op.summary ? ` — ${op.summary}` : ""}`)
        }
      })
    })

    return `I have an OpenAPI/Swagger spec for "${title}" ${version ? `v${version}` : ""}.

Base URL: ${baseUrl || "see spec"}
${authType}

Endpoints:
${endpoints.join("\n")}

Please generate an MCP server that gives Claude access to this API. Use the endpoint details above to create the appropriate tools.`
  } catch {
    throw new Error("Failed to parse OpenAPI spec — make sure it's valid JSON or YAML")
  }
}

export default function MCPForgePage() {
  const [input, setInput] = useState("")
  const [answer, setAnswer] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [questionText, setQuestionText] = useState("")
  const [result, setResult] = useState<ServerResult | null>(null)
  const [prevResult, setPrevResult] = useState<ServerResult | null>(null)
  const [currentPrompt, setCurrentPrompt] = useState("")
  const [activeTab, setActiveTab] = useState<TabKey>("Overview")
  const [history, setHistory] = useState<{ role: string; content: string }[]>([])
  const [errorMsg, setErrorMsg] = useState("")
  const [copied, setCopied] = useState<string | null>(null)
  const [dots, setDots] = useState("")
  const [genHistory, setGenHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [viewingVersion, setViewingVersion] = useState<{ serverName: string; version: number } | null>(null)
  const [diffMode, setDiffMode] = useState(false)
  const [diffVersion, setDiffVersion] = useState<HistoryItem | null>(null)
  const [diffTab, setDiffTab] = useState<"index.ts" | "package.json" | ".env.example" | "README.md">("index.ts")
  const [showDesktopConfig, setShowDesktopConfig] = useState(false)
  const [harLoading, setHarLoading] = useState(false)
  const [harError, setHarError] = useState("")
  // OpenAPI state
  const [swaggerUrl, setSwaggerUrl] = useState("")
  const [swaggerLoading, setSwaggerLoading] = useState(false)
  const [swaggerError, setSwaggerError] = useState("")
  const [showSwaggerInput, setShowSwaggerInput] = useState(false)
  const [toolCount, setToolCount] = useState<ToolCount>(2)
  const [shareToast, setShareToast] = useState(false)
  const [gistToken, setGistToken] = useState("")
  const [gistUrl, setGistUrl] = useState("")
  const [gistLoading, setGistLoading] = useState(false)
  const [gistError, setGistError] = useState("")
  const [showGistInput, setShowGistInput] = useState(false)
  const [darkMode, setDarkMode] = useState(true)
  const [validation, setValidation] = useState<{ status: "valid" | "warning" | "checking" | null; message: string }>({ status: null, message: "" })
  const [selectedTool, setSelectedTool] = useState<string>("")
  const [testParams, setTestParams] = useState<Record<string, string>>({})
  const [testRunning, setTestRunning] = useState(false)
  const [testOutput, setTestOutput] = useState<{ success: boolean; output: string } | null>(null)
  const answerRef = useRef<HTMLTextAreaElement>(null)
  const harInputRef = useRef<HTMLInputElement>(null)
  const swaggerFileRef = useRef<HTMLInputElement>(null)
  const isLoading = status === "loading"

  useEffect(() => {
    setGenHistory(loadHistory())
    const params = new URLSearchParams(window.location.search)
    const shared = params.get("s")
    if (shared) {
      const decoded = decompressResult(shared)
      if (decoded) {
        setResult(decoded)
        setStatus("done")
        setCurrentPrompt("Loaded from shared link")
        setInput("Loaded from shared link")
        validateServer(decoded)
      }
    }
  }, [])

  useEffect(() => {
    if (!isLoading) return
    const t = setInterval(() => setDots(d => d.length >= 3 ? "" : d + "."), 400)
    return () => clearInterval(t)
  }, [isLoading])

  function addToHistory(res: ServerResult, prompt: string) {
    const existing = genHistory.filter(i => i.serverName === res.serverName)
    const version = existing.length + 1
    const item: HistoryItem = { id: Date.now().toString(), serverName: res.serverName, description: res.description, apiType: res.apiType, result: res, prompt, createdAt: Date.now(), version }
    const updated = [item, ...genHistory].slice(0, MAX_HISTORY)
    setGenHistory(updated)
    saveHistory(updated)
  }

  function loadFromHistory(item: HistoryItem) {
    setResult(item.result)
    setInput(item.prompt)
    setCurrentPrompt(item.prompt)
    setActiveTab("Overview")
    setStatus("done")
    setShowHistory(false)
    setShowDesktopConfig(false)
    setPrevResult(null)
    setGistUrl("")
    setSelectedTool("")
    setTestParams({})
    setTestOutput(null)
    setViewingVersion({ serverName: item.serverName, version: item.version })
    validateServer(item.result)
  }

  function toggleGroup(serverName: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(serverName)) next.delete(serverName)
      else next.add(serverName)
      return next
    })
  }

  function clearHistory() {
    setGenHistory([])
    saveHistory([])
    setExpandedGroups(new Set())
    setViewingVersion(null)
  }

  async function callGenerate(message: string, hist: { role: string; content: string }[], count?: ToolCount, testMode?: boolean) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: hist, toolCount: count ?? toolCount, testMode: testMode ?? false }),
    })
    if (!res.ok) throw new Error("API request failed")
    return res.json()
  }

  async function handleGenerate() {
    if (!input.trim()) return
    setStatus("loading")
    setResult(null)
    setPrevResult(null)
    setErrorMsg("")
    setDots("")
    setCurrentPrompt(input)
    setShowDesktopConfig(false)
    setGistUrl("")
    setSelectedTool("")
    setTestParams({})
    setTestOutput(null)
    setValidation({ status: null, message: "" })
    try {
      const data = await callGenerate(input, [], toolCount)
      if (data.type === "question") {
        setQuestionText(data.message)
        setHistory([{ role: "user", content: input }, { role: "assistant", content: data.message }])
        setStatus("question")
        setTimeout(() => answerRef.current?.focus(), 100)
      } else if (data.type === "server") {
        setResult(data.data)
        setActiveTab("Overview")
        setStatus("done")
        addToHistory(data.data, input)
        validateServer(data.data)
        const vNum = genHistory.filter(i => i.serverName === data.data.serverName).length + 1
        setViewingVersion({ serverName: data.data.serverName, version: vNum })
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
        addToHistory(data.data, currentPrompt)
        validateServer(data.data)
        const vNumA = genHistory.filter(i => i.serverName === data.data.serverName).length + 1
        setViewingVersion({ serverName: data.data.serverName, version: vNumA })
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

  async function handleRegenerate() {
    if (!currentPrompt.trim()) return
    setPrevResult(result)
    setStatus("loading")
    setResult(null)
    setErrorMsg("")
    setDots("")
    setShowDesktopConfig(false)
    setGistUrl("")
    setSelectedTool("")
    setTestParams({})
    setTestOutput(null)
    setValidation({ status: null, message: "" })
    try {
      const data = await callGenerate(currentPrompt, [])
      if (data.type === "server") {
        setResult(data.data)
        setActiveTab("Overview")
        setStatus("done")
        addToHistory(data.data, currentPrompt)
        validateServer(data.data)
        const vNumR = genHistory.filter(i => i.serverName === data.data.serverName).length + 1
        setViewingVersion({ serverName: data.data.serverName, version: vNumR })
      } else if (data.type === "question") {
        setQuestionText(data.message)
        setHistory([{ role: "user", content: currentPrompt }, { role: "assistant", content: data.message }])
        setStatus("question")
      } else {
        throw new Error(data.message || "Unknown error")
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error")
      setStatus("error")
      setResult(prevResult)
      setPrevResult(null)
    }
  }

  // ── OpenAPI handlers ──────────────────────────────────────────────────────
  async function handleSwaggerFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setSwaggerLoading(true)
    setSwaggerError("")
    try {
      const text = await file.text()
      let spec: any
      if (file.name.endsWith(".yaml") || file.name.endsWith(".yml")) {
        // Simple YAML to JSON — handles common patterns
        const lines = text.split("\n")
        const jsonLines: string[] = []
        const stack: number[] = [-1]
        const isArray: boolean[] = [false]
        lines.forEach(line => {
          const stripped = line.trimEnd()
          if (!stripped || stripped.trimStart().startsWith("#")) return
          jsonLines.push(stripped) // keep raw for later JSON.parse attempt
        })
        // Try JSON parse first (some .yaml files are actually JSON)
        try { spec = JSON.parse(text) }
        catch {
          // Very minimal YAML parser fallback — just try js-yaml via CDN isn't available
          // So we extract key fields manually
          const getVal = (key: string) => {
            const match = text.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+)["']?`, "m"))
            return match?.[1]?.trim() || ""
          }
          const getBlock = (key: string) => {
            const idx = text.indexOf(`\n${key}:`)
            if (idx < 0) return ""
            return text.slice(idx, idx + 2000)
          }
          spec = {
            info: { title: getVal("title") || file.name, version: getVal("version") },
            servers: [{ url: getVal("url") }],
            host: getVal("host"),
            basePath: getVal("basePath"),
            schemes: [getVal("schemes").split(",")[0].trim() || "https"],
            paths: {},
            securityDefinitions: {},
          }
          // Extract paths roughly
          const pathsBlock = getBlock("paths")
          const pathMatches = pathsBlock.matchAll(/^\s{2}(\/[^\s:]+):/gm)
          for (const m of pathMatches) {
            spec.paths[m[1]] = { get: { summary: "", parameters: [] } }
          }
        }
      } else {
        spec = JSON.parse(text)
      }
      const prompt = parseOpenAPISpec(spec)
      setInput(prompt)
      setCurrentPrompt(prompt)
      setSwaggerError("")
      setShowSwaggerInput(false)
    } catch (err: any) {
      setSwaggerError(err.message || "Failed to parse spec file")
    } finally {
      setSwaggerLoading(false)
      if (swaggerFileRef.current) swaggerFileRef.current.value = ""
    }
  }

  async function handleSwaggerUrl() {
    if (!swaggerUrl.trim()) return
    setSwaggerLoading(true)
    setSwaggerError("")
    try {
      // Try direct fetch first
      let spec: any
      let fetchError = ""
      try {
        const res = await fetch(swaggerUrl.trim())
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        spec = JSON.parse(text)
      } catch (e: any) {
        fetchError = e.message
        // Try CORS proxy fallback
        try {
          const proxy = `https://corsproxy.io/?${encodeURIComponent(swaggerUrl.trim())}`
          const res = await fetch(proxy)
          if (!res.ok) throw new Error(`Proxy HTTP ${res.status}`)
          const text = await res.text()
          spec = JSON.parse(text)
        } catch {
          throw new Error(`Could not fetch spec: ${fetchError}. Try downloading the file and uploading it instead.`)
        }
      }
      const prompt = parseOpenAPISpec(spec)
      setInput(prompt)
      setCurrentPrompt(prompt)
      setSwaggerUrl("")
      setShowSwaggerInput(false)
    } catch (err: any) {
      setSwaggerError(err.message || "Failed to fetch spec")
    } finally {
      setSwaggerLoading(false)
    }
  }

  function handleShare() {
    if (!result) return
    const compressed = compressResult(result)
    if (!compressed) return
    const url = `${window.location.origin}${window.location.pathname}?s=${compressed}`
    navigator.clipboard.writeText(url).then(() => {
      setShareToast(true)
      setTimeout(() => setShareToast(false), 3000)
    })
  }

  async function handleGistExport() {
    if (!result || !gistToken.trim()) return
    setGistLoading(true)
    setGistError("")
    try {
      const files: Record<string, { content: string }> = {}
      Object.entries(result.files).forEach(([name, content]) => { files[name] = { content } })
      files["mcpforge-info.md"] = { content: `# ${result.serverName}\n\nGenerated by [MCPForge](https://mcpforge.vercel.app)\n\n${result.description}\n\n## Tools\n${result.tools.map(t => `- \`${t.name}()\`: ${t.description}`).join("\n")}\n` }
      const res = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${gistToken.trim()}` },
        body: JSON.stringify({ description: `MCPForge: ${result.serverName}`, public: true, files }),
      })
      if (!res.ok) { const err = await res.json(); throw new Error(err.message || "GitHub API error") }
      const data = await res.json()
      setGistUrl(data.html_url)
      setShowGistInput(false)
      setGistToken("")
    } catch (e: unknown) {
      setGistError(e instanceof Error ? e.message : "Failed to create Gist")
    } finally {
      setGistLoading(false)
    }
  }

  async function handleRunTest() {
    if (!result || !selectedTool) return
    setTestRunning(true)
    setTestOutput(null)
    try {
      const tool = result.tools.find(t => t.name === selectedTool)
      if (!tool) throw new Error("Tool not found")
      const paramSummary = Object.entries(testParams).filter(([, v]) => v.trim()).map(([k, v]) => `${k}="${v}"`).join(", ")
      const testPrompt = `You are simulating what the MCP tool "${selectedTool}" would return when called with these parameters: ${paramSummary || "no parameters"}.

Tool description: ${tool.description}
Server: ${result.serverName} — ${result.description}

Simulate a realistic, helpful response that this tool would actually return. Format it as plain text — not JSON, not markdown. Just the actual output a user would see. If it's a search, return 3-5 realistic results. If it's a lookup, return the relevant details. Be concise and realistic.`
      const data = await callGenerate(testPrompt, [], toolCount, true)
      if (data.type === "test_result") {
        setTestOutput({ success: true, output: data.output })
      } else {
        setTestOutput({ success: false, output: data.message || "Unexpected response" })
      }
    } catch (e: unknown) {
      setTestOutput({ success: false, output: e instanceof Error ? e.message : "Test failed" })
    } finally {
      setTestRunning(false)
    }
  }

  function validateServer(res: ServerResult) {
    setValidation({ status: "checking", message: "Checking code..." })
    setTimeout(() => {
      const code = res.files["index.ts"] || ""
      const warnings: string[] = []
      if (!code.includes("@modelcontextprotocol/sdk")) warnings.push("missing MCP SDK import")
      if (!code.includes("StdioServerTransport")) warnings.push("missing StdioServerTransport")
      if (!code.includes("tools/list")) warnings.push("missing tools/list handler")
      if (!code.includes("tools/call")) warnings.push("missing tools/call handler")
      if (!code.includes("try") || !code.includes("catch")) warnings.push("missing error handling")
      if (!code.includes("process.env")) warnings.push("API key may be hardcoded")
      const pkgJson = res.files["package.json"] || ""
      let pkgValid = false
      try { JSON.parse(pkgJson); pkgValid = true } catch { warnings.push("package.json is invalid JSON") }
      if (pkgValid && !pkgJson.includes("@modelcontextprotocol")) warnings.push("missing MCP SDK in package.json")
      setValidation(warnings.length === 0
        ? { status: "valid", message: "All checks passed — ready to run" }
        : { status: "warning", message: warnings[0] + (warnings.length > 1 ? ` (+${warnings.length - 1} more)` : "") })
    }, 600)
  }

  async function handleHarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setHarLoading(true)
    setHarError("")
    try {
      const text = await file.text()
      const har = JSON.parse(text)
      const entries = har?.log?.entries || []
      if (entries.length === 0) throw new Error("No entries found in HAR file")
      const apiCalls = entries.filter((entry: any) => {
        const url: string = entry.request?.url || ""
        const mime: string = entry.response?.content?.mimeType || ""
        return mime.includes("json") || url.includes("/api/") || url.includes("/v1/") || url.includes("/v2/") || url.includes("/graphql")
      }).slice(0, 3)
      if (apiCalls.length === 0) throw new Error("No API calls found. Make sure the HAR contains JSON API requests.")
      const summary = apiCalls.map((entry: any) => {
        const req = entry.request
        const res = entry.response
        const headers = (req.headers || []).filter((h: any) => ["authorization","x-api-key","content-type","accept"].includes(h.name?.toLowerCase())).map((h: any) => `${h.name}: ${h.value}`).join("\n")
        let responseBody = ""
        try { responseBody = JSON.stringify(JSON.parse(res?.content?.text || ""), null, 2).slice(0, 300) } catch { responseBody = (res?.content?.text || "").slice(0, 200) }
        return `Method: ${req.method}\nURL: ${req.url}\nHeaders: ${headers || "none"}\nResponse: ${responseBody}`
      }).join("\n\n---\n\n")
      setInput(`I'm uploading a HAR file. Here are the API calls I captured:\n\n${summary}\n\nPlease generate an MCP server that gives Claude access to this API.`)
      setStatus("idle")
    } catch (err: any) {
      setHarError(err.message || "Failed to parse HAR file")
    } finally {
      setHarLoading(false)
      if (harInputRef.current) harInputRef.current.value = ""
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
    setStatus("idle"); setInput(""); setAnswer(""); setResult(null); setPrevResult(null)
    setHistory([]); setQuestionText(""); setErrorMsg(""); setShowDesktopConfig(false)
    setCurrentPrompt(""); setGistUrl(""); setGistError(""); setShowGistInput(false)
    setValidation({ status: null, message: "" }); setSelectedTool(""); setTestParams({}); setTestOutput(null)
    setViewingVersion(null); setDiffMode(false); setDiffVersion(null)
    setSwaggerUrl(""); setSwaggerError(""); setShowSwaggerInput(false)
    window.history.replaceState({}, "", window.location.pathname)
  }

  function getLanguage(tab: TabKey) {
    if (tab === "index.ts") return "typescript"
    if (tab === "package.json") return "json"
    return tab === "README.md" ? "markdown" : "text"
  }

  function getDiffLines(oldText: string, newText: string): { type: "same" | "added" | "removed"; text: string }[] {
    const oldLines = oldText.split("\n")
    const newLines = newText.split("\n")
    const result: { type: "same" | "added" | "removed"; text: string }[] = []
    const maxLen = Math.max(oldLines.length, newLines.length)
    for (let i = 0; i < maxLen; i++) {
      const o = oldLines[i]; const n = newLines[i]
      if (o === undefined) result.push({ type: "added", text: n })
      else if (n === undefined) result.push({ type: "removed", text: o })
      else if (o === n) result.push({ type: "same", text: n })
      else { result.push({ type: "removed", text: o }); result.push({ type: "added", text: n }) }
    }
    return result
  }

  function getDesktopConfig(serverName: string) {
    return JSON.stringify({ mcpServers: { [serverName]: { command: "node", args: [`/absolute/path/to/${serverName}/index.js`], env: {} } } }, null, 2)
  }

  const apiColor = result?.apiType === "KNOWN_API" ? "#10b981" : result?.apiType === "UNKNOWN_API" ? "#f59e0b" : "#8b5cf6"
  const apiBg = result?.apiType === "KNOWN_API" ? "#052e16" : result?.apiType === "UNKNOWN_API" ? "#1c1003" : "#1e0a3c"
  const apiTypeBadgeColor = (t: string) => t === "KNOWN_API" ? "#10b981" : t === "UNKNOWN_API" ? "#f59e0b" : "#8b5cf6"

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Syne:wght@400;600;700;800&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg:#070710; --surface:#0d0d1a; --surface2:#111122;
          --border:rgba(139,92,246,0.15); --border-bright:rgba(139,92,246,0.4);
          --purple:#8b5cf6; --purple-bright:#a78bfa; --blue:#3b82f6;
          --teal:#10b981; --amber:#f59e0b; --text:#e2e0f0; --muted:#6b6880; --muted2:#9290a8;
          --font-display:'Syne',sans-serif; --font-mono:'JetBrains Mono',monospace;
        }
        .light-mode {
          --bg:#f4f3ff; --surface:#ffffff; --surface2:#f8f7ff;
          --border:rgba(109,40,217,0.12); --border-bright:rgba(109,40,217,0.35);
          --purple:#7c3aed; --purple-bright:#6d28d9; --blue:#2563eb;
          --teal:#059669; --amber:#d97706; --text:#1e1b2e; --muted:#9490a8; --muted2:#6b6880;
        }
        body { background:var(--bg); transition:background 0.3s; }
        @keyframes spin { to { transform:rotate(360deg); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes shimmer { 0% { background-position:-200% center; } 100% { background-position:200% center; } }
        @keyframes toastIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
        .fade-up { animation:fadeUp 0.4s ease forwards; }
        .btn-primary { background:linear-gradient(135deg,#7c3aed,#3b82f6); color:#fff; border:none; border-radius:10px; padding:13px 28px; font-size:14px; font-weight:700; font-family:var(--font-display); cursor:pointer; display:flex; align-items:center; gap:8px; transition:opacity 0.2s,transform 0.15s; }
        .btn-primary:hover:not(:disabled) { transform:translateY(-1px); opacity:0.92; }
        .btn-primary:disabled { opacity:0.45; cursor:not-allowed; transform:none; }
        .btn-ghost { background:transparent; color:var(--muted2); border:1px solid var(--border); border-radius:8px; padding:10px 18px; font-size:13px; font-family:var(--font-display); cursor:pointer; transition:border-color 0.2s,color 0.2s; }
        .btn-ghost:hover { border-color:var(--border-bright); color:var(--text); }
        .chip { background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.2); border-radius:20px; color:var(--muted2); font-size:12px; padding:5px 14px; cursor:pointer; font-family:var(--font-mono); transition:all 0.15s; white-space:nowrap; }
        .chip:hover { background:rgba(139,92,246,0.18); border-color:rgba(139,92,246,0.4); color:var(--purple-bright); }
        .chip:disabled { opacity:0.4; cursor:not-allowed; }
        .tab-btn { background:transparent; border:none; border-bottom:2px solid transparent; color:var(--muted); font-size:12px; padding:10px 16px; cursor:pointer; font-family:var(--font-mono); white-space:nowrap; margin-bottom:-1px; transition:color 0.15s,border-color 0.15s; }
        .tab-btn:hover { color:var(--muted2); }
        .tab-btn.active { color:var(--purple-bright); border-bottom-color:var(--purple-bright); }
        .tab-btn.test-tab { color:var(--amber); }
        .tab-btn.test-tab.active { border-bottom-color:var(--amber); color:var(--amber); }
        textarea { background:rgba(0,0,0,0.4); border:1px solid var(--border); border-radius:12px; color:var(--text); font-size:14px; padding:16px 18px; resize:none; font-family:var(--font-mono); line-height:1.7; width:100%; transition:border-color 0.2s,box-shadow 0.2s; }
        .light-mode textarea { background:rgba(255,255,255,0.8); }
        textarea:focus { outline:none; border-color:var(--border-bright); box-shadow:0 0 0 3px rgba(139,92,246,0.1); }
        .loading-bar { height:2px; background:linear-gradient(90deg,transparent,var(--purple),var(--blue),var(--purple),transparent); background-size:200% 100%; animation:shimmer 1.5s linear infinite; border-radius:2px; }
        .version-group { background:var(--surface2); border:1px solid var(--border); border-radius:10px; overflow:hidden; transition:border-color 0.2s; }
        .version-group:hover { border-color:var(--border-bright); }
        .version-group-header { padding:14px 16px; cursor:pointer; display:flex; justify-content:space-between; align-items:center; }
        .version-group-header:hover { background:rgba(139,92,246,0.05); }
        .version-item { padding:10px 16px; cursor:pointer; border-top:1px solid var(--border); display:flex; align-items:center; gap:10px; transition:background 0.15s; }
        .version-item:hover { background:rgba(139,92,246,0.08); }
        .version-item.active-version { background:rgba(139,92,246,0.12); border-left:3px solid var(--purple); }
        .diff-line { font-family:var(--font-mono); font-size:12px; line-height:1.6; padding:1px 12px; white-space:pre-wrap; word-break:break-all; }
        .diff-line.added { background:rgba(16,185,129,0.1); color:#34d399; border-left:3px solid #10b981; }
        .diff-line.removed { background:rgba(239,68,68,0.1); color:#f87171; border-left:3px solid #ef4444; text-decoration:line-through; opacity:0.7; }
        .diff-line.same { color:var(--muted2); border-left:3px solid transparent; }
        .diff-tab { background:transparent; border:none; border-bottom:2px solid transparent; color:var(--muted); font-size:11px; padding:7px 12px; cursor:pointer; font-family:var(--font-mono); white-space:nowrap; transition:all 0.15s; }
        .diff-tab.active { color:var(--purple-bright); border-bottom-color:var(--purple-bright); }
        .compare-btn { background:rgba(139,92,246,0.08); border:1px solid rgba(139,92,246,0.2); border-radius:4px; color:var(--muted2); font-size:10px; padding:2px 7px; cursor:pointer; font-family:var(--font-mono); transition:all 0.15s; }
        .config-box { background:#050510; border:1px solid rgba(59,130,246,0.3); border-radius:10px; padding:16px; font-family:var(--font-mono); font-size:12px; color:#93c5fd; white-space:pre; overflow-x:auto; position:relative; }
        .light-mode .config-box { background:#eef2ff; color:#1e3a8a; border-color:rgba(37,99,235,0.3); }
        .tool-count-btn { background:transparent; border:1px solid var(--border); border-radius:6px; color:var(--muted2); font-size:12px; padding:5px 12px; cursor:pointer; font-family:var(--font-mono); transition:all 0.15s; }
        .tool-count-btn.active { background:rgba(139,92,246,0.15); border-color:var(--border-bright); color:var(--purple-bright); }
        .tool-count-btn:hover:not(.active) { border-color:var(--border-bright); color:var(--text); }
        .share-toast { position:fixed; bottom:24px; right:24px; background:var(--surface); border:1px solid var(--purple); border-radius:10px; padding:12px 20px; font-size:13px; color:var(--purple-bright); font-family:var(--font-mono); animation:toastIn 0.3s ease; z-index:1000; display:flex; align-items:center; gap:8px; box-shadow:0 4px 20px rgba(139,92,246,0.2); }
        .action-btn { background:transparent; border:1px solid var(--border); border-radius:8px; padding:8px 14px; font-size:12px; cursor:pointer; font-family:var(--font-mono); transition:all 0.15s; display:flex; align-items:center; gap:6px; }
        .action-btn:hover { border-color:var(--border-bright); color:var(--text); }
        .theme-toggle { background:transparent; border:1px solid var(--border); border-radius:8px; padding:7px 12px; font-size:13px; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; gap:6px; color:var(--muted2); font-family:var(--font-mono); }
        .theme-toggle:hover { border-color:var(--border-bright); color:var(--text); }
        .valid-badge { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:20px; font-size:11px; font-weight:700; font-family:var(--font-mono); white-space:nowrap; }
        .valid-badge.valid { background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); color:#34d399; }
        .valid-badge.warning { background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.3); color:#fbbf24; }
        .valid-badge.checking { background:rgba(139,92,246,0.1); border:1px solid rgba(139,92,246,0.2); color:var(--muted2); }
        .param-input { width:100%; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:13px; padding:10px 14px; font-family:var(--font-mono); outline:none; transition:border-color 0.2s; }
        .light-mode .param-input { background:rgba(255,255,255,0.9); }
        .param-input:focus { border-color:rgba(139,92,246,0.5); }
        .swagger-panel { background:rgba(16,185,129,0.04); border:1px solid rgba(16,185,129,0.2); border-radius:12px; padding:16px; margin-top:12px; }
        .swagger-panel input { width:100%; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:8px; color:var(--text); font-size:13px; padding:10px 14px; font-family:var(--font-mono); outline:none; transition:border-color 0.2s; }
        .light-mode .swagger-panel input { background:rgba(255,255,255,0.9); }
        .swagger-panel input:focus { border-color:rgba(16,185,129,0.5); }
      `}</style>

      {shareToast && <div className="share-toast">✓ Share link copied to clipboard!</div>}

      <div className={darkMode ? "" : "light-mode"} style={{ minHeight:"100vh", background:"var(--bg)", color:"var(--text)", fontFamily:"var(--font-display)", display:"flex", flexDirection:"column" }}>

        {/* HEADER */}
        <header style={{ padding:"28px 48px 24px", borderBottom:"1px solid var(--border)", background:"var(--surface)", position:"relative", overflow:"hidden" }}>
          <div style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(139,92,246,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,0.04) 1px,transparent 1px)", backgroundSize:"40px 40px", pointerEvents:"none" }} />
          <div style={{ position:"relative", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"12px" }}>
            <div>
              <div style={{ display:"flex", alignItems:"center", gap:"14px", marginBottom:"8px" }}>
                <div style={{ width:"38px", height:"38px", borderRadius:"10px", background:"linear-gradient(135deg,#7c3aed,#3b82f6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"18px" }}>⚙</div>
                <h1 style={{ fontSize:"28px", fontWeight:"800", fontFamily:"var(--font-display)", letterSpacing:"-0.5px", background:"linear-gradient(135deg,#c4b5fd,#93c5fd)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>MCPForge</h1>
                <span style={{ fontSize:"10px", fontWeight:"700", padding:"3px 8px", borderRadius:"4px", background:"rgba(139,92,246,0.15)", color:"var(--purple-bright)", border:"1px solid rgba(139,92,246,0.3)", fontFamily:"var(--font-mono)", letterSpacing:"1px" }}>BETA</span>
              </div>
              <p style={{ color:"var(--muted2)", fontSize:"13px", fontFamily:"var(--font-mono)" }}>
                <span style={{ color:"var(--purple-bright)" }}>$</span> describe_tool <span style={{ color:"var(--muted)", margin:"0 6px" }}>→</span> generate_mcp_server <span style={{ color:"var(--teal)", marginLeft:"8px" }}>// in seconds</span>
              </p>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
              <button className="theme-toggle" onClick={() => setDarkMode(d => !d)}>{darkMode ? "☀ light" : "◑ dark"}</button>
              <button onClick={() => setShowHistory(h => !h)} style={{ background:showHistory?"rgba(139,92,246,0.15)":"transparent", border:"1px solid var(--border)", borderRadius:"8px", padding:"8px 16px", color:showHistory?"var(--purple-bright)":"var(--muted2)", fontSize:"12px", cursor:"pointer", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:"8px", transition:"all 0.2s" }}>
                ⏱ history {genHistory.length > 0 && <span style={{ background:"var(--purple)", color:"#fff", borderRadius:"10px", padding:"1px 6px", fontSize:"10px" }}>{genHistory.length}</span>}
              </button>
            </div>
          </div>
        </header>

        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>

          {/* HISTORY SIDEBAR */}
          {showHistory && (
            <aside style={{ width:"300px", flexShrink:0, borderRight:"1px solid var(--border)", background:"var(--surface)", padding:"20px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"12px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:"12px", fontWeight:"700", color:"var(--muted)", fontFamily:"var(--font-mono)", letterSpacing:"0.5px" }}>VERSION HISTORY</span>
                {genHistory.length > 0 && <button onClick={clearHistory} style={{ background:"none", border:"none", color:"var(--muted)", fontSize:"11px", cursor:"pointer", fontFamily:"var(--font-mono)" }}>clear all</button>}
              </div>
              {genHistory.length === 0 ? (
                <div style={{ fontSize:"12px", color:"var(--muted)", fontFamily:"var(--font-mono)", textAlign:"center", padding:"24px 0" }}>no generations yet</div>
              ) : groupByServer(genHistory).map(group => (
                <div key={group.serverName} className="version-group">
                  <div className="version-group-header" onClick={() => toggleGroup(group.serverName)}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"4px" }}>
                        <span style={{ fontSize:"12px", fontWeight:"700", color:"var(--text)", fontFamily:"var(--font-mono)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{group.serverName}</span>
                        <span style={{ fontSize:"10px", padding:"1px 7px", borderRadius:"10px", background:"rgba(139,92,246,0.15)", color:"var(--purple-bright)", fontFamily:"var(--font-mono)", fontWeight:"700", flexShrink:0 }}>{group.versions.length}v</span>
                      </div>
                      <div style={{ fontSize:"11px", color:"var(--muted2)", fontFamily:"var(--font-mono)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{group.versions[0].description}</div>
                    </div>
                    <span style={{ fontSize:"12px", color:"var(--muted)", marginLeft:"8px", flexShrink:0, transition:"transform 0.2s", transform:expandedGroups.has(group.serverName)?"rotate(180deg)":"none" }}>▼</span>
                  </div>
                  {expandedGroups.has(group.serverName) && group.versions.map(item => {
                    const isActive = viewingVersion?.serverName === item.serverName && viewingVersion?.version === item.version
                    return (
                      <div key={item.id} className={`version-item${isActive?" active-version":""}`} onClick={() => loadFromHistory(item)}>
                        <div style={{ width:"28px", height:"28px", borderRadius:"6px", background:isActive?"rgba(139,92,246,0.25)":"rgba(139,92,246,0.08)", border:`1px solid ${isActive?"rgba(139,92,246,0.5)":"rgba(139,92,246,0.15)"}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span style={{ fontSize:"10px", fontWeight:"700", color:isActive?"var(--purple-bright)":"var(--muted2)", fontFamily:"var(--font-mono)" }}>v{item.version}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:"11px", color:isActive?"var(--text)":"var(--muted2)", fontFamily:"var(--font-mono)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                            {item.result?.tools?.map((t: Tool) => t.name).join(", ") || item.description.slice(0,40)}
                          </div>
                          <div style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginTop:"2px" }}>{new Date(item.createdAt).toLocaleTimeString()} · {item.apiType.replace(/_/g," ")}</div>
                        </div>
                        <div style={{ display:"flex", alignItems:"center", gap:"4px", flexShrink:0 }}>
                          {isActive && <span style={{ fontSize:"10px", color:"var(--purple-bright)", fontFamily:"var(--font-mono)" }}>← now</span>}
                          {!isActive && result?.serverName === item.serverName && (
                            <button className="compare-btn" onClick={e => { e.stopPropagation(); if (diffVersion?.id===item.id) { setDiffMode(false); setDiffVersion(null) } else { setDiffVersion(item); setDiffMode(true) } }} style={{ color:diffVersion?.id===item.id?"var(--purple-bright)":"var(--muted2)", borderColor:diffVersion?.id===item.id?"rgba(139,92,246,0.4)":undefined }}>
                              {diffVersion?.id===item.id ? "✓ comparing" : "diff"}
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                  {!expandedGroups.has(group.serverName) && (
                    <div style={{ padding:"8px 16px", borderTop:"1px solid var(--border)", fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>
                      {group.versions.length} version{group.versions.length>1?"s":""} · click to expand
                    </div>
                  )}
                </div>
              ))}
            </aside>
          )}

          {/* MAIN */}
          <main style={{ flex:1, padding:"36px 48px", overflowY:"auto", display:"flex", flexDirection:"column", gap:"20px", maxWidth:showHistory?"100%":"960px", margin:"0 auto", width:"100%" }}>

            {/* INPUT CARD */}
            <div className="fade-up" style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"16px", overflow:"hidden" }}>
              <div style={{ height:"3px", background:"linear-gradient(90deg,#7c3aed,#3b82f6,#10b981)" }} />
              <div style={{ padding:"28px" }}>
                <label style={{ display:"block", fontSize:"12px", fontWeight:"700", color:"var(--muted)", fontFamily:"var(--font-mono)", marginBottom:"12px", letterSpacing:"1px" }}>WHAT SHOULD CLAUDE BE ABLE TO DO?</label>
                <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key==="Enter"&&e.metaKey) handleGenerate() }} placeholder='"Search GitHub repositories by keyword and return name, stars, and URL"' disabled={isLoading} rows={3} />

                {/* Import row: HAR + OpenAPI */}
                <div style={{ marginTop:"12px", display:"flex", alignItems:"center", gap:"10px", flexWrap:"wrap" }}>
                  {/* HAR upload */}
                  <input ref={harInputRef} type="file" accept=".har" onChange={handleHarUpload} style={{ display:"none" }} id="har-upload" />
                  <label htmlFor="har-upload" style={{ display:"flex", alignItems:"center", gap:"6px", background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:"8px", padding:"7px 14px", fontSize:"12px", color:"#60a5fa", cursor:harLoading?"wait":"pointer", fontFamily:"var(--font-mono)", transition:"all 0.15s" }}>
                    {harLoading ? <><span style={{ width:"10px", height:"10px", border:"1.5px solid rgba(96,165,250,0.3)", borderTopColor:"#60a5fa", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} /> parsing...</> : <>↑ .har file</>}
                  </label>

                  {/* OpenAPI / Swagger button */}
                  <button
                    onClick={() => { setShowSwaggerInput(v => !v); setSwaggerError("") }}
                    style={{ display:"flex", alignItems:"center", gap:"6px", background:showSwaggerInput?"rgba(16,185,129,0.15)":"rgba(16,185,129,0.06)", border:`1px solid ${showSwaggerInput?"rgba(16,185,129,0.5)":"rgba(16,185,129,0.2)"}`, borderRadius:"8px", padding:"7px 14px", fontSize:"12px", color:"#34d399", cursor:"pointer", fontFamily:"var(--font-mono)", transition:"all 0.15s" }}
                  >
                    {swaggerLoading ? <><span style={{ width:"10px", height:"10px", border:"1.5px solid rgba(52,211,153,0.3)", borderTopColor:"#34d399", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} /> importing...</> : <>⬡ OpenAPI / Swagger</>}
                  </button>

                  {harError && <span style={{ fontSize:"11px", color:"#f87171", fontFamily:"var(--font-mono)" }}>{harError}</span>}
                </div>

                {/* OpenAPI import panel */}
                {showSwaggerInput && (
                  <div className="swagger-panel">
                    <div style={{ fontSize:"11px", fontWeight:"700", color:"#34d399", fontFamily:"var(--font-mono)", marginBottom:"12px", letterSpacing:"0.5px" }}>
                      IMPORT OPENAPI / SWAGGER SPEC
                    </div>

                    {/* Method 1: URL */}
                    <div style={{ marginBottom:"12px" }}>
                      <div style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginBottom:"6px" }}>Paste a Swagger/OpenAPI URL:</div>
                      <div style={{ display:"flex", gap:"8px" }}>
                        <input
                          type="text"
                          value={swaggerUrl}
                          onChange={e => setSwaggerUrl(e.target.value)}
                          placeholder="https://petstore.swagger.io/v2/swagger.json"
                          onKeyDown={e => { if (e.key==="Enter") handleSwaggerUrl() }}
                          style={{ flex:1 }}
                        />
                        <button
                          onClick={handleSwaggerUrl}
                          disabled={!swaggerUrl.trim() || swaggerLoading}
                          style={{ background:"rgba(16,185,129,0.15)", border:"1px solid rgba(16,185,129,0.3)", borderRadius:"8px", color:"#34d399", fontSize:"12px", padding:"8px 16px", cursor:!swaggerUrl.trim()||swaggerLoading?"not-allowed":"pointer", fontFamily:"var(--font-mono)", whiteSpace:"nowrap", opacity:!swaggerUrl.trim()?0.5:1 }}
                        >
                          fetch →
                        </button>
                      </div>
                    </div>

                    {/* Divider */}
                    <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"12px" }}>
                      <div style={{ flex:1, height:"1px", background:"var(--border)" }} />
                      <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>or upload file</span>
                      <div style={{ flex:1, height:"1px", background:"var(--border)" }} />
                    </div>

                    {/* Method 2: File upload */}
                    <div>
                      <input ref={swaggerFileRef} type="file" accept=".json,.yaml,.yml" onChange={handleSwaggerFile} style={{ display:"none" }} id="swagger-upload" />
                      <label htmlFor="swagger-upload" style={{ display:"inline-flex", alignItems:"center", gap:"8px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.25)", borderRadius:"8px", padding:"8px 16px", fontSize:"12px", color:"#34d399", cursor:swaggerLoading?"wait":"pointer", fontFamily:"var(--font-mono)" }}>
                        ↑ Upload .json / .yaml / .yml
                      </label>
                      <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginLeft:"10px" }}>Supports OpenAPI 2.0 + 3.0</span>
                    </div>

                    {swaggerError && (
                      <div style={{ marginTop:"10px", fontSize:"11px", color:"#f87171", fontFamily:"var(--font-mono)", background:"rgba(239,68,68,0.06)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:"6px", padding:"8px 12px" }}>
                        ✗ {swaggerError}
                      </div>
                    )}
                  </div>
                )}

                {/* Tool count selector */}
                <div style={{ display:"flex", alignItems:"center", gap:"10px", marginTop:"14px", flexWrap:"wrap" }}>
                  <span style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>tools to generate:</span>
                  {([1,2,3] as ToolCount[]).map(n => (
                    <button key={n} className={`tool-count-btn${toolCount===n?" active":""}`} onClick={() => setToolCount(n)} disabled={isLoading}>{n} tool{n>1?"s":""}</button>
                  ))}
                  <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)", opacity:0.7 }}>more tools = more Claude capabilities</span>
                </div>

                {/* Chips */}
                <div style={{ display:"flex", flexWrap:"wrap", gap:"8px", alignItems:"center", marginTop:"14px" }}>
                  <span style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginRight:"4px" }}>try →</span>
                  {EXAMPLES.map(ex => <button key={ex} className="chip" onClick={() => setInput(ex)} disabled={isLoading}>{ex}</button>)}
                </div>

                <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"center", gap:"12px", marginTop:"20px" }}>
                  {(status==="done"||status==="error") && <button className="btn-ghost" onClick={handleReset}>← start over</button>}
                  {status==="done" && result && (
                    <button className="btn-ghost" onClick={handleRegenerate} disabled={isLoading} style={{ color:"var(--purple-bright)", borderColor:"rgba(139,92,246,0.3)" }}>↺ Regenerate</button>
                  )}
                  <button className="btn-primary" onClick={handleGenerate} disabled={isLoading||!input.trim()}>
                    {isLoading&&!questionText ? <><span style={{ width:"14px", height:"14px", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite", flexShrink:0 }} />Forging{dots}</> : <>Generate MCP Server <span style={{ opacity:0.7 }}>→</span></>}
                  </button>
                </div>
              </div>
              {isLoading && <div className="loading-bar" />}
            </div>

            {/* FOLLOW-UP QUESTION */}
            {status==="question" && (
              <div className="fade-up" style={{ background:"#0d0a00", border:"1px solid rgba(245,158,11,0.25)", borderRadius:"16px", overflow:"hidden" }}>
                <div style={{ height:"3px", background:"linear-gradient(90deg,#f59e0b,#fbbf24)" }} />
                <div style={{ padding:"28px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"16px" }}>
                    <div style={{ width:"30px", height:"30px", borderRadius:"50%", background:"rgba(245,158,11,0.15)", border:"1px solid rgba(245,158,11,0.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"15px" }}>?</div>
                    <span style={{ fontSize:"14px", fontWeight:"700", color:"#fbbf24", fontFamily:"var(--font-display)" }}>Need a few details about your API</span>
                  </div>
                  <pre style={{ fontSize:"13px", color:"#d4a800", lineHeight:"1.8", whiteSpace:"pre-wrap", fontFamily:"var(--font-mono)", background:"rgba(245,158,11,0.06)", padding:"16px", borderRadius:"8px", border:"1px solid rgba(245,158,11,0.12)", marginBottom:"16px" }}>{questionText}</pre>
                  <textarea ref={answerRef} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Paste your base URL, a sample request + response, and your auth method..." rows={5} />
                  <div style={{ display:"flex", justifyContent:"flex-end", marginTop:"16px" }}>
                    <button className="btn-primary" onClick={handleAnswer} disabled={!answer.trim()||isLoading}>
                      {isLoading ? <><span style={{ width:"14px", height:"14px", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"#fff", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />Forging{dots}</> : <>Generate with these details →</>}
                    </button>
                  </div>
                </div>
                {isLoading && <div className="loading-bar" />}
              </div>
            )}

            {/* ERROR */}
            {status==="error" && (
              <div className="fade-up" style={{ background:"#120406", border:"1px solid rgba(239,68,68,0.25)", borderRadius:"12px", padding:"16px 20px", fontSize:"13px", color:"#f87171", fontFamily:"var(--font-mono)" }}>
                <span style={{ color:"#ef4444", fontWeight:"700" }}>ERROR</span>{"  "}{errorMsg}
              </div>
            )}

            {/* RESULT */}
            {status==="done" && result && (
              <div className="fade-up" style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:"16px", overflow:"hidden" }}>
                <div style={{ height:"3px", background:`linear-gradient(90deg,${apiColor},${apiColor}88)` }} />

                {/* Result header */}
                <div style={{ padding:"24px 28px", borderBottom:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"16px", flexWrap:"wrap" }}>
                  <div style={{ flex:1, minWidth:"200px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"8px", flexWrap:"wrap" }}>
                      <span style={{ fontSize:"22px", fontWeight:"800", fontFamily:"var(--font-mono)", color:"var(--text)", letterSpacing:"-0.5px" }}>{result.serverName}</span>
                      <span style={{ fontSize:"10px", fontWeight:"700", padding:"3px 10px", borderRadius:"4px", background:apiBg, color:apiColor, border:`1px solid ${apiColor}44`, fontFamily:"var(--font-mono)", letterSpacing:"1px" }}>{result.apiType.replace(/_/g," ")}</span>
                      {viewingVersion && (
                        <span style={{ fontSize:"10px", fontWeight:"700", padding:"3px 10px", borderRadius:"4px", background:"rgba(139,92,246,0.12)", color:"var(--purple-bright)", border:"1px solid rgba(139,92,246,0.25)", fontFamily:"var(--font-mono)" }}>
                          v{viewingVersion.version} of {genHistory.filter(i => i.serverName === result.serverName).length}
                        </span>
                      )}
                      {validation.status && (
                        <span className={`valid-badge ${validation.status}`}>
                          {validation.status==="checking" && <span style={{ width:"8px", height:"8px", border:"1.5px solid currentColor", borderTopColor:"transparent", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />}
                          {validation.status==="valid" && "✓"}{validation.status==="warning" && "⚠"}
                          {validation.status==="checking" ? "checking..." : validation.status==="valid" ? "valid TypeScript" : validation.message}
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize:"13px", color:"var(--muted2)", fontFamily:"var(--font-mono)" }}>{result.description}</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"8px", marginTop:"14px", alignItems:"center" }}>
                      <span style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>tools:</span>
                      {result.tools.map(tool => (
                        <span key={tool.name} style={{ fontSize:"11px", padding:"4px 12px", borderRadius:"4px", background:"rgba(139,92,246,0.12)", border:"1px solid rgba(139,92,246,0.25)", color:"var(--purple-bright)", fontFamily:"var(--font-mono)", fontWeight:"500" }}>{tool.name}()</span>
                      ))}
                    </div>
                  </div>

                  <div style={{ display:"flex", flexDirection:"column", gap:"8px", flexShrink:0 }}>
                    <button onClick={handleDownloadZip} style={{ background:"linear-gradient(135deg,#065f46,#047857)", color:"#34d399", border:"1px solid #10b98144", borderRadius:"10px", padding:"11px 22px", fontSize:"13px", fontWeight:"700", cursor:"pointer", whiteSpace:"nowrap", fontFamily:"var(--font-display)", display:"flex", alignItems:"center", gap:"8px" }}>↓ Download ZIP</button>
                    <button onClick={() => setShowDesktopConfig(v => !v)} style={{ background:showDesktopConfig?"rgba(59,130,246,0.15)":"transparent", color:"#60a5fa", border:"1px solid rgba(59,130,246,0.3)", borderRadius:"10px", padding:"10px 22px", fontSize:"13px", fontWeight:"600", cursor:"pointer", fontFamily:"var(--font-display)", transition:"all 0.2s" }}>
                      {showDesktopConfig ? "▲ hide config" : "⚙ Claude Desktop config"}
                    </button>
                    <div style={{ display:"flex", gap:"8px" }}>
                      <button onClick={handleShare} className="action-btn" style={{ color:"var(--purple-bright)", borderColor:"rgba(139,92,246,0.3)", flex:1 }}>🔗 share</button>
                      <button onClick={() => { setShowGistInput(v => !v); setGistError(""); setGistUrl("") }} className="action-btn" style={{ color:"var(--muted2)", flex:1 }}>↑ gist</button>
                    </div>
                    {gistUrl && (
                      <a href={gistUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize:"11px", color:"var(--teal)", fontFamily:"var(--font-mono)", textDecoration:"none", padding:"6px 10px", background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.2)", borderRadius:"6px", textAlign:"center" }}>✓ View Gist →</a>
                    )}
                  </div>
                </div>

                {/* Gist input */}
                {showGistInput && !gistUrl && (
                  <div style={{ padding:"16px 28px", borderBottom:"1px solid var(--border)", background:"rgba(255,255,255,0.02)" }}>
                    <div style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginBottom:"8px" }}>
                      GitHub Personal Access Token with <span style={{ color:"var(--amber)" }}>gist</span> scope →
                      <a href="https://github.com/settings/tokens/new?scopes=gist" target="_blank" rel="noopener noreferrer" style={{ color:"var(--blue)", marginLeft:"8px" }}>create one</a>
                    </div>
                    <div style={{ display:"flex", gap:"8px" }}>
                      <input type="password" value={gistToken} onChange={e => setGistToken(e.target.value)} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" className="param-input" onKeyDown={e => { if (e.key==="Enter") handleGistExport() }} />
                      <button onClick={handleGistExport} disabled={!gistToken.trim()||gistLoading} style={{ background:"rgba(255,255,255,0.06)", border:"1px solid var(--border)", borderRadius:"8px", color:"var(--text)", fontSize:"13px", padding:"10px 18px", cursor:gistLoading?"wait":"pointer", fontFamily:"var(--font-mono)", whiteSpace:"nowrap" }}>
                        {gistLoading ? "uploading..." : "create gist →"}
                      </button>
                    </div>
                    {gistError && <div style={{ fontSize:"11px", color:"#f87171", fontFamily:"var(--font-mono)", marginTop:"6px" }}>{gistError}</div>}
                  </div>
                )}

                {/* Desktop config */}
                {showDesktopConfig && (
                  <div style={{ padding:"20px 28px", borderBottom:"1px solid var(--border)", background:"rgba(59,130,246,0.04)" }}>
                    <div style={{ fontSize:"12px", fontWeight:"700", color:"#60a5fa", fontFamily:"var(--font-mono)", marginBottom:"10px" }}>
                      CLAUDE DESKTOP CONFIG <span style={{ color:"var(--muted)", fontWeight:"400", marginLeft:"8px" }}>→ ~/Library/Application Support/Claude/claude_desktop_config.json</span>
                    </div>
                    <div className="config-box">
                      {getDesktopConfig(result.serverName)}
                      <button onClick={() => handleCopy(getDesktopConfig(result.serverName), "desktop-config")} style={{ position:"absolute", top:"10px", right:"10px", background:"rgba(59,130,246,0.2)", border:"1px solid rgba(59,130,246,0.3)", borderRadius:"6px", color:"#60a5fa", fontSize:"11px", padding:"4px 10px", cursor:"pointer", fontFamily:"var(--font-mono)" }}>
                        {copied==="desktop-config" ? "✓ copied" : "copy"}
                      </button>
                    </div>
                    <div style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginTop:"10px" }}>
                      ⚠ Replace <span style={{ color:"#fbbf24" }}>/absolute/path/to/{result.serverName}/index.js</span> with the real path after unzipping. Then restart Claude Desktop.
                    </div>
                  </div>
                )}

                {/* API key notice */}
                {result.needsApiKey && result.apiKeyInstructions && (
                  <div style={{ padding:"12px 28px", borderBottom:"1px solid var(--border)", background:"rgba(245,158,11,0.06)", fontSize:"12px", color:"#d97706", fontFamily:"var(--font-mono)", display:"flex", gap:"8px" }}>
                    <span>⚠</span><span><strong>API key needed:</strong> {result.apiKeyInstructions}</span>
                  </div>
                )}

                {/* Tabs */}
                <div style={{ display:"flex", borderBottom:"1px solid var(--border)", paddingLeft:"12px", overflowX:"auto" }}>
                  {TABS.map(tab => (
                    <button key={tab} className={`tab-btn${activeTab===tab?" active":""}${tab==="Test"?" test-tab":""}`} onClick={() => setActiveTab(tab)}>
                      {tab==="Test" ? "▶ Test" : tab}
                    </button>
                  ))}
                  {diffMode && diffVersion && (
                    <button onClick={() => { setDiffMode(false); setDiffVersion(null) }} style={{ marginLeft:"auto", marginRight:"12px", background:"rgba(139,92,246,0.1)", border:"1px solid rgba(139,92,246,0.3)", borderRadius:"6px", color:"var(--purple-bright)", fontSize:"11px", padding:"4px 12px", cursor:"pointer", fontFamily:"var(--font-mono)", alignSelf:"center" }}>✕ close diff</button>
                  )}
                </div>

                {/* DIFF VIEW */}
                {diffMode && diffVersion && activeTab !== "Test" && activeTab !== "Overview" && (
                  <div style={{ borderBottom:"1px solid var(--border)" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", background:"rgba(139,92,246,0.06)", borderBottom:"1px solid var(--border)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
                        <span style={{ fontSize:"11px", fontWeight:"700", fontFamily:"var(--font-mono)", color:"var(--purple-bright)" }}>DIFF VIEW</span>
                        <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>v{diffVersion.version} <span style={{ color:"#f87171" }}>removed</span> · v{viewingVersion?.version} <span style={{ color:"#34d399" }}>added</span></span>
                      </div>
                      <div style={{ display:"flex", gap:"0" }}>
                        {(["index.ts","package.json",".env.example","README.md"] as const).map(t => (
                          <button key={t} className={`diff-tab${diffTab===t?" active":""}`} onClick={() => setDiffTab(t)}>{t}</button>
                        ))}
                      </div>
                    </div>
                    {(() => {
                      const oldText = diffVersion.result.files[diffTab] || ""
                      const newText = result.files[diffTab] || ""
                      const lines = getDiffLines(oldText, newText)
                      const added = lines.filter(l => l.type==="added").length
                      const removed = lines.filter(l => l.type==="removed").length
                      const same = lines.filter(l => l.type==="same").length
                      return (
                        <>
                          <div style={{ display:"flex", gap:"16px", padding:"8px 16px", background:"var(--surface2)", borderBottom:"1px solid var(--border)" }}>
                            <span style={{ fontSize:"11px", fontFamily:"var(--font-mono)", color:"#34d399" }}>+{added} added</span>
                            <span style={{ fontSize:"11px", fontFamily:"var(--font-mono)", color:"#f87171" }}>-{removed} removed</span>
                            <span style={{ fontSize:"11px", fontFamily:"var(--font-mono)", color:"var(--muted)" }}>{same} unchanged</span>
                          </div>
                          <div style={{ maxHeight:"360px", overflowY:"auto", background:"#050510" }}>
                            {lines.map((line, i) => (
                              <div key={i} className={`diff-line ${line.type}`}>
                                <span style={{ opacity:0.4, marginRight:"8px", userSelect:"none" }}>{line.type==="added"?"+":line.type==="removed"?"-":" "}</span>
                                {line.text}
                              </div>
                            ))}
                          </div>
                        </>
                      )
                    })()}
                  </div>
                )}

                {/* TEST TAB */}
                {activeTab==="Test" && (
                  <div style={{ padding:"28px" }}>
                    <div style={{ marginBottom:"20px" }}>
                      <div style={{ fontSize:"12px", fontWeight:"700", color:"var(--muted)", fontFamily:"var(--font-mono)", letterSpacing:"1px", marginBottom:"14px" }}>SELECT A TOOL TO TEST</div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:"8px" }}>
                        {result.tools.map(tool => (
                          <button key={tool.name} onClick={() => { setSelectedTool(tool.name); setTestParams({}); setTestOutput(null) }}
                            style={{ background:selectedTool===tool.name?"rgba(139,92,246,0.2)":"var(--surface2)", border:`1px solid ${selectedTool===tool.name?"rgba(139,92,246,0.5)":"var(--border)"}`, borderRadius:"8px", padding:"10px 18px", fontSize:"13px", fontWeight:"600", color:selectedTool===tool.name?"var(--purple-bright)":"var(--muted2)", cursor:"pointer", fontFamily:"var(--font-mono)", transition:"all 0.15s" }}>
                            {tool.name}()
                          </button>
                        ))}
                      </div>
                    </div>
                    {!selectedTool && <div style={{ textAlign:"center", padding:"32px", color:"var(--muted)", fontSize:"13px", fontFamily:"var(--font-mono)" }}>← select a tool above to test it</div>}
                    {selectedTool && (() => {
                      const tool = result.tools.find(t => t.name === selectedTool)!
                      const props = (tool.parameters as any)?.properties || {}
                      const required: string[] = (tool.parameters as any)?.required || []
                      const allRequiredFilled = required.every(r => testParams[r]?.trim())
                      return (
                        <div>
                          <div style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"12px", padding:"18px", marginBottom:"16px" }}>
                            <div style={{ fontSize:"13px", fontWeight:"700", color:"var(--purple-bright)", fontFamily:"var(--font-mono)", marginBottom:"6px" }}>{tool.name}()</div>
                            <div style={{ fontSize:"12px", color:"var(--muted2)", lineHeight:"1.6", marginBottom:"14px" }}>{tool.description}</div>
                            {Object.keys(props).length > 0 ? (
                              <div style={{ display:"flex", flexDirection:"column", gap:"12px" }}>
                                <div style={{ fontSize:"11px", fontWeight:"700", color:"var(--muted)", fontFamily:"var(--font-mono)", letterSpacing:"0.5px" }}>PARAMETERS</div>
                                {Object.entries(props).map(([paramName, paramInfo]: [string, any]) => (
                                  <div key={paramName}>
                                    <div style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"5px" }}>
                                      <span style={{ fontSize:"12px", fontWeight:"700", color:"var(--purple-bright)", fontFamily:"var(--font-mono)" }}>{paramName}</span>
                                      {required.includes(paramName) && <span style={{ fontSize:"10px", padding:"1px 6px", borderRadius:"4px", background:"rgba(239,68,68,0.1)", color:"#f87171", fontFamily:"var(--font-mono)" }}>required</span>}
                                      <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>{paramInfo?.type || "string"}</span>
                                    </div>
                                    {paramInfo?.description && <div style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginBottom:"6px" }}>{paramInfo.description}</div>}
                                    <input type="text" value={testParams[paramName]||""} onChange={e => setTestParams(p => ({ ...p, [paramName]:e.target.value }))} placeholder={`Enter ${paramName}...`} className="param-input" />
                                  </div>
                                ))}
                              </div>
                            ) : <div style={{ fontSize:"12px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>This tool takes no parameters</div>}
                          </div>
                          <button onClick={handleRunTest} disabled={testRunning||!allRequiredFilled}
                            style={{ background:testRunning||!allRequiredFilled?"rgba(139,92,246,0.1)":"linear-gradient(135deg,#7c3aed,#3b82f6)", color:testRunning||!allRequiredFilled?"var(--muted2)":"#fff", border:testRunning||!allRequiredFilled?"1px solid var(--border)":"none", borderRadius:"10px", padding:"12px 28px", fontSize:"14px", fontWeight:"700", cursor:testRunning||!allRequiredFilled?"not-allowed":"pointer", fontFamily:"var(--font-display)", display:"flex", alignItems:"center", gap:"10px", opacity:!allRequiredFilled?0.5:1, transition:"all 0.2s", marginBottom:"16px" }}>
                            {testRunning ? <><span style={{ width:"14px", height:"14px", border:"2px solid rgba(255,255,255,0.3)", borderTopColor:"var(--purple-bright)", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />Running simulation...</> : <>▶ Run test</>}
                          </button>
                          {testOutput && (
                            <div style={{ background:testOutput.success?"rgba(16,185,129,0.05)":"rgba(239,68,68,0.05)", border:`1px solid ${testOutput.success?"rgba(16,185,129,0.25)":"rgba(239,68,68,0.25)"}`, borderRadius:"12px", overflow:"hidden" }}>
                              <div style={{ padding:"12px 16px", borderBottom:`1px solid ${testOutput.success?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)"}`, display:"flex", alignItems:"center", gap:"8px", background:testOutput.success?"rgba(16,185,129,0.08)":"rgba(239,68,68,0.08)" }}>
                                <span style={{ fontSize:"12px", fontWeight:"700", fontFamily:"var(--font-mono)", color:testOutput.success?"#34d399":"#f87171" }}>{testOutput.success?"✓ SIMULATED OUTPUT":"✗ TEST FAILED"}</span>
                                <span style={{ fontSize:"10px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>— Claude simulates what this tool would return</span>
                              </div>
                              <pre style={{ padding:"16px", fontSize:"13px", color:testOutput.success?"var(--text)":"#f87171", fontFamily:"var(--font-mono)", lineHeight:"1.7", whiteSpace:"pre-wrap", wordBreak:"break-word", margin:0 }}>{testOutput.output}</pre>
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* OVERVIEW TAB */}
                {activeTab==="Overview" && (
                  <div style={{ padding:"24px 28px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:"16px" }}>
                    {result.tools.map(tool => (
                      <div key={tool.name} style={{ background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:"12px", padding:"18px", display:"flex", flexDirection:"column", gap:"8px" }}>
                        <div style={{ fontSize:"13px", fontWeight:"700", color:"var(--purple-bright)", fontFamily:"var(--font-mono)" }}>{tool.name}()</div>
                        <div style={{ fontSize:"12px", color:"var(--muted2)", lineHeight:"1.6" }}>{tool.description}</div>
                        <div style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)", marginTop:"4px" }}>params: {Object.keys((tool.parameters as any)?.properties||{}).join(", ")||"none"}</div>
                      </div>
                    ))}
                    <div style={{ background:"linear-gradient(135deg,rgba(16,185,129,0.06),rgba(16,185,129,0.02))", border:"1px solid rgba(16,185,129,0.2)", borderRadius:"12px", padding:"18px" }}>
                      <div style={{ fontSize:"12px", fontWeight:"700", color:"#34d399", fontFamily:"var(--font-mono)", marginBottom:"12px" }}>// quick_setup</div>
                      {["unzip the ZIP file","npm install",result.needsApiKey?"fill in .env with API key":null,"node index.js","add to claude_desktop_config.json"].filter(Boolean).map((step,i) => (
                        <div key={i} style={{ display:"flex", gap:"10px", marginBottom:"8px" }}>
                          <span style={{ fontSize:"11px", color:"#10b981", fontFamily:"var(--font-mono)", flexShrink:0 }}>{String(i+1).padStart(2,"0")}.</span>
                          <span style={{ fontSize:"12px", color:"var(--muted2)", fontFamily:"var(--font-mono)" }}>{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CODE TABS */}
                {activeTab!=="Overview" && activeTab!=="Test" && (
                  <div style={{ position:"relative" }}>
                    <button onClick={() => handleCopy(result.files[activeTab as Exclude<TabKey,"Overview"|"Test">]||"",activeTab)} style={{ position:"absolute", top:"12px", right:"12px", zIndex:10, background:"rgba(139,92,246,0.15)", border:"1px solid rgba(139,92,246,0.3)", borderRadius:"6px", color:"var(--purple-bright)", fontSize:"11px", padding:"5px 12px", cursor:"pointer", fontFamily:"var(--font-mono)", fontWeight:"500" }}>
                      {copied===activeTab?"✓ copied":"copy"}
                    </button>
                    <Editor height="440px" language={getLanguage(activeTab)} value={result.files[activeTab as Exclude<TabKey,"Overview"|"Test">]||""} theme="vs-dark" options={{ readOnly:true, minimap:{enabled:false}, fontSize:13, lineNumbers:"on", scrollBeyondLastLine:false, wordWrap:"on", padding:{top:20}, fontFamily:"JetBrains Mono, monospace" }} />
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        <footer style={{ padding:"14px 48px", borderTop:"1px solid var(--border)", display:"flex", justifyContent:"space-between", alignItems:"center", background:"var(--surface)" }}>
          <span style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}><span style={{ color:"var(--purple-bright)" }}>MCPForge</span> · HackASU 2026 · Claude Builder Club</span>
          <span style={{ fontSize:"11px", color:"var(--muted)", fontFamily:"var(--font-mono)" }}>powered by <span style={{ color:"var(--blue)" }}>Anthropic Claude</span></span>
        </footer>
      </div>
    </>
  )
}