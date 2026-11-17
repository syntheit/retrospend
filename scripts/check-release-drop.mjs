#!/usr/bin/env node
// Proves the device engine's dev flag drops the worker from a build.
//
//   pnpm build                                  # NEXT_PUBLIC_DEV_DEVICE_ENGINE unset
//   node scripts/check-release-drop.mjs         # fails if either marker is found
//
//   NEXT_PUBLIC_DEV_DEVICE_ENGINE=1 pnpm build  # positive control
//   node scripts/check-release-drop.mjs --expect-present   # fails unless both are found
//                    # (the worker's marker must be in a .js under static/chunks:
//                    # the bundled worker, not the raw copy under static/media)
//
// The markers are one string only the worker holds (WORKER_TAG in
// src/lib/device-engine/worker.ts) and one only the engine core holds (TAG in
// packages/engine/src/device/engine.ts). It looks in .next/static,
// .next/server and the built output inside .next/standalone (its .next
// folder), never .next/cache or .next/dev (those keep older builds). The
// standalone folder also holds a copy of the repo's source files, which name
// the markers whatever the flag says, so they are not searched. Run it from
// the repo root, or pass the .next folder as the first argument. Not part of
// CI yet.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const MARKERS = ["RetrospendDeviceWorker", "RetrospendDeviceEngine"];
const args = process.argv.slice(2);
const expectPresent = args.includes("--expect-present");
const next = resolve(args.find((a) => !a.startsWith("--")) ?? ".next");

function* files(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) yield* files(path);
		else if (entry.isFile()) yield path;
	}
}

const found = new Map(MARKERS.map((m) => [m, []]));
let scanned = 0;
for (const part of ["static", "server", "standalone/.next"]) {
	const root = join(next, part);
	try {
		statSync(root);
	} catch {
		continue;
	}
	for (const file of files(root)) {
		if (/\/\.next\/(cache|dev)\//.test(file)) continue;
		// Assets are copied as they are, so a raw copy of the worker's source
		// would count as the bundled worker.
		if (expectPresent && file.includes("/static/media/")) continue;
		scanned += 1;
		const bytes = readFileSync(file);
		for (const marker of MARKERS)
			if (bytes.includes(marker)) found.get(marker).push(file);
	}
}

if (scanned === 0) {
	console.error(`FAIL: no build output under ${next} (run pnpm build first)`);
	process.exit(2);
}

let fail = false;
for (const [marker, all] of found) {
	const where =
		expectPresent && marker === MARKERS[0]
			? all.filter((file) => /\/static\/chunks\/.*\.js$/.test(file))
			: all;
	if (expectPresent && where.length === 0) {
		console.error(`FAIL: ${marker} is not in the flag-on build`);
		fail = true;
	} else if (!expectPresent && where.length > 0) {
		console.error(`FAIL: ${marker} is in the build:`);
		for (const file of where.slice(0, 5)) console.error(`  ${file}`);
		fail = true;
	}
}
if (!fail)
	console.log(
		expectPresent
			? `OK: both markers are in the flag-on build (${scanned} files)`
			: `OK: the worker and the engine are not in the build (${scanned} files)`,
	);
process.exit(fail ? 1 : 0);
