import type { Node, NodeInfo } from "shoukaku";

export type MusicMetadataNode = Pick<Node, "info"> & {
  rest: Pick<Node["rest"], "getLavalinkInfo">;
};

/** Shoukaku 4.3 exposes node.info but does not populate it on WebSocket ready. */
export class MusicNodeMetadata {
  private readonly pending = new WeakMap<
    MusicMetadataNode,
    Promise<NodeInfo>
  >();

  read(node: MusicMetadataNode, refresh = false): Promise<NodeInfo> {
    if (refresh) {
      node.info = null;
      this.pending.delete(node);
    }
    if (node.info) return Promise.resolve(node.info);
    const pending = this.pending.get(node);
    if (pending) return pending;
    const request = Promise.resolve()
      .then(() => node.rest.getLavalinkInfo())
      .then((info) => {
        if (
          !info ||
          typeof info.version?.semver !== "string" ||
          typeof info.lavaplayer !== "string" ||
          !Array.isArray(info.sourceManagers) ||
          !info.sourceManagers.every((name) => typeof name === "string") ||
          !Array.isArray(info.plugins) ||
          !info.plugins.every(
            (plugin) =>
              typeof plugin?.name === "string" &&
              typeof plugin?.version === "string"
          )
        )
          throw new Error("Lavalink did not return valid v4 backend metadata.");
        // A reconnect may have started a newer request while this was in flight.
        if (this.pending.get(node) === request) node.info = info;
        return info;
      })
      .finally(() => {
        if (this.pending.get(node) === request) this.pending.delete(node);
      });
    this.pending.set(node, request);
    return request;
  }
}
