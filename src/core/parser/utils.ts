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