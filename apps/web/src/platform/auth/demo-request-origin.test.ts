import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveDemoRequestOrigin,
  resolveTrustedDemoRequestOrigin,
} from './demo-request-origin.ts';

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
  assert.equal(
    resolveTrustedDemoRequestOrigin(new Request('http://localhost:3157/api/demo', {
      headers: { referer: 'http://127.0.0.1:3157/teacher/demo-control' },
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

test('uses the proxy-owned host and scheme for public same-origin checks', () => {
  const previous = process.env.DGBOOK_TRUST_PROXY;
  try {
    process.env.DGBOOK_TRUST_PROXY = '1';
    const request = new Request('http://127.0.0.1:3157/api/demo', {
      headers: {
        host: 'teacher.8-153-206-97.nip.io',
        origin: 'http://teacher.8-153-206-97.nip.io',
        'x-forwarded-proto': 'http',
      },
    });
    assert.equal(
      resolveDemoRequestOrigin(request),
      'http://teacher.8-153-206-97.nip.io',
    );
    assert.equal(
      resolveTrustedDemoRequestOrigin(request),
      'http://teacher.8-153-206-97.nip.io',
    );
  } finally {
    if (previous === undefined) delete process.env.DGBOOK_TRUST_PROXY;
    else process.env.DGBOOK_TRUST_PROXY = previous;
  }
});
