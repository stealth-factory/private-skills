#!/usr/bin/env bash
# Everything the release workflows know about a track comes from
# .github/release-tracks.json: which paths count towards it, where its version
# lives and how it ships. Tags are <track>-vX.Y.Z; a commit belongs to every
# track whose paths it touches.
#
#   release-track.sh list                   track names, as a JSON array
#   release-track.sh get <track> <field>    one field (ship, kind, manifest, changelog)
#   release-track.sh next <track>           key=value lines: release, current, next, last
#   release-track.sh current <track>        the version in the track's manifest
#   release-track.sh bump <track> <next>    write the version and prepend the changelog
#   release-track.sh notes <track> <ver>    that version's changelog section
#
# Run from the repository root with full history and tags (fetch-depth: 0).
# Needs git, jq, perl and git-cliff (install-git-cliff.sh); node for
# package-json tracks.
set -euo pipefail

config="${RELEASE_TRACKS_CONFIG:-.github/release-tracks.json}"
cmd="${1:?usage: release-track.sh list|get|next|current|bump|notes <track> [arg]}"

if [ "$cmd" = list ]; then
  jq -c '[.tracks[].name]' "$config"
  exit 0
fi

track="${2:?track name}"
spec=$(jq -ce --arg t "$track" '.tracks[] | select(.name == $t)' "$config") \
  || { echo "no track named $track in $config" >&2; exit 1; }
field() { jq -r --arg f "$1" '.[$f] // empty' <<< "$spec"; }

kind=$(field kind)
manifest=$(field manifest)
changelog=$(field changelog)
[ -n "$changelog" ] || changelog="$(jq -r '.paths[0]' <<< "$spec")/CHANGELOG.md"
changelog="${changelog#./}"
# A read loop, not mapfile: macOS still ships bash 3.2.
paths=()
while IFS= read -r p; do paths+=("$p"); done < <(jq -r '.paths[]' <<< "$spec")
prefix="${track}-v"

# git-cliff wants globs; git log wants pathspecs. Same list, two spellings: a
# directory becomes dir/**, a file stays as it is. "." is the whole repository
# (a repo that ships one app): no filter at all.
cliff_paths=()
for p in "${paths[@]}"; do
  if [ "$p" = . ]; then cliff_paths=(); break
  elif [ -f "$p" ]; then cliff_paths+=(--include-path "$p")
  else cliff_paths+=(--include-path "$p/**"); fi
done
# ${a[@]+…}: an empty array is "unbound" to bash 3.2 under set -u.
cliff() { git cliff --tag-pattern "^${prefix}[0-9]" ${cliff_paths[@]+"${cliff_paths[@]}"} "$@"; }

current() {
  case "$kind" in
    xcodegen) sed -n 's/^ *MARKETING_VERSION: *"\{0,1\}\([0-9][^"]*\)"\{0,1\} *$/\1/p' "$manifest" | head -1 ;;
    xcconfig) sed -n 's/^ *MARKETING_VERSION *= *\([0-9][^ ]*\) *$/\1/p' "$manifest" | head -1 ;;
    pbxproj)
      # One MARKETING_VERSION per target and configuration. They must agree (App
      # Store Connect rejects an extension whose version differs from its app),
      # so a project where they do not is an error, not a guess.
      versions=$(sed -n 's/^[[:space:]]*MARKETING_VERSION = "\{0,1\}\([0-9][^";]*\)"\{0,1\};$/\1/p' "$manifest" | sort -u)
      if [ "$(printf '%s\n' "$versions" | grep -c .)" -gt 1 ]; then
        echo "$manifest has several MARKETING_VERSION values ($(paste -sd ' ' - <<< "$versions")); make them one first" >&2
        exit 1
      fi
      echo "$versions" ;;
    package-json) node -p 'require(require("path").resolve(process.argv[1])).version || ""' "$manifest" ;;
    *) echo "unknown kind $kind for $track (xcodegen, xcconfig, pbxproj or package-json)" >&2; exit 1 ;;
  esac
}

last_tag() { git tag --list "${prefix}[0-9]*" --sort=-v:refname | head -1; }

case "$cmd" in
  get)
    case "${3:?field}" in
      changelog) echo "$changelog" ;;
      *) field "$3" ;;
    esac
    ;;

  current)
    current
    ;;

  next)
    cur=$(current)
    last=$(last_tag)
    echo "current=$cur"
    echo "last=$last"
    if [ -z "$last" ]; then
      # No baseline tag yet. tag-release.yml lays one down at the manifest's
      # version the first time it runs; until then there is nothing to
      # measure the next version from.
      echo "next=$cur"
      echo "release=no"
      echo "releasable=0"
      exit 0
    fi
    # Only changes a user gets start a release: feat, fix, perf, revert and
    # anything marked breaking. Docs and chores still reach the changelog,
    # riding along with the next real change.
    # Whole messages, so a BREAKING CHANGE footer counts as well as a `!`.
    releasable=$(git log -z "${last}..HEAD" --format=%B -- "${paths[@]}" \
      | perl -0 -ne '$n++ if /\A(?:(?:feat|fix|perf|revert)(?:\(.+\))?!?:|[a-z]+(?:\(.+\))?!:)|^BREAKING[ -]CHANGE:/m; END { print $n + 0 }')
    # A git-cliff failure (a bad cliff.toml, say) fails the run rather than
    # reading as "nothing to release".
    next=$(cliff --bumped-version)
    next="${next#"$prefix"}"
    if [ -z "$next" ] || [ "$next" = "$cur" ] || [ "$releasable" -eq 0 ]; then
      echo "next=$cur"
      echo "release=no"
    else
      echo "next=$next"
      echo "release=yes"
    fi
    echo "releasable=$releasable"
    ;;

  bump)
    next="${3:?version}"
    cur=$(current)
    case "$kind" in
      # perl -pi rather than sed -i, whose flags differ between GNU and macOS.
      xcodegen)
        CUR="$cur" NEXT="$next" perl -pi -e 's/^( *MARKETING_VERSION: *"?)\Q$ENV{CUR}\E("? *)$/$1$ENV{NEXT}$2/' "$manifest" ;;
      xcconfig)
        CUR="$cur" NEXT="$next" perl -pi -e 's/^( *MARKETING_VERSION *= *)\Q$ENV{CUR}\E( *)$/$1$ENV{NEXT}$2/' "$manifest" ;;
      pbxproj)
        # Every target and configuration, so extensions keep the app's version.
        CUR="$cur" NEXT="$next" perl -pi -e 's/^(\s*MARKETING_VERSION = "?)\Q$ENV{CUR}\E("?;)$/$1$ENV{NEXT}$2/' "$manifest" ;;
      package-json)
        node -e '
          const fs = require("fs"), [file, version] = process.argv.slice(1);
          const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
          pkg.version = version;
          fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
        ' "$manifest" "$next" ;;
    esac
    [ "$(current)" = "$next" ] || { echo "$manifest did not take the bump to $next" >&2; exit 1; }
    # --unreleased --prepend rather than a regenerate: the file has a
    # hand-written header and baseline section, and this stays idempotent
    # because release-pr.yml rebuilds its branch from main every time.
    cliff --unreleased --tag "${prefix}${next}" --prepend "$changelog"
    # One blank line before every version heading, never more than one.
    perl -0pi -e 's/\n(## \[)/\n\n$1/g; s/\n{3,}/\n\n/g' "$changelog"
    ;;

  notes)
    ver="${3:?version}"
    awk -v want="## [$ver]" 'index($0, want) == 1 { on = 1; print; next } /^## \[/ { on = 0 } on' "$changelog"
    ;;

  *)
    echo "unknown command: $cmd" >&2
    exit 1
    ;;
esac
