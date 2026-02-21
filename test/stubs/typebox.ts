export const Type = {
  Object: (shape: Record<string, unknown>) => ({ type: "object", properties: shape }),
  String: (options: Record<string, unknown> = {}) => ({ type: "string", ...options }),
  Number: (options: Record<string, unknown> = {}) => ({ type: "number", ...options }),
  Boolean: (options: Record<string, unknown> = {}) => ({ type: "boolean", ...options }),
  Optional: (schema: Record<string, unknown>) => ({ ...schema, optional: true }),
};
