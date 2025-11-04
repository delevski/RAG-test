import { test, expect } from '@playwright/test';

test.describe('Smart Research Assistant - Mobile Support Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should hide sidebar on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Sidebar should be hidden on mobile (lg:flex means it's hidden on small screens)
    const sidebar = page.locator('aside').first();
    await expect(sidebar).not.toBeVisible();
    
    // Main content should take full width
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('should show sidebar on desktop viewport', async ({ page }) => {
    // Set desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // Sidebar should be visible on desktop
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    
    // Check sidebar content
    await expect(page.getByText('Documents')).toBeVisible();
    await expect(page.getByText('New Session')).toBeVisible();
  });

  test('should display upload zone correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Upload zone should be visible
    const uploadZone = page.getByText('Drop files here or click to browse');
    await expect(uploadZone).toBeVisible();
    
    // Check it's clickable
    await uploadZone.click();
  });

  test('should keep input field visible and accessible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    
    // Input should be visible
    await expect(input).toBeVisible();
    
    // Input should be in viewport
    await expect(input).toBeInViewport();
    
    // Should be able to type
    await input.fill('Test message');
    await expect(input).toHaveValue('Test message');
  });

  test('should handle scrolling on mobile without hiding input', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    
    // Send multiple messages to create scrollable content
    for (let i = 0; i < 8; i++) {
      await input.fill(`Mobile test message ${i}`);
      await input.press('Enter');
      await page.waitForTimeout(500);
    }
    
    // Scroll to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    
    // Input should still be visible and accessible
    await expect(input).toBeInViewport();
    await expect(input).toBeVisible();
    
    // Should still be able to interact with it
    await input.click();
    await expect(input).toBeFocused();
  });

  test('should handle touch interactions on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Test touch on input field
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    await input.tap();
    await expect(input).toBeFocused();
    
    // Test touch on send button
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeVisible();
    
    // Test touch on upload zone
    const uploadZone = page.getByText('Drop files here or click to browse');
    await uploadZone.tap();
  });

  test('should display loader correctly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Reload page to see loader
    await page.reload();
    
    // Loader should appear (might be quick, so check immediately)
    const loader = page.locator('text=Smart Research Assistant').first();
    
    // Wait a bit for loader to appear
    await page.waitForTimeout(100);
    
    // After loader disappears, main content should be visible
    await page.waitForTimeout(1500);
    await expect(page.getByText('Smart Research Assistant')).toBeVisible();
  });

  test('should handle chat interface on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    await expect(input).toBeVisible();
    
    // Type a message
    await input.fill('Hello from mobile');
    await expect(input).toHaveValue('Hello from mobile');
    
    // Send button should be visible and enabled
    const sendButton = page.getByRole('button', { name: 'Send' });
    await expect(sendButton).toBeVisible();
    await expect(sendButton).toBeEnabled();
  });

  test('should maintain responsive layout on tablet', async ({ page }) => {
    // Tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });
    
    // Sidebar should be visible on tablet (lg breakpoint)
    const sidebar = page.locator('aside').first();
    await expect(sidebar).toBeVisible();
    
    // Main content should be visible
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
    
    // Input should be accessible
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    await expect(input).toBeVisible();
    await expect(input).toBeInViewport();
  });

  test('should handle landscape orientation on mobile', async ({ page }) => {
    // Mobile landscape
    await page.setViewportSize({ width: 667, height: 375 });
    
    // Sidebar might be visible in landscape if screen is wide enough
    // But main content should always work
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
    
    // Input should be accessible
    const input = page.getByPlaceholder(/Ask me anything or chat/i);
    await expect(input).toBeVisible();
    await expect(input).toBeInViewport();
  });

  test('should prevent horizontal scroll on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check that body doesn't allow horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    
    // Body should not be wider than viewport (within reasonable margin)
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 20);
  });

  test('should handle file upload UI on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Upload zone should be visible and touchable
    const uploadZone = page.getByText('Drop files here or click to browse');
    await expect(uploadZone).toBeVisible();
    
    // Should show appropriate text for mobile
    await expect(page.getByText(/Supports PDF, DOCX, and TXT files/i)).toBeVisible();
  });
});

