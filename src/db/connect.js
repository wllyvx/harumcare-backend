import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.js';

export const createDbClient = (d1) => {
    return drizzle(d1, { schema });
};
