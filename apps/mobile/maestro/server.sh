#!/usr/bin/env bash
# A throwaway seeded Retrospend server for the Maestro flows
# (docs/roadmap/maestro-plan.md 1.1 and 2.3). Run from anywhere, inside the
# repo's default `nix develop` shell, after `pnpm build` (it serves .next).
#
#   bash apps/mobile/maestro/server.sh template          # migrate + seed rs_e2e_template, once per run
#   bash apps/mobile/maestro/server.sh up <shard>        # rs_e2e_<shard> from the template, server on 3200+<shard>
#   bash apps/mobile/maestro/server.sh down <shard>      # stop that server, drop its database
#
# MAESTRO_PG       Postgres to use, without a database name (default: the test
#                  Postgres of docker-compose.test.yml on 127.0.0.1:5436). The
#                  seed refuses any database not named rs_e2e_* or any host
#                  that is not loopback (e2e/maestro-db-guard.ts).
# MAESTRO_STATE    pidfiles and server logs (default: $TMPDIR/maestro-server).
# MAESTRO_HOST     How the app reaches the server: 10.0.2.2 for the Android
#                  emulator (default), 127.0.0.1 for an iOS simulator.
#
# The server listens on 127.0.0.1 only. `up` prints the URL the app connects to.
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
pg=${MAESTRO_PG:-postgresql://postgres:testpassword@127.0.0.1:5436}
state=${MAESTRO_STATE:-${TMPDIR:-/tmp}/maestro-server}
host=${MAESTRO_HOST:-10.0.2.2}
mkdir -p "$state"
cd "$root"

cmd=${1:-}
shard=${2:-}

# The shard number picks the database name, port and pidfile: digits only.
case "$cmd" in up | down) [[ "$shard" =~ ^[0-9]+$ ]] || { echo "usage: server.sh $cmd <shard>" >&2; exit 2; } ;; esac

psql_admin() { psql -v ON_ERROR_STOP=1 -qAt "$pg/postgres" "$@"; }

case "$cmd" in
template)
	psql_admin -c "DROP DATABASE IF EXISTS rs_e2e_template" -c "CREATE DATABASE rs_e2e_template"
	DATABASE_URL="$pg/rs_e2e_template" pnpm exec prisma migrate deploy >"$state/migrate.log" 2>&1 \
		|| { tail -20 "$state/migrate.log" >&2; exit 1; }
	pnpm exec tsx e2e/fixtures/seed-maestro.ts "$pg/rs_e2e_template"
	;;
up)
	[[ -d .next ]] || { echo "no .next build: run pnpm build first" >&2; exit 2; }
	port=$((3200 + shard))
	pidfile=$state/server-$shard.pid
	if [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
		echo "shard $shard is already up (pid $(cat "$pidfile"))" >&2
		exit 1
	fi
	psql_admin -c "DROP DATABASE IF EXISTS rs_e2e_$shard WITH (FORCE)" \
		-c "CREATE DATABASE rs_e2e_$shard TEMPLATE rs_e2e_template"
	public="http://$host:$port"
	# No sidecar: rates come from the seed. Uploads go to the state dir.
	env DATABASE_URL="$pg/rs_e2e_$shard" \
		AUTH_SECRET="maestro-e2e-secret-value-32-chars-!!" \
		PUBLIC_URL="$public" NEXT_PUBLIC_APP_URL="$public" \
		SIDECAR_URL="http://127.0.0.1:9" UPLOAD_DIR="$state/uploads-$shard" \
		setsid pnpm exec next start -H 127.0.0.1 -p "$port" >"$state/server-$shard.log" 2>&1 &
	echo $! >"$pidfile"
	for _ in $(seq 1 90); do
		if curl -fsS "http://127.0.0.1:$port/api/v1/server-info" >/dev/null 2>&1; then
			echo "$public"
			exit 0
		fi
		sleep 1
	done
	echo "server $shard did not answer in 90 s; see $state/server-$shard.log" >&2
	exit 1
	;;
down)
	pidfile=$state/server-$shard.pid
	if [[ -f $pidfile ]]; then
		pid=$(cat "$pidfile")
		# setsid made the server its own process group leader: stop exactly that group.
		kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
		rm -f "$pidfile"
	fi
	psql_admin -c "DROP DATABASE IF EXISTS rs_e2e_$shard WITH (FORCE)"
	;;
*)
	echo "usage: server.sh template | up <shard> | down <shard>" >&2
	exit 2
	;;
esac
