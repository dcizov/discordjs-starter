
// Build-only integration: upstream's plugin.yml is not a Lavalink manifest.
// The Gradle plugin requires an explicit API version and otherwise names the
// generated manifest after the Gradle subproject ("plugin", not "soundy").
lavalinkPlugin {
    apiVersion.set("4.2.2")
    name.set("soundy")
    path.set("com.waris4ly.soundy")
}

// The older Lavalink Gradle plugin copies the whole classes root (filtering to
// main classes). Gradle 8 still tracks the sibling test output as an input;
// declare its producer when unit tests and jar packaging share one build.
tasks.jar {
    dependsOn(":source:compileTestJava")
}
