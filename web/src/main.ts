import "./styles.css";

if (import.meta.env.DEV) {
  const refreshRuntimePath = "/@react-refresh";
  const refreshRuntime = await import(
    /* @vite-ignore */ refreshRuntimePath
  );
  refreshRuntime.default.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => undefined;
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
}

const [{ createElement }, { createRoot }, { App }] = await Promise.all([
  import("react"),
  import("react-dom/client"),
  import("./App"),
]);

const root = document.getElementById("root");
if (root === null) throw new Error("Missing React root element");
createRoot(root).render(createElement(App));

declare global {
  interface Window {
    $RefreshReg$: () => void;
    $RefreshSig$: () => <T>(type: T) => T;
    __vite_plugin_react_preamble_installed__: boolean;
  }
}
