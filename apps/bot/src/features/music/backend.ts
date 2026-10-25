import {
  Constants,
  Node,
  Shoukaku,
  type Connector,
  type NodeOption,
  type ShoukakuOptions,
} from "shoukaku";

type ManagedNode = { node: Node; failures: number; timer?: NodeJS.Timeout };
type RecoveryOptions = { retryDelayMs?: number; maxRetryDelayMs?: number };

/**
 * Shoukaku 4.3.0 retains connectError after a successful retry in ONE connect()
 * call, then closes that healthy socket and removes the node. Use one attempt
 * per call instead, and supervise those calls with a capped, non-spinning
 * backoff. Reuse the node so REST extensions, player references and the resumable
 * session survive a transient outage. No node_modules patches/private methods.
 */
export class MusicBackend extends Shoukaku {
  private readonly managed = new Map<string, ManagedNode>();
  private stopped = false;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(
    connector: Connector,
    nodes: NodeOption[],
    options: ShoukakuOptions = {},
    recovery: RecoveryOptions = {}
  ) {
    super(connector, nodes, {
      ...options,
      reconnectTries: 1,
      reconnectInterval: 0,
    });
    this.retryDelayMs = Math.max(1, recovery.retryDelayMs ?? 5000);
    this.maxRetryDelayMs = Math.max(
      this.retryDelayMs,
      recovery.maxRetryDelayMs ?? 30000
    );
  }

  override addNode(options: NodeOption) {
    if (this.stopped || this.managed.has(options.name)) return;
    const node = new Node(this, options);
    const managed: ManagedNode = { node, failures: 0 };
    this.managed.set(node.name, managed);

    // Node.close() also calls this public method. Prevent its automatic
    // reconnect on deliberate shutdown/removal, including an in-flight open.
    const connect = node.connect.bind(node);
    node.connect = async () => {
      if (!this.active(managed)) return;
      try {
        await connect();
      } finally {
        if (!this.active(managed)) this.closeSocket(node);
      }
    };
    node.on("debug", (...args) => this.emit("debug", node.name, ...args));
    node.on("raw", (...args) => this.emit("raw", node.name, ...args));
    node.on("error", (error) => {
      if (this.active(managed)) this.emit("error", node.name, error);
    });
    node.on("close", (...args) => {
      if (this.active(managed)) this.emit("close", node.name, ...args);
    });
    node.on("ready", (...args) => {
      if (!this.active(managed)) return;
      managed.failures = 0;
      clearTimeout(managed.timer);
      managed.timer = undefined;
      this.emit("ready", node.name, ...args);
    });
    node.on("disconnect", (count) => {
      if (!this.active(managed)) return;
      this.nodes.delete(node.name);
      this.emit("disconnect", node.name, count);
      this.schedule(managed);
    });
    this.nodes.set(node.name, node);
    this.connect(managed);
  }

  private active(managed: ManagedNode) {
    return !this.stopped && this.managed.get(managed.node.name) === managed;
  }
  private connect(managed: ManagedNode) {
    void managed.node.connect().catch((error: unknown) => {
      if (this.active(managed))
        this.emit(
          "error",
          managed.node.name,
          error instanceof Error
            ? error
            : new Error("Lavalink connection failed")
        );
    });
  }
  private schedule(managed: ManagedNode) {
    if (!this.active(managed) || managed.timer) return;
    const delay = Math.min(
      this.retryDelayMs * 2 ** Math.min(managed.failures++, 6),
      this.maxRetryDelayMs
    );
    this.emit("reconnecting", managed.node.name, 1, delay / 1000);
    managed.timer = setTimeout(() => {
      managed.timer = undefined;
      if (!this.active(managed)) return;
      this.nodes.set(managed.node.name, managed.node);
      this.connect(managed);
    }, delay);
    managed.timer.unref();
  }
  private closeSocket(node: Node) {
    const socket = node.ws;
    node.ws = null;
    node.state = Constants.State.DISCONNECTED;
    if (!socket) return;
    socket.removeAllListeners();
    socket.on("error", () => undefined);
    socket.close(1000, "Orbit music connection stopped");
  }

  override removeNode(name: string) {
    const managed = this.managed.get(name);
    if (!managed) return;
    this.managed.delete(name);
    this.nodes.delete(name);
    clearTimeout(managed.timer);
    this.closeSocket(managed.node);
  }
  stop() {
    this.stopped = true;
    for (const name of this.managed.keys()) this.removeNode(name);
  }
}
