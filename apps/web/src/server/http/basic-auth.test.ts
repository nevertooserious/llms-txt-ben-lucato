import { describe, expect, it } from 'vitest';
import { basicAuthCredentials, isAuthorised, isPublicPath } from './basic-auth';

const credentials = { username: 'user1', password: 'pass1' };
const header = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`;

describe('basicAuthCredentials', () => {
  it('defaults to user1 / pass1, including when the variables are empty', () => {
    expect(basicAuthCredentials({})).toEqual(credentials);
    expect(basicAuthCredentials({ BASIC_AUTH_USERNAME: '', BASIC_AUTH_PASSWORD: '' })).toEqual(credentials);
  });

  it('reads the environment', () => {
    expect(basicAuthCredentials({ BASIC_AUTH_USERNAME: 'a', BASIC_AUTH_PASSWORD: 'b' })).toEqual({
      username: 'a',
      password: 'b',
    });
  });
});

describe('isAuthorised', () => {
  it('accepts the right credentials, whatever the scheme case', () => {
    expect(isAuthorised(header('user1:pass1'), credentials)).toBe(true);
    expect(isAuthorised(header('user1:pass1').replace('Basic', 'basic'), credentials)).toBe(true);
  });

  it('keeps a colon in the password', () => {
    expect(isAuthorised(header('user1:pa:ss'), { username: 'user1', password: 'pa:ss' })).toBe(true);
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['another scheme', 'Bearer dXNlcjE6cGFzczE='],
    ['a wrong password', header('user1:wrong')],
    ['a wrong username', header('other:pass1')],
    ['no colon', header('user1pass1')],
    ['an empty password', header('user1:')],
    ['malformed base64', 'Basic !!!'],
  ])('refuses %s', (_name, value) => {
    expect(isAuthorised(value, credentials)).toBe(false);
  });
});

describe('isPublicPath', () => {
  it.each(['/w/abc/llms.txt', '/_next/static/chunks/app.js', '/_next/webpack-hmr'])('leaves %s public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/w/abc',
    '/w/abc/llms.txt/extra',
    '/w/a/b/llms.txt',
    '/api/sites',
    '/api/sites/abc/versions/1/llms.txt',
    '/api/sites/abc/runs/1/llms.txt',
    '/_next/image',
  ])('protects %s', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});
