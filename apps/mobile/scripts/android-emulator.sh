#!/usr/bin/env bash
# Headless Android emulator for screenshot audits. Run inside the flake's
# android-emu shell, and take the heavy lock for the emulator itself so it
# never overlaps a Gradle or nix build (harbor froze on 2026-10-22):
#
#   nix develop .#android-emu -c bash apps/mobile/scripts/android-emulator.sh create
#   flock /tmp/retrospend-heavy.lock nix develop .#android-emu -c \
#     bash apps/mobile/scripts/android-emulator.sh run     # boots, stays in front
#   ... from another shell, in the same android-emu shell:
#   bash apps/mobile/scripts/android-emulator.sh install app-debug.apk
#   bash apps/mobile/scripts/android-emulator.sh shot out.png
#   bash apps/mobile/scripts/android-emulator.sh stop
#   bash apps/mobile/scripts/android-emulator.sh destroy   # deletes the AVD data
#
# The AVD is a Pixel 8 class phone (written by hand, no device definition) (1080 x 2400, 420 dpi), Android 16 x86_64
# google_apis (no Play Store), 3 GB RAM, 2 cores, software GPU, no window, no
# audio, no snapshots. Data lives in $AVD_ROOT (default ~/.cache/retrospend-avd).
# Build the APK in the android shell like the F-Droid release (RETROSPEND_ABIS=x86_64,
# no keystore signs it with the debug key) and install it with the install command.
set -euo pipefail

name=${AVD_NAME:-retrospend_phone}
root=${AVD_ROOT:-$HOME/.cache/retrospend-avd}
export ANDROID_AVD_HOME=$root/avd
export ANDROID_USER_HOME=$root/user
sdk=${ANDROID_HOME:?run inside nix develop .#android-emu}
image="system-images;android-36;google_apis;x86_64"
mkdir -p "$ANDROID_AVD_HOME" "$ANDROID_USER_HOME"
export ANDROID_EMULATOR_HOME=$ANDROID_USER_HOME

cmd=${1:-}
shift || true
case "$cmd" in
create)
	# The image ships no devices.xml, so avdmanager cannot make a Pixel from a
	# device name. Write the AVD files by hand.
	rm -rf "$ANDROID_AVD_HOME/$name.avd" "$ANDROID_AVD_HOME/$name.ini"
	mkdir -p "$ANDROID_AVD_HOME/$name.avd"
	cat >"$ANDROID_AVD_HOME/$name.ini" <<CFG
avd.ini.encoding=UTF-8
path=$ANDROID_AVD_HOME/$name.avd
path.rel=avd/$name.avd
target=android-36
CFG
	cat >"$ANDROID_AVD_HOME/$name.avd/config.ini" <<CFG
AvdId=$name
PlayStore.enabled=false
abi.type=x86_64
avd.ini.displayname=$name
hw.arc=false
hw.cpu.arch=x86_64
hw.cpu.ncore=2
hw.ramSize=3072
vm.heapSize=256
disk.dataPartition.size=4G
hw.gpu.enabled=yes
hw.gpu.mode=swiftshader_indirect
hw.keyboard=no
hw.lcd.width=1080
hw.lcd.height=2400
hw.lcd.density=420
hw.initialOrientation=portrait
hw.sensors.orientation=yes
hw.dPad=no
hw.mainKeys=no
hw.camera.back=none
hw.camera.front=none
hw.audioInput=no
hw.audioOutput=no
hw.gps=no
hw.battery=yes
hw.accelerometer=yes
image.sysdir.1=system-images/android-36/google_apis/x86_64/
tag.id=google_apis
tag.display=Google APIs
showDeviceFrame=no
skin.dynamic=yes
runtime.network.latency=none
runtime.network.speed=full
CFG
	;;
run)
	# Stays in the foreground; put it behind flock and run it in the background.
	exec emulator -avd "$name" -no-window -no-audio -no-snapshot -no-boot-anim \
		-gpu swiftshader_indirect -memory 3072 -cores 2 -no-metrics \
		-read-only -port "${EMU_PORT:-5554}"
	;;
wait)
	adb wait-for-device
	until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 3; done
	# Stay awake, and show the soft keyboard (the audit wants real
	# motion and the real IME).
	adb shell settings put global stay_on_while_plugged_in 7
	adb shell settings put secure show_ime_with_hard_keyboard 1
	echo booted
	;;
install)
	adb install -r -g "${1:?apk path}"
	;;
shot)
	adb exec-out screencap -p >"${1:?output png}"
	;;
dark)
	adb shell cmd uimode night "${1:-yes}"
	;;
stop)
	adb emu kill || true
	;;
destroy)
	adb emu kill 2>/dev/null || true
	rm -rf "$root"
	;;
*)
	sed -n '2,19p' "$0"
	exit 2
	;;
esac
