import logging
from collections import defaultdict
from datetime import datetime, time, timedelta

import pytz

from odoo import api, fields, models

_logger = logging.getLogger(__name__)


class DashboardMixin(models.Model):
    _name = 'dashboard.mixin'
    _description = 'Dashboard Mixin'
    _rec_name = 'name'

    name = fields.Char(string='Dashboard Name', default='Dashboard')

    _ORDER_TYPE_POS = 'pos_order'

    _SALE_STATES = ('sale', 'done')
    _POS_CLOSED_STATES = ('paid', 'done', 'invoiced')
    _POS_ACTIVE_STATES = ('draft',)

    # -------------------------------------------------------------------------
    # Generic helpers
    # -------------------------------------------------------------------------
    @api.model
    def _get_company_ids(self):
        company_ids = self.env.context.get('allowed_company_ids')
        if company_ids:
            return list(company_ids)
        return [self.env.user.company_id.id]

    @api.model
    def _normalize_order_type(self, order_type):
        return order_type if order_type == self._ORDER_TYPE_POS else self._ORDER_TYPE_POS

    @api.model
    def _normalize_store_id(self, store_id):
        if not store_id or store_id == 'all' or store_id == 0:
            return 0
        try:
            return int(store_id)
        except (ValueError, TypeError):
            return 0

    @api.model
    def _get_user_tz(self):
        return pytz.timezone(self.env.user.tz or 'UTC')

    @api.model
    def _get_datetime_range(self, date_from, date_to):
        """Return UTC-safe datetimes for search domains."""
        if isinstance(date_from, str) and date_from:
            date_from = fields.Date.from_string(date_from)
        if isinstance(date_to, str) and date_to:
            date_to = fields.Date.from_string(date_to)
        if date_from and date_to and date_from > date_to:
            date_from, date_to = date_to, date_from
        user_tz = self._get_user_tz()
        start_local = user_tz.localize(datetime.combine(date_from, time.min))
        end_local = user_tz.localize(datetime.combine(date_to, time.max))
        start_utc = start_local.astimezone(pytz.UTC).replace(tzinfo=None)
        end_utc = end_local.astimezone(pytz.UTC).replace(tzinfo=None)
        return fields.Datetime.to_string(start_utc), fields.Datetime.to_string(end_utc)

    @api.model
    def _iter_dates(self, date_from, date_to):
        current = date_from
        while current <= date_to:
            yield current
            current += timedelta(days=1)

    @api.model
    def _get_order_total_amount(self, order):
        return float(getattr(order, 'amount_total', 0.0) or 0.0)

    @api.model
    def _get_order_paid_amount(self, order):
        """Best-effort paid amount for POS and Sale orders."""
        amount_paid = getattr(order, 'amount_paid', None)
        if amount_paid is not None:
            return float(amount_paid or 0.0)

        if order._name == 'sale.order':
            invoices = getattr(order, 'invoice_ids', self.env['account.move'])
            posted_invoices = invoices.filtered(lambda inv: getattr(inv, 'state', False) == 'posted')
            residual = 0.0
            for invoice in posted_invoices:
                residual += float(getattr(invoice, 'amount_residual', 0.0) or getattr(invoice, 'amount_residual_signed', 0.0) or 0.0)
            if residual:
                return max(self._get_order_total_amount(order) - residual, 0.0)

        payments = getattr(order, 'payment_ids', None) or getattr(order, 'statement_ids', None) or []
        paid = 0.0
        for payment in payments:
            paid += float(
                getattr(payment, 'amount', None)
                or getattr(payment, 'payment_amount', None)
                or getattr(payment, 'amount_total', None)
                or 0.0
            )
        return paid

    @api.model
    def _get_order_day(self, order):
        order_dt = getattr(order, 'date_order', None)
        if not order_dt:
            return None
        order_dt = fields.Datetime.to_datetime(order_dt)
        if not order_dt:
            return None
        local_dt = fields.Datetime.context_timestamp(self, order_dt)
        return local_dt.date()

    @api.model
    def _get_order_local_datetime(self, order):
        order_dt = getattr(order, 'date_order', None)
        if not order_dt:
            return None
        order_dt = fields.Datetime.to_datetime(order_dt)
        if not order_dt:
            return None
        return fields.Datetime.context_timestamp(self, order_dt)

    @api.model
    def _get_order_lines(self, order):
        if order._name == 'sale.order':
            return getattr(order, 'order_line', self.env['sale.order.line'])
        return getattr(order, 'lines', self.env['pos.order.line'])

    @api.model
    def _line_quantity(self, line):
        return float(
            getattr(line, 'product_uom_qty', None)
            or getattr(line, 'qty', None)
            or getattr(line, 'quantity', None)
            or 0.0
        )

    @api.model
    def _line_revenue(self, line):
        revenue = getattr(line, 'price_subtotal', None)
        if revenue is None:
            revenue = getattr(line, 'price_total', None)
        if revenue is None:
            revenue = getattr(line, 'price_unit', 0.0) * self._line_quantity(line)
        return float(revenue or 0.0)

    @api.model
    def _line_cost(self, line):
        product = getattr(line, 'product_id', False)
        return float(getattr(product, 'standard_price', 0.0) or 0.0)

    # -------------------------------------------------------------------------
    # Search helpers
    # -------------------------------------------------------------------------
    @api.model
    def _search_sale_orders(self, date_from, date_to):
        start_dt, end_dt = self._get_datetime_range(date_from, date_to)
        return self.env['sale.order'].search([
            ('date_order', '>=', start_dt),
            ('date_order', '<=', end_dt),
            ('state', 'in', self._SALE_STATES),
            ('company_id', 'in', self._get_company_ids()),
        ])

    @api.model
    def _search_pos_orders(self, date_from, date_to, states=None, store_id=0):
        start_dt, end_dt = self._get_datetime_range(date_from, date_to)
        domain = [
            ('date_order', '>=', start_dt),
            ('date_order', '<=', end_dt),
            ('state', 'not in', ['draft', 'cancel']),
            ('company_id', 'in', self._get_company_ids()),
        ]
        if states:
            domain = [
                ('date_order', '>=', start_dt),
                ('date_order', '<=', end_dt),
                ('state', 'in', list(states)),
                ('company_id', 'in', self._get_company_ids()),
            ]
        pos_order_model = self.env['pos.order']
        store_id = self._normalize_store_id(store_id)
        if store_id:
            domain.append(('config_id', '=', int(store_id)))
        return pos_order_model.search(domain)

    @api.model
    def _search_pos_closed_orders(self, date_from, date_to, store_id=0):
        return self._search_pos_orders(date_from, date_to, states=self._POS_CLOSED_STATES, store_id=store_id)

    @api.model
    def _search_pos_active_orders(self, date_from=None, date_to=None, require_table=False, store_id=0):
        pos_order_model = self.env['pos.order']
        domain = [
            ('state', 'in', list(self._POS_ACTIVE_STATES)),
            ('company_id', 'in', self._get_company_ids()),
        ]
        store_id = self._normalize_store_id(store_id)
        if store_id:
            domain.append(('config_id', '=', int(store_id)))
        if date_from and date_to:
            start_dt, end_dt = self._get_datetime_range(date_from, date_to)
            domain.extend([
                ('date_order', '>=', start_dt),
                ('date_order', '<=', end_dt),
            ])
        if require_table and 'table_id' in pos_order_model._fields:
            domain.append(('table_id', '!=', False))
        return pos_order_model.search(domain)

    @api.model
    def _search_orders(self, date_from, date_to, order_type='pos_order', store_id=0):
        order_type = self._normalize_order_type(order_type)
        return self._search_pos_closed_orders(date_from, date_to, store_id=store_id)

    # -------------------------------------------------------------------------
    # Stats
    # -------------------------------------------------------------------------
    @api.model
    def get_today_sales_count(self, store_id=0):
        today = fields.Date.context_today(self)
        orders = self._search_orders(today, today, store_id=store_id)
        _logger.debug('dashboard.get_today_sales_count store_id=%s count=%s', store_id, len(orders))
        return len(orders)

    @api.model
    def get_today_revenue(self, store_id=0):
        today = fields.Date.context_today(self)
        orders = self._search_orders(today, today, store_id=store_id)
        total_revenue = sum(self._get_order_total_amount(order) for order in orders)
        _logger.debug('dashboard.get_today_revenue store_id=%s revenue=%s', store_id, float(total_revenue))
        return total_revenue

    @api.model
    def get_today_profit(self, store_id=0):
        today = fields.Date.context_today(self)
        orders = self._search_orders(today, today, store_id=store_id)
        total_profit = 0.0
        for order in orders:
            for line in self._get_order_lines(order):
                if getattr(line, 'display_type', False):
                    continue
                quantity = self._line_quantity(line)
                revenue = self._line_revenue(line)
                cost = self._line_cost(line) * quantity
                total_profit += revenue - cost
        _logger.debug('dashboard.get_today_profit store_id=%s profit=%s', store_id, total_profit)
        return total_profit

    @api.model
    def get_unpaid_total(self, store_id=0):
        unpaid_total = 0.0

        pos_orders = self._search_pos_active_orders(store_id=store_id)
        unpaid_total += sum(
            max(self._get_order_total_amount(order) - self._get_order_paid_amount(order), 0.0)
            for order in pos_orders
        )

        return unpaid_total

    @api.model
    def get_table_usage(self):
        """Return active tables / total tables."""
        try:
            total_tables = 0
            used_tables = 0
            table_ids = set()

            try:
                total_tables = len(self.env['restaurant.table'].search([
                    ('company_id', 'in', self._get_company_ids()),
                ]))
            except Exception:
                total_tables = 0

            pos_order_model = self.env['pos.order']
            if 'table_id' in pos_order_model._fields:
                pos_orders = self._search_pos_active_orders(require_table=True)
                table_ids = set(pos_orders.mapped('table_id').ids)
                used_tables = len(table_ids)

            if not total_tables:
                total_tables = len(table_ids)

            return {
                'total_tables': total_tables,
                'used_tables': used_tables,
            }
        except Exception:
            _logger.exception('dashboard.get_table_usage failed')
            return {
                'total_tables': 0,
                'used_tables': 0,
            }

    @api.model
    def get_payment_methods_data(self, date_from, date_to, store_id=0):
        """Return method totals and total unpaid amount."""
        method_totals = defaultdict(float)
        unpaid_total = 0.0

        pos_orders = self._search_pos_closed_orders(date_from, date_to, store_id=store_id)
        for order in pos_orders:
            payments = getattr(order, 'payment_ids', None) or getattr(order, 'statement_ids', None) or []
            for payment in payments:
                method = getattr(payment, 'payment_method_id', False) or getattr(payment, 'journal_id', False)
                method_name = method.name if method else 'Other'
                amount = float(
                    getattr(payment, 'amount', None)
                    or getattr(payment, 'payment_amount', None)
                    or getattr(payment, 'amount_total', None)
                    or 0.0
                )
                method_totals[method_name] += amount

        active_pos_orders = self._search_pos_active_orders(store_id=store_id)
        unpaid_total += sum(
            max(self._get_order_total_amount(order) - self._get_order_paid_amount(order), 0.0)
            for order in active_pos_orders
        )

        methods = [
            {
                'name': name,
                'total_amount': amount,
            }
            for name, amount in sorted(method_totals.items(), key=lambda item: item[0].lower())
            if amount
        ]

        return {
            'methods': methods,
            'total_due': unpaid_total,
            'unpaid_total': unpaid_total,
        }

    # -------------------------------------------------------------------------
    # Charts and top products
    # -------------------------------------------------------------------------
    @api.model
    def _build_daily_series(self, date_from, date_to, values_by_day, value_key):
        result = []
        for day in self._iter_dates(date_from, date_to):
            result.append({
                'label': fields.Date.to_string(day),
                value_key: float(values_by_day.get(day, 0.0) or 0.0),
            })
        non_zero = [item for item in result if item.get(value_key)]
        _logger.debug(
            'dashboard.series.daily key=%s range=%s..%s points=%s non_zero=%s sample=%s',
            value_key,
            date_from,
            date_to,
            len(result),
            len(non_zero),
            result[:3],
        )
        return result

    @api.model
    def _build_hourly_series(self, values_by_hour, value_key):
        result = []
        for hour in range(24):
            result.append({
                'label': '%02d:00' % hour,
                value_key: float(values_by_hour.get(hour, 0.0) or 0.0),
            })
        non_zero = [item for item in result if item.get(value_key)]
        _logger.debug(
            'dashboard.series.hourly key=%s points=%s non_zero=%s sample=%s',
            value_key,
            len(result),
            len(non_zero),
            result[:3],
        )
        return result

    @api.model
    def _is_hourly_period(self, period):
        return period in ('today', 'yesterday')

    @api.model
    def _format_chart_label(self, label):
        if not label:
            return label
        if isinstance(label, str) and len(label) == 10 and label[4] == '-' and label[7] == '-':
            try:
                return fields.Date.to_string(fields.Date.from_string(label))
            except Exception:
                pass
        return label

    @api.model
    def get_revenue_data(self, period='today', order_type='pos_order', date_from=None, date_to=None, store_id=0):
        """Return revenue grouped by day for the selected period."""
        date_from, date_to = self._get_date_range(period, date_from, date_to)
        orders = self._search_orders(date_from, date_to, order_type, store_id=store_id)
        _logger.debug(
            'dashboard.get_revenue_data period=%s order_type=%s date_from=%s date_to=%s orders=%s',
            period,
            order_type,
            date_from,
            date_to,
            len(orders),
        )

        if self._is_hourly_period(period):
            revenue_by_hour = defaultdict(float)
            sample_orders = []
            for order in orders:
                local_dt = self._get_order_local_datetime(order)
                if local_dt:
                    total_amount = self._get_order_total_amount(order)
                    revenue_by_hour[local_dt.hour] += total_amount
                    if len(sample_orders) < 5:
                        sample_orders.append({
                            'id': order.id,
                            'name': getattr(order, 'name', ''),
                            'date_order': getattr(order, 'date_order', None),
                            'local_hour': local_dt.hour,
                            'amount_total': total_amount,
                        })
            _logger.debug(
                'dashboard.get_revenue_data hourly buckets=%s non_zero=%s sample_orders=%s totals=%s',
                dict(sorted(revenue_by_hour.items())),
                {hour: amount for hour, amount in sorted(revenue_by_hour.items()) if amount},
                sample_orders,
                sum(revenue_by_hour.values()),
            )
            return {
                'granularity': 'hour',
                'data': self._build_hourly_series(revenue_by_hour, 'revenue'),
            }

        revenue_by_date = defaultdict(float)
        sample_orders = []
        for order in orders:
            day = self._get_order_day(order)
            if day:
                total_amount = self._get_order_total_amount(order)
                revenue_by_date[day] += total_amount
                if len(sample_orders) < 5:
                    sample_orders.append({
                        'id': order.id,
                        'name': getattr(order, 'name', ''),
                        'day': day,
                        'amount_total': total_amount,
                    })
        _logger.debug(
            'dashboard.get_revenue_data daily buckets=%s non_zero=%s sample_orders=%s totals=%s',
            {fields.Date.to_string(day): amount for day, amount in sorted(revenue_by_date.items())},
            {fields.Date.to_string(day): amount for day, amount in sorted(revenue_by_date.items()) if amount},
            sample_orders,
            sum(revenue_by_date.values()),
        )

        return {
            'granularity': 'day',
            'data': self._build_daily_series(date_from, date_to, revenue_by_date, 'revenue'),
        }

    @api.model
    def get_profit_data(self, period='today', order_type='pos_order', date_from=None, date_to=None, store_id=0):
        """Return profit grouped by day for the selected period."""
        date_from, date_to = self._get_date_range(period, date_from, date_to)
        orders = self._search_orders(date_from, date_to, order_type, store_id=store_id)
        _logger.debug(
            'dashboard.get_profit_data period=%s order_type=%s date_from=%s date_to=%s orders=%s',
            period,
            order_type,
            date_from,
            date_to,
            len(orders),
        )

        if self._is_hourly_period(period):
            profit_by_hour = defaultdict(float)
            sample_orders = []
            for order in orders:
                local_dt = self._get_order_local_datetime(order)
                if not local_dt:
                    continue
                order_profit = 0.0
                for line in self._get_order_lines(order):
                    if getattr(line, 'display_type', False):
                        continue
                    quantity = self._line_quantity(line)
                    revenue = self._line_revenue(line)
                    cost = self._line_cost(line) * quantity
                    line_profit = revenue - cost
                    order_profit += line_profit
                    profit_by_hour[local_dt.hour] += line_profit
                if len(sample_orders) < 5:
                    sample_orders.append({
                        'id': order.id,
                        'name': getattr(order, 'name', ''),
                        'date_order': getattr(order, 'date_order', None),
                        'local_hour': local_dt.hour,
                        'order_profit': order_profit,
                    })
            _logger.debug(
                'dashboard.get_profit_data hourly buckets=%s non_zero=%s sample_orders=%s totals=%s',
                dict(sorted(profit_by_hour.items())),
                {hour: amount for hour, amount in sorted(profit_by_hour.items()) if amount},
                sample_orders,
                sum(profit_by_hour.values()),
            )
            return {
                'granularity': 'hour',
                'data': self._build_hourly_series(profit_by_hour, 'profit'),
            }

        profit_by_date = defaultdict(float)
        sample_orders = []
        for order in orders:
            day = self._get_order_day(order)
            if not day:
                continue
            order_profit = 0.0
            for line in self._get_order_lines(order):
                if getattr(line, 'display_type', False):
                    continue
                quantity = self._line_quantity(line)
                revenue = self._line_revenue(line)
                cost = self._line_cost(line) * quantity
                line_profit = revenue - cost
                order_profit += line_profit
                profit_by_date[day] += line_profit
            if len(sample_orders) < 5:
                sample_orders.append({
                    'id': order.id,
                    'name': getattr(order, 'name', ''),
                    'day': day,
                    'order_profit': order_profit,
                })
        _logger.debug(
            'dashboard.get_profit_data daily buckets=%s non_zero=%s sample_orders=%s totals=%s',
            {fields.Date.to_string(day): amount for day, amount in sorted(profit_by_date.items())},
            {fields.Date.to_string(day): amount for day, amount in sorted(profit_by_date.items()) if amount},
            sample_orders,
            sum(profit_by_date.values()),
        )

        return {
            'granularity': 'day',
            'data': self._build_daily_series(date_from, date_to, profit_by_date, 'profit'),
        }

    @api.model
    def get_top_selling_products(self, period='today', order_type='pos_order', limit=10, date_from=None, date_to=None, store_id=0):
        """Return top selling products with quantity, revenue, cost and profit."""
        date_from, date_to = self._get_date_range(period, date_from, date_to)
        orders = self._search_orders(date_from, date_to, order_type, store_id=store_id)
        limit = int(limit or 10)
        _logger.debug(
            'dashboard.get_top_selling_products period=%s order_type=%s date_from=%s date_to=%s limit=%s orders=%s',
            period,
            order_type,
            date_from,
            date_to,
            limit,
            len(orders),
        )

        product_sales = {}
        for order in orders:
            for line in self._get_order_lines(order):
                if getattr(line, 'display_type', False):
                    continue
                product = getattr(line, 'product_id', False)
                if not product:
                    continue
                product_id = product.id
                if product_id not in product_sales:
                    product_sales[product_id] = {
                        'name': getattr(product, 'display_name', False) or getattr(product, 'name', '') or '',
                        'quantity': 0.0,
                        'revenue': 0.0,
                        'cost': 0.0,
                        'profit': 0.0,
                    }

                quantity = self._line_quantity(line)
                revenue = self._line_revenue(line)
                cost = self._line_cost(line) * quantity
                profit = revenue - cost

                product_sales[product_id]['quantity'] += quantity
                product_sales[product_id]['revenue'] += revenue
                product_sales[product_id]['cost'] += cost
                product_sales[product_id]['profit'] += profit

        sorted_products = sorted(
            product_sales.values(),
            key=lambda item: (item['quantity'], item['revenue']),
            reverse=True,
        )[:limit]

        _logger.debug(
            'dashboard.get_top_selling_products result count=%s sample=%s',
            len(sorted_products),
            sorted_products[:3],
        )

        return sorted_products

    # -------------------------------------------------------------------------
    # Store helpers
    # -------------------------------------------------------------------------
    @api.model
    def get_pos_config_list(self):
        stores = self.env['pos.config'].search([
            ('active', '=', True),
            ('company_id', 'in', self._get_company_ids()),
        ])
        return [{'id': store.id, 'name': store.name} for store in stores]



    @api.model
    def get_stores_data(self, date_from, date_to):
        stores = self.env['pos.config'].search([
            ('active', '=', True),
            ('company_id', 'in', self._get_company_ids()),
        ])
        result = []
        for store in stores:
            orders = self._search_pos_closed_orders(date_from, date_to, store_id=store.id)
            total_revenue = 0.0
            total_cost = 0.0
            total_profit = 0.0
            order_count = len(orders)

            for order in orders:
                total_revenue += self._get_order_total_amount(order)
                for line in self._get_order_lines(order):
                    if getattr(line, 'display_type', False):
                        continue
                    quantity = self._line_quantity(line)
                    revenue = self._line_revenue(line)
                    cost = self._line_cost(line) * quantity
                    total_cost += cost
                    total_profit += revenue - cost

            result.append({
                'name': store.name,
                'order_count': order_count,
                'revenue': total_revenue,
                'cost': total_cost,
                'profit': total_profit,
            })

        return result

    # -------------------------------------------------------------------------
    # Periods
    # -------------------------------------------------------------------------
    @api.model
    def _get_date_range(self, period, date_from=None, date_to=None):
        today = fields.Date.context_today(self)

        if period == 'custom':
            if isinstance(date_from, str) and date_from:
                date_from = fields.Date.from_string(date_from)
            if isinstance(date_to, str) and date_to:
                date_to = fields.Date.from_string(date_to)
            if date_from and date_to and date_from > date_to:
                date_from, date_to = date_to, date_from
            resolved_from = date_from or today
            resolved_to = date_to or date_from or today
            _logger.debug(
                'dashboard.date_range period=custom input_from=%s input_to=%s resolved_from=%s resolved_to=%s',
                date_from,
                date_to,
                resolved_from,
                resolved_to,
            )
            return resolved_from, resolved_to

        if period == 'today':
            return today, today
        if period == 'yesterday':
            yesterday = today - timedelta(days=1)
            return yesterday, yesterday
        if period == 'last_7_days':
            return today - timedelta(days=6), today
        if period == 'this_week':
            start_of_week = today - timedelta(days=today.weekday())
            end_of_week = start_of_week + timedelta(days=6)
            return start_of_week, end_of_week
        if period == 'last_week':
            end_of_last_week = today - timedelta(days=today.weekday() + 1)
            start_of_last_week = end_of_last_week - timedelta(days=6)
            return start_of_last_week, end_of_last_week
        if period == 'this_month':
            result = today.replace(day=1), today
            _logger.debug('dashboard.date_range period=this_month resolved=%s..%s', result[0], result[1])
            return result
        if period == 'last_month':
            first_of_this_month = today.replace(day=1)
            last_day_of_last_month = first_of_this_month - timedelta(days=1)
            first_day_of_last_month = last_day_of_last_month.replace(day=1)
            result = first_day_of_last_month, last_day_of_last_month
            _logger.debug('dashboard.date_range period=last_month resolved=%s..%s', result[0], result[1])
            return result
        result = today, today
        _logger.debug('dashboard.date_range period=%s resolved=%s..%s', period, result[0], result[1])
        return result
