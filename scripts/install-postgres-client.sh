#!/usr/bin/env bash
# CI runs this as root on Ubuntu. PGDG supplies versions newer than Ubuntu's snapshot.
set -euo pipefail
if [ ! -x /usr/lib/postgresql/17/bin/pg_dump ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl postgresql-common
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  apt-get install -y --no-install-recommends postgresql-client-17
fi
/usr/lib/postgresql/17/bin/pg_dump --version
/usr/lib/postgresql/17/bin/pg_restore --version
