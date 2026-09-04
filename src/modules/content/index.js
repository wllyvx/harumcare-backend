import { ValidationError, NotFoundError, ForbiddenError, ConflictError } from './errors.js';

export function createContentModule({ db, media, youtubeFetcher } = {}) {
  if (!db) throw new Error('createContentModule requires db');
  if (!media) throw new Error('createContentModule requires media');

  async function list(query) {
    throw new Error('not implemented: list');
  }

  async function getBySlug(slug) {
    throw new Error('not implemented: getBySlug');
  }

  async function create(dto, user) {
    throw new Error('not implemented: create');
  }

  async function update(id, dto, user) {
    throw new Error('not implemented: update');
  }

  async function remove(id, user) {
    throw new Error('not implemented: remove');
  }

  async function categories(type) {
    throw new Error('not implemented: categories');
  }

  return { list, getBySlug, create, update, remove, categories };
}

export { ValidationError, NotFoundError, ForbiddenError, ConflictError };
