# Hướng Dẫn Tùy Chỉnh Dashboard Module

## 1. Thêm Các Trường Dữ Liệu Mới

### A. Thêm Thống Số Mới

Mở file `models/dashboard.py` và thêm method mới:

```python
@api.model
def get_custom_stat(self):
    """Lấy thống số tùy chỉnh"""
    today = datetime.now().date()
    # Viết logic lấy dữ liệu
    result = self.env['model.name'].search([
        ('date_field', '>=', f"{today} 00:00:00"),
    ])
    return len(result)
```

Sau đó cập nhật view `views/dashboard_templates.xml` để hiển thị:

```xml
<div class="col-lg-3 col-md-6">
    <div class="o_stat_card">
        <div class="o_stat_value">
            <span id="custom_stat">0</span>
        </div>
        <div class="o_stat_label">Tên thống số</div>
    </div>
</div>
```

Cuối cùng cập nhật JavaScript `static/src/js/dashboard.js`:

```javascript
function loadCustomStat() {
    return rpc.query({
        model: 'dashboard.mixin',
        method: 'get_custom_stat',
        args: [],
    }).then(function(result) {
        const element = document.getElementById('custom_stat');
        if (element) {
            element.textContent = formatNumber(result);
        }
    });
}

// Thêm vào initDashboard():
loadCustomStat();
```

## 2. Sửa Đổi Biểu Đồ

### A. Thay Đổi Loại Biểu Đồ

Trong `static/src/js/dashboard.js`, tìm section `revenueChart`:

```javascript
// Thay 'line' thành một trong các loại sau:
// 'line', 'bar', 'doughnut', 'pie', 'radar', 'polarArea'

revenueChart = new Chart(ctx.getContext('2d'), {
    type: 'bar',  // Thay đổi loại tại đây
    // ... các option khác
});
```

### B. Thêm Dataset Mới

```javascript
datasets: [
    {
        label: 'Doanh thu',
        data: revenues,
        borderColor: '#007bff',
        backgroundColor: 'rgba(0, 123, 255, 0.1)',
    },
    {
        label: 'Doanh thu target',
        data: targetRevenues,  // Thêm data mới
        borderColor: '#28a745',
        backgroundColor: 'rgba(40, 167, 69, 0.1)',
    }
]
```

## 3. Thay Đổi Kiểu CSS

### A. Thay Đổi Màu Sắc

Mở `static/src/css/dashboard.css`:

```css
.o_stat_value {
    color: #007bff;  /* Thay đổi màu ở đây */
}

.card-header {
    background-color: #f8f9fa;  /* Hoặc màu khác */
}
```

### B. Thay Đổi Layout

Sửa các class Bootstrap trong `views/dashboard_templates.xml`:

```xml
<!-- Mặc định: 3 cột trên desktop, 1 cột trên mobile -->
<div class="col-lg-3 col-md-6">

<!-- Để 2 cột: -->
<div class="col-lg-6 col-md-6">

<!-- Để 1 cột: -->
<div class="col-lg-12">
```

## 4. Thêm Filters/Period Mới

### A. Thêm Period Mới

Mở `models/dashboard.py`, tìm method `_get_date_range`:

```python
@api.model
def _get_date_range(self, period):
    today = datetime.now().date()
    
    # ... existing code ...
    
    elif period == 'last_3_months':
        date_from = today - timedelta(days=90)
        return date_from, today
    elif period == 'year_to_date':
        start_of_year = today.replace(month=1, day=1)
        return start_of_year, today
    
    # ... rest of code ...
```

### B. Cập Nhật UI

Trong `views/dashboard_templates.xml`, thêm option vào select:

```xml
<select id="revenue_period" class="form-select form-select-sm">
    <!-- existing options ... -->
    <option value="last_3_months">3 tháng trước</option>
    <option value="year_to_date">Từ đầu năm</option>
</select>
```

## 5. Tối Ưu Hóa Performance

### A. Thêm Caching

Trong `models/dashboard.py`:

```python
from functools import lru_cache

@api.model
@lru_cache(maxsize=128)
def get_today_sales_count(self):
    # ... method code ...
```

### B. Limit Dữ Liệu

```python
@api.model
def get_revenue_data(self, period='today', limit=1000):
    # ... existing code ...
    
    sale_orders = self.env['sale.order'].search([
        # ... conditions ...
    ], limit=limit)  # Thêm limit
```

### C. Optimize Query

```python
# Thay vì lặp qua line items:
for line in order.order_line:
    # ... calculate ...

# Sử dụng aggregation SQL nếu có thể
sale_lines = self.env['sale.order.line'].search([...])
total = sum(sl.price_subtotal for sl in sale_lines)
```

## 6. Thêm Export Functionality

Tạo file mới `controllers/export.py`:

```python
from odoo import http
from odoo.http import request
import csv
from io import StringIO

class DashboardExport(http.Controller):
    
    @http.route('/dashboard/export/csv', type='http', auth='user')
    def export_csv(self, period='today'):
        # Lấy dữ liệu
        data = request.env['dashboard.mixin'].get_revenue_data(period)
        
        # Tạo CSV
        output = StringIO()
        writer = csv.DictWriter(output, fieldnames=['date', 'revenue'])
        writer.writeheader()
        writer.writerows(data)
        
        # Return file
        response = request.make_response(output.getvalue())
        response.headers['Content-Type'] = 'text/csv'
        response.headers['Content-Disposition'] = 'attachment; filename=revenue.csv'
        return response
```

## 7. Thêm Permissions/Roles

Tạo file `security/ir.model.access.csv`:

```csv
id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_dashboard_mixin_manager,Dashboard Manager,model_dashboard_mixin,group_dashboard_manager,1,1,0,0
access_dashboard_mixin_user,Dashboard User,model_dashboard_mixin,,1,0,0,0
```

Cập nhật `__manifest__.py`:

```python
'data': [
    'security/ir.model.access.csv',
    'views/dashboard_templates.xml',
    'views/dashboard_views.xml',
],
```

## 8. Testing

### A. Unit Test

Tạo file `tests/test_dashboard.py`:

```python
from odoo.tests.common import TransactionCase

class TestDashboard(TransactionCase):
    
    def setUp(self):
        super().setUp()
        self.dashboard_mixin = self.env['dashboard.mixin']
    
    def test_get_today_sales_count(self):
        result = self.dashboard_mixin.get_today_sales_count()
        self.assertIsInstance(result, int)
```

### B. API Test

```python
def test_revenue_api(self):
    response = self.client.post('/dashboard/api/revenue', 
                                json={'period': 'today'})
    self.assertEqual(response.status_code, 200)
    data = response.json()
    self.assertIn('data', data)
```

## 9. Deployment

### A. Production Checklist

- [ ] Test tất cả chức năng
- [ ] Kiểm tra performance với dữ liệu lớn
- [ ] Backup database
- [ ] Disable debug mode
- [ ] Cấu hình logging
- [ ] Setup monitoring

### B. Backup/Restore

```bash
# Backup
pg_dump database_name > backup.sql

# Restore
psql database_name < backup.sql
```

## 10. Debugging

### A. Enable Debug Mode

```python
# Trong __manifest__.py hoặc settings
'debug': True
```

### B. Logging

```python
import logging
_logger = logging.getLogger(__name__)

@api.model
def get_today_sales_count(self):
    _logger.info("Getting sales count for today")
    # ... method code ...
    _logger.debug(f"Found {len(result)} sales")
```

### C. Browser DevTools

- F12 → Network: Kiểm tra API calls
- F12 → Console: Kiểm tra JavaScript errors
- F12 → Application: Kiểm tra localStorage/sessionStorage

---

**Lưu ý**: Sau khi sửa đổi code Python, cần restart Odoo server. Sau khi sửa đổi CSS/JS, có thể cần clear browser cache hoặc refresh page.

Sử dụng `Ctrl+Shift+R` (hoặc `Cmd+Shift+R` trên Mac) để hard refresh và clear cache.
