import { test, expect } from "@playwright/test";
import { chooseOption } from "./support/ui";
const root = "/dashboard/120000000000000001/overview";
const hydrationError =
  /hydrat|server rendered|minified react error #(418|425)|react\.dev\/errors\/(418|425)/i;
for (const [zone, clientTime] of [
  ["America/Los_Angeles", "2026-03-08T09:59:59Z"], // just before US DST jump
  ["Asia/Tokyo", "2026-10-25T01:30:00Z"], // Berlin's repeated autumn hour
  ["Pacific/Kiritimati", "2030-01-01T10:01:00Z"], // different calendar year/day/UTC+14
]) {
  test.describe(`serialized SSR activity with browser timezone ${zone}`, () => {
    test.use({ timezoneId: zone });
    test("keeps server labels/values/reference unchanged at hydration despite a different client clock", async ({
      page,
    }) => {
      const errors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.clock.setFixedTime(new Date(clientTime));
      let serverHtml = "";
      await page.route(`**${root}`, async (route) => {
        const response = await route.fetch();
        serverHtml = await response.text();
        await route.fulfill({ response, body: serverHtml });
      });
      await page.goto(root);
      await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
      const serialized = (name: string) => {
        const match = serverHtml.match(new RegExp(`${name}="([^"]+)"`));
        expect(
          match,
          `meaningful SSR must already contain ${name}`
        ).not.toBeNull();
        return match![1];
      };
      const chart = page.locator("[data-activity-reference]");
      expect(await chart.getAttribute("data-activity-reference")).toBe(
        serialized("data-activity-reference")
      );
      expect(await chart.getAttribute("data-activity-timezone")).toBe(
        "Europe/Berlin"
      );
      expect(
        await chart.locator("svg").getAttribute("data-activity-labels")
      ).toBe(serialized("data-activity-labels"));
      expect(
        await chart.locator("svg").getAttribute("data-activity-values")
      ).toBe(serialized("data-activity-values"));
      await expect(chart.locator("[data-activity-day]")).toHaveCount(7);
      await chart.locator("summary").click();
      await expect(chart.locator("tbody tr")).toHaveCount(7);
      await chooseOption(page, "Chart metric", "Rewarded members");
      await expect(
        chart.getByRole("columnheader", {
          name: "Rewarded members",
          exact: true,
        })
      ).toBeVisible();
      for (const days of [14, 30]) {
        await page
          .getByRole("button", {
            name: `Last ${days === 14 ? 7 : 14} days`,
            exact: true,
          })
          .click();
        await page
          .getByRole("menuitem", { name: `Last ${days} days`, exact: true })
          .click();
        await expect(chart.locator("[data-activity-day]")).toHaveCount(days);
        await expect(chart.locator("tbody tr")).toHaveCount(days);
        await expect(
          chart.getByText(`Previous ${days} days`, { exact: true })
        ).toBeVisible();
        const keys = await chart
          .locator("[data-activity-day]")
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute("data-activity-day"))
          );
        expect(new Set(keys).size).toBe(days);
      }
      expect(errors.filter((message) => hydrationError.test(message))).toEqual(
        []
      );
      expect(pageErrors).toEqual([]);
      await expect(
        chart.getByText("Sample activity", { exact: true })
      ).toBeVisible();
      await expect(
        chart.getByText(/Illustrative samples, not production measurements/)
      ).toBeVisible();
    });
  });
}
