#!/usr/bin/env bash
# One Maestro run on the runner host (vista), from a synced checkout. Started
# by maestro.sh over ssh; not meant to be typed. The host is shared, so:
#   - everything comes from the flake shells (nix develop), nothing is installed;
#   - one slot per emulator (pool.sh): flock, emulator port 5554+2N, server port
#     3200+N, Postgres port 5440+N on tmpfs with fsync off;
#   - every process is started by this script (spawn), recorded by process group,
#     and stopped on exit and on a signal; nothing else is ever signalled;
#   - the emulator runs in a memory-capped systemd scope with a time limit.
#
# Environment (from maestro.sh): RUN_ID, TAGS or FLOWS (space separated, relative
# to apps/mobile/maestro), COLD_BOOT=1 to skip the snapshot, REBUILD=1 to ignore
# the build caches, MAESTRO_TIMEOUT seconds for the flows (default 1200).
set -uo pipefail

: "${RUN_ID:?}"
here=$(cd "$(dirname "$0")" && pwd)
home=$HOME/rs-runner
dir=$(pwd)
app=$dir/apps/mobile
out=$dir/maestro-results
mkdir -p "$out" "$home"
pgdir=
export RS_MAESTRO_RUN=$RUN_ID MAESTRO_CLI_NO_ANALYTICS=1
log() { printf '[maestro %s] %s\n' "$(date +%T)" "$*" | tee -a "$out/run.log" >&2; }
# shellcheck source=pool.sh
source "$here/pool.sh"

# --- Flake shells ---------------------------------------------------------
# A path: flake of just the files the shells read, so nix does not copy
# node_modules into the store. One directory per content hash, shared by runs.
flakekey=$(cat "$dir/flake.nix" "$dir/flake.lock" "$dir/pnpm-lock.yaml" | sha256sum | cut -c1-12)
flakedir=$home/flake-$flakekey
if [[ ! -f $flakedir/flake.nix ]]; then
	tmp=$flakedir.tmp.$$
	mkdir -p "$tmp"
	cp "$dir/flake.nix" "$dir/flake.lock" "$dir/pnpm-lock.yaml" "$tmp/"
	mv -T "$tmp" "$flakedir" 2>/dev/null || rm -rf "$tmp" # a run that started at the same time won
fi
# Closes the slot lock and the build lock: a child must never keep either held.
shell() { local name=$1; shift; nix develop "path:$flakedir#$name" -c "$@" 9>&- 8>&-; }
# A dead emulator makes adb wait forever; nothing here may hang the run's cleanup.
adbs() { timeout 60 nix develop "path:$flakedir#android-emu" -c adb -s "$serial" "$@" 9>&- 8>&-; }

# --- Timings -----------------------------------------------------------------
times=()
SECONDS=0
phase_start=0
current=
phase() { # name: close the previous phase, open this one
	if [[ -n $current ]]; then times+=("$current=$((SECONDS - phase_start))s"); fi
	current=$1
	phase_start=$SECONDS
	log "-- $1"
}

# --- Cleanup that cannot leak --------------------------------------------------
serial=
cleaned=0
cleanup() {
	((cleaned)) && return
	cleaned=1
	trap - EXIT INT TERM HUP
	log "cleaning up"
	if [[ -n $pgdir && -d $pgdir ]]; then
		[[ -n $serial ]] && timeout 10 nix develop "path:$flakedir#android-emu" -c adb -s "$serial" emu kill >/dev/null 2>&1
		cp "$pgdir/server-$slot.log" "$out/server.log" 2>/dev/null
		if stop_slot_processes "$pgdir"; then
			cp "$pgdir/pg.log" "$out/postgres.log" 2>/dev/null
			rm -rf "$pgdir"
		else
			mark_unusable "$slot" "postgres did not stop"
		fi
	fi
	release_slot
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

reap
# Run directories whose copy-back failed stay a day, then go.
find "$home" -maxdepth 1 -name 'mae-*' -mmin +1440 -exec rm -rf {} + 2>/dev/null

# --- Install and build (no emulator needed; caches keyed by content) ------------
hash_of() { # paths relative to $dir; node_modules, generated output, tests and scripts skipped
	(cd "$dir" && find "$@" -type f \
		-not -path '*/node_modules/*' -not -path 'apps/mobile/android/*' \
		-not -path 'apps/mobile/ios/*' -not -path 'apps/mobile/dist/*' \
		-not -path 'apps/mobile/.expo/*' -not -path 'apps/mobile/maestro/*' \
		-not -path 'apps/mobile/test/*' -not -path 'apps/mobile/scripts/*' \
		-not -name README.md -not -name '*.test.ts' -not -name '*.test.tsx' \
		-not -name '*.apk' -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16)
}

# Keys of the synced tree as it arrived. Taken before install and build: those
# write files into the tree, and a key that moved with them never hit the cache.
serverkey=$(hash_of src prisma public packages scripts patches next.config.js package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json postcss.config.js prisma.config.ts)
apkkey=$({ hash_of apps/mobile packages pnpm-lock.yaml package.json; sha256sum <"$here/build-apk.sh"; } | sha256sum | cut -c1-16)

phase install
# Prisma's config and the Next build want these set; the server run overrides them.
cat >"$dir/.env" <<'ENV'
AUTH_SECRET="maestro-build-dummy-secret-0123456789abcdef"
PUBLIC_URL="http://localhost:3101"
DATABASE_URL="postgresql://dummy:dummy@localhost:5999/dummy"
SIDECAR_URL="http://localhost:8080"
WORKER_API_KEY="maestro-build-dummy-key"
ENV
(cd "$dir" && shell default bash -c 'pnpm install --frozen-lockfile --prefer-offline >.install.log 2>&1 && pnpm prisma generate >>.install.log 2>&1') \
	|| { tail -30 "$dir/.install.log" >&2; log "FAIL install"; exit 3; }

# One Gradle or Next build at a time on the host, and none while two emulators
# run. The cache is checked again once the lock is ours: the run ahead of us
# may have built the very thing we need.
build_lock() {
	exec 8>>"$home/.build.lock"
	flock -w 3600 8 || { log "FAIL build lock not free in an hour"; exit 6; }
	# A Gradle build loads vista to 100+ and slows the flows of a run in progress
	# enough to fail them. Wait for an idle pool (never while both slots are
	# busy), at most 10 minutes; after that build anyway, at low priority.
	local waited=$SECONDS
	while (($(busy_slots) >= 2 || ($(busy_slots) >= 1 && SECONDS - waited < 600))); do
		log "waiting: $(busy_slots) emulator slot(s) busy"
		sleep 20
	done
}
build_unlock() { exec 8>&-; }

servercache=$home/server-cache/$serverkey.tar
phase server-build
if [[ ${REBUILD:-0} != 1 && -f $servercache ]]; then
	log "server build cached ($serverkey)"
else
	build_lock
	if [[ ${REBUILD:-0} != 1 && -f $servercache ]]; then
		log "server build cached ($serverkey), built by the run ahead"
	else
		(cd "$dir" && NODE_OPTIONS=--max-old-space-size=4096 nice -n 10 nix develop "path:$flakedir#default" -c pnpm build 9>&- 8>&- >.build.log 2>&1) \
			|| { tail -40 "$dir/.build.log" >&2; log "FAIL server build"; exit 4; }
		mkdir -p "$home/server-cache"
		tar -C "$dir" -cf "$servercache.part.$$" .next && mv "$servercache.part.$$" "$servercache"
	fi
	build_unlock
fi
[[ -d $dir/.next ]] || tar -C "$dir" -xf "$servercache"

apk=$home/apk-cache/$apkkey.apk
phase apk-build
if [[ ${REBUILD:-0} != 1 && -f $apk ]]; then
	log "APK cached ($apkkey)"
else
	build_lock
	if [[ ${REBUILD:-0} != 1 && -f $apk ]]; then
		log "APK cached ($apkkey), built by the run ahead"
	else
		nice -n 10 nix develop "path:$flakedir#android" -c bash "$app/maestro/ops/build-apk.sh" "$out/app.apk" 9>&- 8>&- >"$out/apk-build.log" 2>&1 \
			|| { tail -40 "$out/apk-build.log" >&2; log "FAIL APK build"; exit 5; }
		mkdir -p "$home/apk-cache"
		cp "$out/app.apk" "$apk.part.$$" && mv "$apk.part.$$" "$apk"
		rm -f "$out/app.apk"
	fi
	build_unlock
fi

# --- Slot ---------------------------------------------------------------------
phase wait-slot
take_slot "$RUN_ID" 900 || { log "FAIL no free slot in 15 minutes: $(describe_holders)"; exit 6; }
log "slot $slot ($(describe_holders))"
mem_deadline=$((SECONDS + 600))
while (($(free -g | awk '/^Mem:/{print $7}') < 10)); do
	((SECONDS < mem_deadline)) || { log "FAIL under 10 GB of memory available for 10 minutes"; exit 6; }
	log "waiting: under 10 GB of memory available"
	sleep 20
done

port=$((5554 + 2 * slot))
serial=emulator-$port
serverport=$((3200 + slot))
pgport=$((5440 + slot))
pgdir=$(slot_dir "$slot")
export RS_MAESTRO_SLOT=$slot
export MAESTRO_PG=postgresql://postgres@127.0.0.1:$pgport MAESTRO_STATE=$pgdir
rm -rf "$pgdir"
mkdir -p "$pgdir"
echo "$RUN_ID" >"$pgdir/owner"

# --- Emulator (boots while the server comes up) ------------------------------------
phase server-up
avd=$home/avd-current
[[ -d $avd ]] || avd=$home/avd-base
[[ -d $avd/avd/retrospend_phone.avd/snapshots/clean ]] || { log "FAIL no AVD base: maestro.sh --avd-base"; exit 10; }
boot_flags=(-snapshot clean)
[[ ${COLD_BOOT:-0} == 1 ]] && boot_flags=(-no-snapshot-load)
boot_start=$SECONDS
cd "$dir" || exit 2
spawn emulator env ANDROID_AVD_HOME="$avd/avd" ANDROID_USER_HOME="$avd/user" ANDROID_EMULATOR_HOME="$avd/user" \
	systemd-run --user --scope --quiet -p MemoryMax=9G -p RuntimeMaxSec=1800 \
	nix develop "path:$flakedir#android-emu" -c \
	emulator -avd retrospend_phone -read-only "${boot_flags[@]}" -no-snapshot-save \
	-no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -memory 3072 -cores 2 \
	-no-metrics -port "$port" >"$out/emulator.log" 2>&1

# --- Postgres, seed, server -----------------------------------------------------
shell default bash -c "
	initdb -D '$pgdir/data' -U postgres --auth=trust -E UTF8 --locale=C >'$pgdir/initdb.log' &&
	pg_ctl -D '$pgdir/data' -l '$pgdir/pg.log' -w \
		-o '-p $pgport -k $pgdir -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off' start >/dev/null
" || { cat "$pgdir/initdb.log" "$pgdir/pg.log" >&2; log "FAIL postgres"; exit 7; }
(cd "$dir" && shell default bash apps/mobile/maestro/server.sh template) \
	|| { log "FAIL seed"; exit 8; }
(cd "$dir" && shell default bash apps/mobile/maestro/server.sh up "$slot" >"$out/server-url.txt") \
	|| { tail -20 "$pgdir/server-$slot.log" >&2; log "FAIL server"; exit 9; }
# The flake shell prints a banner first; the URL is the last line.
tail -n 1 "$out/server-url.txt" >"$out/server-url.txt.1" && mv "$out/server-url.txt.1" "$out/server-url.txt"
log "server $(cat "$out/server-url.txt")"

phase emulator-boot
shell android-emu bash -c "
	timeout 240 adb -s $serial wait-for-device || exit 1
	for _ in \$(seq 1 120); do
		[ \"\$(adb -s $serial shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')\" = 1 ] && exit 0
		sleep 2
	done
	exit 1
" || { tail -30 "$out/emulator.log" >&2; log "FAIL emulator did not boot in 4 minutes"; exit 11; }
if grep -q "Successfully loaded snapshot" "$out/emulator.log"; then boot=snapshot; else boot=cold; fi
log "emulator up ($boot boot, $((SECONDS - boot_start)) s from start)"
adbs shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1

phase install-app
adbs install -r -t -g "$apk" >"$out/install.log" 2>&1 || { cat "$out/install.log" >&2; log "FAIL install apk"; exit 12; }

# --- Maestro ---------------------------------------------------------------------
phase maestro
args=(--device "$serial" test -e "SERVER=http://10.0.2.2:$serverport"
	--format junit --output "$out/junit.xml" --debug-output "$out/debug" --flatten-debug-output)
[[ -n ${TAGS:-} ]] && args+=(--include-tags "$TAGS")
if [[ -n ${FLOWS:-} ]]; then
	# shellcheck disable=SC2086
	for f in $FLOWS; do args+=("$app/maestro/$f"); done
else
	args+=("$app/maestro")
fi
spawn maestro timeout -k 15 "${MAESTRO_TIMEOUT:-1200}" nix develop "path:$flakedir#android-emu" -c maestro "${args[@]}" \
	>"$out/maestro.log" 2>&1
wait "$spawned"
rc=$?
adbs logcat -d 2>/dev/null | tail -300 >"$out/logcat-tail.txt"

phase done
echo "$boot" >"$out/boot.txt"
{
	echo "run=$RUN_ID slot=$slot boot=$boot exit=$rc"
	echo "times: ${times[*]} total=${SECONDS}s"
	grep -E '^\[(Passed|Failed)\]|Flows? (passed|failed)|[0-9]+/[0-9]+ Flow' "$out/maestro.log" | tail -20
} | tee "$out/summary.txt" >&2
exit "$rc"
