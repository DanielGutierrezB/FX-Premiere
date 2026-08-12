/**
 * The bottom of the shared stack: reaching Node from inside a CEP page. Everything that touches
 * the file system goes through here, and nothing here depends on the rest of the bridge.
 */
export const nodeRequire = (): NodeRequire => {
  if (window.cep_node?.require) {
    return window.cep_node.require;
  }
  const globalRequire = (globalThis as { require?: NodeRequire }).require;
  if (globalRequire) {
    return globalRequire;
  }
  throw new Error('Node.js is not enabled for this extension');
};
