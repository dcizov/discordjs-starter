import java.net.HttpURLConnection;
import java.net.URI;

/** Local authenticated HTTP readiness only, not plugins/WebSocket/voice/playback. */
public final class Healthcheck {
    static boolean ready(String password) {
        if (password == null || password.isEmpty()) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create("http://127.0.0.1:2333/v4/info")
                    .toURL().openConnection();
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", password);
            return connection.getResponseCode() == 200;
        } catch (Exception ignored) {
            // Docker records stdout/stderr: never print credentials/headers.
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    public static void main(String[] args) {
        System.exit(ready(System.getenv("LAVALINK_SERVER_PASSWORD")) ? 0 : 1);
    }
}
