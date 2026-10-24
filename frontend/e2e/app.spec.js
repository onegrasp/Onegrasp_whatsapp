import { test, expect } from "@playwright/test";
import { installFakeApi, signIn, PASSWORD } from "./fakeApi.js";

// Fails a test if the page throws an uncaught error.
const watchErrors = (page) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
};

test.describe("signing in and out", () => {
  test("wrong password shows an error; the right one opens the dashboard", async ({ page }) => {
    await installFakeApi(page);
    await page.goto("/");
    await page.getByLabel("Password").fill("wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid admin password");

    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByLabel("Key metrics")).toContainText("93%");
  });

  test("an expired session goes back to the sign-in screen", async ({ page }) => {
    await installFakeApi(page, { failures: { "GET /stats": { status: 401, body: { success: false, error: { code: "session_expired", message: "Your session has expired." } } } } });
    await signIn(page);
    await page.goto("/dashboard");
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("signing out tells the server, then shows the sign-in screen", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Sign out" }).first().click();
    await expect(page.getByLabel("Password")).toBeVisible();
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/auth/logout")).toBe(true);
  });
});

test.describe("contacts", () => {
  test("search waits until typing stops, then shows matches", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await page.goto("/contacts");
    await expect(page.getByRole("cell", { name: "Meena Iyer", exact: true })).toBeVisible();

    const before = api.requests.filter((r) => r.path === "/contacts").length;
    await page.getByLabel("Search contacts").pressSequentially("asha", { delay: 40 });
    await expect(page.getByRole("cell", { name: "Asha Rao", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Meena Iyer", exact: true })).toHaveCount(0);
    const searches = api.requests.filter((r) => r.path === "/contacts").slice(before);
    // One request for the finished word, not one per keystroke.
    expect(searches.length).toBe(1);
    expect(searches[0].query.search).toBe("asha");
  });

  test("files over 10 MB are refused before uploading", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await page.goto("/contacts");
    await page.getByRole("button", { name: "Import" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.alloc(11 * 1024 * 1024, "a") });
    await expect(dialog).toContainText("larger than 10 MB");
    await expect(dialog.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(api.requests.some((r) => r.path === "/contacts/upload")).toBe(false);
  });
});

test.describe("chats", () => {
  test("a reply is sent and appears in the conversation", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await page.goto("/chats");
    await page.getByRole("button", { name: /^Asha Rao/ }).click();
    await expect(page.getByLabel("Conversation", { exact: true }).getByText("Is the event on Friday?")).toBeVisible();

    await page.getByRole("textbox", { name: "Message" }).fill("Yes, 6 pm. See you there!");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByLabel("Conversation", { exact: true }).getByText("Yes, 6 pm. See you there!")).toBeVisible();
    const sent = api.requests.find((r) => r.path === "/send-message");
    expect(sent.body).toMatchObject({ phone: "+919876543210", message: "Yes, 6 pm. See you there!", type: "text" });
  });

  test("an opted-out contact shows a warning and the server's refusal", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/chats");
    await page.getByRole("button", { name: /^Ravi Kumar/ }).click();
    await expect(page.getByText("This contact opted out.").first()).toBeVisible();

    await page.getByRole("textbox", { name: "Message" }).fill("Big sale today!");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("You can reply once they message you again").first()).toBeVisible();
  });
});

test.describe("templates", () => {
  test("a new Call button starts empty and must be filled in", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/templates");
    await expect(page.getByText("event_reminder")).toBeVisible();
    await page.getByRole("button", { name: "New template" }).first().click();
    await page.getByRole("button", { name: "+ Call" }).click();
    const phone = page.getByLabel("Button phone number");
    await expect(phone).toHaveValue("");
    await expect(phone).toHaveAttribute("required", "");
  });
});

test.describe("bulk send", () => {
  test("pick recipients and a template, confirm, and the campaign starts", async ({ page }) => {
    const api = await installFakeApi(page);
    await signIn(page);
    await page.goto("/bulk");

    // The opted-out contact can't be selected.
    await expect(page.getByLabel("Select Ravi Kumar")).toBeDisabled();
    await page.getByRole("button", { name: /Select all eligible \(2\)/ }).click();
    await page.getByLabel("Template", { exact: true }).selectOption({ label: "event_reminder (approved)" });
    await page.getByRole("button", { name: "Send to 2 contacts" }).click();

    const confirm = page.getByRole("dialog");
    await expect(confirm).toContainText("Send this campaign now?");
    await confirm.getByRole("button", { name: "Send to 2" }).click();
    await expect(page.getByText(/Campaign started: 2 queued/)).toBeVisible();

    const sent = api.requests.find((r) => r.path === "/send-bulk");
    expect(sent.body.phones.sort()).toEqual(["+919876543210", "+919900112233"]);
    expect(sent.body.phones).not.toContain("+919812345678");
  });
});

test.describe("settings", () => {
  test("in production, webhook verification is shown as always on; retention is 60 days", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Settings" }).first().click();
    const dialog = page.getByRole("dialog");
    const verify = dialog.getByRole("checkbox", { name: /Verify webhook signatures/ });
    await expect(verify).toBeChecked();
    await expect(verify).toBeDisabled();
    await expect(dialog.getByLabel("Delete messages older than")).toHaveValue("60");
  });

  test("if settings can't be loaded they can't be saved over", async ({ page }) => {
    await installFakeApi(page, { failures: { "GET /settings": { status: 500, body: { success: false, error: { code: "internal", message: "down" } } } } });
    await signIn(page);
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Settings" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Settings couldn't be loaded");
    await expect(dialog.getByRole("button", { name: "Save settings" })).toBeDisabled();
  });
});

const PAGES = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/bulk", heading: "Bulk send" },
  { path: "/chats", heading: "Chats" },
  { path: "/campaigns", heading: "Campaigns" },
  { path: "/templates", heading: "Templates" },
  { path: "/contacts", heading: "Contacts" },
  { path: "/logs", heading: "Logs" },
];

test.describe("every page @phone", () => {
  for (const { path, heading } of PAGES) {
    test(`${path} loads without errors and fits the screen`, async ({ page }) => {
      const errors = watchErrors(page);
      await installFakeApi(page);
      await signIn(page);
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, exact: false }).first()).toBeVisible();
      // Nothing wider than the screen (no sideways scrolling).
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }

  test("unknown addresses show 'Page not found'", async ({ page }) => {
    await installFakeApi(page);
    await signIn(page);
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});
