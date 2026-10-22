#!/usr/bin/env bash
# Builds a release tarball for one CPU architecture:
#
#   scripts/build-release.sh [amd64|arm64]     (default: this machine's)
#
# Output: dist/rtl-airband-panel-v<version>-linux-<arch>.tar.gz (+ .sha256)
# containing static rtl-airband-panel and rtl_airband binaries, install.sh,
# and the files it installs. Needs Docker with buildx; building for another
# architecture also needs QEMU binfmt emulation (and is slow).
set -euo pipefail
cd "$(dirname "$0")/.."

arch="${1:-$(uname -m)}"
case "$arch" in
  amd64 | x86_64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) echo "unsupported architecture: $arch (use amd64 or arm64)" >&2; exit 1 ;;
esac

version="$(sed -n 's/^  "version": "\(.*\)",$/\1/p' package.json | head -1)"
[ -n "$version" ] || { echo "could not read the version from package.json" >&2; exit 1; }

# The pinned fork must sit exactly on a tag: releases name the rtl_airband
# version they ship, and the fork's version script takes it from the
# exported directory name.
git submodule update --init vendor/RTLSDR-Airband
# (Shallow CI checkouts may lack the fork's tags; fetch them if needed.)
git -C vendor/RTLSDR-Airband describe --tags --exact-match >/dev/null 2>&1 \
  || git -C vendor/RTLSDR-Airband fetch --quiet --tags origin || true
airband_tag="$(git -C vendor/RTLSDR-Airband describe --tags --exact-match 2>/dev/null)" || {
  echo "vendor/RTLSDR-Airband is not checked out at a tag; pin it to one first" >&2
  exit 1
}
airband_version="${airband_tag#v}"
airband_commit="$(git -C vendor/RTLSDR-Airband rev-parse HEAD)"

build="packaging/.build/$arch"
rm -rf "$build" && mkdir -p "$build/airband-src" "$build/bin"
git -C vendor/RTLSDR-Airband archive --format=tar --prefix="RTLSDR-Airband-$airband_version/" HEAD \
  | tar -x -C "$build/airband-src"

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1; then docker_cmd=(sudo docker); fi
"${docker_cmd[@]}" buildx build \
  --platform "linux/$arch" \
  --file packaging/Dockerfile \
  --build-context "airband-src=$build/airband-src" \
  --build-arg "AIRBAND_VERSION=$airband_version" \
  --target release \
  --output "type=local,dest=$build/bin" \
  .

name="rtl-airband-panel-v$version-linux-$arch"
stage="$build/$name"
mkdir -p "$stage/bin" "$stage/deploy"
install -m 0755 "$build/bin/rtl-airband-panel" "$build/bin/rtl_airband" "$stage/bin/"
install -m 0755 packaging/install.sh "$stage/install.sh"
install -m 0644 deploy/rtl-airband-panel.service deploy/rtl-airband-panel.sudoers \
  packaging/60-rtl-airband-panel.rules packaging/rtl-airband-panel-blacklist.conf "$stage/deploy/"
install -m 0644 README.md DEPLOYMENT.md LICENSE .env.example "$stage/"
cat > "$stage/VERSIONS" <<VERSIONS
rtl-airband-panel $version
rtl_airband $airband_version ($airband_commit, github.com/jschmall/RTLSDR-Airband)
built for linux/$arch, statically linked
VERSIONS

mkdir -p dist
tar -C "$build" --owner=0 --group=0 -czf "dist/$name.tar.gz" "$name"
(cd dist && sha256sum "$name.tar.gz" > "$name.tar.gz.sha256")
echo "dist/$name.tar.gz"
