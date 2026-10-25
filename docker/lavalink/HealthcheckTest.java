import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicInteger;

/** Build-only loopback fixtures. No Discord, providers, supplied secrets or JUnit dependency. */
public final class HealthcheckTest {
    private static int checks;
    private static void check(boolean condition, String label) {
        if (!condition) throw new AssertionError(label);
        checks++;
    }
    public static void main(String[] args) throws Exception {
        String password = "test-only-probe-password";
        check(!Healthcheck.ready(null), "missing password");
        check(!Healthcheck.ready(""), "empty password");
        check(!Healthcheck.ready(password), "unavailable listener");
        AtomicInteger response = new AtomicInteger(200);
        AtomicInteger redirected = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 2333), 0);
        server.createContext("/v4/info", exchange -> {
            int status = password.equals(exchange.getRequestHeaders().getFirst("Authorization"))
                    ? response.get() : 401;
            if (status == 302) exchange.getResponseHeaders().set("Location", "/redirect-target");
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.createContext("/redirect-target", exchange -> {
            redirected.incrementAndGet();
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        try {
            server.start();
            check(Healthcheck.ready(password), "authenticated listener ready after unavailable");
            check(!Healthcheck.ready("test-only-wrong-password"), "authentication failure");
            response.set(503);
            check(!Healthcheck.ready(password), "HTTP unavailable");
            response.set(302);
            check(!Healthcheck.ready(password), "redirect is not readiness");
            check(redirected.get() == 0, "redirect must not be followed");
            response.set(200);
            check(Healthcheck.ready(password), "recovery after failures");
        } finally {
            server.stop(0);
        }
        System.out.println("Authenticated HTTP probe checks passed: " + checks);
    }
}
