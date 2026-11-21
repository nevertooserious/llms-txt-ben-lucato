'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { saveWorkspace, secretLinkPath } from '../browser/saved-workspaces';

interface SubmitResponse {
  publicSlug?: string;
  accessToken?: string;
  error?: string;
}

export function SubmitSiteForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = String(new FormData(event.currentTarget).get('siteUrl') ?? '').trim();
    if (typed === '') return;
    // Accept "example.com" as well as a full URL.
    const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const body = (await response.json().catch(() => ({}))) as SubmitResponse;
      if (!response.ok || !body.publicSlug || !body.accessToken) {
        throw new Error(body.error ?? 'The site could not be submitted.');
      }
      saveWorkspace({
        publicSlug: body.publicSlug,
        accessToken: body.accessToken,
        rootUrl: url,
        createdAt: new Date().toISOString(),
      });
      router.push(secretLinkPath(body.publicSlug, body.accessToken));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The site could not be submitted.');
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="url-form">
        <label htmlFor="site-url" className="visually-hidden">
          Website URL
        </label>
        <input
          id="site-url"
          name="siteUrl"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="example.com"
          required
          disabled={isSubmitting}
        />
        <button type="submit" className="button" disabled={isSubmitting}>
          {isSubmitting ? 'Starting…' : 'Generate'}
        </button>
      </div>
      {errorMessage && (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
