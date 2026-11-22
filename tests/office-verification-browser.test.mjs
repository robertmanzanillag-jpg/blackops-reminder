import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { launchOfficeUiFixture } from '../script/software-factory-office-ui-fixture.mjs';
import { buildOfficeVerification } from '../server/office-verification.ts';
import { emptyCouncilState } from '../shared/agent-council.ts';

test('compiled office verification journeys: owner, errors, keyboard, map and mobile', { timeout: 120000 }, async () => {
  // The fixture externalizes its auth dependencies; keep its temporary module
  // under the repository so Node resolves the reviewed local packages.
  const previousTmp = process.env.TMPDIR;
  let fixture;
  try {
    const tempRoot = path.resolve('.cache/office-verification');
    await mkdir(tempRoot, { recursive: true });
    process.env.TMPDIR = tempRoot;
    fixture = await launchOfficeUiFixture(path.resolve('dist/public'), 'a'.repeat(40));
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }
  let browser;
  const artifacts = process.env.OFFICE_VERIFICATION_QA_DIR || '/tmp/office-verification-qa';
  await mkdir(artifacts, { recursive: true });
  try {
    browser = await chromium.launch({ channel: process.env.OFFICE_QA_BROWSER_CHANNEL || undefined, args: ['--no-sandbox'] });
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
      try {
        // Exercise the same shared DOM panel in the supported building view;
        // the separate office browser suite covers the continuous 3D scene.
        await context.addInitScript(() => localStorage.setItem('agentsOffice.view.v2', 'building'));
        const page = await context.newPage(), errors = [], consoleErrors = [], failedResponses = [];
        page.setDefaultTimeout(15000);
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
        page.on('response', response => {
          const pathname = new URL(response.url()).pathname;
          if (response.status() >= 400 && !(response.status() === 401 && pathname === '/api/auth/me') && !(response.status() === 503 && pathname === '/api/agents-office/verification')) failedResponses.push(`${response.status()} ${pathname}`);
        });
        let reads = 0, fail = false, partner = false;
        const report = buildOfficeVerification(emptyCouncilState(), 'fixture-owner', Date.now(), {});
        await context.route('**/api/workspace/me', route => route.fulfill({ json: { role: partner ? 'partner' : 'owner', canManagePartners: !partner, blackRoomScope: null } }));
        await context.route('**/api/agents-office/verification', route => { reads++; return route.fulfill(fail ? { status: 503, json: { error: 'Evidence unavailable' } } : { json: report }); });
        await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
        await page.goto(new URL('/agents-office', fixture.baseUrl).href);
        await page.getByLabel('Usuario', { exact: true }).fill('fixture-owner');
        await page.getByLabel('Password', { exact: true }).fill('local-fixture-password');
        await page.getByRole('button', { name: 'Entrar', exact: true }).last().click();
        const open = page.getByTestId('open-office-verification');
        await open.waitFor();
        assert.equal(reads, 0, 'opening the office must not run the report or any agent');
        await open.click();
        await page.getByTestId('office-verification-evals').waitFor();
        assert.match(await page.getByTestId('office-verification-improvements').innerText(), /Todavía no hay mejoras verificadas/);
        for (const id of ['feedback', 'evals', 'guardrails', 'feature-map', 'limitations']) assert.equal(await page.getByTestId(`office-verification-${id}`).isVisible(), true);
        const dialog = page.getByTestId('office-verification-dialog');
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        for (const feature of report.featureMap) assert.equal(await page.getByTestId(`office-verification-feature-${feature.id}`).getAttribute('href'), feature.route);
        await page.screenshot({ path: path.join(artifacts, `verification-${viewport.width}.png`), fullPage: true });
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        // Radix restores focus asynchronously after the content unmounts.
        // Observe that restoration rather than racing it or focusing the trigger.
        await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'open-office-verification');
        assert.equal(await open.evaluate(element => element === document.activeElement), true);
        await open.click();
        await page.getByTestId('office-verification-evals').waitFor();
        fail = true;
        await page.getByTestId('refresh-office-verification').click();
        await page.getByRole('alert').filter({ hasText: 'No se pudo verificar' }).waitFor();
        assert.equal(await page.getByTestId('office-verification-improvements').count(), 0, 'stale success must disappear on a failed read');
        fail = false;
        await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
        await page.getByTestId('office-verification-evals').waitFor();
        for (const reference of report.mechanisms.guardrails.references) assert.equal(await page.getByText(reference.source, { exact: true }).isVisible(), true);
        await page.getByTestId('office-verification-feature-runs').click();
        await page.getByRole('heading', { name: 'Trabajo real de agentes', exact: true }).waitFor();
        await page.goto(new URL(report.featureMap.find(feature => feature.id === 'verification').route, fixture.baseUrl).href);
        await page.getByTestId('office-verification-evals').waitFor();
        await page.getByTestId('office-verification-feature-qa').click();
        await page.waitForURL('**/app-qa-agent');
        assert.equal(new URL(page.url()).pathname, '/app-qa-agent');
        partner = true;
        await page.goto(new URL('/agents-office', fixture.baseUrl).href);
        await page.getByTestId('button-back-home').waitFor();
        assert.equal(await page.getByTestId('open-office-verification').count(), 0);
        assert.deepEqual(errors, []);
        assert.deepEqual(failedResponses, []);
        assert.deepEqual(consoleErrors.filter(error => !(
          error.url.endsWith('/api/auth/me') && /401/.test(error.text) ||
          error.url.endsWith('/api/agents-office/verification') && /503/.test(error.text)
        )), []);
      } finally { await context.close(); }
    }
  } finally { await browser?.close(); await fixture.close(); }
});

test('compiled Academy text remains visible below wrapped mobile office controls', { timeout: 60000 }, async () => {
  const previousTmp = process.env.TMPDIR;
  let fixture;
  try {
    const tempRoot = path.resolve('.cache/office-verification');
    await mkdir(tempRoot, { recursive: true });
    process.env.TMPDIR = tempRoot;
    fixture = await launchOfficeUiFixture(path.resolve('dist/public'), 'a'.repeat(40));
  } finally {
    if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp;
  }

  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.OFFICE_QA_BROWSER_CHANNEL || undefined, args: ['--no-sandbox'] });
    for (const { width, height, isMobile } of [
      { width: 390, height: 844, isMobile: true },
      { width: 1440, height: 900, isMobile: false },
    ]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch: isMobile, serviceWorkers: 'block' });
      try {
        const origin = new URL(fixture.baseUrl).origin;
        await context.route('**/*', route => {
          const request = route.request();
          const url = new URL(request.url());
          if (url.origin === origin && request.method() === 'GET') return route.continue();
          if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
          return route.abort();
        });
        assert.equal((await context.request.post(new URL('/api/auth/login', origin).href, { data: { username: 'fixture-owner', password: 'local-fixture-password' } })).status(), 200);
        await context.route('**/api/workspace/me', route => route.fulfill({ json: { role: 'owner', canManagePartners: true, blackRoomScope: null } }));
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(new URL('/agents-office', origin).href);
        const improvements = page.getByTestId('office-kong-mirror-slot').getByRole('button', { name: /Mejoras KONG/ });
        await improvements.waitFor();
        await page.getByTestId('world-blackroom-academy').click();
        const panel = page.getByTestId('world-blackroom-academy-panel');
        await panel.getByText(/evaluaciones hoy/).waitFor();

        const inspect = () => panel.evaluate(element => {
          const { clientWidth, clientHeight } = document.documentElement;
          const { width: visualWidth, height: visualHeight } = window.visualViewport ?? { width: clientWidth, height: clientHeight };
          const rect = element.getBoundingClientRect();
          const visibleWidth = Math.min(clientWidth, visualWidth);
          const visibleHeight = Math.min(clientHeight, visualHeight);
          const mirror = document.querySelector('[data-testid="office-kong-mirror-slot"] button');
          const mirrorRect = mirror.getBoundingClientRect();
          const covered = [];
          let textRects = 0;
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const text = walker.currentNode.textContent.trim();
            if (!text) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            for (const line of range.getClientRects()) {
              const left = Math.max(line.left, rect.left, 0);
              const top = Math.max(line.top, rect.top, 0);
              const right = Math.min(line.right, rect.right, visibleWidth);
              const bottom = Math.min(line.bottom, rect.bottom, visibleHeight);
              if (right <= left || bottom <= top) continue;
              textRects++;
              // Sample near each edge as well as the middle of the full glyph box.
              for (const x of [left + .25, (left + right) / 2, right - .25]) {
                for (const y of [top + .25, (top + bottom) / 2, bottom - .25]) {
                  if (!element.contains(document.elementFromPoint(x, y))) covered.push({ text, x, y });
                }
              }
            }
          }
          return { panelTop: rect.top, panelBottom: rect.bottom, clientWidth, visibleHeight,
            mirrorBottom: mirrorRect.bottom, textRects, covered };
        });
        for (const mobileWidth of isMobile ? [390, 320, 390] : [width]) {
          await page.setViewportSize({ width: mobileWidth, height });
          // Let the browser deliver ResizeObserver notifications after wrapping.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const layout = await inspect();
          assert.equal(layout.clientWidth, mobileWidth);
          assert.ok(layout.textRects >= 5, JSON.stringify(layout));
          assert.deepEqual(layout.covered, [], JSON.stringify(layout));
          assert.ok(layout.panelBottom <= layout.visibleHeight, JSON.stringify(layout));
          if (isMobile) assert.ok(layout.panelTop >= layout.mirrorBottom, JSON.stringify(layout));
          else assert.equal(layout.panelTop, 96, 'desktop keeps its existing top offset');
        }

        await panel.getByRole('button', { name: 'Cerrar academia Black Room', exact: true }).click();
        await panel.waitFor({ state: 'hidden' });
        await improvements.click({ trial: true });
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await fixture.close();
  }
});
