#!/usr/bin/env bash
# Runs the mobile Maestro flows on vista's Android emulator pool
# (docs/roadmap/maestro-plan.md 1.3). Run it from a worktree on harbor:
#
#   bash apps/mobile/maestro/ops/maestro.sh --tags smoke
#   bash apps/mobile/maestro/ops/maestro.sh --flows flows/sign-in.yaml,flows/edit-expense.yaml
#   bash apps/mobile/maestro/ops/maestro.sh --tags smoke --cold-boot --rebuild
#   bash apps/mobile/maestro/ops/maestro.sh --status
#   bash apps/mobile/maestro/ops/maestro.sh --avd-base
#
#   --tags <t>      run the flows with this tag (smoke, full)
#   --flows <a,b>   or these flows, relative to apps/mobile/maestro
#   --cold-boot     boot the emulator without its snapshot
#   --rebuild       ignore the APK and server build caches
#   --status        who holds the two slots, and the emulators on vista
#   --avd-base      rebuild the emulator image and its snapshot (about 3 minutes)
#
# It syncs the worktree to ~/rs-runner/mae-<run> on vista and runs ops/run.sh
# there. Two runs at once are fine: each takes one of the two slots (ops/pool.sh)
# and a third waits up to 15 minutes. Ctrl-C or a dropped ssh stops that run's
# emulator, server and database and nothing else. Caches on vista (APK and
# server build keyed by content, pnpm store, AVD image) are only ever added to.
#
# Results come back to docs/ui-overhaul/impl/shots/maestro/<worktree>/<run>/
# (MAESTRO_RESULTS overrides the base): junit.xml, summary.txt (verdict, flow
# results, timings per phase), maestro.log, Maestro's debug output with a
# screenshot at every failed step, logcat tail, server and emulator logs.
# Read the verdict line and the failing step, not the folder. Exit code 0 is a
# pass. The emulator renders in software, so screenshots of motion are not
# representative.
set -uo pipefail

tags=
flows=
cold=0
rebuild=0
avd_base=0
status=0
while (($#)); do
	case $1 in
	--tags) tags=${2:?}; shift 2 ;;
	--flows) flows=${2:?}; shift 2 ;;
	--cold-boot) cold=1; shift ;;
	--rebuild) rebuild=1; shift ;;
	--avd-base) avd_base=1; shift ;;
	--status) status=1; shift ;;
	*) sed -n '2,12p' "$0"; exit 2 ;;
	esac
done

# One ssh connection per call, never a shared master: when a master dies every
# session on it dies with it, and two runs at once would take each other down.
# Keepalives end a run whose network went away (its cleanup then runs on vista).
ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=no -o ControlPath=none
	-o ServerAliveInterval=15 -o ServerAliveCountMax=8)
rsync_ssh="ssh ${ssh_opts[*]}"
on_vista() { ssh "${ssh_opts[@]}" vista "$@" </dev/null; }
on_vista true 2>/dev/null || { echo "maestro: vista is not reachable" >&2; exit 2; }

if ((status)); then
	ssh "${ssh_opts[@]}" vista bash -s <<'REMOTE'
mkdir -p ~/rs-runner/pool
for n in 0 1; do
	exec 9>>"$HOME/rs-runner/pool/slot-$n.lock"
	if flock -n 9; then echo "slot $n: free"; else echo "slot $n: busy, $(cat "$HOME/rs-runner/pool/slot-$n.holder" 2>/dev/null)"; fi
	exec 9>&-
done
echo "emulators on the host: $(pgrep -fc 'qemu-system-x86_64-headless -avd' || true)"
if [ -e ~/rs-runner/avd-current ]; then echo "image: $(readlink -f ~/rs-runner/avd-current)"; else echo "image: ~/rs-runner/avd-base"; fi
REMOTE
	exit 0
fi

[[ -n $tags || -n $flows || $avd_base == 1 ]] || { echo "give --tags or --flows" >&2; exit 2; }

src=$(git rev-parse --show-toplevel) || exit 2
name=$(basename "$src")
run_id=$name-$(date +%m%d-%H%M%S)-$RANDOM
dir=rs-runner/mae-$run_id
results=${MAESTRO_RESULTS:-/home/matv/Projects/retrospend/docs/ui-overhaul/impl/shots/maestro}/$name/$run_id
started=$SECONDS

on_vista "mkdir -p $dir" || exit 2
remote_cleanup() { on_vista "rm -rf $dir" >/dev/null 2>&1; }

if ((avd_base)); then
	(cd "$src" && rsync -e "$rsync_ssh" -aR flake.nix flake.lock pnpm-lock.yaml apps/mobile/scripts/android-emulator.sh \
		apps/mobile/maestro/ops/avd-base.sh "vista:$dir/") || exit 2
	ssh -tt "${ssh_opts[@]}" vista "cd $dir && nix develop path:\$PWD#android-emu -c bash apps/mobile/maestro/ops/avd-base.sh" </dev/null
	rc=$?
	remote_cleanup
	exit "$rc"
fi

rsync -e "$rsync_ssh" -a --delete \
	--exclude node_modules --exclude .next --exclude generated --exclude .git \
	--exclude '.env*' --exclude tsconfig.tsbuildinfo --exclude 'public/images/flags' \
	--exclude 'public/images/crypto' --exclude apps/mobile/android --exclude apps/mobile/ios \
	--exclude apps/mobile/dist --exclude .claude --exclude docs/ui-overhaul \
	--exclude maestro-results \
	"$src/" "vista:$dir/" || exit 2

# A pty, so that a dropped ssh hangs up the remote run and its cleanup runs.
ssh -tt "${ssh_opts[@]}" vista "cd $dir && RUN_ID=$run_id TAGS='$tags' FLOWS='${flows//,/ }' COLD_BOOT=$cold REBUILD=$rebuild bash apps/mobile/maestro/ops/run.sh" </dev/null
rc=$?

mkdir -p "$results"
if rsync -e "$rsync_ssh" -a "vista:$dir/maestro-results/" "$results/" 2>/dev/null; then
	remote_cleanup
else
	echo "maestro: copy-back failed; results stay on vista in ~/$dir (run.sh removes run directories after a day)" >&2
fi
echo "maestro: results in $results" >&2
echo "maestro: wall time $((SECONDS - started)) s including sync and copy-back" >&2
if ((rc == 0)); then echo "MAESTRO PASS"; else echo "MAESTRO FAIL (exit $rc)"; fi
exit "$rc"
