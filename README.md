# Odoo Dashboard Module

## Mô tả
Module Dashboard cho Odoo Community 19 hiển thị các thống số quan trọng và biểu đồ phân tích kinh doanh.

## Tính năng chính

### 1. Thống số
- **Số đơn hàng trong ngày**: Hiển thị tổng số đơn hàng được tạo hôm nay
- **Doanh thu hôm nay**: Hiển thị tổng doanh thu từ các đơn hàng đã hoàn thành
- **Bàn sử dụng**: Hiển thị số bàn đang sử dụng trên tổng số bàn (nếu có POS)
- **Phương thức thanh toán**: Hiển thị số phương thức thanh toán có cấu hình

### 2. Danh sách Phương thức Thanh toán
Hiển thị chi tiết các phương thức thanh toán được sử dụng trong ngày:
- Tên phương thức
- Số lần sử dụng
- Tổng tiền

### 3. Biểu đồ Doanh thu
Biểu đồ đường hiển thị doanh thu theo thời gian với các lựa chọn:
- Hôm nay
- Hôm qua
- 7 ngày trước
- Tuần này
- Tuần trước
- Tháng này
- Tháng trước

### 4. Biểu đồ Lợi nhuận
Biểu đồ đường hiển thị lợi nhuận theo thời gian (giống như doanh thu)

### 5. Danh sách Sản phẩm Bán chạy
Hiển thị top 10 sản phẩm bán chạy nhất với các thông tin:
- Tên sản phẩm
- Số lượng bán
- Doanh thu
- Chi phí
- Lợi nhuận

## Yêu cầu
- Odoo Community 19
- Python 3.8+
- Chart.js (được load từ CDN)

## Cài đặt

1. Copy module vào thư mục `addons` của Odoo
2. Khởi động lại Odoo server
3. Truy cập **Apps** → Tìm kiếm "Dashboard" → Click **Install**

## Sử dụng

1. Từ menu chính, click vào **Dashboard**
2. Xem các thống số và biểu đồ
3. Sử dụng các select boxes để thay đổi khoảng thời gian

## Lưu ý
- Module này phụ thuộc vào modules: `sale`, `point_of_sale`, `account`
- Dữ liệu được cập nhật mỗi 30 giây
- Chart.js được load từ CDN, cần kết nối internet để hoạt động

## Phát triển
- Thêm hỗ trợ cho custom date range
- Thêm export dữ liệu sang Excel/PDF
- Thêm cảnh báo khi doanh thu thấp
- Thêm biểu đồ theo phân loại sản phẩm
