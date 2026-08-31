function canonicalize(value: unknown, inArray = false): string | undefined {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint':
      throw new TypeError('BigInt is not JSON serializable.');
    case 'undefined':
    case 'function':
    case 'symbol':
      return inArray ? 'null' : undefined;
    case 'object': {
      if (value instanceof Date) return JSON.stringify(value.toJSON());
      if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalize(entry, true) ?? 'null').join(',')}]`;
      }

      const object = value as Record<string, unknown>;
      const entries = Object.keys(object)
        .sort()
        .flatMap((key) => {
          const encoded = canonicalize(object[key]);
          return encoded === undefined
            ? []
            : [`${JSON.stringify(key)}:${encoded}`];
        });
      return `{${entries.join(',')}}`;
    }
  }
}

export function stableStringify(value: unknown): string {
  return canonicalize(value) ?? 'null';
}

export function parseStoredJson<T>(value: string, label = 'stored JSON'): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Could not parse ${label}.`, { cause: error });
  }
}
