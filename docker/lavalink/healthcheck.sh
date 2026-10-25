#!/bin/sh
# The server's heap option must not override the tiny probe's heap or be logged.
unset _JAVA_OPTIONS
exec java -Xms8m -Xmx32m -XX:+UseSerialGC -cp /opt/Lavalink/healthcheck Healthcheck
