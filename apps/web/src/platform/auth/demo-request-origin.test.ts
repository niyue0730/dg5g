import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveTrustedDemoRequestOrigin } from './demo-request-origin.ts';

test('accepts exact origins and equivalent loopback host aliases', () => {
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('https://teacher.demo.example.com/api/demo', {
      headers: { origin: 'https://teacher.demo.example.com' },
    })),
    'https://teacher.demo.example.com',
  );
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('http://localhost:3157/api/demo', {
      headers: { origin: 'http://127.0.0.1:3157' },
    })),
    'http://127.0.0.1:3157',
  );
});

test('rejects public mismatches, loopback port mismatches and cross-site fetches', () => {
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('https://teacher.demo.example.com/api/demo', {
      headers: { origin: 'https://evil.example' },
    })),
    null,
  );
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('http://localhost:3157/api/demo', {
      headers: { origin: 'http://127.0.0.1:3158' },
    })),
    null,
  );
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('http://localhost:3157/api/demo', {
      headers: {
        origin: 'http://localhost:3157',
        'sec-fetch-site': 'cross-site',
      },
    })),
    null,
  );
});
