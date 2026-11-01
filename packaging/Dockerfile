# syntax=docker/dockerfile:1
#
# Builds both release binaries as fully static executables, so one release
# tarball per CPU architecture runs on any Linux distribution:
#   rtl_airband        - the pinned jschmall/RTLSDR-Airband fork (vendor/RTLSDR-Airband)
#   rtl-airband-panel  - the panel, with the frontend embedded
#
# Don't call this directly; scripts/build-release.sh prepares the build
# context (an exported copy of the pinned fork) and assembles the tarball.

ARG ALPINE_VERSION=3.21

# ---------------------------------------------------------------- rtl_airband

FROM alpine:${ALPINE_VERSION} AS airband-deps
RUN apk add --no-cache \
      build-base cmake git pkgconf linux-headers ca-certificates file \
      libconfig-dev libconfig-static \
      lame-dev \
      libshout-dev libshout-static libogg-static libvorbis-static libtheora-static \
      openssl-dev openssl-libs-static \
      fftw-dev \
      curl-dev curl-static nghttp2-static brotli-static libpsl-static libidn2-static \
      zstd-static libunistring-static c-ares-dev zlib-static \
      libusb-dev
# Alpine ships CMake 4; let older cmake_minimum_required() projects configure.
ENV CMAKE_POLICY_VERSION_MINIMUM=3.5
WORKDIR /deps

# speex (a libshout dependency) has no static package on Alpine.
ARG SPEEX_VERSION=1.2.1
ARG SPEEX_SHA256=4b44d4f2b38a370a2d98a78329fefc56a0cf93d1c1be70029217baae6628feea
# downloads.xiph.org occasionally resets TLS connections, so retry and fall back to the
# OSUOSL mirror of the same release tree. The checksum still guards whatever is fetched.
RUN f=speex-${SPEEX_VERSION}.tar.gz \
 && for attempt in 1 2 3; do \
      for base in https://downloads.xiph.org/releases/speex https://ftp.osuosl.org/pub/xiph/releases/speex; do \
        rm -f "$f"; wget -q "$base/$f" && echo "${SPEEX_SHA256}  $f" | sha256sum -c -s - && break 2; \
        echo "speex download from $base failed (attempt $attempt)" >&2; \
      done; sleep $((attempt * 5)); \
    done \
 && echo "${SPEEX_SHA256}  $f" | sha256sum -c - \
 && tar xzf speex-${SPEEX_VERSION}.tar.gz \
 && cd speex-${SPEEX_VERSION} \
 && ./configure --prefix=/usr --enable-static --disable-shared --disable-binaries \
 && make -j"$(nproc)" install

# rtl-sdr-blog's librtlsdr (RTL-SDR Blog V4 support), as the fork's own image uses.
ARG RTLSDR_BLOG_COMMIT=aed0ea19f3a273370a13c9009b96313c75d54c7b
RUN git clone -q https://github.com/rtlsdrblog/rtl-sdr-blog \
 && git -C rtl-sdr-blog checkout -q ${RTLSDR_BLOG_COMMIT} \
 && cmake -S rtl-sdr-blog -B rtl-sdr-blog/build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
      -DDETACH_KERNEL_DRIVER=ON -DINSTALL_UDEV_RULES=OFF \
 && cmake --build rtl-sdr-blog/build -j"$(nproc)" \
 && cmake --install rtl-sdr-blog/build

# libmirisdr-4 (Mirics dongles).
ARG LIBMIRISDR_COMMIT=fd0452e31264f065bb315e74313384ca4a121ef1
RUN git clone -q https://github.com/f4exb/libmirisdr-4 \
 && git -C libmirisdr-4 checkout -q ${LIBMIRISDR_COMMIT} \
 && cmake -S libmirisdr-4 -B libmirisdr-4/build -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_BUILD_TYPE=Release \
 && cmake --build libmirisdr-4/build -j"$(nproc)" \
 && cmake --install libmirisdr-4/build

FROM airband-deps AS airband
ARG AIRBAND_VERSION
# The pinned fork, exported with `git archive` into RTLSDR-Airband-<version>/
# (a named build context from scripts/build-release.sh),
# so the fork's find_version script reports <version> without a .git dir.
COPY --from=airband-src / /src/
WORKDIR /src/RTLSDR-Airband-${AIRBAND_VERSION}
# The fork finds input drivers with dlsym(), which a fully static binary
# can't do; this adds a fallback to the drivers linked in (the only source
# change the bundled build makes).
COPY packaging/airband-static-drivers.patch /tmp/
RUN patch -p1 < /tmp/airband-static-drivers.patch
# Fully static link without changing the fork's CMake:
# - remove the unversioned .so dev links of everything rtl_airband links, so
#   find_library() can only find the .a archives (versioned runtime .so files
#   stay; cmake itself needs them);
# - link with -static;
# - append every library the static archives themselves need, for C and C++
#   links, including the configure-time feature checks (try_compile only sees
#   variables listed in CMAKE_TRY_COMPILE_PLATFORM_VARIABLES).
RUN for l in config++ mp3lame shout curl fftw3f usb-1.0 rtlsdr mirisdr; do rm -f /usr/lib/lib$l.so; done \
 && extra="$(pkg-config --static --libs shout libcurl libconfig++ fftw3f libusb-1.0) -lmp3lame" \
 && cmake -B build -DCMAKE_BUILD_TYPE=Release -DPLATFORM=generic \
      -DNFM=ON -DRDIO_SCANNER=ON -DRTLSDR=ON -DMIRISDR=ON -DPULSEAUDIO=OFF -DSOAPYSDR=OFF \
      -DBUILD_UNITTESTS=ON \
      -DCMAKE_EXE_LINKER_FLAGS="-static" \
      -DCMAKE_C_STANDARD_LIBRARIES="$extra" \
      -DCMAKE_CXX_STANDARD_LIBRARIES="$extra" \
      -DCMAKE_TRY_COMPILE_PLATFORM_VARIABLES="CMAKE_C_STANDARD_LIBRARIES;CMAKE_CXX_STANDARD_LIBRARIES" \
 && cmake --build build -j"$(nproc)"
RUN ./build/src/unittests
RUN file build/src/rtl_airband \
 && ! readelf -d build/src/rtl_airband 2>/dev/null | grep -q NEEDED \
 && ./build/src/rtl_airband -v \
 && mkdir -p /out && strip -o /out/rtl_airband build/src/rtl_airband

# ------------------------------------------------------------------- panel

FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY frontend frontend
RUN npm run build --workspace=frontend

FROM rust:1-alpine${ALPINE_VERSION} AS panel
RUN apk add --no-cache musl-dev file
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY crates crates
COPY --from=frontend /app/frontend/dist frontend/dist
RUN cargo build --release --locked -p rtl-airband-panel
RUN file target/release/rtl-airband-panel \
 && ! readelf -d target/release/rtl-airband-panel 2>/dev/null | grep -q NEEDED \
 && ./target/release/rtl-airband-panel --version \
 && mkdir -p /out && cp target/release/rtl-airband-panel /out/

# --------------------------------------------------------------- licenses

# THIRD-PARTY-LICENSES: the licenses of the Rust crates linked into the
# panel, generated by cargo-about (an external tool, installed here only).
# It reads crate metadata, not the build target, so it runs on the build
# machine's own platform, never under QEMU. packaging/about.toml lists the
# accepted licenses; a crate under any other license fails the build.
FROM --platform=$BUILDPLATFORM rust:1-alpine${ALPINE_VERSION} AS licenses
ARG CARGO_ABOUT_VERSION=0.9.3
RUN apk add --no-cache musl-dev \
 && cargo install --locked --features cli --version ${CARGO_ABOUT_VERSION} cargo-about
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY .cargo .cargo
COPY crates crates
COPY packaging/about.toml packaging/about.hbs packaging/
RUN mkdir -p /out \
 && cargo about generate --locked \
      --config packaging/about.toml \
      --manifest-path crates/panel/Cargo.toml \
      --output-file /out/THIRD-PARTY-LICENSES \
      packaging/about.hbs \
 && grep -q '^  - sync_wrapper ' /out/THIRD-PARTY-LICENSES

# ----------------------------------------------------------------- output

FROM scratch AS release
COPY --from=airband /out/rtl_airband /
COPY --from=panel /out/rtl-airband-panel /
COPY --from=licenses /out/THIRD-PARTY-LICENSES /
