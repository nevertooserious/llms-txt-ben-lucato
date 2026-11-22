import type { Queryable } from '../connection/transaction';

export interface StoredUser {
  id: string;
  username: string;
  /** Made and checked by the web app; this package only stores it. */
  passwordHash: string;
}

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
}

const toUser = (row: UserRow): StoredUser => ({ id: row.id, username: row.username, passwordHash: row.password_hash });

export interface NewUser {
  username: string;
  passwordHash: string;
}

/**
 * Creates the user, or returns the one that already has this username unchanged: two
 * processes starting together both try to create the configured user.
 */
export async function createUserIfAbsent(database: Queryable, user: NewUser): Promise<StoredUser> {
  const inserted = await database.query<UserRow>(
    `insert into users (username, password_hash)
     values ($1, $2)
     on conflict (username) do nothing
     returning id, username, password_hash`,
    [user.username, user.passwordHash],
  );
  if (inserted.rows[0]) return toUser(inserted.rows[0]);
  const existing = await loadUserByUsername(database, user.username);
  if (existing === null) throw new Error(`user ${user.username} was deleted while it was being created`);
  return existing;
}

export async function loadUserByUsername(database: Queryable, username: string): Promise<StoredUser | null> {
  const result = await database.query<UserRow>('select id, username, password_hash from users where username = $1', [
    username,
  ]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function loadUserById(database: Queryable, userId: string): Promise<StoredUser | null> {
  const result = await database.query<UserRow>('select id, username, password_hash from users where id = $1', [userId]);
  return result.rows[0] ? toUser(result.rows[0]) : null;
}

export async function saveUserPasswordHash(database: Queryable, userId: string, passwordHash: string): Promise<void> {
  await database.query('update users set password_hash = $2 where id = $1', [userId, passwordHash]);
}
