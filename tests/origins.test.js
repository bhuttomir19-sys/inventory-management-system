import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigins, validOrigin } from '../origins.js';
const req = (origin, forwarded = {}) => ({ protocol: 'http', headers: { origin, ...forwarded }, get: () => 'localhost:3000' });
test('accepts local requests and the exact configured Codespaces origin', () => {
 const origins = publicOrigins({ CODESPACES: 'true', CODESPACE_NAME: 'my-workspace', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' });
 assert.deepEqual(origins, ['https://my-workspace-3000.app.github.dev']);
 assert.equal(validOrigin(req('http://localhost:3000'), origins), true);
 assert.equal(validOrigin(req(origins[0]), origins), true);
 assert.equal(validOrigin(req(undefined), origins), true);
 assert.equal(validOrigin(req('https://other-workspace-3000.app.github.dev'), origins), false);
 assert.equal(validOrigin(req('https://my-workspace-3000.app.github.dev.attacker.example'), origins), false);
});
test('does not trust forged forwarding headers or activate Codespaces outside that environment', () => {
 assert.deepEqual(publicOrigins({ CODESPACE_NAME: 'my-workspace' }), []);
 assert.equal(validOrigin(req('https://attacker.example', {'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https'}), []), false);
});
test('explicit reverse-proxy origins must be valid origins', () => {
 assert.deepEqual(publicOrigins({ APP_ORIGIN: 'https://trade.example/' }), ['https://trade.example']);
 for(const origin of ['https://trade.example/path','https://user:pass@trade.example','file:///tmp/example','https://trade.example/?x=1'])assert.throws(()=>publicOrigins({APP_ORIGIN:origin}));
});
