// swagger-ui-dist ships no types. This is the one call the docs screen makes.
declare module 'swagger-ui-dist/swagger-ui-es-bundle.js' {
  const SwaggerUIBundle: (options: { domNode: HTMLElement; url: string; deepLinking?: boolean }) => unknown;
  export default SwaggerUIBundle;
}
