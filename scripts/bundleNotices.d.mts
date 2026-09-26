export function bundleNotices(
  rootInput: string, moduleIds: Iterable<string>, target: "browser" | "server"
): Promise<{ text: string; json: string }>;
