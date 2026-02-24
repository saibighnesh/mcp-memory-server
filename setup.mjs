#!/usr/bin/env node

/**
 * MCP Memory Server — One-Command Setup
 * 
 * Detects your installed MCP clients and generates
 * ready-to-paste config snippets for each one.
 * 
 * Usage: node setup.mjs [--user-id=YOUR_NAME]
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join } from "path";
import { homedir } from "os";

// ─── Config ──────────────────────────────────────────────
const args = process.argv.slice(2);
const userIdArg = args.find(a => a.startsWith("--user-id="));
const userId = userIdArg ? userIdArg.split("=")[1] : process.env.USERNAME || process.env.USER || "default-user";
const serverPath = resolve("dist/index.js").replace(/\\/g, "/");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

const CHECK = `${GREEN}✓${RESET}`;
const CROSS = `${RED}✗${RESET}`;
const ARROW = `${BLUE}→${RESET}`;
const STAR = `${YELLOW}★${RESET}`;

// ─── Header ──────────────────────────────────────────────
console.log(`
${BOLD}${BLUE}╔════════════════════════════════════════════════╗
║       MCP Memory Server — Quick Setup          ║
╚════════════════════════════════════════════════╝${RESET}
`);

// ─── Pre-flight checks ───────────────────────────────────
console.log(`${BOLD}Pre-flight Checks${RESET}\n`);

const hasServiceKey = existsSync("serviceAccountKey.json");
const hasDist = existsSync("dist/index.js");

console.log(`  ${hasServiceKey ? CHECK : CROSS} serviceAccountKey.json ${hasServiceKey ? "" : `${RED}(MISSING — download from Firebase Console)${RESET}`}`);
console.log(`  ${hasDist ? CHECK : CROSS} dist/index.js ${hasDist ? "" : `${YELLOW}(run: npm run build)${RESET}`}`);
console.log(`  ${CHECK} User ID: ${CYAN}${userId}${RESET}`);
console.log(`  ${CHECK} Server path: ${DIM}${serverPath}${RESET}`);
console.log();

if (!hasServiceKey) {
    console.log(`${RED}${BOLD}⚠ Missing serviceAccountKey.json!${RESET}`);
    console.log(`  1. Go to ${CYAN}https://console.firebase.google.com${RESET}`);
    console.log(`  2. Project Settings → Service Accounts → Generate New Private Key`);
    console.log(`  3. Save the file as ${BOLD}serviceAccountKey.json${RESET} in this folder\n`);
}

if (!hasDist) {
    console.log(`${YELLOW}Building server...${RESET}`);
    const { execSync } = await import("child_process");
    try {
        execSync("npm run build", { stdio: "inherit" });
        console.log(`${CHECK} Build complete!\n`);
    } catch {
        console.log(`${CROSS} Build failed — run ${BOLD}npm run build${RESET} manually\n`);
    }
}

// ─── MCP Config ──────────────────────────────────────────
const mcpConfig = {
    mcpServers: {
        "memory": {
            command: "node",
            args: [serverPath, `--user-id=${userId}`]
        }
    }
};

const vsCodeConfig = {
    mcp: {
        servers: {
            "memory": {
                command: "node",
                args: [serverPath, `--user-id=${userId}`]
            }
        }
    }
};

const configJSON = JSON.stringify(mcpConfig, null, 2);
const vsCodeJSON = JSON.stringify(vsCodeConfig, null, 2);

// ─── Client Detection & Config Output ────────────────────
console.log(`${BOLD}${BLUE}═══ Copy-Paste Configs for Your Clients ═══${RESET}\n`);

const clients = [
    {
        name: "Claude Code",
        icon: "🟣",
        method: "one-liner",
        command: `claude mcp add memory -- node ${serverPath} --user-id=${userId}`,
    },
    {
        name: "Claude Desktop",
        icon: "🟣",
        method: "json",
        paths: {
            win: `%APPDATA%\\Claude\\claude_desktop_config.json`,
            mac: `~/Library/Application Support/Claude/claude_desktop_config.json`,
            linux: `~/.config/Claude/claude_desktop_config.json`,
        },
        config: configJSON,
    },
    {
        name: "Cursor IDE",
        icon: "🔵",
        method: "manual",
        steps: [
            `Settings → Features → MCP → + Add new MCP server`,
            `Type: ${BOLD}command${RESET}`,
            `Name: ${BOLD}memory${RESET}`,
            `Command: ${CYAN}node ${serverPath} --user-id=${userId}${RESET}`,
        ],
    },
    {
        name: "Windsurf / Codeium",
        icon: "🟢",
        method: "json",
        paths: {
            win: `%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json`,
            mac: `~/.codeium/windsurf/mcp_config.json`,
            linux: `~/.codeium/windsurf/mcp_config.json`,
        },
        config: configJSON,
    },
    {
        name: "VS Code (Copilot)",
        icon: "🔷",
        method: "json",
        paths: { all: `.vscode/mcp.json (in your project)` },
        config: vsCodeJSON,
    },
    {
        name: "Gemini CLI",
        icon: "🔶",
        method: "json",
        paths: {
            all: `~/.gemini/settings.json`,
        },
        config: configJSON,
    },
];

for (const client of clients) {
    console.log(`${client.icon} ${BOLD}${client.name}${RESET}`);
    console.log(`${"─".repeat(40)}`);

    if (client.method === "one-liner") {
        console.log(`  Just run this command:\n`);
        console.log(`  ${CYAN}${client.command}${RESET}\n`);
    }

    if (client.method === "json") {
        if (client.paths) {
            const pathEntries = Object.entries(client.paths);
            if (pathEntries.length === 1) {
                console.log(`  ${ARROW} Config file: ${DIM}${pathEntries[0][1]}${RESET}`);
            } else {
                for (const [os, p] of pathEntries) {
                    console.log(`  ${ARROW} ${os}: ${DIM}${p}${RESET}`);
                }
            }
        }
        console.log(`\n  ${DIM}Add this to your config file:${RESET}\n`);
        for (const line of client.config.split("\n")) {
            console.log(`  ${GREEN}${line}${RESET}`);
        }
        console.log();
    }

    if (client.method === "manual") {
        for (let i = 0; i < client.steps.length; i++) {
            console.log(`  ${i + 1}. ${client.steps[i]}`);
        }
        console.log();
    }
}

// ─── Dashboard ───────────────────────────────────────────
console.log(`${BOLD}${BLUE}═══ Web Dashboard ═══${RESET}\n`);
console.log(`  ${STAR} Live at: ${CYAN}${BOLD}https://mcp-memory-srv-prust.web.app${RESET}`);
console.log(`  ${DIM}View, search, and manage all your memories in the browser${RESET}\n`);

// ─── Done ────────────────────────────────────────────────
console.log(`${BOLD}${GREEN}Setup complete!${RESET} Add the config above to your preferred client, restart it, and you're good to go. 🧠\n`);
