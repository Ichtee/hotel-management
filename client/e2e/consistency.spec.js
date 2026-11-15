import { test, expect } from '@playwright/test';

const password = 'HotelDemo123!';
const origin = 'http://localhost:5173';
async function signIn(context, email) {
  const response = await context.request.post('/api/auth/login', { data: { email, password, captchaToken: 'valid_test_token' }, headers: { Origin: origin } });
  expect(response.status()).toBe(200);
}

test('staff status changes send a reason and the edit form excludes deleted', async ({ page, context }) => {
  await signIn(context, 'manager@demo.hotel');
  const employees = (await (await context.request.get('/api/staff?limit=100')).json()).data;
  const employee = employees.find(e => e.status === 'active');
  await page.goto('/#/admin/staff');
  const row = page.getByRole('row').filter({ hasText: employee.email });
  page.on('dialog', dialog => dialog.accept('Kiểm thử thay đổi trạng thái'));
  await row.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  const saved = (await (await context.request.get(`/api/staff/${employee._id}`)).json()).data;
  expect(saved.statusReason).toBe('Kiểm thử thay đổi trạng thái');
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('select[name="status"] option[value="deleted"]')).toHaveCount(0);
  await expect(page.locator('input[name="reason"]')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await row.getByRole('button', { name: 'Activate', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible();
});

test('manager sees room numbers and the maintenance instruction, with no front-desk booking actions', async ({ page, context, browser }) => {
  await signIn(context, 'manager@demo.hotel');
  const rooms = (await (await context.request.get('/api/rooms?limit=100')).json()).data;
  const room = rooms.find(r => r.status === 'available');
  const reporter = await browser.newContext({ baseURL: origin });
  await signIn(reporter, 'reception@demo.hotel');
  const response = await reporter.request.post('/api/room-issues', { data: { roomId: room._id, title: 'UI regression issue', description: 'Kiểm thử hiển thị phòng', unusable: false }, headers: { Origin: origin } });
  expect(response.status()).toBe(201);
  await page.goto('/#/admin/issues');
  const row = page.getByRole('row').filter({ hasText: 'UI regression issue' });
  await expect(row).toContainText(room.roomNumber);
  page.on('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByText(/clear Maintenance in room management/)).toBeVisible();
  await page.goto('/#/admin/bookings');
  await expect(page.getByRole('heading', { name: 'Bookings', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^(Check in|Check out|New booking)$/ })).toHaveCount(0);
  await page.goto('/#/admin/rooms');
  await expect(page.getByRole('heading', { name: 'Room map', exact: true })).toBeVisible();
  const tile = page.locator('button.room').filter({ has: page.locator('b', { hasText: new RegExp(`^${room.roomNumber}$`) }) });
  await expect(tile.locator('.room-type')).toBeVisible();
  await reporter.close();
});

test('pagination reaches records beyond the first page and newest search wins', async ({ page, context }) => {
  await signIn(context, 'manager@demo.hotel');
  const data = Array.from({ length: 21 }, (_, i) => ({ _id: String(i), username: `staff${i}`, email: `staff${i}@example.com`, role: 'receptionist', status: 'active', customerProfile: { fullName: `Employee ${i}` } }));
  await page.route('**/api/staff?*', async route => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get('page') || 1);
    const query = url.searchParams.get('q') || '';
    // Cho phản hồi tìm kiếm cũ về sau phản hồi mới để phát hiện ghi đè dữ liệu.
    if (query === 'old') await new Promise(resolve => setTimeout(resolve, 350));
    await route.fulfill({ json: { data: query ? [{ ...data[0], customerProfile: { fullName: query === 'new' ? 'Newest result' : 'Stale result' } }] : data.slice((pageNumber - 1) * 20, pageNumber * 20), meta: { page: pageNumber, limit: 20, total: query ? 1 : 21, pages: query ? 1 : 2 } } }).catch(() => {});
  });
  await page.goto('/#/admin/staff');
  await expect(page.getByText('21 results · page 1 of 2')).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'staff20@example.com' })).toBeVisible();
  await page.locator('input[name="q"]').fill('old');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.locator('input[name="q"]').fill('new');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByText('Newest result', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.getByText('Stale result', { exact: true })).toHaveCount(0);
});

test('occupancy exports CSV and renders actual-stay report', async ({ page, context }) => {
  await signIn(context, 'manager@demo.hotel');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/admin/occupancy');
  await expect(page.getByRole('heading', { name: 'Occupancy Report' })).toBeVisible();
  const href = await page.getByRole('link', { name: 'Export CSV' }).getAttribute('href');
  const response = await context.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/csv');
  expect(await response.text()).toContain('Occupied room-nights');
  expect(errors).toEqual([]);
});

test('merged checkout shows detailed charges and handles payment fields hidden by permission', async ({ page, context }) => {
  await signIn(context, 'reception@demo.hotel');
  const stays = (await (await context.request.get('/api/bookings/search?status=checked_in')).json()).data;
  expect(stays.length).toBeGreaterThan(0);
  const path = `/api/front-desk/bookings/${stays[0]._id}/check-out/start`;
  const response = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`/#/admin/bookings?screen=check-out&id=${stays[0]._id}`);
  const bill = await (await response).json();
  await expect(page.getByRole('heading', { name: 'Final bill', exact: true })).toBeVisible();
  await expect(page.getByText(bill.data.lines[0].name, { exact: true })).toBeVisible();
  await expect(page.getByText('Balance due', { exact: true })).toBeVisible();
  // Mô phỏng payload đã ẩn thanh toán; API phân quyền có test tích hợp riêng.
  delete bill.data.payments; delete bill.data.paidAmount; delete bill.data.balance;
  await page.route(`**${path}`, route => route.fulfill({ json: bill }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Final bill', exact: true })).toBeVisible();
  await expect(page.getByText('Balance due', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Ask an employee with payment access/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('reception can submit Other issues while charge items stay restricted', async ({ page, context }) => {
  await signIn(context, 'reception@demo.hotel');
  await page.goto('/#/admin/issues?screen=new');
  const choices = page.locator('select[name="chargeItemId"]');
  await expect(choices.locator('option')).toHaveCount(2);
  await choices.selectOption('other');
  const room = page.locator('select[name="roomId"]');
  await expect(room.locator('option')).not.toHaveCount(1);
  const value = await room.locator('option').nth(1).getAttribute('value');
  await room.selectOption(value);
  await page.locator('input[name="otherTitle"]').fill('Merge check shower issue');
  await page.locator('textarea[name="description"]').fill('Kiểm thử báo sự cố ngoài danh mục.');
  await page.getByRole('button', { name: 'Submit report', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('The Hotel Manager will follow it up.');
});
