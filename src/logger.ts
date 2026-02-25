/**
 * Structured logger for OmniBrain MCP.
 *
 * All output goes to stderr — MCP reserves stdout for JSON-RPC transport.
 * Set LOG_LEVEL env var to: debug | info | warn | error (default: info).
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LEVELS;

const currentLevel: LogLevel = (() => {
    const env = (process.env.LOG_LEVEL ?? "info").toLowerCase();
    return env in LEVELS ? (env as LogLevel) : "info";
})();

function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, meta?: unknown): string {
    const ts = new Date().toISOString();
    const tag = `[MCP Memory] [${level.toUpperCase()}]`;
    const base = `${ts} ${tag} ${message}`;
    return meta !== undefined ? `${base} ${JSON.stringify(meta)}` : base;
}

export const logger = {
    debug(message: string, meta?: unknown): void {
        if (shouldLog("debug")) console.error(formatMessage("debug", message, meta));
    },
    info(message: string, meta?: unknown): void {
        if (shouldLog("info")) console.error(formatMessage("info", message, meta));
    },
    warn(message: string, meta?: unknown): void {
        if (shouldLog("warn")) console.error(formatMessage("warn", message, meta));
    },
    error(message: string, meta?: unknown): void {
        if (shouldLog("error")) console.error(formatMessage("error", message, meta));
    },
};
