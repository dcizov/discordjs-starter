#!/usr/bin/env python3
"""Install reviewed Lavalink artifacts at IMAGE BUILD time, never at boot.

Normal builds require SHA-256 pins. --review-unpinned is exclusively a CI
maintenance tool: it prints missing checksums for review; it never relaxes the
normal Docker build. No credentials or media/provider requests are needed.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import time
import urllib.request
import zipfile

HOSTS = {"github.com", "maven.lavalink.dev", "jitpack.io"}


def checked_url(value):
    from urllib.parse import urlsplit
    url = urlsplit(value)
    if url.scheme != "https" or url.hostname not in HOSTS or url.username or url.password or url.port not in (None, 443):
        raise ValueError("Plugin URL is not an approved HTTPS artifact repository")
    return value


def fetch(url):
    request = urllib.request.Request(checked_url(url), headers={"User-Agent": "Orbit-Lavalink-plugin-build"})
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                value = response.read(80 * 1024 * 1024 + 1)
                if len(value) > 80 * 1024 * 1024:
                    raise ValueError("Plugin artifact exceeds build size limit")
                return value
        except (OSError, ValueError) as error:
            last = error
            if attempt < 2:
                time.sleep(attempt + 1)
    raise RuntimeError(f"Could not fetch reviewed plugin artifact: {url}: {last}")


def install(item, raw, folder, review=False):
    digest = hashlib.sha256(raw).hexdigest()
    expected = item.get("sha256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", expected):
        if not review:
            raise ValueError(f"{item['id']}: missing reviewed SHA-256 pin")
        print(f"::notice title=Plugin SHA-256 pin::{item['id']} {item['version']} {digest}", flush=True)
    elif digest != expected:
        raise ValueError(f"{item['id']}: artifact checksum mismatch")
    source = zipfile.ZipFile(io.BytesIO(raw))
    properties = [name for name in source.namelist() if name.startswith("lavalink-plugins/") and name.endswith(".properties")]
    if not properties:
        raise ValueError(f"{item['id']}: not a Lavalink plugin JAR")
    # LavaDSPX 0.0.5 ships both template and hand-written metadata. Normalize
    # just this packaging defect into ONE plugin identity/package registration.
    if item['id'] == 'lavadspx-plugin':
        target = io.BytesIO()
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as jar:
            for entry in source.infolist():
                if entry.filename in properties:
                    continue
                if re.fullmatch(r"META-INF/[^/]+\.(SF|RSA|DSA)", entry.filename, re.I):
                    raise ValueError("Refusing to alter a signed plugin JAR")
                jar.writestr(entry, source.read(entry.filename))
            jar.writestr("lavalink-plugins/lavadspx-plugin.properties", "name=lavadspx-plugin\npath=me.devoxin.lavadspx.plugin\nversion=0.0.5\napiVersion=4.0.0\n")
        raw = target.getvalue()
    else:
        # The runtime verifies compatibility too; a wrong artifact must fail
        # here instead of quietly baking an API/library-only JAR.
        identities = [source.read(name).decode("utf-8") for name in properties]
        names = [match.group(1).strip() for value in identities for match in re.finditer(r"^name=(.+)$", value, re.M)]
        if names != [item['id']]:
            raise ValueError(f"{item['id']}: unexpected/duplicate plugin identities: {names}")
    output = Path(folder) / f"{item['id']}-{item['version']}.jar"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(raw)
    print(f"Installed {item['id']} {item['version']} (upstream SHA-256 {digest})", flush=True)
    return digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default="docker/lavalink/plugins.lock.json")
    parser.add_argument("--output", required=True)
    parser.add_argument("--review-unpinned", action="store_true")
    args = parser.parse_args()
    if args.review_unpinned and os.getenv("GITHUB_ACTIONS") != "true":
        parser.error("Unpinned artifact review is limited to a clean CI maintenance run")
    items = json.loads(Path(args.manifest).read_text())["plugins"]
    if len({item['id'] for item in items}) != len(items):
        raise ValueError("Duplicate plugin identities in manifest")
    errors = []
    for item in items:
        try:
            # Fail before a download if the production lock is incomplete.
            if not args.review_unpinned and not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", "")):
                raise ValueError("Missing reviewed SHA-256 pin")
            install(item, fetch(item["url"]), args.output, args.review_unpinned)
        except Exception as error:
            print(f"::error title=Plugin artifact {item['id']}::{str(error).replace('%', '%25').replace(chr(10), '%0A')}", flush=True)
            errors.append(item['id'])
    if errors:
        raise SystemExit(f"Plugin artifact installation failed: {', '.join(errors)}")


if __name__ == "__main__":
    main()
