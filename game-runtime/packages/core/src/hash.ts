function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = stableValue(record[key]);
    }
    return sorted;
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

export function hashText32(value: string): number {
  let hash = 0x811c_9dc5;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    hash ^= codePoint & 0xff;
    hash = Math.imul(hash, 0x0100_0193);
    hash ^= codePoint >>> 8;
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

export function stableHash32(value: unknown): string {
  return hashText32(stableStringify(value)).toString(16).padStart(8, '0');
}
