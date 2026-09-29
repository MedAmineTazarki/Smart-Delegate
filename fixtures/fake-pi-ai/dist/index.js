// Minimal stand-in for pi-ai's public API (test fixture): enough for the
// embedded agent to build tools and providers. Schemas are plain JSON Schema.
export const Type = {
  Object: (properties) => ({ type: "object", properties, required: Object.keys(properties).filter((k) => !properties[k].optional) }),
  String: () => ({ type: "string" }),
  Number: () => ({ type: "number" }),
  Optional: (schema) => ({ ...schema, optional: true }),
};
export const createProvider = (spec) => spec;
export const envApiKeyAuth = (name, vars) => ({ name, vars });
