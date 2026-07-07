/**
 * Goodreads plugin — core handlers.
 * Playwright-based headless scraper with anti-403 browser context.
 * No carapace-sdk imports here — pure logic only.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoodreadsConfig {
  username: string;
  password: string;
  stateFilePath: string;
}

export interface BookRecord {
  title: string;
  author: string;
  url: string;
  cover_image_url?: string;
  avg_rating?: number;
  user_rating?: number;
  date_read?: string;
  shelf: string;
}

export interface SearchResult {
  title: string;
  author: string;
  url: string;
  avg_rating?: number;
  num_ratings?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOODREADS_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const VALID_SHELVES = ["read", "currently-reading", "to-read"];

// ---------------------------------------------------------------------------
// Browser context helpers
// ---------------------------------------------------------------------------

async function createContext(stateFilePath: string) {
  const browser = await chromium.launch({ headless: true });
  const stateExists = fs.existsSync(stateFilePath);
  const ctx = await browser.newContext({
    storageState: stateExists ? stateFilePath : undefined,
    userAgent: GOODREADS_UA,
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  return { browser, ctx };
}

function saveState(ctx: Awaited<ReturnType<typeof createContext>>["ctx"], stateFilePath: string) {
  return ctx.storageState().then((state) => {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
  });
}

function isLoginRedirect(url: string): boolean {
  return url.includes("/user/sign_in") || url.includes("/ap/signin");
}

function check403(status: number): void {
  if (status === 403) {
    throw Object.assign(new Error("Goodreads returned 403 — possible fingerprint/bot detection issue. Check UA/viewport settings."), {
      code: "goodreads_403",
    });
  }
}

// ---------------------------------------------------------------------------
// Auth status
// ---------------------------------------------------------------------------

export async function handleAuthStatus(config: GoodreadsConfig): Promise<{
  authenticated: boolean;
  username?: string;
  error?: string;
}> {
  if (!fs.existsSync(config.stateFilePath)) {
    return { authenticated: false, error: "No session state file found. Run goodreads_login first." };
  }

  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();
  try {
    const response = await page.goto("https://www.goodreads.com/shelf/list", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!response) {
      return { authenticated: false, error: "No response from Goodreads" };
    }

    check403(response.status());

    const finalUrl = page.url();
    if (isLoginRedirect(finalUrl)) {
      return { authenticated: false, error: "Session expired — re-run goodreads_login" };
    }

    // Try to grab username from nav
    let username: string | undefined;
    try {
      const profileLink = await page.$("a.headerPersonalNav__link--profile, a[href*='/user/show/']");
      if (profileLink) {
        username = (await profileLink.textContent())?.trim() || undefined;
      }
    } catch {
      // non-fatal
    }

    return { authenticated: true, username };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "goodreads_403") {
      return { authenticated: false, error: e.message };
    }
    return { authenticated: false, error: String(e.message ?? err) };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function handleLogin(config: GoodreadsConfig): Promise<{
  success: boolean;
  error?: string;
}> {
  if (!config.username || !config.password) {
    return { success: false, error: "GOODREADS_USERNAME and GOODREADS_PASSWORD must be set" };
  }

  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();
  try {
    const response = await page.goto("https://www.goodreads.com/user/sign_in", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (!response) {
      return { success: false, error: "No response loading sign-in page" };
    }

    check403(response.status());

    // Goodreads now uses Amazon SSO — click Sign in with email to get Amazon login form
    await page.click('a[href*="openid.assoc_handle=amzn_goodreads_web_na"]');
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    // Fill Amazon email/password on the Amazon-hosted login form
    await page.fill('#ap_email', config.username);
    await page.fill('#ap_password', config.password);
    await page.click('#signInSubmit');

    // Wait for redirect back to Goodreads
    await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

    const finalUrl = page.url();
    if (isLoginRedirect(finalUrl)) {
      return { success: false, error: "Login failed — check GOODREADS_USERNAME / GOODREADS_PASSWORD" };
    }

    // Verify by checking for authenticated nav elements
    const myBooks = await page.$('a[href*="/review/list"], a:has-text("My Books")');
    if (!myBooks) {
      // Might still be ok — check URL isn't sign_in
      if (finalUrl.includes("goodreads.com") && !isLoginRedirect(finalUrl)) {
        await saveState(ctx, config.stateFilePath);
        return { success: true };
      }
      return { success: false, error: "Login failed — check GOODREADS_USERNAME / GOODREADS_PASSWORD" };
    }

    await saveState(ctx, config.stateFilePath);
    return { success: true };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "goodreads_403") {
      return { success: false, error: e.message };
    }
    return { success: false, error: String(e.message ?? err) };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// List shelf (with auto-reauth)
// ---------------------------------------------------------------------------

async function fetchShelfPage(
  config: GoodreadsConfig,
  shelf: string,
  page_num: number,
  per_page: number,
  retried = false
): Promise<{ shelf: string; books: BookRecord[]; page: number; has_next_page: boolean }> {
  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();

  try {
    const url = `https://www.goodreads.com/review/list?v=2&shelf=${encodeURIComponent(shelf)}&per_page=${per_page}&page=${page_num}`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (!response) throw new Error("No response from Goodreads shelf page");
    check403(response.status());

    // Redirect to login?
    if (isLoginRedirect(page.url())) {
      if (retried) {
        throw Object.assign(new Error("Login failed — check GOODREADS_USERNAME / GOODREADS_PASSWORD"), { code: "auth_failed" });
      }
      await browser.close();
      // Re-login and retry
      const loginResult = await handleLogin(config);
      if (!loginResult.success) {
        throw Object.assign(new Error(loginResult.error ?? "Re-login failed"), { code: "auth_failed" });
      }
      return fetchShelfPage(config, shelf, page_num, per_page, true);
    }

    // Parse book rows
    const books: BookRecord[] = await page.evaluate((shelfName: string) => {
      const rows = Array.from(document.querySelectorAll("tr.bookalike, tr[id^='review_']"));
      return rows.map((row) => {
        const titleEl = row.querySelector("td.field.title a, .title a");
        const authorEl = row.querySelector("td.field.author a, .author a");
        const coverEl = row.querySelector("td.field.cover img, .cover img");
        const avgRatingEl = row.querySelector("td.field.avg_rating .value, .avg_rating .value");
        const ratingEl = row.querySelector("td.field.rating .value, .rating .value");
        const dateReadEl = row.querySelector("td.field.date_read .value, .date_read .value");

        const title = titleEl?.textContent?.trim() ?? "";
        const author = authorEl?.textContent?.trim() ?? "";
        const href = titleEl?.getAttribute("href") ?? "";
        const url = href ? (href.startsWith("http") ? href : `https://www.goodreads.com${href}`) : "";
        const cover_image_url = coverEl?.getAttribute("src") ?? undefined;

        const avgRatingText = avgRatingEl?.textContent?.trim();
        const avg_rating = avgRatingText ? parseFloat(avgRatingText) : undefined;

        // User rating: count filled stars
        const filledStars = row.querySelectorAll("td.field.rating span.staticStar.p10, .rating .staticStar.p10");
        const user_rating = filledStars.length > 0 ? filledStars.length : undefined;

        const dateReadText = dateReadEl?.textContent?.trim()?.replace(/\s*\[edit\]/gi, "").trim();
        const date_read = dateReadText && !dateReadText.startsWith("not set") ? dateReadText : undefined;

        return { title, author, url, cover_image_url, avg_rating, user_rating, date_read, shelf: shelfName } as {
          title: string;
          author: string;
          url: string;
          cover_image_url?: string;
          avg_rating?: number;
          user_rating?: number;
          date_read?: string;
          shelf: string;
        };
      }).filter((b) => b.title !== "");
    }, shelf);

    // Detect pagination — check if there's a "next" link
    const nextLink = await page.$("a[rel='next'], .next_page a, a:has-text('next »')");
    const has_next_page = nextLink !== null;

    await saveState(ctx, config.stateFilePath);

    return { shelf, books, page: page_num, has_next_page };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "goodreads_403" || e.code === "auth_failed") throw err;
    throw Object.assign(
      new Error(`Could not parse shelf page — Goodreads may have changed their layout. ${e.message ?? ""}`),
      { code: "parse_error" }
    );
  } finally {
    await browser.close();
  }
}

export async function handleListShelf(
  config: GoodreadsConfig,
  params: { shelf: string; page?: number; limit?: number }
): Promise<{ shelf: string; books: BookRecord[]; page: number; has_next_page: boolean } | { error: string; message: string }> {
  const shelf = params.shelf ?? "read";
  if (!VALID_SHELVES.includes(shelf)) {
    return { error: "invalid_shelf", message: `Invalid shelf "${shelf}". Must be one of: ${VALID_SHELVES.join(", ")}` };
  }

  const page_num = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 200);

  try {
    return await fetchShelfPage(config, shelf, page_num, limit);
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return {
      error: e.code ?? "unknown_error",
      message: e.message ?? String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Move book to shelf
// ---------------------------------------------------------------------------

export async function handleMoveShelf(
  config: GoodreadsConfig,
  params: { book_url: string; shelf: string }
): Promise<{ success: boolean; error?: string }> {
  if (!VALID_SHELVES.includes(params.shelf)) {
    return { success: false, error: `Invalid shelf "${params.shelf}". Must be one of: ${VALID_SHELVES.join(", ")}` };
  }

  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();
  try {
    const response = await page.goto(params.book_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response) return { success: false, error: "No response loading book page" };
    check403(response.status());

    if (isLoginRedirect(page.url())) {
      await browser.close();
      const loginResult = await handleLogin(config);
      if (!loginResult.success) return { success: false, error: loginResult.error ?? "Re-login failed" };
      return handleMoveShelf(config, params);
    }

    // Click the shelf dropdown button ("Want to Read" / current shelf label)
    const shelfBtn = await page.$("button.wantToReadBtn, .wantToReadButton, .shelfButton button, button[aria-label*='shelf'], .wantToRead button");
    if (!shelfBtn) return { success: false, error: "Could not find shelf button on book page" };
    await shelfBtn.click();
    await page.waitForTimeout(600);

    // Find the shelf option in the dropdown
    const shelfLabel: Record<string, string[]> = {
      "read": ["Read"],
      "currently-reading": ["Currently Reading"],
      "to-read": ["Want to Read", "To Read"],
    };
    const labels = shelfLabel[params.shelf];
    let clicked = false;
    for (const label of labels) {
      const option = await page.$(`[role="menuitem"]:has-text("${label}"), .wantToReadMenu li:has-text("${label}"), .dropdown__content li:has-text("${label}")`);
      if (option) {
        await option.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) return { success: false, error: `Could not find shelf option for "${params.shelf}" in dropdown` };

    await page.waitForTimeout(1000);
    await saveState(ctx, config.stateFilePath);
    return { success: true };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return { success: false, error: e.message ?? String(err) };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Remove book from all shelves (Did Not Finish / remove)
// ---------------------------------------------------------------------------

export async function handleRemoveShelf(
  config: GoodreadsConfig,
  params: { book_url: string }
): Promise<{ success: boolean; error?: string }> {
  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();
  try {
    const response = await page.goto(params.book_url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response) return { success: false, error: "No response loading book page" };
    check403(response.status());

    if (isLoginRedirect(page.url())) {
      await browser.close();
      const loginResult = await handleLogin(config);
      if (!loginResult.success) return { success: false, error: loginResult.error ?? "Re-login failed" };
      return handleRemoveShelf(config, params);
    }

    // Open the shelf dropdown
    const shelfBtn = await page.$("button.wantToReadBtn, .wantToReadButton, .shelfButton button, button[aria-label*='shelf'], .wantToRead button");
    if (!shelfBtn) return { success: false, error: "Could not find shelf button on book page" };
    await shelfBtn.click();
    await page.waitForTimeout(600);

    // Look for a Remove / Did Not Finish option
    const removeOption = await page.$(
      `[role="menuitem"]:has-text("Remove"), .wantToReadMenu li:has-text("Remove"),
       [role="menuitem"]:has-text("Did Not Finish"), .wantToReadMenu li:has-text("Did Not Finish"),
       .dropdown__content li:has-text("Remove")`
    );
    if (!removeOption) return { success: false, error: "Could not find a Remove option in the shelf dropdown" };
    await removeOption.click();
    await page.waitForTimeout(1000);
    await saveState(ctx, config.stateFilePath);
    return { success: true };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    return { success: false, error: e.message ?? String(err) };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function handleSearch(
  config: GoodreadsConfig,
  params: { query: string; limit?: number }
): Promise<{ query: string; results: SearchResult[] } | { error: string; message: string }> {
  const { query, limit = 10 } = params;
  if (!query?.trim()) {
    return { error: "invalid_params", message: "query is required" };
  }

  const { browser, ctx } = await createContext(config.stateFilePath);
  const page = await ctx.newPage();
  try {
    const url = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`;
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });

    if (!response) throw new Error("No response from Goodreads search");
    check403(response.status());

    const results: SearchResult[] = await page.evaluate((maxResults: number) => {
      const rows = Array.from(document.querySelectorAll("tr[itemtype='http://schema.org/Book']")).slice(0, maxResults);
      return rows.map((row) => {
        const titleEl = row.querySelector("a.bookTitle span[itemprop='name'], .bookTitle span");
        const authorEl = row.querySelector("a.authorName span[itemprop='name'], .authorName span");
        const linkEl = row.querySelector("a.bookTitle");
        const avgRatingEl = row.querySelector("span.minirating");

        const title = titleEl?.textContent?.trim() ?? "";
        const author = authorEl?.textContent?.trim() ?? "";
        const href = linkEl?.getAttribute("href") ?? "";
        const url = href ? (href.startsWith("http") ? href : `https://www.goodreads.com${href}`) : "";

        // Parse "avg 4.15 — 1,234,567 ratings"
        let avg_rating: number | undefined;
        let num_ratings: number | undefined;
        const ratingText = avgRatingEl?.textContent?.trim() ?? "";
        const avgMatch = ratingText.match(/(\d+\.\d+)/);
        if (avgMatch) avg_rating = parseFloat(avgMatch[1]);
        const countMatch = ratingText.match(/([\d,]+)\s+rating/);
        if (countMatch) num_ratings = parseInt(countMatch[1].replace(/,/g, ""), 10);

        return { title, author, url, avg_rating, num_ratings } as {
          title: string;
          author: string;
          url: string;
          avg_rating?: number;
          num_ratings?: number;
        };
      }).filter((r) => r.title !== "");
    }, limit);

    return { query, results };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e.code === "goodreads_403") {
      return { error: "goodreads_403", message: e.message ?? "403 error" };
    }
    return { error: "search_error", message: e.message ?? String(err) };
  } finally {
    await browser.close();
  }
}
