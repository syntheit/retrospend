// Log hygiene (AGENTS.md 6.4): no amounts, titles, notes, names or tokens in
// logs. Scans server, mobile, packages and sidecar code (see scan.ts for what
// counts). A new hit fails here with file:line. baseline.json holds the hits
// that were there when the check was added; it may only shrink. A fix only
// warns (run `pnpm exec tsx src/test/logHygiene/ratchet.ts` to lower it), so a
// merge never turns main red. Raising it fails against the merge base with
// main unless a commit on the branch says `log-hygiene-raise: <reason>`.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_METADATA_KEYS } from "~/server/services/api-v1/event-metadata-keys";
import {
	collectHits,
	countHits,
	type Git,
	loadBaseline,
	raiseGuard,
	raisedSince,
	REPO_ROOT,
	SINKS,
	sourceFiles,
} from "./repo";
import { metadataKeys, RULES, scanSource, sensitiveIn, words } from "./scan";

const ts = (src: string) => scanSource(src, "ts", EVENT_METADATA_KEYS);
const go = (src: string) => scanSource(src, "go", EVENT_METADATA_KEYS);
const rules = (hits: { rule: string }[]) => hits.map((h) => h.rule);

describe("log hygiene over the real source tree", () => {
	it("scans server, mobile, package and sidecar code", () => {
		const files = sourceFiles();
		expect(files.some((f) => f.startsWith("src/server/"))).toBe(true);
		expect(files.some((f) => f.startsWith("apps/mobile/src/"))).toBe(true);
		expect(
			files.some((f) => f.startsWith("sidecar/") && f.endsWith(".go")),
		).toBe(true);
		expect(files.some((f) => /\.test\.|_test\.go|__tests__/.test(f))).toBe(
			false,
		);
	});

	it("baseline.json and SINKS name real files", () => {
		for (const files of Object.values(loadBaseline()))
			for (const file of Object.keys(files))
				expect(existsSync(join(REPO_ROOT, file)), `baseline: ${file}`).toBe(
					true,
				);
		for (const [file, why] of Object.entries(SINKS)) {
			expect(existsSync(join(REPO_ROOT, file)), `SINKS: ${file}`).toBe(true);
			expect(why.length).toBeGreaterThan(20);
		}
		for (const rule of Object.keys(loadBaseline()))
			expect(RULES[rule], `baseline: unknown rule ${rule}`).toBeDefined();
	});

	it("stays at or below the baseline", () => {
		const hits = collectHits();
		const now = countHits(hits);
		const base = loadBaseline();
		const problems: string[] = [];
		const loose: string[] = [];
		for (const rule of [
			...new Set([...Object.keys(now), ...Object.keys(base)]),
		]) {
			const files = new Set([
				...Object.keys(now[rule] ?? {}),
				...Object.keys(base[rule] ?? {}),
			]);
			for (const file of [...files].sort()) {
				const n = now[rule]?.[file] ?? 0;
				const b = base[rule]?.[file] ?? 0;
				if (n > b) {
					const lines = hits
						.filter((h) => h.rule === rule && h.file === file)
						.map((h) => `    ${file}:${h.line}  [${h.why}]  ${h.match}`)
						.join("\n");
					problems.push(
						`${rule} ${file}: ${n} hits, baseline allows ${b}.\n${lines}\n    ${RULES[rule]}`,
					);
				} else if (n < b)
					loose.push(`${rule} ${file}: baseline ${b}, now ${n}`);
			}
		}
		if (loose.length)
			console.warn(
				`logHygiene: ${loose.length} counts are below the baseline; lower baseline.json:\n  ${loose.join("\n  ")}`,
			);
		expect(problems, `\n${problems.join("\n\n")}\n`).toEqual([]);
	}, 30_000);

	it("baseline.json is not raised since main without a log-hygiene-raise reason", () => {
		const g = raiseGuard();
		if ("skipped" in g) {
			console.warn(`logHygiene: skipped the check against main: ${g.skipped}`);
			return;
		}
		if (!g.reasons.length)
			expect(
				g.raised,
				`baseline.json is above the merge base with main (${g.base.slice(0, 9)}). Fix the code instead; if raising is right, add a commit line  log-hygiene-raise: <reason>`,
			).toEqual([]);
	});
});

describe("LOG-010: log calls", () => {
	it("fails on user text, amounts, names and tokens in a log", () => {
		const bad = [
			"console.error(`Failed to save ${expense.title}`, err);",
			'console.warn("bad note", entry.notes);',
			"console.error(`Failed to import wealth row ${row.name}:`, error);",
			"console.log(`Balance for ${project.name} is ${balance}`);",
			"console.error(`Charged ${amount} ${currency}`);",
			"console.info('sent', { token: pushToken });",
			"console.error(`Importer error: ${errorText}`);",
			"console.warn(`Invite for ${user.email}`);",
			"console.error('could not parse', buffer);",
			'logger.error("bad", { payload });',
			"console.error(\n\t`multi line ${\n\t\texpense.description\n\t}`,\n);",
			"console.error(`nested ${items.map((i) => i.title).join()}`);",
			"console.log(session.apiKey);",
			"console.error('fail', row);",
			"console.error(`Failed to parse importer response line: ${line}`, error);",
			"console.warn(`skipped ${item}`);",
			"ctx.logger.error(`bad ${expense.title}`);",
			"this.logger.warn(entry);",
			"console.error(await response.text());",
			"console.log(secretCode);",
			"console.log(apiToken.code);",
		];
		for (const src of bad) expect(rules(ts(src)), src).toEqual(["LOG-010"]);
	});

	it("passes ids, codes, counts, statuses and error objects", () => {
		const good = [
			"console.error(`Export ${row.id} could not be recorded`, error);",
			'console.error("[Notification Error] PERIOD_CLOSED:", err);',
			"console.warn(`webhook ${delivery.id} failed with ${status}`);",
			"this.logger.warn(`dropped ${rows.length} rows, last ${row.id}`);",
			"console.error(`importer answered ${response.status} ${response.statusText}`);",
			"console.error(error.code, err.code, `${e.code}`);",
			"console.error(`Imported ${expenses.length} of ${rows.length}`);",
			"console.error(`Queue error for user ${userId}:`, error);",
			"console.warn(`${error.name} while syncing project ${projectId}`);",
			"console.error(`${error.meta?.modelName} not found`);",
			// text inside a literal is not an identifier
			'console.error("the title and the amount are wrong");',
			"const title = expense.title; console.log(1);",
			"// console.error(expense.title)\nconsole.log(count);",
		];
		for (const src of good) expect(ts(src), src).toEqual([]);
	});

	it("does not mistake a definition or a lookalike for a call", () => {
		expect(
			ts("export async function logEvent(params: P) { params.metadata; }"),
		).toEqual([]);
		expect(ts("const mylog.error = 1; fooconsole.log(expense.title)")).toEqual(
			[],
		);
	});

	it("reports the line of the call", () => {
		const hits = ts("const a = 1;\n\nconsole.error(expense.title);\n");
		expect(hits.map((h) => h.line)).toEqual([3]);
		expect(hits[0]?.why).toBe("expense, title");
	});

	it("checks Go log calls the same way", () => {
		const bad = [
			'log.Printf("bad amount %q for %s", template.Amount, id)',
			'log.Printf("Processing file: %s", header.Filename)',
			'log.Printf("WARNING: %s", resp.Content)',
			'fmt.Println("token", apiToken)',
			'log.Fatalf("bad key %s", cfg.APIKey)',
			'log.Printf("parse %s", transaction.Description)',
			'slog.Info("saved", "title", t)',
			'slog.Warn("saved", "amount", a)',
		];
		for (const src of bad) expect(rules(go(src)), src).toEqual(["LOG-010"]);
		const good = [
			'log.Printf("sync failed: %v", err)',
			'log.Printf("Extracted %d transactions", len(transactions))',
			'log.Printf("Failed to remove old backup %s: %v", entry.Name(), err)',
			'log.Printf("skipping template %s", template.ID)',
			'log.Printf("the amount is bad, token missing")',
			'log.Println("Importer: available")',
			'log.Printf("row %d has too few columns", rowNum)',
			'slog.Info("saved", "count", n, "projectId", id)',
		];
		for (const src of good) expect(go(src), src).toEqual([]);
	});

	it("catches who a mail goes to and invite codes", () => {
		const bad = [
			"console.log(`[Email Skipped]: Would have sent \"${subject}\" to ${to}`);",
			"console.log(to);",
			"console.warn(`Invite code ${inviteCode} was already consumed`);",
			"console.warn(`sent to ${recipient}`);",
			"console.warn(recipients);",
		];
		for (const src of bad) expect(rules(ts(src)), src).toEqual(["LOG-010"]);
		const good = [
			'console.log("[Email Skipped]: SMTP not configured");',
			"console.warn(`An invite code was already consumed for user ${user.id}`);",
			"console.warn(`sent ${recipients.length} mails`);",
			"console.warn(`Invite ${invite.id} used`);",
			"console.warn(`went to ${total} items`);",
		];
		for (const src of good) expect(ts(src), src).toEqual([]);
	});

	it("catches a provider body, a reply or a text line in a Go error or log", () => {
		const bad = [
			'return fmt.Errorf("openrouter API failed with status %d: %s", resp.StatusCode, string(respBody))',
			'return fmt.Errorf("decode failed: %w (raw: %s)", err, string(respBody))',
			'return "", fmt.Errorf("ollama failed with status %d: %s", resp.StatusCode, string(bodyBytes))',
			'return fmt.Errorf("bad schema: %w (raw response: %s)", err, resp.Content)',
			'return fmt.Errorf("write row for %s: %w", tx.Title, err)',
			'log.Printf("[sanitizer]   - %s", truncate(s, 80))',
			'log.Printf("stripped %s", stripped[0])',
			'log.Printf("line: %s", line)',
			'log.Printf("text: %s", text)',
			'return errors.New("bad " + string(body))',
		];
		for (const src of bad) expect(rules(go(src)), src).toEqual(["LOG-010"]);
		const good = [
			'return fmt.Errorf("openrouter API failed with status %d (response body %d bytes)", resp.StatusCode, len(respBody))',
			'return fmt.Errorf("decode failed: %w (response body %d bytes)", err, len(respBody))',
			'return fmt.Errorf("bad schema: %w (reply %d bytes)", err, len(resp.Content))',
			'return fmt.Errorf("write row %d: %w", i+1, err)',
			'log.Printf("[sanitizer] Stripped %d lines from PDF text, kept %d", len(stripped), len(result))',
			'return fmt.Errorf("unexpected status code: %d", resp.StatusCode)',
			'return fmt.Errorf("%w: none set", ErrInvalidAgeRecipient)',
			'return errors.New("backup_publish_failed")',
		];
		for (const src of good) expect(go(src), src).toEqual([]);
	});

	it("splits identifiers into words", () => {
		expect(words("shadowProfileName")).toEqual(["shadow", "profile", "name"]);
		expect(words("user_email")).toEqual(["user", "email"]);
		expect(words("APIKey")).toEqual(["api", "key"]);
		expect(sensitiveIn("userId projectId statusCode count")).toEqual([]);
		expect(sensitiveIn("pushToken, noteText")).toEqual([
			"note",
			"text",
			"token",
		]);
	});
});

describe("LOG-020: event metadata", () => {
	it("passes ids, flags, counts and allowlisted keys", () => {
		const good = [
			'logEventAsync({ eventType: "X", metadata: { adminId, view: "users" } });',
			'await logEvent({ eventType: "X", userId, metadata: { sessionId: s.id } });',
			'logEventAsync({ eventType: "X", metadata: { "duration_ms": 3, status } });',
			'logEventAsync({ eventType: "SUCCESSFUL_LOGIN", userId });',
			"await db.eventLog.create({ data: { eventType: 'X', metadata: { fileType, fileSize: f.size } } });",
		];
		for (const src of good) expect(ts(src), src).toEqual([]);
	});

	it("fails on a key outside EVENT_METADATA_KEYS", () => {
		const bad: [string, string][] = [
			["logEventAsync({ metadata: { guestName: guest.name } });", "guestName"],
			[
				"logEvent({ metadata: { adminId, shadowProfileName: p.name } });",
				"shadowProfileName",
			],
			[
				"await db.eventLog.create({ data: { metadata: { fileName: file.name } } });",
				"fileName",
			],
			["logEventAsync({ metadata: { expenseTitle } });", "expenseTitle"],
			['logEventAsync({ metadata: { ["x" + y]: 1 } });', "..."],
		];
		for (const [src, why] of bad) {
			const hits = ts(src);
			expect(rules(hits), src).toEqual(["LOG-020"]);
			expect(hits[0]?.why).toBe(why);
		}
	});

	it("fails on metadata whose keys cannot be checked", () => {
		for (const src of [
			"logEventAsync({ metadata: { ...extra, adminId } });",
			"logEventAsync({ metadata: params.metadata });",
			"logEventAsync({ eventType: 'X', metadata });",
		])
			expect(rules(ts(src)), src).toEqual(["LOG-020"]);
	});

	it("reads quoted keys and ignores values", () => {
		expect(
			metadataKeys(
				"x({ metadata: { \"a-b\": 1, 'c': { nested: 1 }, d: f(a, b), e } })",
			),
		).toEqual(["a-b", "c", "d", "e"]);
	});
});

describe("the baseline guard", () => {
	it("raisedSince flags raised and added entries, not lowered or removed ones", () => {
		const base = { "LOG-010": { "src/a.ts": 3, "src/b.ts": 2 } };
		expect(raisedSince(base, base)).toEqual([]);
		expect(raisedSince(base, { "LOG-010": { "src/a.ts": 1 } })).toEqual([]);
		expect(
			raisedSince(base, { "LOG-010": { "src/a.ts": 4, "src/b.ts": 2 } }),
		).toEqual(["LOG-010 src/a.ts: raised 3 -> 4"]);
		expect(
			raisedSince(base, { ...base, "LOG-020": { "src/c.ts": 1 } }),
		).toEqual(["LOG-020 src/c.ts: added with 1"]);
	});

	it("raiseGuard compares with the merge base and reads log-hygiene-raise lines", () => {
		const fake =
			(was: string | undefined, log = ""): Git =>
			(args) => {
				if (args[0] === "rev-parse") return ".git";
				if (args[0] === "merge-base") return "abc123\n";
				if (args[0] === "show") return was;
				if (args[0] === "log") return log;
				return undefined;
			};
		const base = JSON.stringify({ "LOG-010": { "src/a.ts": 2 } });
		expect(raiseGuard(fake(base), { "LOG-010": { "src/a.ts": 2 } })).toEqual({
			base: "abc123",
			raised: [],
			reasons: [],
		});
		expect(
			raiseGuard(fake(base, "Fix\n\nlog-hygiene-raise: new rule\n"), {
				"LOG-010": { "src/a.ts": 3 },
			}),
		).toEqual({
			base: "abc123",
			raised: ["LOG-010 src/a.ts: raised 2 -> 3"],
			reasons: ["log-hygiene-raise: new rule"],
		});
		expect(raiseGuard(fake(undefined), {})).toHaveProperty("skipped");
		expect(raiseGuard(() => undefined, {})).toHaveProperty("skipped");
	});
});
