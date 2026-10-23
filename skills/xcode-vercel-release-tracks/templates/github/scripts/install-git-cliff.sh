#!/usr/bin/env bash
# Installs a pinned, checksummed git-cliff. The published binary rather than an
# installer action, so exactly what ran is written down here.
set -euo pipefail
ver=2.13.1
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    target=x86_64-unknown-linux-gnu
    sha=9a1263f24e59a2f508c7b3d3283c9dea94a8bf697f96dbc18cc783cac6284546 ;;
  Darwin-arm64)
    target=aarch64-apple-darwin
    sha=21547ae4a0421164070ab75c2522864ea5565858a011fabc5f583061b20f1226 ;;
  *) echo "no pinned git-cliff for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
tmp=$(mktemp -d)
curl -fsSL "https://github.com/orhun/git-cliff/releases/download/v${ver}/git-cliff-${ver}-${target}.tar.gz" -o "$tmp/cliff.tar.gz"
echo "${sha}  $tmp/cliff.tar.gz" | shasum -a 256 -c -
tar -xzf "$tmp/cliff.tar.gz" -C "$tmp"
sudo install "$tmp/git-cliff-${ver}/git-cliff" /usr/local/bin/
git-cliff --version
