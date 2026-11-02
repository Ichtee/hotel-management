# Member 2 Implementation Contract & 10-Week Execution Guide

**Thành viên:** M2 — Đỗ Nguyễn Quang Sơn (HE180515)  
**Phân hệ sở hữu:** Tìm kiếm / Đặt phòng / Công suất phòng (Search / Reservation / Occupancy)  
**Tài liệu liên quan:** T2 — SRS Document (October 2026), T3 — SDS Document (October 2026), T1 — Project Tracking (10 Tuần), T4 — Issues Report, T5 — Final Release Document  
**Công nghệ:** React 19 / Vite frontend, Node.js Express REST API, MongoDB / Mongoose ODM.

---

## I. Tổng quan phân hệ & Quyết định thiết kế (Design Decisions)

### 1. Bảng đối chiếu Use Case (SRS 2026 & Tracking Register)

| Use Case SRS (Oct 2026) | Use Case Tracking WBS | Tên Use Case | Actor | Trách nhiệm của M2 |
|---|---|---|---|---|
| **UC04** | UC05 | Search Room | Customer, Receptionist | Lọc phòng theo ngày (`checkIn`, `checkOut`), số khách, khoảng giá, tiện ích |
| **UC05** | UC06 | View Room Details | Customer, Receptionist | Xem chi tiết loại phòng, tiện nghi, giường, ảnh, giá cơ bản & giá mùa vụ |
| **UC06** | UC07 | Make Reservation | Customer, Receptionist | Tạo đơn đặt phòng, atomic concurrency check, giữ chỗ 15 phút (BR-29), áp coupon, snapshot giá |
| **UC07** | UC12 | Modify Reservation | Customer, Receptionist | Đổi ngày lưu trú (BR-46 kiểm tra mốc 48h hoàn 100%), số khách, yêu cầu đặc biệt |
| **UC08** | UC13 | Cancel Reservation | Customer, Receptionist | Hủy đơn: giữ cọc nếu < 48h, chuyển trạng thái `cancellation_requested` và khai báo số tài khoản nếu >= 48h (BR-32, BR-16, BR-17) |
| **UC09** | UC10, UC11 | View Booking | Customer, Receptionist, Manager | Xem danh sách chuyến đi (Upcoming/Past), chi tiết giá phòng, tiền cọc, sự kiện đơn phòng |
| **UC28** | UC37 | View Reports (Occupancy) | Manager, Admin | Báo cáo công suất phòng theo ngày, phân rã loại phòng, loại trừ phòng bảo trì, xuất file CSV |
| — | UC39 | Search Reservations | Customer, Front Desk, Manager | Bộ lọc tìm kiếm đặt phòng dùng chung (mã đơn, tên khách, số điện thoại, trạng thái, khoảng ngày) |
| — | BR-36 | Withdraw Cancellation | Customer | Khách hàng tự rút lại yêu cầu hủy đơn khi đơn đang chờ duyệt (`cancellation_requested` -> `confirmed`) |
| — | BR-29 | Abandon Pending Hold | Customer | Khách hàng chủ động nhả phòng giữ chỗ khi hủy thanh toán (`pending` -> `expired`) |

---

### 2. Các quy tắc nghiệp vụ cốt lõi (Core Business Rules & Invariants)

1. **Thuật toán kiểm tra phòng trống (T06 Availability & Date Overlap):**
   - Hai khoảng ngày lưu trú bị xung đột khi và chỉ khi:
     $$\text{existing.checkInDate} < \text{requested.checkOutDate} \quad \text{AND} \quad \text{existing.checkOutDate} > \text{requested.checkInDate}$$
   - Các đơn có trạng thái `pending` (còn hạn giữ chỗ), `confirmed`, `checked_in`, `cancellation_requested` đều được tính là đang chiếm phòng.
   - Các đơn `cancelled` hoặc `expired` được giải phóng phòng ngay lập tức.
   - Các phòng có trạng thái vật lý `status === 'maintenance'` hoặc `isActive === false` bị loại trừ hoàn toàn khỏi danh sách mở bán.

2. **Cơ chế Atomic Reservation & Chống Đặt Trùng (Overbooking Prevention):**
   - Trước khi lưu `booking.save()`, service thực hiện kiểm tra khóa nguyên tử đồng thời (Atomic Concurrency Check). Nếu có 2 khách hàng cùng đặt một phòng tại cùng một mili-giây, hệ thống chặn đơn thứ hai và trả về `409 Conflict`: *"One or more selected rooms were just reserved by another guest. Please select another room or alternative dates."*
   - Trong cùng 1 đơn đặt phòng, schema validator chặn việc gán trùng 1 `roomId` nhiều lần (Tuân thủ nguyên tắc LIM-02: 1 booking = 1 room).

3. **Cơ chế giữ chỗ 15 phút & Giới hạn chống đầu cơ (BR-29 Anti-Hoarding & 15-Minute Hold):**
   - Khi khách hàng tạo đơn đặt phòng trực tuyến yêu cầu đặt cọc, đơn được tạo ở trạng thái `pending` với thời hạn giữ phòng:
     $$\text{holdExpiresAt} = \text{Date.now()} + 15 \times 60 \times 1000 \quad \text{(15 phút)}$$
   - Một khách hàng tại cùng một thời điểm không được phép có quá 3 đơn giữ chỗ `pending` chưa thanh toán. Nếu vượt quá, hệ thống từ chối tạo đơn mới với mã thông báo **MSG-79**: *"Customer already has 3 pending reservations. Complete payment or cancel an existing hold before creating a new one."*
   - Khách hàng có thể bấm nút **"Cancel & Abandon Hold"** để giải phóng phòng ngay lập tức mà không cần chờ hết 15 phút.
   - Background Job `expireHolds(now)` định kỳ quét và chuyển các đơn quá hạn sang trạng thái `expired`.

4. **Chính sách đặt cọc & Snapshot giá (BR-31 Deposit Policy & Price Snapshot):**
   - Tỷ lệ cọc được snapshot trực tiếp từ cấu hình hiệu lực của khách sạn (`depositPercentage`, mặc định 20% hoặc 50%).
   - Nếu `totalAmount === 0` (được giảm giá 100%), đơn đặt phòng chuyển ngay lập tức sang trạng thái `confirmed`.
   - Giá phòng mỗi đêm được tính theo hàm `roomTypeService.calculatePriceForDate(roomTypeId, targetDate)`, tự động kích hoạt giá mùa vụ (`seasonalPricing`) nếu ngày lưu trú trùng dịp lễ/cao điểm.
   - Mọi giá trị (`priceAtBooking`, `roomAmount`, `depositRequired`, `policySnapshot`) được lưu bất biến trong Document Booking.

5. **Chính sách hủy đơn phân tầng & Khai báo tài khoản hoàn tiền (BR-16, BR-17, BR-32 Tiered Cancellation):**
   - **Mốc thời gian:** Tính theo thời điểm hủy so với thời điểm Check-in (14:00 ngày `checkInDate`):
     - $\ge 48$ giờ trước check-in: Được hoàn **100%** số tiền cọc đã thanh toán. Đơn chuyển sang trạng thái `cancellation_requested`, khách hàng bắt buộc khai báo thông tin tài khoản ngân hàng thụ hưởng (`refundAccount`: Tên ngân hàng, Số tài khoản, Tên chủ tài khoản) để bộ phận Lễ tân duyệt chuyển khoản (hoặc tự động duyệt sau 24h).
     - $< 48$ giờ trước check-in: Được hoàn **0%** (khách mất tiền cọc). Đơn chuyển ngay lập tức sang trạng thái `cancelled`.
   - **Rút lại yêu cầu hủy (BR-36):** Trong thời gian đơn đang ở trạng thái `cancellation_requested` (chưa được duyệt/từ chối), khách hàng có quyền bấm **"Withdraw Cancellation Request"** để khôi phục lại trạng thái `confirmed` của chuyến đi.

6. **Chính sách đổi ngày lưu trú (BR-46 Date Modification Policy):**
   - Khách hàng chỉ được phép thay đổi ngày lưu trú (`checkInDate`, `checkOutDate`) nếu đơn đặt phòng tại thời điểm sửa đổi đủ điều kiện hoàn 100% tiền cọc ($\ge 48$ giờ trước check-in).
   - Nếu trong vòng 48 giờ trước check-in, hệ thống từ chối đổi ngày với mã thông báo **MSG-78**: *"Modification is only allowed when eligible for 100% refund (> 48h before check-in)"*.

7. **Công thức tính công suất phòng chuẩn quốc tế (Occupancy Definition - UC28/UC37):**
   $$\text{Occupancy Rate (\%)} = \frac{\text{Occupied Room-Nights}}{\text{Sellable Room-Nights}} \times 100\%$$
   - **Mẫu số (Sellable Room-Nights):** Tổng số đêm phòng thực tế có thể mở bán trong kỳ:
     $$\text{Sellable Nights} = \text{Total Physical Rooms} \times \text{Days in Period} - \text{Maintenance/Blocked Room-Nights}$$
   - **Tử số (Occupied Room-Nights):** Tổng số đêm phòng có khách lưu trú thực tế từ các đơn hợp lệ (`confirmed`, `checked_in`, `checked_out`, `cancellation_requested`).
   - Tỷ lệ được làm tròn đến 1 chữ số thập phân và phân tách chi tiết theo từng loại phòng (`roomTypeBreakdown`).

---

## II. API Contract chi tiết của M2

### 1. `GET /api/rooms/search`
- **Use Case:** UC04 Search Room
- **Query params:** `hotelId`, `checkInDate`, `checkOutDate`, `guests`, `minPrice`, `maxPrice`.
- **Response:**
  ```json
  {
    "success": true,
    "count": 4,
    "data": [
      {
        "_id": "671...",
        "roomNumber": "301",
        "floor": 3,
        "status": "available",
        "roomTypeId": {
          "name": "Deluxe Double",
          "basePrice": 850000,
          "maxOccupancy": 2,
          "bedType": "King"
        }
      }
    ]
  }
  ```

### 2. `POST /api/bookings`
- **Use Case:** UC06 Make Online Reservation
- **Body:**
  ```json
  {
    "hotelId": "671...",
    "checkInDate": "2026-11-10",
    "checkOutDate": "2026-11-14",
    "rooms": [{ "roomTypeId": "671...", "guestCount": 2 }],
    "guestName": "Tran Van B",
    "guestEmail": "tranb@example.com",
    "guestPhone": "0912345678",
    "couponCode": "WELCOME10",
    "paymentType": "deposit",
    "specialRequests": "High floor with sea view"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "success": true,
    "message": "Reservation created successfully",
    "data": {
      "bookingReference": "BK-2841",
      "status": "pending",
      "holdExpiresAt": "2026-10-29T12:25:00.000Z",
      "roomAmount": 3400000,
      "discountAmount": 340000,
      "totalAmount": 3060000,
      "depositRequired": 612000,
      "policySnapshot": {
        "depositPercentage": 20,
        "cancellationTiers": [
          { "hoursBeforeCheckIn": 48, "refundPercentage": 100 },
          { "hoursBeforeCheckIn": 0, "refundPercentage": 0 }
        ]
      }
    }
  }
  ```

### 3. `POST /api/bookings/:id/cancel-payment`
- **Use Case:** BR-29 Abandon Payment & Release Hold
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Payment abandoned and room hold released",
    "data": {
      "_id": "671...",
      "status": "expired",
      "bookingReference": "BK-2841"
    }
  }
  ```

### 4. `POST /api/bookings/:id/modify`
- **Use Case:** UC07 Modify Reservation (BR-46 Enforced)
- **Body:**
  ```json
  {
    "checkInDate": "2026-11-12",
    "checkOutDate": "2026-11-16",
    "specialRequests": "Need early check-in at 12:00"
  }
  ```
- **Error Response (400 Bad Request if within 48h):**
  ```json
  {
    "success": false,
    "message": "Modification is only allowed when eligible for 100% refund (> 48h before check-in)"
  }
  ```

### 5. `POST /api/bookings/:id/cancel` hoặc `DELETE /api/bookings/:id/cancel`
- **Use Case:** UC08 Cancel Reservation (BR-16, BR-17, BR-32 Enforced)
- **Body:**
  ```json
  {
    "reason": "Change of travel plans",
    "refundAccount": {
      "bank": "Vietcombank",
      "accountNumber": "0123456789",
      "holderName": "TRAN VAN B"
    }
  }
  ```
- **Response (200 OK - Khi đủ điều kiện hoàn cọc > 0):**
  ```json
  {
    "success": true,
    "message": "Cancellation request submitted and pending approval",
    "data": {
      "status": "cancellation_requested",
      "cancellation": {
        "reason": "Change of travel plans",
        "refundableAmount": 612000,
        "requestedAt": "2026-10-29T12:00:00.000Z"
      },
      "refundAccount": {
        "bank": "Vietcombank",
        "accountNumber": "0123456789",
        "holderName": "TRAN VAN B"
      }
    }
  }
  ```

### 6. `POST /api/bookings/:id/withdraw-cancellation`
- **Use Case:** BR-36 Withdraw Cancellation Request
- **Response (200 OK):**
  ```json
  {
    "success": true,
    "message": "Cancellation request withdrawn successfully",
    "data": {
      "status": "confirmed",
      "bookingReference": "BK-2841"
    }
  }
  ```

### 7. `GET /api/reports/occupancy`
- **Use Case:** UC28 View Reports (Occupancy Math)
- **Query params:** `from`, `to`, `hotelId`, `format` (`json` hoặc `csv`).
- **Response:**
  ```json
  {
    "success": true,
    "data": {
      "from": "2026-10-01",
      "to": "2026-10-24",
      "totals": {
        "totalPhysicalRooms": 24,
        "totalSellableNights": 552,
        "totalOccupiedNights": 430,
        "totalMaintenanceNights": 24,
        "averageOccupancyRate": 77.9
      },
      "series": [
        {
          "date": "2026-10-01",
          "totalRooms": 24,
          "maintenanceRooms": 1,
          "sellableRooms": 23,
          "occupiedRooms": 18,
          "occupancyRate": 78.3
        }
      ],
      "roomTypeBreakdown": [
        {
          "roomType": "Deluxe Double",
          "totalRooms": 10,
          "sellableNights": 230,
          "occupiedNights": 195,
          "occupancyRate": 84.8
        }
      ]
    }
  }
  ```

---

## III. Bảng kế hoạch chi tiết 10 tuần của M2 (Task Execution Breakdown)

| Tuần | Mã task | Loại việc | Công việc chi tiết | Kết quả đạt được | Reviewer |
|---|---|---|---|---|---|
| **Tuần 1** | `W1-M2-1` | Tài liệu | Phân tích tìm kiếm khách sạn/phòng, tình trạng trống, vòng đời đặt phòng và cách tính công suất phòng | Tài liệu quy tắc date overlap, mẫu số room-night và ownership | M1 |
| **Tuần 1** | `W1-M2-2` | Thiết kế | Phác thảo Screen Flow và Screen Details cho Customer; xác định trạng thái booking và phương án ngăn đặt phòng trùng | Sơ đồ luồng màn hình khách, state machine đặt phòng | M1 |
| **Tuần 1** | `W1-M2-3` | Tài liệu | Lập danh sách Use Case và khung Functional Requirements trong SRS | Danh mục Use Case register hoàn chỉnh (không tính micro-actions) | M1 |
| **Tuần 1** | `W1-M2-4` | Rà soát | Rà soát các giả định về thanh toán với M3 và đưa ra ước lượng backlog | Danh sách câu hỏi tích hợp M2-M3, estimation backlog | M1 |
| **Tuần 2** | `W2-M2-1` | Tài liệu | Hoàn thiện Functional Requirements và Use Case specification của M2 (search/book/history/change/cancel/report) | Phần SRS hoàn chỉnh cho phân hệ đặt phòng & công suất | M1 |
| **Tuần 2** | `W2-M2-2` | Thiết kế | Vẽ Customer Screen Flow và Booking workflow, gồm các nhánh Room Unavailable và Payment Failure | Sơ đồ luồng Workflow 1 và wireframe tương tác khách | M1 |
| **Tuần 2** | `W2-M2-3` | Tài liệu | Ghép Use Case Diagram hoàn chỉnh và rà soát để có 35–45 Use Case có ý nghĩa | Use Case Diagram tổng thể nhóm, phân chia actor rõ ràng | M1 |
| **Tuần 2** | `W2-M2-4` | Rà soát | Rà soát SRS của M3 và kiểm tra việc bàn giao trạng thái giữa booking và payment | Biên bản thống nhất trạng thái booking/payment handoff | M1 |
| **Tuần 3** | `W3-M2-1` | Thiết kế | Thiết kế service tìm kiếm/đặt phòng/occupancy, index theo ngày và cấp phát room-night theo cơ chế atomic | Tài liệu SDS M2, Database Schema & Table Descriptions | M1 |
| **Tuần 3** | `W3-M2-2` | Tài liệu | Hợp nhất SRS của cả nhóm và kiểm tra 45 Use Case, actor, workflow và độ phủ màn hình | SRS Baseline, đóng các câu hỏi còn tồn đọng | M1 |
| **Tuần 3** | `W3-M2-3` | Test Design | Thiết kế các edge test về trùng ngày, booking đồng thời, quyền sở hữu và occupancy | Ma trận test cases & test data cho M2 | M1 |
| **Tuần 3** | `W3-M2-4` | Rà soát | Rà soát SDS/API contract của M3 và đóng góp vào DOC FREEZE | Ký duyệt DOC FREEZE, sẵn sàng bước vào giai đoạn code | M1 |
| **Tuần 4** | `W4-M2-1` | Lập trình | Lập trình API tìm kiếm/lọc/chi tiết và màn hình React theo room contract | API search, filters và view chi tiết phòng hoạt động tốt | M1 |
| **Tuần 4** | `W4-M2-2` | Lập trình | Lập trình availability service với biên ngày và loại trừ các phòng không khả dụng | Availability Service chuẩn T06 tái sử dụng cho cả lễ tân | M1 |
| **Tuần 4** | `W4-M2-3` | Kiểm thử | Chạy unit/API test cho availability; phân biệt phòng đã đặt với phòng bẩn/bị block | Bộ test tự động kiểm tra overlap boundaries & invalid dates | M1 |
| **Tuần 4** | `W4-M2-4` | Rà soát | Rà soát deposit service của M3 và tinh chỉnh công việc cho increment tiếp theo | PR review notes và cập nhật tracking | M1 |
| **Tuần 5** | `W5-M2-1` | Lập trình | Lập trình Make Reservation theo cơ chế atomic, giữ ngày, chi tiết và tìm kiếm booking | Concurrent request không thể đặt trùng cùng 1 phòng (BR-29, LIM-02) | M1 |
| **Tuần 5** | `W5-M2-2` | Tích hợp | Kết nối UI booking của khách hàng với coupon quote và sandbox đặt cọc; lưu price snapshot | Luồng Tìm kiếm -> Đặt phòng -> Đặt cọc hoạt động thông suốt | M1 |
| **Tuần 5** | `W5-M2-3` | Kiểm thử | Kiểm thử race condition, gửi trùng, quyền sở hữu và các case price snapshot | Bằng chứng kiểm thử tích hợp booking-payment API | M1 |
| **Tuần 5** | `W5-M2-4` | Rà soát | Rà soát nền tảng thông báo/payment flow của M3 và hỗ trợ demo #1 | Demo #1 thành công với khách hàng và ghi nhận phản hồi | M1 |
| **Tuần 6** | `W6-M2-1` | Lập trình | Lập trình Booking History và chức năng khách hàng Modify/Cancel theo contract giữ chỗ và chính sách hoàn tiền | Khách hàng có thể tự sửa ngày (BR-46) / hủy đơn / rút yêu cầu hủy (BR-36) | M1 |
| **Tuần 6** | `W6-M2-2` | Lập trình | Lập trình Occupancy Report và hoàn thiện bộ lọc Search Reservation dùng chung | Báo cáo công suất phòng theo ngày, trừ phòng bảo trì, xuất CSV | M1 |
| **Tuần 6** | `W6-M2-3` | Kiểm thử | Kiểm thử đổi ngày, hủy đồng thời, tách biệt lịch sử và phép tính occupancy | Kiểm tra đối soát toán học công suất phòng chính xác 100% | M1 |
| **Tuần 6** | `W6-M2-4` | Rà soát | Rà soát các invariant hoàn tiền của M3 và ghi lại các thay đổi yêu cầu đã được duyệt | Cập nhật SRS & tracking bảng chênh lệch yêu cầu | M1 |
| **Tuần 7** | `W7-M2-1` | Tích hợp | Hoàn thiện các điểm bàn giao giữa booking/payment/cancel/refund/reception và báo cáo occupancy | Toàn bộ vòng đời đơn từ đặt, cọc, sửa, hủy đến check-out đồng bộ | M1 |
| **Tuần 7** | `W7-M2-2` | Sửa lỗi | Sửa lỗi UX/validation/race của booking; kiểm tra toàn bộ màn hình khách hàng | Không còn lỗi đặt trùng, giao diện responsive mượt mà | M1 |
| **Tuần 7** | `W7-M2-3` | Kiểm thử | Chạy regression trên staging cho booking race, ownership và occupancy | Bằng chứng test E2E Search / Reserve / Deposit trên staging | M1 |
| **Tuần 7** | `W7-M2-4` | Rà soát | Rà soát regression hoàn tiền của M3 và hỗ trợ demo #2 | Tham gia Demo #2, chốt Feature Freeze | M1 |
| **Tuần 8** | `W8-M2-1` | Kiểm thử | Chạy regression về booking đồng thời/ownership và hoàn thiện luồng E2E booking/cancel | Kiểm thử toàn diện đường đi Search / Reserve / Modify / Cancel | M1 |
| **Tuần 8** | `W8-M2-2` | Sửa lỗi | Dùng thời gian sửa lỗi dự phòng cho booking/occupancy và lỗi liên module | Khắc phục triệt để lỗi biên ngày và phòng bảo trì | M1 |
| **Tuần 8** | `W8-M2-3` | Tài liệu | Viết User Manual cho Customer kèm ảnh chụp và hợp nhất các thay đổi cuối của SRS | Hướng dẫn sử dụng cho khách hàng (Customer Manual - Mục VII) | M1 |
| **Tuần 8** | `W8-M2-4` | Rà soát | Rà soát evidence sandbox của M3 và hỗ trợ evaluation #3 | Biên bản đánh giá đợt 3, kiểm tra checklist release | M1 |
| **Tuần 9** | `W9-M2-1` | Tài liệu | Hoàn thiện SRS và User Manual cho Customer; xử lý sai lệch về tên/số lượng Use Case | Bản SRS đóng gói cuối cùng, khớp toàn diện các quy tắc nghiệp vụ | M1 |
| **Tuần 9** | `W9-M2-2` | Kiểm thử | Chạy nghiệm thu booking/occupancy trên bản deploy; chỉ retest các bản sửa đã được duyệt | Bộ kết quả test nghiệm thu có chữ ký xác nhận | M1 |
| **Tuần 9** | `W9-M2-3` | Trình bày | Chuẩn bị và diễn tập demo reservation/occupancy cùng phần Q&A về concurrency/thiết kế | Slide thuyết trình cá nhân, kịch bản demo và tài liệu giải trình AI | M1 |
| **Tuần 9** | `W9-M2-4` | Rà soát | Rà soát tài liệu cuối của M3 và hỗ trợ chuẩn bị nộp bài | Hoàn tất gói nộp Final Release Package | M1 |
| **Tuần 10** | `W10-M2-1`| Trình bày | Trình bày module được phân công và trả lời câu hỏi hội đồng bằng bản build đã chốt ở Tuần 9 | Bảo vệ thành công đồ án trước hội đồng chấm thi | M1 |

---

## IV. Bằng chứng nghiệm thu & Nhật ký kiểm thử tự động

### 1. Lệnh thực thi kiểm thử
```bash
# Kiểm thử toàn diện module M2
npm run test:member2 --prefix server

# Kiểm thử toàn bộ hệ thống (15 test suites)
npm test --prefix server

# Kiểm thử build client Vite/React
npm run build --prefix client
```

### 2. Chi tiết kết quả kiểm thử (100% Passed)

- **Test Suite: Seasonal Pricing & RoomType Calculation**
  - Ngày thường: trả về đúng `basePrice = 1,000,000 VND`.
  - Ngày lễ Giáng sinh (`2026-12-25`): tự động kích hoạt giá mùa vụ `1,500,000 VND` (`isSeasonal: true`).
- **Test Suite: Room Operational Model & Status Invariants**
  - Giá trị enum hợp lệ: `available`, `occupied`, `cleaning`, `maintenance` -> Pass.
  - Giá trị không hợp lệ: `invalid_status` -> Bị reject ngay lập tức bởi Schema.
- **Test Suite: Double Booking Prevention in Same Request (LIM-02)**
  - Đơn hàng cố tình gán trùng 1 `roomId` cho 2 phòng -> Schema validator kích hoạt: *"A room cannot be assigned twice in one booking"*.
- **Test Suite: Date Inversion & Boundary Rejection**
  - `checkOutDate <= checkInDate` -> Thao tác tìm phòng và đặt phòng đều ném lỗi `400 Bad Request`.
- **Test Suite: T06 Availability Date Overlap Exclusion**
  - Phòng 101 có đơn từ `2026-11-10` đến `2026-11-15`.
  - Tìm kiếm phòng từ `2026-11-12` đến `2026-11-16` -> Phòng 101 bị loại trừ chính xác, chỉ phòng 102 xuất hiện trong kết quả.
- **Test Suite: BR-29 Anti-Hoarding & 15-Minute Hold**
  - Giới hạn 3 đơn giữ chỗ: Khi khách hàng đã có 3 đơn `pending`, đơn thứ 4 bị chặn với lỗi `400 Bad Request` (MSG-79).
  - Chủ động hủy giữ chỗ: Gọi `abandonPayment` giải phóng phòng ngay lập tức và đưa đơn về `expired`.
- **Test Suite: UC07 / BR-46 Modify Reservation Rules**
  - Thay đổi ngày lưu trú $\ge 48$h trước check-in: Hệ thống kiểm tra phòng trống, tính lại đơn giá, áp coupon và cập nhật tổng tiền thành công.
  - Thay đổi ngày $< 48$h trước check-in: Hệ thống từ chối với thông báo MSG-78.
- **Test Suite: UC08 / BR-32 Cancellation Requested & BR-36 Withdrawal**
  - Hủy đơn $\ge 48$h trước check-in: Đơn chuyển sang trạng thái `cancellation_requested`, ghi nhận tài khoản hoàn tiền (`refundAccount`) và số tiền dự kiến hoàn (`refundableAmount`).
  - Rút lại yêu cầu hủy: Gọi `withdrawCancellation` khôi phục trạng thái về `confirmed` và xóa yêu cầu hủy.
  - Hủy đơn $< 48$h trước check-in: Đơn chuyển ngay sang `cancelled` với số tiền hoàn 0 VND.
- **Test Suite: UC28/UC37 Occupancy Report Mathematical Exactness**
  - Setup 10 phòng vật lý (8 phòng bán được, 2 phòng bảo trì).
  - Trong 3 ngày, có 4 phòng có khách ở mỗi đêm.
  - Tổng đêm phòng có thể bán = $3 \times 8 = 24$ đêm.
  - Tổng đêm phòng có khách = $3 \times 4 = 12$ đêm.
  - Công suất phòng trung bình = $\frac{12}{24} \times 100\% = 50.0\%$ (Khớp toán học chính xác tuyệt đối).

---

## V. Hướng dẫn sử dụng cho Khách hàng (Customer User Manual)
*(Phục vụ deliverable W8-M2-3 và W9-M2-1)*

### 1. Tìm kiếm phòng trống (UC04 Search Room)
1. **Truy cập:** Mở trang chủ ứng dụng hoặc chọn tab **"Find Rooms"**.
2. **Nhập tiêu chí tìm kiếm:**
   - **Check-in Date:** Chọn ngày nhận phòng (phải từ ngày hôm nay trở đi).
   - **Check-out Date:** Chọn ngày trả phòng (phải lớn hơn ngày nhận phòng ít nhất 1 đêm).
   - **Guests:** Chọn số lượng người lớn và trẻ em.
   - **Price Range:** Kéo thanh trượt khoảng giá tối thiểu - tối đa mong muốn.
3. **Thao tác:** Bấm nút **"Search Rooms"**.
4. **Kết quả:** Hệ thống hiển thị danh sách các phòng khả dụng thỏa mãn điều kiện ngày lưu trú, không bị trùng lịch và không nằm trong thời gian bảo trì kỹ thuật.

### 2. Xem chi tiết loại phòng (UC05 View Room Details)
1. Trong danh sách kết quả, bấm vào thẻ phòng để xem chi tiết.
2. Màn hình hiển thị:
   - Thư viện ảnh phòng thực tế.
   - Danh sách tiện nghi (Điều hòa, Wifi miễn phí, TV thông minh, Bồn tắm...).
   - Loại giường (King bed, Twin bed) và sức chứa tối đa.
   - Chi tiết giá niêm yết và thông báo giá mùa cao điểm nếu rơi vào dịp lễ tết.

### 3. Đặt phòng trực tuyến & Thời gian giữ chỗ 15 phút (UC06 Make Online Reservation & BR-29)
1. Bấm nút **"Book Now"** trên loại phòng đã chọn.
2. **Nhập thông tin người lưu trú:**
   - Họ và tên người đại diện.
   - Số điện thoại liên hệ và Email nhận xác nhận đặt phòng.
   - Yêu cầu đặc biệt (nhận phòng tầng cao, giường phụ...).
   - Nhập mã giảm giá khuyến mãi (nếu có) và bấm **"Apply Coupon"** để xem tổng tiền sau giảm giá.
3. Bấm **"Confirm Reservation"**:
   - Hệ thống tiến hành khóa phòng tạm thời trong **15 phút** (`pending hold`).
   - Màn hình hiển thị đồng hồ đếm ngược 15:00 và nút bấm chuyển sang thanh toán đặt cọc.
   - *Lưu ý quy tắc BR-29:* Mỗi tài khoản chỉ được phép giữ tối đa 3 đơn phòng chưa thanh toán. Nếu muốn giải phóng phòng ngay, khách hàng bấm **"Cancel & Abandon Hold"**.

### 4. Quản lý danh sách đặt phòng (UC09 View Booking)
1. Chọn tab **"My Bookings"** trên thanh điều hướng.
2. Danh sách được phân tách rõ ràng thành 2 tab:
   - **Upcoming Trips:** Các chuyến đi sắp tới ở trạng thái `pending`, `confirmed`, hoặc `cancellation_requested`.
   - **Past Trips:** Các chuyến đi đã hoàn thành (`checked_out`), đã hủy (`cancelled`), hoặc hết hạn giữ chỗ (`expired`).
3. Bấm vào từng đơn để xem chi tiết: Mã đơn phòng (`BK-XXXX`), số phòng, khoảng ngày, bảng kê chi phí và lịch sử cập nhật.

### 5. Thay đổi ngày lưu trú (UC07 Modify Reservation & BR-46)
1. Trong màn hình chi tiết đơn phòng ở tab **Upcoming**, bấm nút **"Modify Dates"**.
2. Chọn khoảng ngày `Check-in` và `Check-out` mới.
3. Bấm **"Save Changes"**:
   - Nếu thời điểm sửa ngày còn cách giờ nhận phòng $\ge 48$ giờ: Hệ thống tự động tính lại giá phòng theo ngày mới, cập nhật chênh lệch tiền cọc và ghi log thay đổi.
   - Nếu trong vòng 48 giờ trước check-in: Hệ thống từ chối đổi ngày và hiển thị cảnh báo đỏ **MSG-78**.

### 6. Yêu cầu hủy đặt phòng & Khai báo tài khoản hoàn tiền (UC08 Cancel Reservation & BR-16/17/32)
1. Bấm nút **"Cancel Booking"** trên đơn đặt phòng sắp tới.
2. Hộp thoại xác nhận hủy hiển thị chính sách hoàn tiền tương ứng:
   - **Trường hợp đơn phòng được hoàn cọc (trước 48 giờ):**
     - Hệ thống hiển thị số tiền cọc dự kiến được hoàn (100%).
     - Khách hàng nhập thông tin tài khoản thụ hưởng: Tên ngân hàng, Số tài khoản, Tên chủ tài khoản và Lý do hủy phòng.
     - Bấm **"Confirm Cancellation Request"**: Đơn chuyển sang trạng thái `cancellation_requested` để Lễ tân duyệt chuyển khoản.
   - **Trường hợp đơn phòng không được hoàn cọc (trong vòng 48 giờ):**
     - Hệ thống cảnh báo mất 100% tiền cọc.
     - Bấm **"Confirm Cancel"**: Đơn chuyển sang trạng thái `cancelled` ngay lập tức.

### 7. Rút lại yêu cầu hủy đặt phòng (BR-36 Withdraw Cancellation)
1. Nếu khách hàng đổi ý và muốn tiếp tục chuyến đi trong khi đơn đang chờ duyệt hủy (`cancellation_requested`), mở chi tiết đơn trong **My Bookings**.
2. Bấm nút **"Withdraw Request"**.
3. Hệ thống phục hồi trạng thái đơn về **"confirmed"** ngay lập tức, giữ nguyên phòng và lịch trình của khách hàng.

### 8. Báo cáo công suất phòng (UC28 View Occupancy Report - Dành cho Quản lý)
1. Đăng nhập tài khoản Quản trị / Quản lý và chọn mục **"Occupancy Report"**.
2. Chọn khoảng thời gian cần thống kê (`From Date` - `To Date`).
3. Theo dõi bảng chỉ số tổng quan: Tổng đêm phòng thực tế có thể bán (đã trừ ngày phòng hỏng/bảo trì), Tổng đêm phòng có khách, Tỷ lệ công suất phòng bình quân.
4. Xem biểu đồ công suất từng ngày và bảng phân tích theo từng loại phòng.
5. Bấm nút **"Export CSV"** để tải về bảng tính Excel phục vụ báo cáo hội đồng quản trị.

---

## VI. Hướng dẫn bảo vệ đồ án & Trả lời câu hỏi Hội đồng (Council Q&A)
*(Phục vụ deliverable W9-M2-3 và W10-M2-1)*

### 1. Câu hỏi: "Làm thế nào hệ thống ngăn chặn đặt phòng trùng (Overbooking) khi có 2 khách cùng bấm thanh toán 1 phòng tại cùng 1 giây?"
- **Trả lời:**
  > *"Hệ thống áp dụng cơ chế kiểm tra đồng thời nguyên tử (Atomic Concurrency Double-Check). Khi khách chọn phòng, hệ thống kiểm tra tình trạng trống lần 1 qua Date Overlap (`existing.checkIn < new.checkOut && existing.checkOut > new.checkIn`). Ngay trước thời điểm commit ghi đơn phòng vào MongoDB, Service thực hiện truy vấn khóa nguyên tử kiểm tra lại một lần nữa các booking mới được tạo trong tích tắc đó. Nếu phát hiện phòng đã bị người khác hoàn tất trước, giao dịch sẽ rollback và trả về mã lỗi 409 Conflict với thông báo rõ ràng để khách chọn phòng khác, đảm bảo dữ liệu phòng không bao giờ bị ghi đè."*

### 2. Câu hỏi: "Cơ chế giữ chỗ 15 phút và chống đầu cơ (BR-29) hoạt động ra sao nếu khách hàng cố tình tạo nhiều đơn phòng ảo?"
- **Trả lời:**
  > *"Để chống tình trạng đầu cơ giữ phòng ảo làm nghẽn quỹ phòng của khách sạn, hệ thống triển khai hai lớp bảo vệ: (1) Kiểm soát ngưỡng chống đầu cơ (Anti-Hoarding Threshold): Trước khi tạo đơn giữ chỗ, hệ thống kiểm tra tổng số đơn đang ở trạng thái `pending` của khách hàng đó. Nếu đã có từ 3 đơn trở lên, hệ thống sẽ từ chối tạo đơn mới với mã lỗi MSG-79; (2) Bộ đếm thời gian 15 phút nguyên tử: Mỗi đơn `pending` được gắn `holdExpiresAt = Date.now() + 15 phút`. Một background worker chạy định kỳ tự động quét và chuyển trạng thái các đơn quá hạn sang `expired`, giải phóng ngay lập tức các đêm phòng vào kho mở bán cho khách khác."*

### 3. Câu hỏi: "Quy trình hủy phòng và hoàn tiền cọc được thiết kế thế nào để đảm bảo tính an toàn tài chính?"
- **Trả lời:**
  > *"Hệ thống áp dụng chính sách phân tầng hoàn tiền theo mốc 48 giờ trước giờ check-in: (1) Nếu khách hủy trước 48 giờ, khách đủ điều kiện hoàn 100% tiền cọc. Tuy nhiên, để bảo vệ dòng tiền, hệ thống không hoàn tiền tự động ngay lập tức mà chuyển đơn sang trạng thái `cancellation_requested` và yêu cầu khách khai báo tài khoản ngân hàng thụ hưởng. Lễ tân hoặc Quản lý sẽ đối soát và bấm duyệt chuyển khoản (hoặc hệ thống auto-approve sau 24h); (2) Trong thời gian chờ duyệt hủy, khách hàng có thể chủ động rút lại yêu cầu hủy (`withdrawCancellation`) nếu thay đổi kế hoạch; (3) Nếu khách hủy trong vòng 48 giờ, khách bị mất 100% cọc theo điều khoản hợp đồng và đơn chuyển thẳng sang `cancelled`."*

### 4. Câu hỏi: "Khi khách hàng sửa ngày đặt phòng (Modify Reservation), hệ thống xử lý giá và tình trạng phòng cũ như thế nào?"
- **Trả lời:**
  > *"Hệ thống thực hiện: (1) Kiểm tra điều kiện mốc thời gian theo BR-46: Chỉ cho phép đổi ngày nếu đơn tại thời điểm sửa đủ điều kiện hoàn 100% cọc (> 48h trước check-in). Nếu < 48h, hệ thống chặn để tránh việc khách lách luật dời ngày xa hơn rồi mới hủy để lấy lại cọc; (2) Kiểm tra phòng hiện tại có trống trong khoảng ngày mới hay không bằng cách loại trừ chính `bookingId` đó khỏi điều kiện lọc xung đột; (3) Tính lại giá từng đêm theo biểu giá của các ngày mới (bao gồm giá mùa vụ nếu rơi vào dịp lễ); (4) Tính lại mã giảm giá và tổng tiền; (5) Lưu giữ lịch sử thay đổi trong mảng `events` của booking với đầy đủ giá trị cũ và mới để phục vụ đối soát."*

### 5. Câu hỏi: "Cách tính công suất phòng (Occupancy Rate) xử lý các phòng đang hỏng hóc hoặc sửa chữa thế nào?"
- **Trả lời:**
  > *"Công thức tính công suất phòng của hệ thống tuân theo tiêu chuẩn quản trị khách sạn quốc tế: Chỉ chia trên số đêm phòng thực tế có thể bán (Sellable Room-Nights), chứ không chia thuần túy trên tổng số phòng vật lý. Các phòng có trạng thái `maintenance` được trừ ra khỏi mẫu số để không làm méo mó hiệu quả kinh doanh của khách sạn: $\text{Sellable Nights} = \text{Total Physical Rooms} \times \text{Days} - \text{Maintenance Nights}$. Đồng thời, báo cáo bóc tách riêng số đêm phòng bảo trì và phân tích theo từng loại phòng để người quản lý theo dõi tỷ lệ thất thoát do phòng hỏng."*
