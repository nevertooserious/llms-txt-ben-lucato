'use client';

import { useActionState } from 'react';
import type { SignInState } from '@/shared/sign-in';

interface LoginScreenProps {
  signIn: (previous: SignInState, form: FormData) => Promise<SignInState>;
  /** Where the visitor was headed before being asked to sign in. */
  nextPath: string;
}

/** The landing page for a signed-out visitor: what the app does, beside the sign-in form. */
export function LoginScreen({ signIn, nextPath }: LoginScreenProps) {
  const [state, submit, isPending] = useActionState(signIn, { errorMessage: null, username: '' });

  return (
    <main className="login">
      <section className="login-pitch">
        <span className="label">For any website</span>
        <h1 className="hero-title">
          An <em>llms.txt</em> for your site,
          <br />
          kept current.
        </h1>
        <p className="hero-lede">
          Paste a URL and let us do the rest.
        </p>
        <ol className="login-points">
          <li>
            <span className="label">01</span> Monitors your site for changes.
          </li>
          <li>
            <span className="label">02</span> Hosts the file at a stable URL and keeps it up to date.
          </li>
          <li>
            <span className="label">03</span> Flexible input rules.
          </li>
        </ol>
      </section>

      <form className="login-card" action={submit}>
        <h2 className="cell-title">Sign in</h2>
        <input type="hidden" name="next" value={nextPath} />
        <label className="login-field">
          <span className="label">Username</span>
          <input
            name="username"
            type="text"
            defaultValue={state.username}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
          />
        </label>
        <label className="login-field">
          <span className="label">Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {state.errorMessage && (
          <p className="form-error" role="alert">
            {state.errorMessage}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={isPending}>
          {isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
