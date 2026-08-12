type Child = Node | string | null | undefined | false;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
};

export const clear = (node: Element): void => {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
};

export const highlight = (text: string, indices: number[]): DocumentFragment => {
  const fragment = document.createDocumentFragment();
  if (indices.length === 0) {
    fragment.appendChild(document.createTextNode(text));
    return fragment;
  }
  const flags = new Set(indices);
  let buffer = '';
  let marked = false;
  const flush = () => {
    if (buffer === '') {
      return;
    }
    if (marked) {
      const mark = document.createElement('mark');
      mark.textContent = buffer;
      fragment.appendChild(mark);
    } else {
      fragment.appendChild(document.createTextNode(buffer));
    }
    buffer = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const isMatch = flags.has(i);
    if (isMatch !== marked) {
      flush();
      marked = isMatch;
    }
    buffer += text[i];
  }
  flush();
  return fragment;
};
