/**
 * Unit tests for the structured logger.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";

describe("Logger", () => {
    let originalEnv: NodeJS.ProcessEnv;
    let consoleErrorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
        originalEnv = process.env;
        consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        jest.resetModules();
    });

    afterEach(() => {
        process.env = originalEnv;
        consoleErrorSpy.mockRestore();
    });

    it("should log info by default", async () => {
        delete process.env.LOG_LEVEL;
        const { logger } = await import("../src/logger.js");
        
        logger.info("Test info message");
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[INFO] Test info message"));
        
        logger.debug("Test debug message");
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("[DEBUG] Test debug message"));
    });

    it("should respect LOG_LEVEL=debug", async () => {
        process.env.LOG_LEVEL = "debug";
        const { logger } = await import("../src/logger.js");
        
        logger.debug("Test debug message");
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[DEBUG] Test debug message"));
    });

    it("should log warnings and errors", async () => {
        process.env.LOG_LEVEL = "warn";
        const { logger } = await import("../src/logger.js");
        
        logger.info("Should not log");
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("[INFO]"));

        logger.warn("Test warn message", { detail: 123 });
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[WARN] Test warn message"));
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('{"detail":123}'));

        logger.error("Test error message");
        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[ERROR] Test error message"));
    });
});
