#!/usr/bin/env bash
# Builds the read-only emulator image every Maestro run boots from
# (docs/roadmap/maestro-plan.md 1.1): the Pixel 8 class AVD of
# scripts/android-emulator.sh, API 36 google_apis x86_64, animations off, and
# one quick-boot snapshot called `clean` taken right after boot, before the
# app is installed. Runs on the runner host inside the flake's android-emu
# shell (`maestro.sh --avd-base` does that).
#
# Rebuild it whenever the emulator version in the flake changes (a stale
# snapshot only costs a cold boot, never a false pass). It never touches the
# image runs boot from: it writes a new directory ~/rs-runner/avd-<stamp>,
# and only when the build worked it points the avd-current symlink at it.
# Runs already booted keep their files; the next run uses the new image. The
# old directory stays (about 7 GB): delete it by hand once no run needs it.
#
#   nix develop .#android-emu -c bash apps/mobile/maestro/ops/avd-base.sh
#
# AVD_ROOT  build here instead, and do not repoint avd-current (a trial build)
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
home=$HOME/rs-runner
mkdir -p "$home"
# Two builds would fight over the emulator port and the avd-current link.
exec 6>>"$home/avd-base.lock"
flock -n 6 || { echo "another --avd-base is running" >&2; exit 1; }
flip=0
if [[ -z ${AVD_ROOT:-} ]]; then
	AVD_ROOT=$home/avd-$(date +%Y%m%d-%H%M%S)
	flip=1
fi
export AVD_ROOT
emu=$here/../../scripts/android-emulator.sh
port=5598
serial=emulator-$port
export ANDROID_AVD_HOME=$AVD_ROOT/avd ANDROID_USER_HOME=$AVD_ROOT/user
export ANDROID_EMULATOR_HOME=$ANDROID_USER_HOME
name=retrospend_phone
mkdir -p "$AVD_ROOT"
log=$AVD_ROOT/avd-base.log

bash "$emu" create
pid=
cleanup() {
	adb -s "$serial" emu kill >/dev/null 2>&1 || true
	[[ -n $pid ]] && kill -TERM "$pid" 2>/dev/null || true
}
trap cleanup EXIT

# A cold boot that is allowed to write a snapshot: no -read-only, no -no-snapshot-save.
emulator -avd "$name" -no-window -no-audio -no-boot-anim -no-snapshot-load \
	-gpu swiftshader_indirect -memory 3072 -cores 2 -no-metrics -port "$port" \
	6>&- >"$log" 2>&1 &
pid=$!

timeout 240 adb -s "$serial" wait-for-device || { echo "the emulator did not appear in 4 minutes; see $log" >&2; exit 1; }
deadline=$((SECONDS + 300))
until [[ $(timeout 20 adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r') == 1 ]]; do
	((SECONDS < deadline)) || { echo "the emulator did not finish booting in 5 minutes; see $log" >&2; exit 1; }
	sleep 3
done

# Zero transition scales read as reduce motion, which the app honors (opacity
# only). The soft keyboard stays up with no hardware keyboard.
for key in window_animation_scale transition_animation_scale animator_duration_scale; do
	adb -s "$serial" shell settings put global "$key" 0
done
adb -s "$serial" shell settings put secure show_ime_with_hard_keyboard 0
adb -s "$serial" shell settings put global stay_on_while_plugged_in 7
# A busy host makes System UI miss its deadline; the dialog would cover the app.
adb -s "$serial" shell settings put global hide_error_dialogs 1
# Let the home screen settle, then save the state every run starts from.
sleep 20
adb -s "$serial" emu avd snapshot save clean
adb -s "$serial" emu kill
wait "$pid" 2>/dev/null || true
pid=
[[ -d $ANDROID_AVD_HOME/$name.avd/snapshots/clean ]] || { echo "no snapshot was saved" >&2; exit 1; }
if ((flip)); then
	ln -sfn "$AVD_ROOT" "$home/avd-current.new"
	mv -T "$home/avd-current.new" "$home/avd-current"
fi
echo "AVD base ready: $AVD_ROOT (snapshot clean)"
