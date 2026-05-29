import { z } from 'zod';

export function lazySchema<T extends z.ZodType>(factory: () => T): () => T {
  let schema: T | undefined;

  return () => {
    if (!schema) {
      schema = factory();
    }
    return schema;
  };
}