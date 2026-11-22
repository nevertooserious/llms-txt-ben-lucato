import { describe, expect, it } from 'vitest';
import { readBasicAuthCredentials } from '../composition/web-config';
import { basicAuthLogin, isPublicPath } from './basic-auth';

const credentials = { username: 'user1', password: 'pass1' };
const header = (text: string) => `Basic ${Buffer.from(text).toString('base64')}`;

describe('readBasicAuthCredentials', () => {
  it('defaults to user1 / pass1, including when the variables are empty', () => {
    expect(readBasicAuthCredentials({})).toEqual(credentials);
    expect(readBasicAuthCredentials({ BASIC_AUTH_USERNAME: '', BASIC_AUTH_PASSWORD: '' })).toEqual(credentials);
  });

  it('reads the environment', () => {
    expect(readBasicAuthCredentials({ BASIC_AUTH_USERNAME: 'a', BASIC_AUTH_PASSWORD: 'b' })).toEqual({
      username: 'a',
      password: 'b',
    });
  });
});

describe('basicAuthLogin', () => {
  it('reads the username and password, whatever the scheme case', () => {
    expect(basicAuthLogin(header('user1:pass1'))).toEqual(credentials);
    expect(basicAuthLogin(header('user1:pass1').replace('Basic', 'basic'))).toEqual(credentials);
  });

  it('keeps a colon in the password', () => {
    expect(basicAuthLogin(header('user1:pa:ss'))).toEqual({ username: 'user1', password: 'pa:ss' });
  });

  it.each([
    ['no header', null],
    ['an empty header', ''],
    ['another scheme', 'Bearer dXNlcjE6cGFzczE='],
    ['no colon', header('user1pass1')],
    ['malformed base64', 'Basic !!!'],
  ])('reads nothing from %s', (_name, value) => {
    expect(basicAuthLogin(value)).toBeNull();
  });
});

describe('isPublicPath', () => {
  it.each(['/login', '/w/abc/llms.txt', '/_next/static/chunks/app.js', '/_next/webpack-hmr'])('leaves %s public', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/login/extra',
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
