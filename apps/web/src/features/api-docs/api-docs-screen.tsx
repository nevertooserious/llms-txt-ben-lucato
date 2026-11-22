'use client';

import { useEffect, useRef, useState } from 'react';
import 'swagger-ui-dist/swagger-ui.css';

/** Swagger UI over the API's OpenAPI document. Requests it sends use the session cookie. */
export function ApiDocsScreen() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [didFailToLoad, setDidFailToLoad] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    // Loaded here because the bundle is large and needs the browser.
    import('swagger-ui-dist/swagger-ui-es-bundle.js')
      .then(({ default: SwaggerUIBundle }) => {
        if (isCancelled || containerRef.current === null) return;
        SwaggerUIBundle({ domNode: containerRef.current, url: '/api/openapi.json', deepLinking: true });
      })
      .catch(() => {
        if (!isCancelled) setDidFailToLoad(true);
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  if (didFailToLoad) return <p role="alert">The API docs could not be loaded. Reload the page to try again.</p>;
  return <div ref={containerRef} className="api-docs" />;
}
