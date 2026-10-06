# Thiết kế MongoDB theo 40 use case

Ứng dụng dùng Mongoose với 17 model, mỗi model trong `server/src/models` tương ứng một collection MongoDB. `ObjectId` là tham chiếu logic; MongoDB không tự kiểm tra khóa ngoại. Các trường tiền hiện lưu số nguyên VND (không lưu số thực thập phân). Mọi collection trừ `couponusages` có `createdAt`/`updatedAt`. Lịch sử thao tác được nhúng trong `bookings.events`.

## Collection và quan hệ

| Collection | Dữ liệu chính | Quan hệ / use case |
|---|---|---|
| `users` | tài khoản, mật khẩu băm, `role`, hồ sơ khách/nhân viên | đăng ký, đăng nhập, hồ sơ, quản lý khách/nhân viên |
| `roles` | `key`, tên, danh sách `permissions` | admin quản lý quyền; `users.role` khớp `roles.key` |
| `hotels` | tên, địa chỉ, thành phố, liên hệ | tìm khách sạn |
| `roomtypes` | loại phòng, sức chứa, tiện nghi, ảnh, giá cơ bản, giá theo mùa | tìm/xem phòng, quản lý loại và giá |
| `rooms` | phòng vật lý, số phòng, trạng thái vận hành | gán/chuyển phòng, bảo trì |
| `services` | dịch vụ và đơn giá theo `hotelId` | lễ tân ghi dịch vụ phát sinh |
| `bookings` | khách, ngày ở, phòng, dịch vụ, tổng tiền, trạng thái, snapshot chính sách và mảng `events` | đặt/sửa/hủy phòng, check-in/out, lịch sử thao tác, báo cáo |
| `payments` | `kind` cọc/cuối/phát sinh, số tiền, phương thức, gateway, mã giao dịch | thanh toán, doanh thu |
| `refunds` | khoản hoàn gắn payment, trạng thái và mã gateway | xử lý hoàn tiền |
| `invoices` | một hóa đơn/booking | tổng kết khi check-out |
| `coupons` | mã giảm giá, thời gian, giới hạn dùng | quản lý khuyến mãi |
| `couponusages` | coupon, booking, khách sử dụng | chống dùng lại khuyến mãi |
| `hotelpolicies` | chính sách cọc hoặc hủy/hoàn theo khách sạn, hiệu lực | quản lý chính sách; booking giữ snapshot đã áp dụng |
| `reviews` | đánh giá sau lưu trú | gửi/xem đánh giá |
| `notifications` | thông báo, trạng thái đã đọc | xem thông báo |
| `cleaningtasks` | phòng, nhân viên, lịch dọn, tiến độ | quản lý dọn phòng |
| `roomissues` | phòng, người báo, mức độ, xử lý | báo sự cố phòng |

## Quy ước nghiệp vụ cần dùng ở service/API

- **Tình trạng phòng:** `rooms.status` là trạng thái vận hành hiện tại, không phản ánh phòng còn trống trong một khoảng ngày. Khi tìm phòng, lọc phòng không bảo trì rồi loại các booking `pending`/`confirmed`/`checked_in` có khoảng ngày giao nhau (`existing.checkInDate < requested.checkOutDate` và `existing.checkOutDate > requested.checkInDate`). Cần transaction hoặc cơ chế khóa khi xác nhận booking để tránh đặt trùng do hai yêu cầu đồng thời.
- **Giá:** `roomtypes.basePrice`/`seasonalPricing` là giá hiện hành. `bookings.rooms.priceAtBooking`, `roomAmount`, `serviceAmount`, `discountAmount`, `totalAmount` là số đã chốt tại thời điểm đặt. Cập nhật giá không sửa booking cũ. Service cần tính lại tổng tiền khi sửa booking/thêm dịch vụ.
- **Cọc và hoàn:** chọn `hotelpolicies` theo khách sạn, loại, ngày hiệu lực; lưu `depositRequired` và bản sao quy tắc trong booking để chính sách sửa sau này không đổi điều kiện của đơn cũ. Tổng payment `success` trừ refund `completed` là số thực thu. Service phải kiểm tra tiền cọc/tất toán, giới hạn hoàn không vượt số đã thanh toán và xử lý callback gateway theo `idempotencyKey`/mã giao dịch.
- **Phân quyền:** `users.role` khớp `roles.key`; middleware lấy permissions từ Role. Nên tạo sẵn 5 role `customer`, `receptionist`, `manager`, `housekeeping`, `admin`. Việc đổi/xóa role đang được dùng cần kiểm tra ở service.
- **Tính toàn vẹn:** service xác nhận room/roomType thuộc cùng hotel, customer là người sở hữu booking, review chỉ sau `checked_out`, nhân viên thuộc đúng khách sạn, và các trạng thái chỉ chuyển theo luồng hợp lệ. Mongoose `ref` không tự bảo đảm các quy tắc này.
- **Báo cáo:** doanh thu tổng hợp từ `payments` thành công và `refunds` hoàn tất theo ngày giao dịch. Công suất phòng tính bằng số đêm phòng có booking hợp lệ chia tổng số đêm phòng bán được; cần định nghĩa rõ cách xử lý phòng bảo trì.

`server/scripts/initDatabase.js` tạo collection và index. `syncIndexes()` có thể xóa index cũ; cần xem kế hoạch migration trước khi chạy trên database có dữ liệu thật.
