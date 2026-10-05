import { Hono } from 'hono';
import type { Env, AppVariables, CategoryRow } from '../types';

const categories = new Hono<{ Bindings: Env; Variables: AppVariables }>();

categories.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM categories ORDER BY name COLLATE NOCASE'
  ).all<CategoryRow>();

  return c.json({ data: results });
});

export default categories;
