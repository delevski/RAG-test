import { test, expect } from '@playwright/test';

test.describe('Smart Research Assistant - Smoke Tests', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Smart Research Assistant');
  });

  test('should display upload zone', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Drop files here or click to browse')).toBeVisible();
  });

  test('should allow chat without documents', async ({ page }) => {
    await page.goto('/');
    
    // Check that initial message is shown
    await expect(page.getByText(/I can help you with questions or chat/i)).toBeVisible();
    
    // Type a message
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    await input.fill('Hello, what is 2+2?');
    await input.press('Enter');
    
    // Wait for response
    await expect(page.getByText(/4|four/i)).toBeVisible({ timeout: 10000 });
  });

  test('should show sidebar with documents section', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Documents')).toBeVisible();
    await expect(page.getByText('New Session')).toBeVisible();
  });

  test('should keep input field visible when scrolling', async ({ page }) => {
    await page.goto('/');
    
    // Send multiple messages to create scrollable history
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    for (let i = 0; i < 5; i++) {
      await input.fill(`Test message ${i}`);
      await input.press('Enter');
      await page.waitForTimeout(1000);
    }
    
    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    
    // Input should still be visible (sticky at bottom)
    await expect(input).toBeInViewport();
  });

  test('should handle file upload UI', async ({ page }) => {
    await page.goto('/');
    
    const uploadZone = page.getByText('Drop files here or click to browse');
    await expect(uploadZone).toBeVisible();
    
    // Check that upload zone is clickable
    await uploadZone.click();
  });
});

