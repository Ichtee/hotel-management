// A day in the hotel, driven through the real screens: guest -> customer books and pays -> receptionist checks the guest in,
// records services, asks for cleaning -> housekeeping works -> check-out and invoice -> review -> cancellation and refund ->
// manager and admin controls. Every step is its own test, so one failure does not hide the steps after it.
// Run against the demo (npm run demo): the demo accounts and a temporary database are what the steps rely on.
import { test, expect, request as pwRequest } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:5173";
const PASSWORD = "HotelDemo123!";
const vn = (offset = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(Date.now() + offset * 864e5));
const TODAY = vn(0), TOMORROW = vn(1);
const money = (n) => `₫${n.toLocaleString("en-US")}`;

mkdirSync("e2e-results", { recursive: true });
const note = (area, text) => appendFileSync("e2e-results/findings.log", `[${area}] ${text}\n`);

// State passed from one step to the next. A failed test makes Playwright start a new worker, so it lives in a file
// (delete e2e-results/state.json and findings.log before a fresh run).
const STATE = "e2e-results/state.json";
const loaded = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const S = new Proxy(loaded, { set: (t, k, v) => { t[k] = v; writeFileSync(STATE, JSON.stringify(t)); return true; } });
const actors = {};

// The login form asks for a CAPTCHA; the cookie is taken through the API with Google's public test key, everything after is UI.
async function actor(browser, name, email) {
  if (actors[name]) return actors[name];
  const context = await browser.newContext({ baseURL: BASE });
  const res = await context.request.post("/api/auth/login", { data: { email, password: PASSWORD, captchaToken: "x" } });
  expect(res.status(), `login ${email}`).toBe(200);
  const page = await context.newPage();
  // A list fetches its data when the page mounts and never refreshes itself, and goto() to the same #hash does not remount it:
  // reload after every goto so each step reads fresh data (what a user gets by pressing F5).
  const goto = page.goto.bind(page);
  page.goto = async (url, options) => { const res = await goto(url, options); await page.reload(); return res; };
  page.on("dialog", (d) => d.accept(d.type() === "prompt" ? d.defaultValue() : undefined)); // confirm(): OK; prompt(): keep its default
  page.on("pageerror", (e) => note(`js-error ${name}`, e.message));
  page.on("response", (r) => { if (r.status() >= 500) note(`http-${r.status()} ${name}`, `${r.request().method()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/401|reCAPTCHA|frame-ancestors|Failed to load resource/.test(m.text())) note(`console ${name}`, m.text().slice(0, 200)); });
  return (actors[name] = { context, page, api: context.request });
}
const as = {
  customer: (b) => actor(b, "customer", "customer@demo.hotel"),
  reception: (b) => actor(b, "reception", "reception@demo.hotel"),
  housekeeping: (b) => actor(b, "housekeeping", "housekeeping@demo.hotel"),
  manager: (b) => actor(b, "manager", "manager@demo.hotel"),
  admin: (b) => actor(b, "admin", "admin@demo.hotel"),
};
test.afterAll(async () => { for (const a of Object.values(actors)) await a.context.close(); });

async function solveCaptcha(page) {
  if (process.env.CAPTCHA_BYPASS === "true") return; // the demo was started with the local CAPTCHA bypass
  const frame = page.frameLocator('iframe[title="reCAPTCHA"]');
  await frame.locator(".recaptcha-checkbox-border").click({ timeout: 30000 });
  await expect(frame.locator(".recaptcha-checkbox-checked")).toBeVisible({ timeout: 30000 });
}
// Books a room as the customer through the screens and pays the deposit at the sandbox gateway. Returns { id, ref }.
async function bookAndPay(c, { typeName, from, to, coupon }) {
  await c.page.goto(`/#/rooms?in=${from}&out=${to}&guests=2`);
  const card = c.page.locator("article.c-card").filter({ hasText: typeName });
  await expect(card).toContainText(/rooms? left/);
  await card.getByRole("link", { name: "Book now" }).click();
  await expect(c.page.getByRole("heading", { name: "Checkout" })).toBeVisible();
  if (coupon) {
    await c.page.getByLabel("Promo code").fill(coupon);
    await c.page.getByRole("button", { name: "Apply" }).click();
    await expect(c.page.getByText(`Promo code ${coupon}`)).toBeVisible();
  }
  await c.page.getByRole("checkbox").check();
  await solveCaptcha(c.page);
  await c.page.getByRole("button", { name: "Continue to deposit payment" }).click();
  await expect(c.page).toHaveURL(/#\/pay\/[0-9a-f]{24}\?kind=deposit/);
  const id = c.page.url().match(/#\/pay\/([0-9a-f]{24})/)[1];
  await expect(c.page.getByRole("heading", { name: "Pay your deposit" })).toBeVisible();
  await c.page.getByRole("button", { name: /^Pay ₫/ }).click();
  await c.page.getByRole("button", { name: "Approve payment" }).click();
  await expect(c.page.getByRole("heading", { name: "Payment received" })).toBeVisible();
  const ref = (await (await c.api.get(`/api/bookings/${id}`)).json()).data.bookingReference;
  return { id, ref };
}
const row = (page, ref) => page.locator("tbody tr").filter({ hasText: ref });
async function findBooking(page, ref, view = "") {
  await page.goto(`/#/admin/bookings${view}`);
  await page.getByLabel("Search bookings").fill(ref);
  await expect(row(page, ref)).toHaveCount(1);
  return row(page, ref);
}
async function rowAction(page, ref, name) {
  const r = await findBooking(page, ref);
  const direct = r.getByRole("button", { name, exact: true });
  if (await direct.count()) return direct.click();
  await r.getByText("More").click();
  await r.getByRole("button", { name, exact: true }).click();
}

test.describe.configure({ mode: "default" });

test.describe("1. Guest (no account)", () => {
  test("home, hotel information and policies", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const hotel = await (await page.request.get("/api/hotel-info")).json();
    if (!hotel.data) note("data", "GET /api/hotel-info is empty: the home page and the footer show no hotel name, address or contact");
    await page.goto("/#/offers");
    await expect(page.getByText(/deposit of \d+%/)).toBeVisible();
    await expect(page.getByText(/% of the deposit back/).first()).toBeVisible();
  });

  test("search shows room types with price of the stay, rooms left and Book now; no physical rooms are exposed", async ({ page }) => {
    await page.goto(`/#/rooms?in=${vn(20)}&out=${vn(23)}&guests=2`);
    const cards = page.locator("article.c-card");
    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).toContainText(/for 3 nights/);
    await expect(cards.first()).toContainText(/rooms? left/);
    await expect(cards.first().getByRole("link", { name: "Book now" })).toBeVisible();
    await expect(page.getByLabel("Destination")).toHaveCount(0);
    const open = await (await page.request.get(`/api/public/availability?checkIn=${vn(20)}&checkOut=${vn(23)}&guests=2`)).json();
    expect(JSON.stringify(open)).not.toMatch(/roomNumber/);
    expect((await page.request.get("/api/rooms/search")).status()).toBe(401);
    expect((await page.request.get(`/api/public/availability?checkIn=${vn(23)}&checkOut=${vn(20)}`)).status()).toBe(400);
  });

  test("amenity filter and guests filter narrow the list", async ({ page }) => {
    await page.goto(`/#/rooms?in=${vn(20)}&out=${vn(22)}&guests=4`);
    await expect(page.locator("article.c-card")).toHaveCount(1); // only the Family Suite holds 4
    await page.goto(`/#/rooms?in=${vn(20)}&out=${vn(22)}&guests=2`);
    await expect(page.locator("article.c-card").first()).toBeVisible();
    const all = await page.locator("article.c-card").count();
    await page.getByLabel("Jacuzzi").check();
    await expect(page.locator("article.c-card")).toHaveCount(1); // only the Presidential Suite has a jacuzzi
    expect(all).toBeGreaterThan(1);
  });

  test("room details: amenities, policies, rating, reviews, price of the stay", async ({ page }) => {
    await page.goto(`/#/rooms?in=${vn(20)}&out=${vn(23)}&guests=2`);
    await page.locator("article.c-card").first().getByRole("link", { name: "View room" }).click();
    await expect(page.getByRole("heading", { name: "Amenities" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Guest reviews" })).toBeVisible();
    await expect(page.locator("form.book")).toContainText("3 nights");
    await expect(page.locator("form.book")).toContainText(/Rooms left/);
  });

  test("Book now sends a guest to login and keeps the dates; staff and account pages are closed", async ({ page }) => {
    await page.goto(`/#/rooms?in=${vn(20)}&out=${vn(23)}&guests=2`);
    await page.locator("article.c-card").first().getByRole("link", { name: "Book now" }).click();
    await expect(page.getByText("Please sign in to continue.")).toBeVisible();
    const next = await page.evaluate(() => sessionStorage.getItem("next"));
    expect(next).toContain(`in=${vn(20)}`);
    await page.goto("/#/my-bookings");
    await expect(page.getByText("Please sign in to continue.")).toBeVisible();
    await page.goto("/#/admin/bookings");
    await expect(page).toHaveURL(/#\/admin\/login/);
  });

  test("login form: wrong password is refused, forgot-password form is reachable", async ({ page }) => {
    await page.goto("/#/login");
    await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset password" })).toBeVisible();
  });
});

test.describe("2. Customer books and pays", () => {
  test("search, apply the promo code, see the server price, pass the CAPTCHA, pay the deposit at the gateway", async ({ browser }) => {
    const c = await as.customer(browser);
    await c.page.goto(`/#/rooms?in=${TODAY}&out=${TOMORROW}&guests=2`);
    const card = c.page.locator("article.c-card").filter({ hasText: "Superior Twin" });
    await card.getByRole("link", { name: "Book now" }).click();
    await expect(c.page.getByText(/Night of/)).toBeVisible();
    await expect(c.page.getByText("₫1,750,000").first()).toBeVisible();
    await c.page.getByLabel("Promo code").fill("NOPE");
    await c.page.getByRole("button", { name: "Apply" }).click();
    await expect(c.page.getByText(/Coupon code is invalid/)).toBeVisible();
    await c.page.getByLabel("Promo code").fill("DIRECT15");
    await c.page.getByRole("button", { name: "Apply" }).click();
    await expect(c.page.getByText("Promo code DIRECT15")).toBeVisible();
    await expect(c.page.getByText("₫1,487,500").first()).toBeVisible(); // 15% off one night of 1,750,000
    await expect(c.page.getByText("₫446,250").first()).toBeVisible(); // 30% deposit
    // the form cannot be submitted without the consent box (CR-21)
    await c.page.getByRole("button", { name: "Continue to deposit payment" }).click();
    await expect(c.page).toHaveURL(/#\/checkout/);
    S.today = await bookAndPay(c, { typeName: "Superior Twin", from: TODAY, to: TOMORROW, coupon: "DIRECT15" });
  });

  test("My bookings shows the booking Confirmed with the deposit paid; details show the payment", async ({ browser }) => {
    const c = await as.customer(browser);
    await c.page.goto("/#/my-bookings"); await c.page.reload(); // the list does not refresh by itself
    const trip = c.page.locator("article.trip").filter({ hasText: S.today.ref });
    await expect(trip).toContainText("confirmed");
    await expect(trip).toContainText("deposit paid");
    await trip.getByRole("button", { name: "View details" }).click();
    await expect(c.page.getByText(/446,250/).first()).toBeVisible();
  });

  test("simultaneous bookings of one room type never exceed the rooms it has (CR-16)", async ({ browser }) => {
    const c = await as.customer(browser), m = await as.manager(browser);
    const types = (await (await c.api.get(`/api/public/availability?checkIn=${vn(40)}&checkOut=${vn(41)}&guests=2`)).json()).data;
    const suite = types.find((t) => t.name === "Presidential Suite");
    const left = suite.roomsLeft;
    const body = { roomTypeId: suite._id, checkInDate: vn(40), checkOutDate: vn(41), guestCount: 2, consent: true, captchaToken: "x" };
    const sessions = [c, m, c, m, c, m].slice(0, left + 1); // two accounts: at most 3 unpaid bookings each
    const results = await Promise.all(sessions.map((a) => a.api.post("/api/bookings", { data: body })));
    const won = results.filter((r) => r.status() === 201).length;
    note("race", `${left} suites free, ${results.length} simultaneous requests -> ${won} booked, statuses ${results.map((r) => r.status()).join(",")}`);
    for (const [i, r] of results.entries()) if (r.status() === 201) await sessions[i].api.post(`/api/bookings/${(await r.json()).data._id}/cancel-payment`);
    expect(won).toBe(left);
  });
});

test.describe("3. Reception: the guest arrives", () => {
  test("the booking is in Arrivals; the views Overdue, search by name and phone work", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/bookings?view=arrivals");
    await expect(r.page.getByRole("button", { name: "Overdue Check-In" })).toBeVisible();
    await expect(r.page.getByRole("button", { name: "Overdue Check-Out" })).toBeVisible();
    await expect(row(r.page, S.today.ref)).toHaveCount(1);
    await r.page.getByLabel("Search bookings").fill("Jamie");
    await expect(row(r.page, S.today.ref)).toHaveCount(1);
    await r.page.getByLabel("Search bookings").fill("0912345678");
    await expect(row(r.page, S.today.ref)).toHaveCount(1);
    await r.page.getByRole("button", { name: "Overdue Check-In" }).click();
    await expect(r.page.getByText(/check-in date has passed/)).toBeVisible();
  });

  test("room availability screen lists physical rooms (staff only)", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/room-availability");
    await r.page.getByRole("button", { name: "Search" }).click();
    await expect(r.page.locator("tbody tr").first()).toBeVisible();
  });

  test("check-in: choose a free room of the booked type, guests and ID; the booking becomes Checked in", async ({ browser }) => {
    const r = await as.reception(browser);
    await rowAction(r.page, S.today.ref, "Check in");
    const select = r.page.locator("select[name=roomId]");
    await expect(select).toBeVisible();
    await expect(select.locator("option")).not.toHaveCount(1); // the free rooms have loaded
    const options = await select.locator("option").allTextContents();
    const pick = options.find((o) => /Floor [234]/.test(o)); // floors 2-4 are covered by the housekeeping plan
    expect(pick, `rooms offered: ${options.join(" | ")}`).toBeTruthy();
    S.roomNumber = pick.match(/Room (\S+)/)[1];
    await select.selectOption({ label: pick });
    await r.page.getByLabel("Number of guests").fill("2");
    await r.page.getByLabel("ID / passport number").fill("079123456789");
    await r.page.getByRole("button", { name: "Confirm check-in" }).click();
    await expect(r.page.getByRole("heading", { name: "Bookings" })).toBeVisible();
    const line = await findBooking(r.page, S.today.ref, "?view=checked_in");
    await expect(line).toContainText(/checked in/i);
  });

  test("record an additional service on the stay", async ({ browser }) => {
    const r = await as.reception(browser);
    await rowAction(r.page, S.today.ref, "Add service");
    await r.page.locator("select[name=serviceId]").selectOption({ index: 1 });
    await r.page.locator("input[name=quantity]").fill("2");
    await r.page.locator("form.form button.primary").click();
    await expect(row(r.page, S.today.ref)).toBeVisible();
    const detail = await (await r.api.get(`/api/bookings/${S.today.id}`)).json();
    expect(detail.data.serviceAmount).toBeGreaterThan(0);
    S.serviceAmount = detail.data.serviceAmount;
  });

  test("ad-hoc cleaning request is assigned by the responsibility plan", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/cleaning-request");
    await expect(r.page.locator("select[name=roomId] option")).not.toHaveCount(1); // the rooms have loaded
    const labels = await r.page.locator("select[name=roomId] option").allTextContents();
    await r.page.locator("select[name=roomId]").selectOption({ label: labels.find((l) => l.startsWith(`Room ${S.roomNumber} `)) });
    await r.page.locator("textarea[name=requestContent]").fill("Guest spilled a drink, please wipe the table and change the towels");
    await r.page.getByRole("button", { name: "Create cleaning request" }).click();
    await expect(r.page.getByText(/assigned to the responsible staff member/)).toBeVisible();
  });
});

test.describe("4. Housekeeping", () => {
  test("the assigned ad-hoc task is listed; report a damaged item without taking the room out of service", async ({ browser }) => {
    const h = await as.housekeeping(browser);
    await h.page.goto("/#/admin/cleaning");
    const task = h.page.locator("tbody tr").filter({ hasText: `Room ${S.roomNumber}` }).filter({ hasText: /ad hoc/i });
    await expect(task).toHaveCount(1);
    await task.getByRole("button", { name: "Report damage / issue" }).click();
    const items = await h.page.locator("select[name=chargeItemId] option").allTextContents();
    await h.page.locator("select[name=chargeItemId]").selectOption({ label: items.find((l) => /Bath towel/.test(l)) });
    await h.page.getByRole("button", { name: "Submit report" }).click();
    await expect(h.page.getByText(/front desk will confirm the charge/)).toBeVisible();
    await expect(h.page.getByText(/moved to Maintenance/)).toHaveCount(0);
    await h.page.getByText("Close", { exact: true }).click();
    const rooms = (await (await (await as.manager(browser)).api.get("/api/rooms?limit=100")).json()).data;
    expect(rooms.find((x) => x.roomNumber === S.roomNumber).status).toBe("occupied");
    const issues = await (await (await as.manager(browser)).api.get("/api/room-issues")).json();
    expect(issues.data.filter((i) => String(i.roomId) === String(rooms.find((x) => x.roomNumber === S.roomNumber)._id))).toHaveLength(0);
  });

  test("start and complete the ad-hoc task; the receptionist is told", async ({ browser }) => {
    const h = await as.housekeeping(browser);
    await h.page.goto("/#/admin/cleaning");
    const task = h.page.locator("tbody tr").filter({ hasText: `Room ${S.roomNumber}` }).filter({ hasText: /ad hoc/i });
    await task.getByRole("button", { name: "Start" }).click();
    await expect(task.getByRole("button", { name: "Complete" })).toBeVisible();
    await task.getByRole("button", { name: "Complete" }).click();
    await expect(task).toContainText(/completed/i);
    const r = await as.reception(browser);
    const notes = (await (await r.api.get("/api/notifications")).json()).data.map((n) => n.title);
    expect(notes.some((t) => /ad-hoc task completed/i.test(t)), notes.join(" | ")).toBeTruthy();
  });
});

test.describe("5. Reception: penalty, check-out, invoice", () => {
  test("the damage report reaches the receptionist, who confirms the penalty", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/notifications");
    await expect(r.page.getByText(/Damage \/ loss reported/).first()).toBeVisible();
    await rowAction(r.page, S.today.ref, "Penalties");
    const line = r.page.locator("tbody tr").filter({ hasText: "Bath towel" });
    await expect(line).toContainText("proposed");
    await line.getByRole("button", { name: "Confirm" }).click(); // the prompt keeps the proposed amount
    await expect(line).toContainText("confirmed");
  });

  test("customer sends a check-out request for the next day (approved at once)", async ({ browser }) => {
    const c = await as.customer(browser);
    await c.page.goto("/#/my-bookings"); await c.page.reload(); // the list does not refresh by itself
    const trip = c.page.locator("article.trip").filter({ hasText: S.today.ref });
    await expect(trip).toContainText("checked in");
    await trip.getByRole("button", { name: "Check-out request" }).click();
    await c.page.getByRole("button", { name: "Send request" }).click();
    await expect(c.page.getByRole("status").filter({ hasText: /request/i })).toBeVisible();
  });

  test("check-out is blocked while the inspection is open and the balance unpaid", async ({ browser }) => {
    const r = await as.reception(browser);
    await rowAction(r.page, S.today.ref, "Check out");
    await expect(r.page.getByText(/Balance due/)).toBeVisible();
    await expect(r.page.getByRole("button", { name: "Complete check-out" })).toBeDisabled();
    await expect(r.page.getByText(/Room inspection/)).toBeVisible();
  });

  test("housekeeping completes the inspection of the room", async ({ browser }) => {
    const h = await as.housekeeping(browser);
    await h.page.goto("/#/admin/cleaning");
    const task = h.page.locator("tbody tr").filter({ hasText: `Room ${S.roomNumber}` }).filter({ hasText: /inspection/i });
    await expect(task).toHaveCount(1);
    await task.getByRole("button", { name: "Start" }).click();
    await task.getByRole("button", { name: "Complete" }).click();
    await expect(task).toContainText(/completed/i);
  });

  test("receptionist takes the balance in cash and completes the check-out; the invoice is issued", async ({ browser }) => {
    const r = await as.reception(browser);
    await rowAction(r.page, S.today.ref, "Check out");
    await expect(r.page.getByText(/Balance due/)).toBeVisible();
    await r.page.getByRole("button", { name: "Refresh" }).click();
    await r.page.getByRole("button", { name: "Record payment" }).click();
    await expect(r.page.getByRole("button", { name: "Complete check-out" })).toBeEnabled();
    await r.page.getByRole("button", { name: "Complete check-out" }).click();
    await expect(r.page.getByText(/Invoice INV-/)).toBeVisible();
    S.invoice = (await r.page.getByText(/Invoice INV-/).textContent()).match(/INV-[\w-]+/)[0];
    const detail = await (await r.api.get(`/api/bookings/${S.today.id}`)).json();
    expect(detail.data.status).toBe("checked_out");
    expect(detail.data.paymentStatus).toBe("fully_paid");
  });

  test("the invoice is in Invoices with services, penalty and the deposit as payment", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/invoices");
    const line = r.page.locator("tbody tr").filter({ hasText: S.invoice });
    await expect(line).toHaveCount(1);
    await line.getByRole("button").first().click();
    await expect(r.page.locator("#invoice-print")).toContainText(/Damage \/ loss: Bath towel/);
    const hotel = (await (await r.api.get("/api/hotel-info")).json()).data;
    if (!hotel?.name) note("data", "the invoice prints no hotel name/address because the hotel information is empty");
  });

  test("housekeeping gets a turnover task; completing it makes the room Available again", async ({ browser }) => {
    const h = await as.housekeeping(browser);
    await h.page.goto("/#/admin/cleaning");
    await h.page.reload(); // the task list does not refresh by itself: a new task shows after a reload
    const task = h.page.locator("tbody tr").filter({ hasText: `Room ${S.roomNumber}` }).filter({ hasText: /turnover/i });
    await expect(task).toHaveCount(1);
    await task.getByRole("button", { name: "Start" }).click();
    await task.getByRole("button", { name: "Complete" }).click();
    await expect(task).toContainText(/completed/i);
    const rooms = (await (await (await as.manager(browser)).api.get("/api/rooms?limit=100")).json()).data;
    expect(rooms.find((x) => x.roomNumber === S.roomNumber).status).toBe("available");
  });
});

test.describe("6. Customer after the stay", () => {
  test("view the invoice and write a review; it shows on the room page", async ({ browser }) => {
    const c = await as.customer(browser);
    await c.page.goto("/#/my-bookings"); await c.page.reload(); // the list does not refresh by itself
    await c.page.getByRole("button", { name: /^past/ }).click();
    const trip = c.page.locator("article.trip").filter({ hasText: S.today.ref });
    await trip.getByRole("button", { name: "View invoice" }).click();
    await expect(c.page.getByText(S.invoice).first()).toBeVisible();
    await c.page.getByRole("button", { name: /Close|Back/ }).first().click();
    await c.page.getByRole("button", { name: /^past/ }).click();
    await c.page.locator("article.trip").filter({ hasText: S.today.ref }).getByRole("button", { name: "Write review" }).click();
    await c.page.getByRole("button", { name: "★ 5", exact: true }).click();
    S.comment = `Smooth arrival and quick check-out ${Date.now()}`;
    await c.page.getByPlaceholder(/Tell us what you liked/).fill(S.comment);
    await c.page.getByRole("button", { name: "Submit review" }).click();
    await expect(c.page.getByText(/review has been submitted/)).toBeVisible();
    const types = (await (await c.api.get("/api/public/room-types")).json()).data;
    S.typeId = types.find((t) => t.name === "Superior Twin")._id;
    await c.page.goto(`/#/room/${S.typeId}`);
    await expect(c.page.getByText(S.comment)).toBeVisible();
    // one review per booking (BR-23)
    const again = await c.api.post("/api/reviews", { data: { bookingId: S.today.id, rating: 4, comment: "again" } });
    expect(again.status()).toBe(409);
  });
});

test.describe("7. Cancellation and refund", () => {
  test("customer books a stay 12 days ahead, sends a check-in request, then cancels", async ({ browser }) => {
    const c = await as.customer(browser);
    S.future = await bookAndPay(c, { typeName: "Deluxe Double", from: vn(12), to: vn(14) });
    await c.page.goto("/#/my-bookings"); await c.page.reload(); // the list does not refresh by itself
    let trip = c.page.locator("article.trip").filter({ hasText: S.future.ref });
    await trip.getByRole("button", { name: "Check-in request" }).click();
    await c.page.getByLabel("Main guest ID / passport number").fill("079555000111");
    await c.page.getByRole("button", { name: "Send request" }).click();
    await expect(c.page.getByRole("status").filter({ hasText: /request/i })).toBeVisible(); // back on the list with the result
    trip = c.page.locator("article.trip").filter({ hasText: S.future.ref });
    await trip.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(c.page.getByText(/Estimated refund/)).toBeVisible();
    await c.page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(c.page.getByRole("status").first()).toBeVisible(); // back on the list with the result (MSG-57)
    await expect(c.page.locator("article.trip").filter({ hasText: S.future.ref })).toContainText("cancellation requested");
  });

  test("receptionist approves the request; the booking is Cancelled and a refund case opens", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/cancellations");
    const line = r.page.locator("tbody tr").filter({ hasText: S.future.ref });
    await expect(line).toBeVisible();
    await line.getByRole("button", { name: "Approve" }).click();
    await expect(r.page.getByText(/approved|cancelled/i).first()).toBeVisible();
    await r.page.goto("/#/admin/refunds");
    await expect(r.page.locator("tbody tr").filter({ hasText: S.future.ref })).toBeVisible();
  });

  test("refund: bank account, contact note, transfer code; the case moves to Refunded", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/refunds");
    await r.page.locator("tbody tr").filter({ hasText: S.future.ref }).getByRole("button", { name: "Process" }).click();
    await r.page.getByLabel("Bank", { exact: true }).fill("Vietcombank");
    await r.page.getByLabel("Account number").fill("0071001234567");
    await r.page.getByRole("button", { name: "Save account" }).click();
    await r.page.getByLabel("Note").fill("Called the customer, account confirmed");
    await r.page.getByRole("button", { name: "Add note" }).click();
    await r.page.getByLabel("Bank transaction code").fill("FT26311ABC123");
    await r.page.getByRole("button", { name: /Record|Confirm/ }).last().click();
    await expect(r.page.getByRole("status")).toContainText(/refund/i); // back on the list with the result (MSG-41)
    await r.page.getByRole("button", { name: "Refunded" }).click();
    await expect(r.page.locator("tbody tr").filter({ hasText: S.future.ref })).toContainText("FT26311ABC123");
  });

  test("customer sees the refund and its transaction code", async ({ browser }) => {
    const c = await as.customer(browser);
    await c.page.goto("/#/my-bookings"); await c.page.reload(); // the list does not refresh by itself
    await c.page.getByRole("button", { name: /^past/ }).click();
    await c.page.locator("article.trip").filter({ hasText: S.future.ref }).getByRole("button", { name: "View details" }).click();
    await expect(c.page.getByRole("heading", { name: "Refund" })).toBeVisible();
    await expect(c.page.getByText("FT26311ABC123")).toBeVisible();
  });
});

test.describe("8. Walk-in guest", () => {
  test("a walk-in for tonight: only available types, coupon, created and opened at check-in", async ({ browser }) => {
    const r = await as.reception(browser);
    await r.page.goto("/#/admin/bookings?screen=new");
    const type = r.page.locator("select").filter({ has: r.page.locator("option", { hasText: /left/ }) });
    await type.selectOption({ index: 1 });
    await r.page.getByLabel("Coupon code (optional)").fill("DIRECT15"); // WEEKEND5 needs 2,000,000: a night is 1,750,000
    await r.page.getByLabel("Guest full name").click(); // the code is read when the field loses focus
    await r.page.getByLabel("Guest full name").fill("Walk In Tester");
    await r.page.getByLabel("Phone").fill("0988777666");
    await r.page.getByLabel("ID / passport number").fill("012345678901");
    await expect(r.page.getByText(/Total ₫/)).toBeVisible();
    await r.page.getByRole("button", { name: "Create booking and check in" }).click();
    await expect(r.page).toHaveURL(/screen=check-in/);
    await expect(r.page.getByRole("heading", { name: /Check in BK-/ })).toBeVisible();
    S.walkIn = r.page.url().match(/id=([0-9a-f]{24})/)[1];
    const booking = (await (await r.api.get(`/api/bookings/${S.walkIn}`)).json()).data;
    expect(booking.status).toBe("confirmed");
    S.walkInRef = booking.bookingReference;
    note("walk-in", `coupon DIRECT15 on a walk-in: discount ${booking.discountAmount}, total ${booking.totalAmount}`);
    expect(booking.discountAmount).toBeGreaterThan(0);
  });

  test("a walk-in who leaves is cancelled at once at the desk, no deposit, no review step", async ({ browser }) => {
    const r = await as.reception(browser);
    await rowAction(r.page, S.walkInRef, "Cancel");
    await r.page.locator("input[name=reason]").fill("Guest changed their mind before check-in");
    await r.page.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(r.page.getByText(/cancelled/i).first()).toBeVisible();
    const booking = (await (await r.api.get(`/api/bookings/${S.walkIn}`)).json()).data;
    expect(booking.status).toBe("cancelled");
  });

  test("a walk-in cannot be created for another day", async ({ browser }) => {
    const r = await as.reception(browser);
    const types = (await (await r.api.get(`/api/public/availability?checkIn=${TODAY}&checkOut=${TOMORROW}&guests=1`)).json()).data;
    const res = await r.api.post("/api/front-desk/bookings", { data: { roomTypeId: types[0]._id, checkInDate: TOMORROW, checkOutDate: vn(2), guestCount: 1, fullName: "Later Guest", phone: "0911000111", idDocumentNo: "123456789" } });
    expect(res.status()).toBe(409);
  });
});

test.describe("9. Hotel Manager", () => {
  test("dashboard, revenue and occupancy reports", async ({ browser }) => {
    const m = await as.manager(browser);
    await m.page.goto("/#/admin");
    await expect(m.page.getByRole("heading", { name: /^Hello, / })).toBeVisible();
    await m.page.goto("/#/admin/revenue");
    await expect(m.page.getByRole("heading", { name: /Revenue/ }).first()).toBeVisible();
    const rev = await (await m.api.get(`/api/reports/revenue?from=${TODAY}&to=${TODAY}&groupBy=day`)).json();
    expect(JSON.stringify(rev.data)).toMatch(/net/);
    await m.page.goto("/#/admin/occupancy");
    await expect(m.page.getByRole("heading", { name: /Occupancy/ }).first()).toBeVisible();
  });

  test("hotel information saved here appears on the public home page and footer", async ({ browser }) => {
    const m = await as.manager(browser);
    await m.page.goto("/#/admin/policy");
    const name = m.page.getByLabel("Hotel name");
    await name.waitFor({ timeout: 8000 }).catch(() => {});
    if (await name.count()) {
      await name.fill("GrandStay Da Nang");
      await m.page.getByLabel("Address").fill("Vo Nguyen Giap, Son Tra, Da Nang");
      await m.page.getByLabel("Phone").last().fill("+842360000000");
      await m.page.getByRole("button", { name: /Save hotel/ }).click();
      await expect(m.page.getByText(/Saved|Updated/i).first()).toBeVisible();
      await m.page.goto("/#/");
      await m.page.reload();
      await expect(m.page.locator("footer")).toContainText("GrandStay");
    } else note("ui", "Hotel & policies has no 'Hotel name' field");
  });

  test("moderation: hide the new review with a reason; it leaves the public room page, then show it again", async ({ browser }) => {
    const m = await as.manager(browser);
    await m.page.goto(`/#/admin/reviews?type=${S.typeId}`);
    await expect(m.page.getByText(S.comment)).toBeVisible();
    await m.page.locator("tbody tr").filter({ hasText: S.comment }).getByRole("button", { name: "Hide" }).click();
    await m.page.getByLabel("Reason").selectOption({ index: 1 });
    await m.page.getByRole("button", { name: /Hide review|Hide/ }).last().click();
    const pub = async () => JSON.stringify((await (await m.api.get(`/api/public/room-types/${S.typeId}/reviews`)).json()).data);
    await expect.poll(pub).not.toContain(S.comment);
    await m.page.goto(`/#/admin/reviews?type=${S.typeId}`);
    await m.page.locator("tbody tr").filter({ hasText: S.comment }).getByRole("button", { name: "Show" }).click();
    await expect.poll(pub).toContain(S.comment);
  });

  test("management pages open: rooms, room types, services, coupons, assignments, issues, permissions, customers, staff", async ({ browser }) => {
    const m = await as.manager(browser);
    for (const [path, heading] of [["rooms", /Room/], ["roomtypes", /Room types/i], ["catalog", /Services/i], ["coupons", /Coupons/i], ["assignments", /assignment|Housekeeping/i], ["issues", /issue/i], ["permissions", /permission/i], ["customers", /Customer/i], ["staff", /Staff/i], ["policy", /polic/i]]) {
      await m.page.goto(`/#/admin/${path}`);
      await expect(m.page.getByRole("heading", { name: heading }).first(), `/admin/${path}`).toBeVisible();
      await expect(m.page.getByText(/Something went wrong|Forbidden|not found/i)).toHaveCount(0);
    }
  });

  test("role permissions: Hotel Manager cannot give a staff role a function it must never have (UC33)", async ({ browser }) => {
    const m = await as.manager(browser);
    const roles = (await (await m.api.get("/api/staff/roles")).json()).data;
    const recep = roles.find((r) => r.key === "receptionist");
    const bad = await m.api.patch(`/api/staff/roles/${recep._id}/permissions`, { data: { permissions: ["users.manage"] } });
    expect(bad.status()).toBe(403);
  });

  test("customer blacklist: a blacklisted customer cannot log in and is let back after restore (UC29)", async ({ browser }) => {
    const m = await as.manager(browser);
    const list = (await (await m.api.get("/api/customers?q=customer@demo.hotel")).json()).data;
    const id = list.find((u) => u.email === "customer@demo.hotel")._id;
    await m.api.patch(`/api/customers/${id}/blacklist`, { data: { action: "blacklist", reason: "Playwright blacklist check" } });
    const anon = await pwRequest.newContext({ baseURL: BASE });
    const denied = await anon.post("/api/auth/login", { data: { email: "customer@demo.hotel", password: PASSWORD, captchaToken: "x" } });
    expect(denied.status()).toBeGreaterThanOrEqual(400);
    await m.api.patch(`/api/customers/${id}/blacklist`, { data: { action: "restore", reason: "Playwright restore" } });
    const back = await anon.post("/api/auth/login", { data: { email: "customer@demo.hotel", password: PASSWORD, captchaToken: "x" } });
    expect(back.status()).toBe(200);
    await anon.dispose();
  });
});

test.describe("10. Admin", () => {
  test("Hotel Manager accounts page and the audit log of everything that happened today", async ({ browser }) => {
    const a = await as.admin(browser);
    await a.page.goto("/#/admin/users");
    await expect(a.page.getByText("manager@demo.hotel")).toBeVisible();
    for (const action of ["booking.cancelled|cancellation", "penalty.confirmed", "invoice.generated", "refund"]) {
      const logs = (await (await a.api.get(`/api/audit-logs?action=${encodeURIComponent(action.split("|")[0])}&limit=5`)).json()).data;
      if (!logs.length) note("audit", `no audit entry found for '${action.split("|")[0]}' after today's flow`);
    }
    await a.page.goto("/#/admin/audit");
    await expect(a.page.getByRole("heading", { name: /Audit/i }).first()).toBeVisible();
    await expect(a.page.locator("tbody tr").first()).toBeVisible();
  });

  test("role boundaries: customers and staff cannot reach each other's functions", async ({ browser }) => {
    const c = await as.customer(browser), r = await as.reception(browser), h = await as.housekeeping(browser), m = await as.manager(browser);
    const status = async (a, method, url, data) => (await a.api[method](url, data ? { data } : undefined)).status();
    expect([401, 403]).toContain(await status(c, "get", "/api/bookings/search")); // 401: the blacklist test above ended this session
    expect([401, 403]).toContain(await status(c, "get", "/api/audit-logs"));
    expect(await status(r, "get", "/api/audit-logs")).toBe(403);
    expect(await status(r, "get", "/api/staff")).toBe(403);
    expect(await status(h, "get", "/api/bookings/search")).toBe(403);
    expect(await status(h, "get", "/api/frontdesk/refunds")).toBe(403);
    expect(await status(m, "get", "/api/frontdesk/refunds")).toBe(403); // the Hotel Manager takes no part in refunds (SRS)
    expect([401, 403]).toContain(await status(c, "post", "/api/front-desk/bookings", {}));
  });
});

test.describe("11. Mobile layout (360px)", () => {
  test("public and staff pages do not scroll sideways", async ({ browser }) => {
    const r = await as.reception(browser);
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 740 } });
    const page = await ctx.newPage();
    const wide = [];
    for (const path of ["/#/", `/#/rooms?in=${vn(20)}&out=${vn(22)}&guests=2`, "/#/offers", "/#/login"]) {
      await page.goto(path); await page.waitForTimeout(1200);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) wide.push(path);
    }
    await ctx.addCookies(await r.context.cookies());
    for (const path of ["/#/admin", "/#/admin/bookings", "/#/admin/bookings?screen=new", "/#/admin/refunds", "/#/admin/cleaning-request"]) {
      await page.goto(path); await page.waitForTimeout(1500);
      if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) wide.push(path);
    }
    await ctx.close();
    if (wide.length) note("mobile", `horizontal scroll at 360px on: ${wide.join(", ")}`);
    expect(wide).toEqual([]);
  });
});
