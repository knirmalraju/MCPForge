# ⚙ MCPForge

> **Describe what you want Claude to do — get a ready-to-run MCP server in seconds.**

MCPForge generates complete, runnable MCP (Model Context Protocol) servers from plain English descriptions using Claude. No SDK knowledge required. No boilerplate. Just describe the capability you want Claude to have, and MCPForge handles the rest.

Built for **HackASU 2026 — Track 2: AI Tooling** by Claude Builder Club.

---

## What is MCPForge?

MCP servers let you give Claude new capabilities — like searching GitHub, fetching weather, querying your own internal APIs, and more. But building one from scratch requires knowing JSON schemas, the MCP SDK, transport protocols, and API integration patterns.

MCPForge eliminates all of that. You type one sentence. You get:

- `index.ts` — Complete TypeScript MCP server with real API calls
- `package.json` — All dependencies correctly configured
- `.env.example` — Environment variable template with instructions
- `README.md` — Setup guide and Claude Desktop configuration

Everything bundled into a downloadable ZIP. Unzip, run `npm install`, and Claude has a new capability.

---

## Live Demo

**[mcpforge.vercel.app](https://mcpforge.vercel.app)**

---

## How It Works

MCPForge uses a carefully engineered two-turn conversation system:

### For well-known public APIs (GitHub, YouTube, Reddit, Weather...)
Type your description → MCPForge generates immediately. Claude already knows these APIs from training.

### For private or internal APIs
MCPForge asks three targeted questions:
1. What is your base URL?
2. Paste one sample request + response
3. How does auth work?

From that single example, Claude infers the full API structure and generates a complete server.

### For APIs with existing specs
Use the **OpenAPI / Swagger import** — paste a URL or upload a `.yaml` / `.json` file. MCPForge extracts endpoints, base URL, and auth automatically.

### For pure logic (no API needed)
Just describe what you want — MCPForge generates the logic directly, no external calls required.

---

## Features

| Feature | Description |
|---|---|
| ⏱ **Generation History** | Last 40 generations saved locally, with version tracking per server |
| 📋 **Version History** | Groups regenerations as v1/v2/v3 with side-by-side diff view |
| ▶ **Live Server Test** | Simulate tool output using Claude before downloading |
| ↑ **HAR File Upload** | Drop a browser traffic file — MCPForge auto-detects the API |
| ⬡ **OpenAPI Import** | Paste a Swagger URL or upload `.yaml`/`.json` spec files |
| ⚙ **Desktop Config** | One-click copy of `claude_desktop_config.json` snippet |
| ✓ **Validation Badge** | 6 automated code checks run after every generation |
| 🔗 **Share via URL** | Compressed shareable link — no account needed |
| ↑ **GitHub Gist Export** | Push all generated files to a public Gist in one click |
| ◑ **Dark / Light Mode** | Full theme toggle with CSS variables |

---

## Tech Stack

- **Frontend** — Next.js 16 + TypeScript (App Router)
- **AI Engine** — Anthropic SDK + Claude Sonnet (`claude-sonnet-4-20250514`)
- **Code Editor** — Monaco Editor (VS Code engine)
- **File Export** — JSZip (client-side, no server storage)
- **Fonts** — JetBrains Mono + Syne
- **Deployment** — Vercel

---

## Getting Started

### Prerequisites

- Node.js 18+
- An [Anthropic API key](https://console.anthropic.com/)

### Installation
```bash
git clone https://github.com/knirmalraju/MCPForge.git
cd MCPForge
npm install
```

### Environment Setup

Create a `.env.local` file in the root of the project:
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your API key from [console.anthropic.com](https://console.anthropic.com/).

### Run Locally
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure
```
mcpforge/
├── src/
│   └── app/
│       ├── page.tsx          # Main UI — all features
│       ├── layout.tsx        # Root layout
│       └── api/
│           └── generate/
│               └── route.ts  # Anthropic API route + system prompt
├── public/
├── .env.local                # Your API key (not committed)
└── package.json
```

---

## How to Use

### Basic Generation

1. Open MCPForge at [http://localhost:3000](http://localhost:3000)
2. Type what you want Claude to be able to do
3. Choose how many tools to generate (1, 2, or 3)
4. Click **Generate MCP Server**
5. Browse the generated files using the tabs
6. Click **Download ZIP**

### Installing a Generated Server

1. Unzip the downloaded file
2. Run `npm install` inside the folder
3. Fill in your API key in the `.env` file (if required)
4. Run `node index.js`
5. Add to Claude Desktop — click **⚙ Claude Desktop config** in MCPForge to get the exact snippet

### Claude Desktop Config

Add this to your Claude Desktop configuration file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
```json
{
  "mcpServers": {
    "your-server-name": {
      "command": "node",
      "args": ["/absolute/path/to/your-server-name/index.js"],
      "env": {}
    }
  }
}
```

Replace the path with wherever you unzipped the files. Restart Claude Desktop.

---

## Example Prompts

**Public APIs (instant generation):**
```
Search GitHub repositories by keyword and return name, stars, and URL
```
```
Get current weather and 5-day forecast for any city
```
```
Search YouTube videos and return title, channel, views, and link
```
```
Fetch top posts from any subreddit with score and comments
```

**Private APIs (2-turn flow):**
```
I want Claude to retrieve employee details from my company's HR system
```
```
Query our internal ticket system for open support tickets by team
```

**OpenAPI import:**
```
Paste: https://petstore.swagger.io/v2/swagger.json
```

---

## API Route

The generation endpoint lives at `POST /api/generate`.

**Request body:**
```json
{
  "message": "string",
  "history": [],
  "toolCount": 2,
  "testMode": false
}
```

**Response types:**
- `{ type: "server", data: { ... } }` — Complete generated server
- `{ type: "question", message: "..." }` — Follow-up question for private APIs
- `{ type: "test_result", output: "..." }` — Simulated tool output (testMode)
- `{ type: "error", message: "..." }` — Error

---

## Validation Checks

After every generation, MCPForge automatically checks the generated `index.ts` for:

1. MCP SDK import (`@modelcontextprotocol/sdk`)
2. `StdioServerTransport` present
3. `tools/list` handler implemented
4. `tools/call` handler implemented
5. `try/catch` error handling
6. `process.env` used for API keys (not hardcoded)
7. Valid `package.json` with MCP SDK listed

Shows **✓ valid TypeScript** or **⚠ [specific issue]** immediately after generation.

---

## Deployment

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/knirmalraju/MCPForge)

Add your `ANTHROPIC_API_KEY` as an environment variable in Vercel project settings.

### Deploy manually
```bash
npm run build
npm start
```

---

## Why MCPForge?

Every other MCP generator requires an OpenAPI spec or existing API documentation. MCPForge is the only tool that works from a plain English sentence and — for private APIs — a single sample response.

**Claude is the engine. MCPForge is the interface.**

Asking Claude to write an MCP server is like asking a carpenter to build furniture. Possible, but you need to know what to ask for, how to specify it, and how to put the pieces together. MCPForge is IKEA — same quality output, packaged so anyone can use it.

---

## Contributing

PRs welcome. Open an issue first to discuss major changes.
```bash
git checkout -b feature/your-feature
git commit -m "Add your feature"
git push origin feature/your-feature
```

---

## License

MIT

---

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude and the MCP SDK
- [Model Context Protocol](https://modelcontextprotocol.io) for the open standard
- HackASU 2026 for the opportunity

---

*Built with ❤ at HackASU 2026 · Track 2: AI Tooling · Claude Builder Club*
