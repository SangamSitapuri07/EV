import { test, expect } from "@playwright/test";

test.describe("VoltPark City E2E Smoke Suite", () => {
  test("Landing page -> Explore -> Facility Detail & Pricing Estimate", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Find Smart Parking &")).toBeVisible();

    await page.getByRole("link", { name: /Explore Map/i }).first().click();
    await expect(page).toHaveURL(/\/explore/);

    await expect(page.getByText("Sarabha Nagar Central Plaza")).toBeVisible();
    await page.getByRole("link", { name: /Book Bay/i }).first().click();

    await expect(page.getByText("Reserve & Pay (Sandbox)")).toBeVisible();
    await expect(page.getByText(/Price Breakdown/i)).toBeVisible();
  });

  test("Customer Demo Login -> Dashboard -> Bookings & Vehicles", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /Customer Demo/i }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText(/Welcome back/i)).toBeVisible();
  });
});
