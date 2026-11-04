import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectReactInHtml } from '../src/analysis/reactDetection';

describe('detectReactInHtml', () => {
  it('recognizes Next.js markup', () => {
    const html = '<div id="__next"></div><script id="__NEXT_DATA__" type="application/json">{}</script>';
    assert.deepEqual(detectReactInHtml({ html }), ['next.js']);
  });

  it('recognizes data-reactroot and a react-dom script', () => {
    const html = '<div data-reactroot=""></div><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>';
    assert.deepEqual(detectReactInHtml({ html }), ['data-reactroot', 'react-script']);
  });

  it('does not treat a bare #root client-rendered shell as proof', () => {
    assert.deepEqual(detectReactInHtml({ html: '<div id="root"></div><script src="/assets/index-abc.js"></script>' }), []);
  });

  it('does not match Preact or unrelated libraries named react-*', () => {
    assert.deepEqual(detectReactInHtml({ html: '<script src="/preact.min.js"></script><script src="/vendor/react-select.js"></script>' }), []);
  });
});
