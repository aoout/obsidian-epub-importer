export const findProperty = (obj: unknown, propertyNames: string | string[]): unknown => {
  const names = [propertyNames].flat();

  const search = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return null;

    for (const [key, val] of Object.entries(value)) {
      if (names.includes(key) || names.some(name => key.split(":")[1] === name)) {
        if (val) return val;
      }
    }

    return Object.values(value)
      .map(item => search(item))
      .find(result => result !== null) ?? null;
  };

  return search(obj);
};

export const serializeNode = (node: Node) :string => {
    return node.nodeType === Node.TEXT_NODE 
      ? node.textContent || ""
      : node.nodeType === Node.ELEMENT_NODE
        ? `<${node.nodeName.toLowerCase()}${getAttributes(node as Element)}>${Array.from(node.childNodes).map(n => serializeNode(n)).join("")}</${node.nodeName.toLowerCase()}>`
        : "";
  }

  const getAttributes = (el: Element): string => {
    return Array.from(el.attributes)
      .map(attr => ` ${attr.name}="${attr.value}"`)
      .join("");
  }