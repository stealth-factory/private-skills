#!/usr/bin/env bash
# Install N GitHub Actions runner instances on this Mac as launchd services.
#
#   install-runner.sh --scope org:<org> | repo:<org>/<repo> \
#                     --label <mac-label> [--count 3] [--group <runner-group>] \
#                     [--extra-labels xcode,ios]
#
# Run as the macOS account the runner should use (not root). Needs `gh`
# logged in with a token that can create registration tokens for the scope
# (org: admin:org or the runners permission; repo: repo admin).
# Re-running replaces instances of the same name.
set -euo pipefail

scope="" label="" count=1 group="" extra=""
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) scope="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --count) count="$2"; shift 2 ;;
    --group) group="$2"; shift 2 ;;
    --extra-labels) extra="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$scope" ] && [ -n "$label" ] || { echo "--scope and --label are required" >&2; exit 2; }
[ "$(id -u)" -ne 0 ] || { echo "run as the runner user, not root" >&2; exit 2; }
[ "$(uname -s)" = Darwin ] || { echo "macOS only" >&2; exit 2; }

case "$scope" in
  org:*)  target="${scope#org:}";  token_path="orgs/$target/actions/runners/registration-token" ;;
  repo:*) target="${scope#repo:}"; token_path="repos/$target/actions/runners/registration-token" ;;
  *) echo "--scope must be org:<org> or repo:<org>/<repo>" >&2; exit 2 ;;
esac
host="$(gh auth status --active 2>/dev/null | awk '/Logged in to/ {print $5; exit}')"
url="https://${host:-github.com}/$target"

arch="$(uname -m)"; [ "$arch" = arm64 ] && pkg=osx-arm64 || pkg=osx-x64
labels="$label${extra:+,$extra}"
base="$HOME/actions-runner"
mkdir -p "$base"

for n in $(seq 1 "$count"); do
  dir="$base/$n"
  name="$label-$n"
  echo "==> $name in $dir"
  if [ -x "$dir/svc.sh" ]; then
    (cd "$dir" && ./svc.sh stop >/dev/null 2>&1 || true; ./svc.sh uninstall >/dev/null 2>&1 || true)
  fi
  if [ ! -x "$dir/config.sh" ]; then
    mkdir -p "$dir"
    gh release download -R actions/runner --pattern "actions-runner-$pkg-*.tar.gz" -O "$dir/runner.tar.gz" --clobber
    tar xzf "$dir/runner.tar.gz" -C "$dir"
    rm "$dir/runner.tar.gz"
  fi
  token="$(gh api -X POST "$token_path" --jq .token)"
  (
    cd "$dir"
    ./config.sh --unattended --replace \
      --url "$url" --token "$token" \
      --name "$name" --labels "$labels" --work _work \
      ${group:+--runnergroup "$group"}
    ./svc.sh install
    ./svc.sh start
  )
  unset token
done

echo
echo "Installed $count instance(s). Check they are online:"
case "$scope" in
  org:*)  echo "  gh api orgs/$target/actions/runners --jq '.runners[]|[.name,.status,.busy]|@tsv'" ;;
  repo:*) echo "  gh api repos/$target/actions/runners --jq '.runners[]|[.name,.status,.busy]|@tsv'" ;;
esac
echo "The services run while $(id -un) is logged in; enable automatic login for it."
