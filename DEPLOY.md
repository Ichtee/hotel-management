# Deploy GrandStay: Render (API) + Vercel (web) + MongoDB Atlas

Mọi cấu hình đã nằm sẵn trong repo (`render.yaml`, `client/vercel.json`). Bạn chỉ cần tạo tài khoản, dán key và bấm deploy. Tất cả đều có gói miễn phí.

```
Trình duyệt ──► Vercel (React) ──/api/*──► Render (Express API) ──► MongoDB Atlas
```

Web và API dùng chung một tên miền (Vercel chuyển tiếp `/api` sang Render), nên cookie đăng nhập hoạt động bình thường.

Code phải được push lên GitHub trước, vì Render và Vercel đều lấy code từ GitHub.

---

## 1. MongoDB Atlas (database)

1. Vào https://cloud.mongodb.com, tạo **Free cluster (M0)**, region **Singapore**.
2. **Database Access** → Add user: đặt username và mật khẩu (nên chỉ dùng chữ và số).
3. **Network Access** → Add IP → `0.0.0.0/0`. Bước này cần vì Render không có IP cố định.
4. **Connect → Drivers** → copy chuỗi kết nối, rồi thêm tên database `grandstay` vào trước dấu `?`:
   ```
   mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/grandstay?retryWrites=true&w=majority
   ```
   Đây là **`MONGO_URI`**.
5. Nạp dữ liệu demo (phòng, booking mẫu và 5 tài khoản demo). Chạy **một lần** trên máy bạn:
   ```powershell
   $env:MONGO_URI="mongodb+srv://...(chuỗi ở trên)"; npm run seed:cloud --prefix server
   ```
   Lệnh tự từ chối nếu database đã có tài khoản, nên chạy lại cũng không mất dữ liệu.

## 2. Render (API)

1. Vào https://render.com và đăng nhập bằng GitHub.
2. **New → Blueprint** → chọn repo này. Render sẽ đọc `render.yaml` và tạo service `grandstay-api`.
3. Render hỏi các biến có ghi chú "Paste these". Tạm điền như sau (sẽ sửa lại sau bước 3):

   | Biến | Giá trị |
   |---|---|
   | `MONGO_URI` | chuỗi ở bước 1 |
   | `CLIENT_ORIGIN`, `PUBLIC_URL`, `CLIENT_URL` | tạm điền `https://grandstay.vercel.app` |
   | `RESEND_API_KEY` | key ở mục 4 (có thể để trống lúc đầu) |
   | `RESEND_FROM_EMAIL` | `GrandStay <onboarding@resend.dev>` |
   | `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | key ở mục 4 |
   | `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY` | để trống nếu chưa có SePay |

   `JWT_SECRET`, `GATEWAY_SECRET`, `DATA_KEY` và `JOB_SECRET` do Render tự sinh, bạn không cần điền.
4. Deploy. Khi xong, mở `https://<tên-service>.onrender.com/api/health`. Kết quả phải là `{"data":{"status":"ok"}}`.
5. Nếu tên service khác `grandstay-api`, sửa URL trong **`client/vercel.json`** (dòng `destination`) rồi push lại.

## 3. Vercel (web)

1. Vào https://vercel.com và đăng nhập bằng GitHub.
2. **Add New → Project** → chọn repo → **Root Directory: `client`** → Deploy. Bước này không cần biến môi trường nào.
3. Copy tên miền Vercel cấp, ví dụ `https://grandstay-abc.vercel.app`.
4. Quay lại Render → **Environment**: đặt `CLIENT_ORIGIN`, `PUBLIC_URL` và `CLIENT_URL` đúng bằng tên miền đó (không có `/` ở cuối) → **Save, rebuild and deploy**.

Mở web, đăng nhập bằng `customer@demo.hotel` / `HotelDemo123!`, đặt phòng và trả cọc. Không có SePay thì trang thanh toán thử nghiệm (sandbox) sẽ hiện ra.

## 4. Các API key: lấy ở đâu, dán vào đâu

Tất cả key đều dán vào **Render → grandstay-api → Environment**. Vercel không cần key nào.

| Dịch vụ | Lấy ở đâu | Biến trên Render | Không có thì sao |
|---|---|---|---|
| **reCAPTCHA v2** (đăng nhập, đặt phòng) | https://www.google.com/recaptcha/admin → v2 "I'm not a robot" → Domains: tên miền Vercel (bỏ `https://`) | `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY` | Dùng key test của Google: vẫn chạy nhưng hiện dòng "for testing purposes only" |
| **Resend** (xác thực email, quên mật khẩu, thông báo, OTP huỷ phòng) | https://resend.com/api-keys | `RESEND_API_KEY` | Không gửi được email. Khách mới đăng ký không xác thực được, hãy dùng tài khoản demo |
| **SePay** (cổng thanh toán cọc) | https://my.sepay.vn → Cổng thanh toán → Sandbox → Merchant ID và Secret Key | `SEPAY_MERCHANT_ID`, `SEPAY_SECRET_KEY` | Dùng cổng sandbox có sẵn khi `ENABLE_SANDBOX_GATEWAY=true` |

**Lưu ý về Resend:** khi gửi từ `onboarding@resend.dev`, Resend chỉ cho gửi tới **email của chính tài khoản Resend**. Muốn gửi cho bất kỳ ai, bạn cần thêm và xác thực một tên miền trên Resend, rồi đổi `RESEND_FROM_EMAIL` thành địa chỉ thuộc tên miền đó.

**Khi dùng SePay:**
- Có key là hệ thống tự chuyển sang SePay. Đặt `ENABLE_SANDBOX_GATEWAY` = `false`.
- Trên my.sepay.vn → IPN, đặt URL: `https://<tên-miền-vercel>/api/payments/sepay/ipn`.
- Lúc thử nghiệm để `SEPAY_ENV=sandbox`. Khi nhận tiền thật thì đổi thành `production` và dùng key production.

## 5. Sau khi deploy

- **Render free tự ngủ sau 15 phút không có ai truy cập.** Lần mở đầu tiên sẽ mất khoảng 50 giây, và khi API ngủ thì các job tự động (hết hạn giữ phòng, tự duyệt huỷ, nhắc lịch) cũng dừng. Để giữ API luôn thức, tạo một cron miễn phí trên https://cron-job.org gọi `GET https://<tên-service>.onrender.com/api/health` mỗi 10 phút.
  Chắc chắn hơn (SRS 4.2.4: job không được phụ thuộc lượng truy cập): cũng trên cron-job.org, tạo các cron gọi `POST https://<tên-service>.onrender.com/api/jobs/<tên-job>` với header `X-Job-Secret: <giá trị JOB_SECRET trên Render>`. Mọi job đều chạy lại an toàn và tự xử lý phần bị lỡ:

  | Job | Lịch (giờ Việt Nam) |
  | --- | --- |
  | `hold-expiry`, `cancellation-auto-approval`, `housekeeping-tick` | mỗi 5 phút |
  | `payment-reconciliation` | 04:15 hằng ngày |
  | `penalty-waiver` | 04:30 hằng ngày |
  | `no-show-processing` | 06:00 hằng ngày |
  | `routine-tasks` | 07:00 hằng ngày |
  | `arrival-reminder` | 09:00 hằng ngày |
- **Đổi mật khẩu 5 tài khoản demo** (`HotelDemo123!`) nếu web công khai lâu dài.
- Mỗi lần push lên GitHub, Render và Vercel tự deploy lại.

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân và cách sửa |
|---|---|
| Đăng nhập xong vẫn bị đẩy ra, hoặc "Request origin is not allowed" | `CLIENT_ORIGIN` trên Render không trùng tên miền Vercel (kiểm tra `https://` và không có `/` cuối) |
| Mọi trang báo lỗi máy chủ hoặc 404 `/api` | URL Render trong `client/vercel.json` sai, hoặc API đang ngủ (đợi khoảng 50 giây rồi tải lại) |
| Render báo `MONGO_URI is required` hoặc `Server selection timed out` | Sai chuỗi Atlas, hoặc chưa mở Network Access `0.0.0.0/0` |
| CAPTCHA báo "Invalid domain for site key" | Chưa thêm tên miền Vercel vào danh sách Domains của reCAPTCHA |
| Bấm trả cọc không có gì xảy ra | Chưa có SePay và `ENABLE_SANDBOX_GATEWAY` không phải `true` |
