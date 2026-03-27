import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getInitials,
	formatBytes,
	formatUptime,
	formatRelativeTime,
	formatRelativeTimeCompact,
} from "../format";

describe("getInitials", () => {
	it("returns initials from two-word name", () => {
		expect(getInitials("Daniel Miller")).toBe("DM");
	});

	it("returns single initial for single-word name", () => {
		expect(getInitials("Daniel")).toBe("D");
	});

	it("returns first two initials for three-word name", () => {
		expect(getInitials("Daniel James Miller")).toBe("DJ");
	});

	it("returns empty string for empty input", () => {
		expect(getInitials("")).toBe("");
	});

	it("uppercases the initials", () => {
		expect(getInitials("alice bob")).toBe("AB");
	});
});

describe("formatBytes", () => {
	it("returns '0 B' for 0 bytes", () => {
		expect(formatBytes(0)).toBe("0 B");
	});

	it("formats 1024 as '1.00 KB'", () => {
		expect(formatBytes(1024)).toBe("1.00 KB");
	});

	it("formats 1048576 as '1.00 MB'", () => {
		expect(formatBytes(1048576)).toBe("1.00 MB");
	});

	it("formats 1073741824 as '1.00 GB'", () => {
		expect(formatBytes(1073741824)).toBe("1.00 GB");
	});

	it("formats partial KB with two decimal places", () => {
		expect(formatBytes(1536)).toBe("1.50 KB");
	});
});

describe("formatUptime", () => {
	it("formats seconds-only as minutes", () => {
		expect(formatUptime(45)).toBe("0m");
	});

	it("formats exactly 60 seconds as '1m'", () => {
		expect(formatUptime(60)).toBe("1m");
	});

	it("formats less than an hour", () => {
		expect(formatUptime(3540)).toBe("59m");
	});

	it("formats exactly 1 hour", () => {
		expect(formatUptime(3600)).toBe("1h 0m");
	});

	it("formats hours and minutes", () => {
		expect(formatUptime(5400)).toBe("1h 30m");
	});

	it("formats 24 hours as days", () => {
		expect(formatUptime(86400)).toBe("1d 0h 0m");
	});

	it("formats days, hours, and minutes", () => {
		expect(formatUptime(90061)).toBe("1d 1h 1m");
	});
});

describe("formatRelativeTime", () => {
	const now = new Date("2024-03-15T12:00:00.000Z");

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 'just now' for < 1 minute ago", () => {
		const d = new Date(now.getTime() - 30_000);
		expect(formatRelativeTime(d)).toBe("just now");
	});

	it("returns '1 minute ago' for exactly 1 minute", () => {
		const d = new Date(now.getTime() - 60_000);
		expect(formatRelativeTime(d)).toBe("1 minute ago");
	});

	it("returns 'X minutes ago' for < 1 hour", () => {
		const d = new Date(now.getTime() - 5 * 60_000);
		expect(formatRelativeTime(d)).toBe("5 minutes ago");
	});

	it("returns '1 hour ago' for exactly 1 hour", () => {
		const d = new Date(now.getTime() - 3_600_000);
		expect(formatRelativeTime(d)).toBe("1 hour ago");
	});

	it("returns 'X hours ago' for plural hours", () => {
		const d = new Date(now.getTime() - 3 * 3_600_000);
		expect(formatRelativeTime(d)).toBe("3 hours ago");
	});

	it("returns 'yesterday' for 1 day ago", () => {
		const d = new Date(now.getTime() - 24 * 3_600_000);
		expect(formatRelativeTime(d)).toBe("yesterday");
	});

	it("returns 'X days ago' for 2-6 days", () => {
		const d = new Date(now.getTime() - 3 * 24 * 3_600_000);
		expect(formatRelativeTime(d)).toBe("3 days ago");
	});

	it("returns full date for >= 7 days ago", () => {
		const d = new Date(now.getTime() - 7 * 24 * 3_600_000);
		const result = formatRelativeTime(d);
		// Should be a locale date string, not a relative time
		expect(result).not.toMatch(/ago|yesterday|just now/);
		expect(result.length).toBeGreaterThan(0);
	});

	it("accepts a date string", () => {
		const result = formatRelativeTime(new Date(now.getTime() - 30_000).toISOString());
		expect(result).toBe("just now");
	});
});

describe("formatRelativeTimeCompact", () => {
	const now = new Date("2024-03-15T12:00:00.000Z");

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns 'just now' for < 1 minute ago", () => {
		const d = new Date(now.getTime() - 30_000);
		expect(formatRelativeTimeCompact(d)).toBe("just now");
	});

	it("returns 'Xm ago' for minutes", () => {
		const d = new Date(now.getTime() - 5 * 60_000);
		expect(formatRelativeTimeCompact(d)).toBe("5m ago");
	});

	it("returns 'Xh ago' for hours", () => {
		const d = new Date(now.getTime() - 3 * 3_600_000);
		expect(formatRelativeTimeCompact(d)).toBe("3h ago");
	});

	it("returns 'Xd ago' for days (< 7)", () => {
		const d = new Date(now.getTime() - 3 * 24 * 3_600_000);
		expect(formatRelativeTimeCompact(d)).toBe("3d ago");
	});

	it("returns locale date for >= 7 days", () => {
		const d = new Date(now.getTime() - 7 * 24 * 3_600_000);
		const result = formatRelativeTimeCompact(d);
		expect(result).not.toMatch(/ago|just now/);
		expect(result.length).toBeGreaterThan(0);
	});

	it("accepts a date string", () => {
		const result = formatRelativeTimeCompact(new Date(now.getTime() - 30_000).toISOString());
		expect(result).toBe("just now");
	});
});
