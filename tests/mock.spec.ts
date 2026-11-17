import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * Full-pipeline E2E in mock mode (RAG_MOCK=1) — no API key, no paid calls.
 * Exercises: upload -> indexing status -> retrieval -> streamed answer ->
 * citations bound to the uploaded document, plus stop and mobile files tab.
 */

const SAMPLE = path.join(__dirname, 'fixtures', 'sample.txt');

test.describe('Mock-mode pipeline', () => {
  test('upload, index, ask, and see citations from the uploaded document', async ({ page }) => {
    await page.goto('/');

    // Upload a document (desktop sidebar zone)
    const input = page.locator('aside input[type="file"]');
    await input.setInputFiles(SAMPLE);

    // Document appears in the sidebar and becomes ready (indexed)
    await expect(page.getByText('sample.txt').first()).toBeVisible();
    await expect(page.getByText('Indexed').first()).toBeVisible({ timeout: 15000 });

    // Header switches to research mode
    await expect(page.getByText(/Research mode/)).toBeVisible();

    // Ask something the document answers
    const chatInput = page.getByPlaceholder(/Ask a question about your documents/i);
    await chatInput.fill('Who was the first person to land on the Moon?');
    await chatInput.press('Enter');

    // Mock answer streams back
    await expect(page.getByText(/Mock answer/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/I retrieved \d+ relevant chunk/i)).toBeVisible();

    // Citations are bound to the actual uploaded document
    await expect(page.getByText('Sources', { exact: true })).toBeVisible();
    const chip = page.getByRole('button', { name: 'sample.txt', exact: true });
    await expect(chip).toBeVisible();

    // Expanding the citation shows the retrieved snippet
    await chip.click();
    await expect(page.getByText(/Sea of Tranquility|Apollo 11/i).first()).toBeVisible();
  });

  test('plain chat works without documents in mock mode', async ({ page }) => {
    await page.goto('/');
    const chatInput = page.getByPlaceholder(/Ask me anything or chat/i);
    await chatInput.fill('Hello there');
    await chatInput.press('Enter');
    await expect(page.getByText(/plain chat path/i)).toBeVisible({ timeout: 15000 });
  });

  test('stop button halts streaming', async ({ page }) => {
    await page.goto('/');
    const chatInput = page.getByPlaceholder(/Ask me anything or chat/i);
    await chatInput.fill('Tell me a long story');
    await chatInput.press('Enter');

    const stop = page.getByRole('button', { name: /Stop generating/i });
    await expect(stop).toBeVisible();
    await stop.click();

    // After stopping, the send button returns
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible({ timeout: 10000 });
  });

  test('mobile: files tab exposes upload and documents', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Upload zone is behind the Files tab on mobile
    await page.getByRole('button', { name: 'Files' }).click();
    const filesPanel = page.locator('main');
    await expect(filesPanel.getByText('Drop files here or click to browse')).toBeVisible();

    const input = filesPanel.locator('input[type="file"]');
    await input.setInputFiles(SAMPLE);

    // Upload switches back to chat; the Files nav badge shows one document
    await expect(page.getByRole('button', { name: /Files/ })).toContainText('1', { timeout: 10000 });

    // The document is listed and indexed under the Files tab
    await page.getByRole('button', { name: /Files/ }).click();
    await expect(filesPanel.getByText('sample.txt')).toBeVisible();
    await expect(filesPanel.getByText('Indexed')).toBeVisible({ timeout: 15000 });

    // Back to chat
    await page.getByRole('button', { name: 'Chat' }).click();
    await expect(page.getByPlaceholder(/Ask a question about your documents/i)).toBeVisible();
  });

  test('server rejects unsupported file types with a clear error', async ({ page }) => {
    await page.goto('/');
    // Craft an unsupported upload through the API contract the client uses
    const res = await page.request.post('/api/upload', {
      multipart: {
        file: {
          name: 'evil.exe',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('MZ fake binary'),
        },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unsupported file type/i);
  });

  test('query endpoint validates sessionId', async ({ page }) => {
    const res = await page.request.post('/api/query', {
      data: { sessionId: 'bad id!', query: 'hi' },
    });
    expect(res.status()).toBe(400);
  });
});
