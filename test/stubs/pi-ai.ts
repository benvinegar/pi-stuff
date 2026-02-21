export function StringEnum(values: readonly string[], options: Record<string, unknown> = {}) {
  return { type: "string", enum: [...values], ...options };
}
