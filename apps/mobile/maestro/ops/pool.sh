#!/usr/bin/env bash
# The emulator pool of the Maestro runner on vista (docs/roadmap/maestro-plan.md
# 1.3). Sourced by run.sh; not run by itself.
#
# Two slots, 0 and 1. Slot N owns, and nothing else touches:
#   ~/rs-runner/pool/slot-N.lock   flock, held on fd 9 by the run that has the slot
#   ~/rs-runner/pool/slot-N.holder who has it (run id, since when), for the wait message
#   /dev/shm/rs-maestro-N/         Postgres data, server state, pidfiles (tmpfs)
#   emulator port 5554+2N, server port 3200+N, Postgres port 5440+N
# Only the read-only AVD base is shared between slots.
#
# The lock is a plain fd held by the run's shell, so it goes when that shell
# does, even on SIGKILL. Children are started with `9>&-` so a leaked child
# can never keep a slot locked (the 2026-11-08 orphan emulator did exactly that
# with the first version of this pool).
# shellcheck shell=bash

pool_home=$HOME/rs-runner
pool_dir=$pool_home/pool
pool_slots=(0 1)
mkdir -p "$pool_dir"

slot_dir() { echo "/dev/shm/rs-maestro-$1"; }

# Spawn <name> <cmd...>: start a command in its own process group, record the
# group id in the slot's pidfile directory, and leave its pid in $spawned.
# Everything a run starts goes through here, so teardown stops exactly these.
spawned=
spawn() {
	local name=$1
	shift
	setsid "$@" 9>&- 8>&- &
	spawned=$!
	mkdir -p "$pgdir/pids"
	echo "$RS_MAESTRO_RUN" >"$pgdir/owner"
	echo "$spawned" >"$pgdir/pids/$name.pid"
	# The group exists only once the child has run setsid. A kill_group that
	# came before then finds no group, returns, and leaves the child running
	# for good, which a starved host makes likely. Wait for the group (bounded,
	# and not past the child's own exit).
	local i
	for i in $(seq 1 1000); do
		kill -0 -- "-$spawned" 2>/dev/null && return 0
		kill -0 "$spawned" 2>/dev/null || return 0
		sleep 0.01
	done
}

# kill_group <pgid> <run id>: TERM, wait up to 10 s, then KILL. Only ever
# called with an id recorded under a slot directory, and only acts when the
# group leader carries that slot's run id (an id reused by something else
# after a reboot does not, and is left alone).
kill_group() {
	local pgid=$1 owner=${2:-} i
	kill -0 -- "-$pgid" 2>/dev/null || return 0
	[[ -n $owner ]] || return 0
	if [[ -r /proc/$pgid/environ ]] && ! tr '\0' '\n' <"/proc/$pgid/environ" | grep -qxF "RS_MAESTRO_RUN=$owner"; then
		return 0
	fi
	kill -TERM -- "-$pgid" 2>/dev/null
	for i in $(seq 1 20); do
		kill -0 -- "-$pgid" 2>/dev/null || return 0
		sleep 0.5
	done
	kill -KILL -- "-$pgid" 2>/dev/null
	return 0
}

# postgres_alive <slot dir>: the postmaster of that data directory is running.
# The command line must name this directory, so a reused pid never matches.
postgres_alive() {
	local pm
	[[ -f $1/data/postmaster.pid ]] || return 1
	pm=$(head -1 "$1/data/postmaster.pid")
	[[ $pm =~ ^[0-9]+$ ]] || return 1
	tr '\0' ' ' <"/proc/$pm/cmdline" 2>/dev/null | grep -qF -- "-D $1/data"
}

# stop_slot_processes <dir>: stop what is recorded under a slot directory
# (maestro, emulator, server), then Postgres. Returns 1 when Postgres is
# still up afterwards: the caller must then leave the directory alone.
stop_slot_processes() {
	local d=$1 f owner pm
	owner=$(cat "$d/owner" 2>/dev/null)
	# server.sh records its own server group as server-<slot>.pid.
	for f in "$d/pids/maestro.pid" "$d/pids/emulator.pid" "$d"/server-*.pid; do
		[[ -f $f ]] && kill_group "$(cat "$f")" "$owner"
	done
	if postgres_alive "$d"; then
		pm=$(head -1 "$d/data/postmaster.pid")
		kill -INT "$pm" 2>/dev/null
		for _ in $(seq 1 "${POOL_PG_STOP_TRIES:-40}"); do
			postgres_alive "$d" || return 0
			sleep 0.5
		done
		return 1
	fi
	return 0
}

# mark_unusable <slot> <why>: a slot whose Postgres would not stop keeps its
# directory (deleting a live database's files is worse) and is skipped until
# a later run's reaper manages to clean it, or someone removes the marker.
mark_unusable() {
	echo "$2" >"$pool_dir/slot-$1.unusable"
	log "slot $1 is unusable: $2. Clean it by hand: stop the postgres on $(slot_dir "$1")/data, then rm $pool_dir/slot-$1.unusable"
}

# take_slot <run id> <seconds>: take the first free slot, waiting up to the
# limit. Sets $slot, holds its lock on fd 9.
slot=
take_slot() {
	local run=$1 limit=$2 n logged deadline=$((SECONDS + $2))
	while :; do
		for n in "${pool_slots[@]}"; do
			[[ -e $pool_dir/slot-$n.unusable ]] && continue
			exec 9>>"$pool_dir/slot-$n.lock"
			if flock -n 9; then
				slot=$n
				echo "$run since $(date +%T) pid $$" >"$pool_dir/slot-$n.holder"
				return 0
			fi
			exec 9>&-
		done
		((SECONDS < deadline)) || return 1
		if ((SECONDS - ${logged:--60} >= 60)); then
			log "waiting for a slot; held by: $(describe_holders)"
			logged=$SECONDS
		fi
		sleep "${POOL_POLL:-10}"
	done
}

# busy_slots: how many slots have a live run. Probing takes a lock for a
# moment, which a run taking that slot just then survives: it tries again.
busy_slots() {
	local n count=0
	for n in "${pool_slots[@]}"; do
		if ! (exec 7>>"$pool_dir/slot-$n.lock" && flock -n 7); then count=$((count + 1)); fi
	done
	echo "$count"
}

release_slot() {
	[[ -n $slot ]] || return 0
	rm -f "$pool_dir/slot-$slot.holder"
	exec 9>&-
	slot=
}

describe_holders() {
	local n out=
	for n in "${pool_slots[@]}"; do
		if [[ -e $pool_dir/slot-$n.unusable ]]; then
			out+="slot $n: UNUSABLE ($(cat "$pool_dir/slot-$n.unusable"))  "
		else
			out+="slot $n: $(cat "$pool_dir/slot-$n.holder" 2>/dev/null || echo free)  "
		fi
	done
	echo "$out"
}

# reap: clean up after runs that died without their cleanup (SIGKILL, power).
# A slot whose lock is free has no live owner, so whatever sits in its
# directory is a leftover. The lock is held while cleaning, so a run that
# wants the slot waits a moment instead of racing the reaper.
reap() {
	local n d
	for n in "${pool_slots[@]}"; do
		exec 9>>"$pool_dir/slot-$n.lock"
		if flock -n 9; then
			d=$(slot_dir "$n")
			if [[ -d $d ]]; then
				log "reaping leftovers of slot $n"
				if stop_slot_processes "$d"; then
					rm -rf "$d" "$pool_dir/slot-$n.unusable"
				else
					mark_unusable "$n" "postgres did not stop"
				fi
			else
				rm -f "$pool_dir/slot-$n.unusable"
			fi
			rm -f "$pool_dir/slot-$n.holder"
		fi
		exec 9>&-
	done
}
