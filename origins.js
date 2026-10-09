// Trust configured public origins, not arbitrary forwarded request headers.
export function publicOrigins(env = process.env) {
  const origins = [];
  if (env.APP_ORIGIN) {
    const url = new URL(env.APP_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('APP_ORIGIN must be an HTTP(S) origin without a path or credentials');
    }
    origins.push(url.origin);
  }
  if (env.CODESPACES === 'true' && env.CODESPACE_NAME) {
    const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || 'app.github.dev';
    if (!/^[a-zA-Z0-9-]+$/.test(env.CODESPACE_NAME) || !/^[a-zA-Z0-9.-]+$/.test(domain)) {
      throw new Error('Invalid Codespaces forwarding configuration');
    }
    origins.push(`https://${env.CODESPACE_NAME}-${env.PORT || 3000}.${domain}`);
    // Codespaces' HTTPS forwarding proxy can rewrite Origin to its local target.
    // Accept only this exact alias, and only in the Codespaces environment.
    origins.push(`https://localhost:${env.PORT || 3000}`);
  }
  return [...new Set(origins)];
}
export function validOrigin(req, configuredOrigins) {
  const origin = req.headers.origin;
  return !origin || origin === `${req.protocol}://${req.get('host')}` || configuredOrigins.includes(origin);
}
