# Hướng dẫn Cài đặt và Sử dụng Dashboard Module

## I. Yêu cầu Hệ thống

- **Odoo**: Version 19.0 Community Edition
- **Python**: 3.8 trở lên
- **Database**: PostgreSQL 13+
- **Modules phụ thuộc**: 
  - `sale`
  - `point_of_sale` 
  - `account`
  - `web`

## II. Cài đặt Module

### Cách 1: Copy thủ công
1. Copy toàn bộ thư mục `dashboard` vào thư mục `addons` của Odoo
   ```
   odoo/addons/dashboard/
   ```

2. Khởi động lại Odoo server
   ```bash
   python odoo-bin -d database_name -u dashboard
   ```

3. Hoặc truy cập Odoo web interface:
   - Vào **Apps**
   - Tìm kiếm "Dashboard"
   - Click **Install**

### Cách 2: Sử dụng Command Line
```bash
# Cài đặt module
python odoo-bin -d your_database -u dashboard

# Hoặc khởi động Odoo bình thường, nó sẽ tự detect module
python odoo-bin -d your_database
```

## III. Cấu Trúc Module

```
dashboard/
├── __init__.py                 # Entry point
├── __manifest__.py             # Metadata module
├── models/
│   ├── __init__.py
│   └── dashboard.py           # Logic lấy dữ liệu
├── controllers/
│   ├── __init__.py
│   └── dashboard.py           # API endpoints
├── views/
│   ├── dashboard_views.xml    # Empty (placeholder)
│   └── dashboard_templates.xml # View chính
├── static/
│   ├── src/
│   │   ├── js/
│   │   │   └── dashboard.js   # Logic frontend
│   │   ├── css/
│   │   │   └── dashboard.css  # Styles
│   │   └── xml/               # (Future)
│   └── description/
│       └── icon.svg           # Icon module
├── README.md                  # Documentation
└── INSTALL_GUIDE.md          # (This file)
```

## IV. Tính Năng Chi Tiết

### A. Thống Số Hôm Nay
- **Số đơn hàng**: Tất cả đơn hàng trong ngày (không bao gồm draft/cancel)
- **Doanh thu**: Tổng tiền từ các đơn hàng đã bán/done
- **Bàn sử dụng**: Số bàn đang hoạt động / Tổng số bàn (từ POS)
- **Phương thức thanh toán**: Số phương thức có sẵn trong cấu hình

### B. Chi Tiết Phương Thức Thanh Toán
- Hiển thị bảng với:
  - Tên phương thức
  - Số lần sử dụng hôm nay
  - Tổng tiền từ phương thức đó

### C. Biểu Đồ Doanh Thu
- **Loại**: Line chart
- **Lựa chọn thời gian**:
  - Hôm nay
  - Hôm qua
  - 7 ngày trước
  - Tuần này
  - Tuần trước
  - Tháng này
  - Tháng trước
- **Cập nhật**: Realtime khi thay đổi period

### D. Biểu Đồ Lợi Nhuận
- **Loại**: Line chart (giống biểu đồ doanh thu)
- **Tính toán**: Giá bán - Giá vốn
- **Lựa chọn thời gian**: Giống biểu đồ doanh thu

### E. Danh Sách Sản Phẩm Bán Chạy
- **Top**: 10 sản phẩm bán nhiều nhất
- **Cột hiển thị**:
  - Tên sản phẩm
  - Số lượng bán
  - Doanh thu
  - Chi phí (cost)
  - Lợi nhuận
- **Sắp xếp**: Theo số lượng bán (giảm dần)

## V. API Endpoints

Module cung cấp các endpoints RPC:

```python
# Lấy thống số hôm nay
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_today_sales_count',
    'args': []
})

# Lấy doanh thu hôm nay
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_today_revenue',
    'args': []
})

# Lấy thông tin bàn
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_table_usage',
    'args': []
})

# Lấy dữ liệu phương thức thanh toán
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_payment_methods_data',
    'args': [date_from, date_to]
})

# Lấy dữ liệu doanh thu
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_revenue_data',
    'args': [period]  # 'today', 'yesterday', 'last_7_days', etc.
})

# Lấy dữ liệu lợi nhuận
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_profit_data',
    'args': [period]
})

# Lấy top selling products
rpc.query({
    'model': 'dashboard.mixin',
    'method': 'get_top_selling_products',
    'args': [period, limit]
})
```

## VI. Sử Dụng Dashboard

### Truy cập Dashboard
1. Từ menu chính, click vào **Dashboard** 
   (hoặc `Dashboard > Dashboard` tùy theo menu structure)

### Thao Tác
1. **Xem thống số**: Thông tin tự động load khi vào trang
2. **Thay đổi thời gian biểu đồ**: 
   - Click vào dropdown phía trên mỗi biểu đồ
   - Chọn khoảng thời gian mong muốn
3. **Xem chi tiết phương thức thanh toán**: 
   - Scroll xuống phần "Phương thức thanh toán"
4. **Xem sản phẩm bán chạy**: 
   - Scroll xuống phần "Sản phẩm bán chạy"

## VII. Lưu Ý

### Performance
- Dashboard được thiết kế để load dữ liệu từ 30 ngày qua
- Nếu dữ liệu lớn, có thể tối ưu bằng cách:
  - Thêm indexes trên các trường datetime
  - Cache dữ liệu

### Timezone
- Hiện tại sử dụng `datetime.now().date()` (local timezone)
- Nếu cần multi-timezone, cần sửa lại các phương thức

### Quyền Truy Cập
- Dashboard mở cho tất cả user authenticated
- Có thể giới hạn bằng cách sửa `auth='user'` thành `auth='group'`

## VIII. Khắc Phục Sự Cố

### Biểu đồ không hiển thị
- Kiểm tra Chart.js load từ CDN có thành công
- Mở DevTools (F12) → Console để xem lỗi
- Kiểm tra connection internet

### Dữ liệu không cập nhật
- Kiểm tra permission của user
- Kiểm tra database connection
- Xem logs: `tail -f ~/odoo.log`

### Module không cài được
- Kiểm tra phụ thuộc: `sale`, `point_of_sale`, `account`, `web`
- Restart Odoo và cài lại
- Xem error logs trong Odoo interface

## IX. Phát Triển Tiếp Theo

Các tính năng có thể thêm vào:
- [ ] Custom date range picker
- [ ] Export to PDF/Excel
- [ ] Email report scheduled
- [ ] Category-based analysis
- [ ] Multi-warehouse support
- [ ] KPI alerts/notifications
- [ ] User-specific dashboards
- [ ] Dashboard customization

## X. Hỗ Trợ

Nếu gặp vấn đề:
1. Kiểm tra terminal logs: `python odoo-bin --logfile=odoo.log`
2. Kiểm tra Odoo error logs trong interface
3. Kiểm tra browser console (F12)
4. Review code bạn có thể tìm trong file `models/dashboard.py` và `static/src/js/dashboard.js`

---
**Version**: 1.0.0
**Last Updated**: June 2026
