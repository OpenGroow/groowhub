export { githubPlugin, githubManifest } from "./github";

// The bundle contract (ADR-072): the package's default export is the plugin.
import { githubPlugin as plugin } from "./github";
export default plugin;
