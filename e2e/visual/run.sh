#!/usr/bin/env bash
# Runs the visual regression project (e2e/visual) with the browser inside the
# pinned Playwright image, so fonts and rasterizing match the committed
# baselines on any host. The tests and the app stay on the host; the browser
# reaches the app's localhost through Playwright's network tunnel.
#
#   bash e2e/visual/run.sh                      # compare
#   bash e2e/visual/run.sh --update-snapshots   # rewrite baselines (say why in the PR)
#
# Arguments go to `playwright test`. The app comes from the config's
# webServer (port 3106), or from E2E_BASE_URL when it runs elsewhere.
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

version=$(pnpm exec playwright --version | awk '{print $2}')
image="mcr.microsoft.com/playwright:v${version}-noble"
# The server listens on 3000 inside the container; Docker picks a free host
# port, so parallel runs and other servers on the host never collide.
inner=3000
name="retrospend-visual-pw-$$"

# The image ships the browsers for this exact version; the server comes from
# the repo's own node_modules, mounted read-only, so nothing is downloaded.
docker run -d --rm --init --name "$name" \
	--memory 3g --shm-size 1g \
	-p "127.0.0.1::${inner}" \
	-v "$root:$root:ro" -w /home/pwuser --user pwuser \
	"$image" \
	node "$root/node_modules/@playwright/test/cli.js" run-server \
	--port "$inner" --host 0.0.0.0 >/dev/null
trap 'docker stop -t 5 "$name" >/dev/null 2>&1 || true' EXIT

# The published port accepts connections before the server listens.
for _ in $(seq 60); do
	if docker logs "$name" 2>&1 | grep -q "Listening on"; then break; fi
	sleep 1
done
port=$(docker port "$name" "$inner/tcp" | head -1 | sed 's/.*://')

E2E_VISUAL=1 \
	PW_TEST_CONNECT_WS_ENDPOINT="ws://127.0.0.1:${port}/" \
	PW_TEST_CONNECT_EXPOSE_NETWORK="<loopback>" \
	pnpm exec playwright test --project=visual "$@"
