/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
    testEnvironment: "node",
    extensionsToTreatAsEsm: [".ts"],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    transform: {
        "^.+\\.tsx?$": [
            "ts-jest",
            {
                useESM: true,
                // Disable TS diagnostics in tests — source files remain
                // fully type-checked by `npx tsc --noEmit` / `npm run build`.
                diagnostics: false,
            },
        ],
    },
    testMatch: ["**/tests/**/*.test.ts"],
};
