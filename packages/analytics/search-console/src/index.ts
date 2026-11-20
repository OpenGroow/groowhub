export { searchConsoleAnalytics } from "./search-console";

// The bundle contract (ADR-078): the package's default export is the adapter.
import { searchConsoleAnalytics as adapter } from "./search-console";
export default adapter;
