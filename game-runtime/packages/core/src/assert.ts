export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertSafeInteger(value: number, name: string): void {
  invariant(Number.isSafeInteger(value), `${name} must be a safe integer`);
}

export function assertIntegerInRange(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): void {
  assertSafeInteger(value, name);
  invariant(value >= minimum && value <= maximum, `${name} must be in [${minimum}, ${maximum}]`);
}
