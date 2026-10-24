import java.net.HttpURLConnection;
import java.net.URI;

/** Local, authenticated readiness probe. No curl/Node/Python in the JVM image. */
public final class Healthcheck {
    public static void main(String[] args) {
        HttpURLConnection connection = null;
        int status = 1;
        try {
            String password = System.getenv("LAVALINK_SERVER_PASSWORD");
            if (password == null || password.isEmpty()) {
                System.exit(1);
            }
            connection = (HttpURLConnection) URI.create("http://127.0.0.1:2333/v4/info")
                    .toURL().openConnection();
            connection.setConnectTimeout(2000);
            connection.setReadTimeout(2000);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Authorization", password);
            status = connection.getResponseCode() == 200 ? 0 : 1;
        } catch (Exception ignored) {
            // Docker records stdout/stderr: never print credentials/headers.
        } finally {
            if (connection != null) connection.disconnect();
        }
        System.exit(status);
    }
}
