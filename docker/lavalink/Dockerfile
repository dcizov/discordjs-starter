# syntax=docker/dockerfile:1.7
# Soundy's merged AAC/fMP4 fix is not tagged/published yet. Build the canonical
# upstream commit, not a mutable branch, JitPack snapshot, or arbitrary jar.
FROM gradle:8.5-jdk17 AS soundy
USER root
WORKDIR /soundy
ADD --checksum=sha256:67c3ef77f9792605263be47825373a35f30f7b77ba6bd048e38274ea6cba22f0 https://codeload.github.com/lowkwrs/soundy/tar.gz/e2c5da8e96661d2a9eb96ee53e3d5b95903bc194 /tmp/soundy.tar.gz
RUN tar --extract --gzip --file /tmp/soundy.tar.gz --directory /soundy --strip-components=1 \
    && rm /tmp/soundy.tar.gz \
    && chown -R gradle:gradle /soundy
USER gradle
# No provider calls: the upstream integration harness is opt-in (SOUNDY_IT=1).
ENV SOUNDY_IT=0
COPY docker/lavalink/soundy-plugin.gradle.kts /tmp/soundy-plugin.gradle.kts
RUN cat /tmp/soundy-plugin.gradle.kts >> plugin/build.gradle.kts \
    && gradle --no-daemon --console=plain --max-workers=2 :source:test :plugin:build

# Compile a tiny standard-library readiness probe with the existing JDK stage.
# The final image remains the official unprivileged JRE, without curl or Node.
COPY docker/lavalink/Healthcheck.java /tmp/Healthcheck.java
RUN mkdir -p /tmp/healthcheck && javac --release 17 -d /tmp/healthcheck /tmp/Healthcheck.java

# Download only reviewed version/checksum-pinned plugin artifacts at build time.
# This stage is not shipped; the final image keeps the official unprivileged JVM.
FROM python:3.12-slim AS plugins
WORKDIR /review
COPY docker/lavalink/plugins.lock.json docker/lavalink/install-plugins.py ./
RUN python install-plugins.py --manifest plugins.lock.json --output /plugins

FROM ghcr.io/lavalink-devs/lavalink:4.2.2
LABEL dev.orbit.soundy.revision="e2c5da8e96661d2a9eb96ee53e3d5b95903bc194"
COPY --from=soundy --chown=322:322 /soundy/plugin/build/libs/soundy-plugin-1.1.0.jar /opt/Lavalink/plugins/soundy-plugin-1.1.0.jar
COPY --from=soundy --chown=322:322 /soundy/LICENSE /opt/Lavalink/licenses/soundy-LICENSE
COPY --from=plugins --chown=322:322 /plugins/ /opt/Lavalink/plugins/
COPY --from=soundy --chown=322:322 /tmp/healthcheck/ /opt/Lavalink/healthcheck/
COPY --chown=322:322 docker/lavalink/licenses/ /opt/Lavalink/licenses/
COPY --chown=322:322 docker/lavalink/plugins.lock.json /opt/Lavalink/plugins.lock.json
# Retain the official image's unprivileged user and Java entrypoint.
