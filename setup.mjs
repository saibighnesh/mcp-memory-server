#!/usr/bin/env node

/**
 * MCP Memory Server — Interactive Setup Wizard
 * 
 * A foolproof, step-by-step guide to setting up the server, Firebase credentials,
 * the web dashboard, and the AI MCP configs.
 */

import { existsSync, writeFileSync } from "fs";
import { resolve } from "path";
import * as readline from "readline/promises";

const serverPath = resolve("dist/index.js").replace(/\\/g, "/");

// Colors and formatting
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

const CHECK = `${GREEN}✓${RESET}`;
const CROSS = `${RED}✗${RESET}`;
const ARROW = `${BLUE}→${RESET}`;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const args = process.argv.slice(2);
const isNonInteractive = args.includes("--non-interactive");

async function prompt(question, defaultValue = "") {
    if (isNonInteractive) return defaultValue;
    const answer = await rl.question(`${BOLD}${question}${RESET}${defaultValue ? ` ${DIM}(${defaultValue})${RESET}` : ''}\n> `);
    return answer.trim() || defaultValue;
}

async function promptMultiline(question) {
    if (isNonInteractive) return "";
    console.log(`${BOLD}${question}${RESET} ${DIM}(Paste your config, then type 'DONE' on a new line and press Enter)${RESET}\n`);

    let lines = [];
    for await (const line of rl) {
        if (line.trim().toUpperCase() === 'DONE') {
            break;
        }
        lines.push(line);
    }
    return lines.join('\n');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

console.log(`
${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗
║     ✨ MCP Memory Server — Interactive Setup ✨      ║
╚══════════════════════════════════════════════════════╝${RESET}

Welcome! This setup will walk you through getting your AI Memory Server 
running in 5 easy steps. You don't need any coding experience!
`);

async function main() {
    // Step 1: Firebase Project Setup
    console.log(`\n${BOLD}${CYAN}Step 1: Create a Free Database${RESET}`);
    console.log(`We use Google Firebase to securely store your memories for free.`);
    console.log(`1. Go to ${CYAN}https://console.firebase.google.com/${RESET}`);
    console.log(`2. Click ${BOLD}"Add project"${RESET} and give it a name.`);
    console.log(`3. Once created, click ${BOLD}"Firestore Database"${RESET} on the left and click ${BOLD}"Create database"${RESET}. Start in Test Mode for now.`);
    console.log(`4. Click ${BOLD}"Authentication"${RESET} on the left, click ${BOLD}"Get Started"${RESET}, choose ${BOLD}"Google"${RESET}, and enable it.`);

    await prompt("Press Enter when you have finished these steps.");

    // Step 2: Service Account Key (Backend)
    console.log(`\n${BOLD}${CYAN}Step 2: Get Your Secret Backend Key${RESET}`);
    console.log(`Now we need the secret key that allows this server to talk to your new database.`);
    console.log(`1. Still in the Firebase Console, click the ${BOLD}Gear Icon ⚙️${RESET} (top left) -> ${BOLD}"Project settings"${RESET}.`);
    console.log(`2. Click the ${BOLD}"Service accounts"${RESET} tab at the top.`);
    console.log(`3. Click the blue ${BOLD}"Generate new private key"${RESET} button at the bottom.`);
    console.log(`4. Save the downloaded file into THIS exact folder and rename it to exactly: ${BOLD}serviceAccountKey.json${RESET}`);

    let hasServiceKey = existsSync("serviceAccountKey.json");
    console.log(`\n${DIM}Waiting for serviceAccountKey.json to appear in the folder...${RESET}`);

    while (!hasServiceKey && !isNonInteractive) {
        await sleep(2000);
        hasServiceKey = existsSync("serviceAccountKey.json");
    }

    if (hasServiceKey) {
        console.log(`  ${CHECK} Woohoo! Found your ${BOLD}serviceAccountKey.json${RESET}!\n`);
    } else {
        console.log(`  ${YELLOW}Skipping serviceAccountKey.json check. The server will crash if run without it.${RESET}\n`);
    }


    // Step 3: Web Dashboard Config (Frontend)
    console.log(`\n${BOLD}${CYAN}Step 3: Connect the Web Dashboard${RESET}`);
    console.log(`We need to connect your visual dashboard to the database.`);
    console.log(`1. In the Firebase Console, go back to ${BOLD}Project settings${RESET} -> ${BOLD}General${RESET}.`);
    console.log(`2. Scroll down to ${BOLD}"Your apps"${RESET} and click the ${BOLD}</>${RESET} (Web) button.`);
    console.log(`3. Register the app with any name.`);
    console.log(`4. It will show you a block of code with a ${BOLD}firebaseConfig${RESET} object.`);

    const configBlock = await promptMultiline("Copy that ENTIRE firebaseConfig { ... } block and paste it below:");

    if (configBlock) {
        // Regex to extract the values from the pasted text
        const extract = (key) => {
            const match = configBlock.match(new RegExp(`${key}\\s*:\\s*['"\`](.*?)['"\`]`));
            return match ? match[1] : '';
        };

        const apiKey = extract('apiKey');
        const authDomain = extract('authDomain');
        const projectId = extract('projectId');
        const storageBucket = extract('storageBucket');
        const messagingSenderId = extract('messagingSenderId');
        const appId = extract('appId');

        if (apiKey && projectId) {
            const envLocalContent = `NEXT_PUBLIC_FIREBASE_API_KEY=${apiKey}
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${authDomain}
NEXT_PUBLIC_FIREBASE_PROJECT_ID=${projectId}
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=${storageBucket}
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=${messagingSenderId}
NEXT_PUBLIC_FIREBASE_APP_ID=${appId}
`;
            writeFileSync("dashboard/.env.local", envLocalContent);
            console.log(`  ${CHECK} Success! Your dashboard/.env.local file has been created automatically.\n`);
        } else {
            console.log(`  ${CROSS} Hmm, I couldn't find the config values in what you pasted. You may need to create dashboard/.env.local manually.\n`);
        }
    } else {
        console.log(`  ${DIM}Skipped dashboard configuration.${RESET}\n`);
    }


    // Step 4: Login and get UID
    console.log(`\n${BOLD}${CYAN}Step 4: Connect Your AI Identity${RESET}`);
    console.log(`Your server needs to know *who* you are, so your AI only saves memories to your private account.`);
    console.log(`1. Open a new terminal window in this folder and run: ${BOLD}cd dashboard && npm run dev${RESET}`);
    console.log(`   ${DIM}(If you get a 'next: command not found' error, run 'npm install' inside the dashboard folder first)${RESET}`);
    console.log(`2. Open ${CYAN}http://localhost:3000${RESET} in your browser and log in with Google.`);
    console.log(`3. In the Firebase Console, go to ${BOLD}Authentication${RESET} -> ${BOLD}Users${RESET}.`);
    console.log(`4. Find your email and copy the ${BOLD}User UID${RESET} (it looks like a long random string of letters/numbers).`);

    const userId = await prompt("Paste your Firebase User UID here:");

    if (userId) {
        console.log(`  ${CHECK} Identity saved! Your AI will now use UID: ${CYAN}${userId}${RESET}\n`);
    } else {
        console.log(`  ${CROSS} No UID provided. The AI may not be able to read/write memories.\n`);
    }


    // Step 5: Final Configs
    console.log(`\n${BOLD}${CYAN}Step 5: Final Setup & Connecting Claude/Cursor${RESET}`);

    // Build the server first
    const hasDist = existsSync("dist/index.js");
    if (!hasDist) {
        console.log(`  ${YELLOW}Building server behind the scenes...${RESET}`);
        const { execSync } = await import("child_process");
        try {
            execSync("npm run build", { stdio: "ignore" });
            console.log(`  ${CHECK} Server is built!\n`);
        } catch {
            console.log(`  ${CROSS} Build failed — run ${BOLD}npm run build${RESET} manually\n`);
        }
    }

    const mcpConfig = {
        mcpServers: {
            "memory": {
                command: "node",
                args: [serverPath, `--user-id=${userId || 'YOUR_UID_HERE'}`]
            }
        }
    };
    const configJSON = JSON.stringify(mcpConfig, null, 2);

    console.log(`You are all done! To connect your AI to your new memory server, copy this code block:\n`);

    for (const line of configJSON.split("\n")) {
        console.log(`    ${GREEN}${line}${RESET}`);
    }

    console.log(`\n${BOLD}Paste that into your MCP settings file!${RESET}`);
    console.log(`  - For Claude Desktop: ${CYAN}claude_desktop_config.json${RESET}`);
    console.log(`  - For Cursor IDE: Settings -> MCP -> Add new -> Command: ${CYAN}node ${serverPath} --user-id=${userId || 'YOUR_UID'}${RESET}`);

    console.log(`\n${BOLD}${GREEN}Setup Complete! Restart your AI client and say "Hello"!${RESET}`);

    rl.close();
}

main().catch(console.error);
