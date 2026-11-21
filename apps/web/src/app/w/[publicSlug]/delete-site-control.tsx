'use client';

import { useState } from 'react';
import { deleteSite, SiteApiError } from './site-api';

interface DeleteSiteControlProps {
  publicSlug: string;
  onDeleted: () => void;
}

export function DeleteSiteControl({ publicSlug, onDeleted }: DeleteSiteControlProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function confirmDelete() {
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteSite(publicSlug);
      onDeleted();
    } catch (error) {
      if (error instanceof SiteApiError && error.status === 404) {
        onDeleted();
        return;
      }
      setErrorMessage(error instanceof SiteApiError ? error.message : 'Something went wrong.');
    } finally {
      setIsDeleting(false);
    }
  }

  if (!isConfirming) {
    return (
      <div className="delete-site">
        <button type="button" className="button button-danger" onClick={() => setIsConfirming(true)}>
          Delete site
        </button>
      </div>
    );
  }

  return (
    <div className="delete-site">
      <p className="hint">This permanently removes your llms.txt, its hosted URL and its version history.</p>
      <div className="confirm-actions">
        <button type="button" className="button button-danger" disabled={isDeleting} onClick={confirmDelete}>
          {isDeleting ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button type="button" className="button" disabled={isDeleting} onClick={() => setIsConfirming(false)}>
          Cancel
        </button>
      </div>
      {errorMessage && (
        <p className="form-error" role="status">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
