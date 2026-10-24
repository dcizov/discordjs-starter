
// Build-only integration: upstream's plugin.yml is not a Lavalink manifest.
// The Gradle plugin requires an explicit API version and otherwise names the
// generated manifest after the Gradle subproject ("plugin", not "soundy").
lavalinkPlugin {
    apiVersion.set("4.2.2")
    name.set("soundy")
    path.set("com.waris4ly.soundy")
}
