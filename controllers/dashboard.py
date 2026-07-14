import logging

from odoo import fields, http
from odoo.http import request

_logger = logging.getLogger(__name__)


class DashboardController(http.Controller):

    def _get_dashboard_mixin(self, params=None):
        env = request.env
        if params and isinstance(params, dict):
            ctx = params.get('context', {})
            if isinstance(ctx, dict) and ctx.get('allowed_company_ids'):
                env = env['dashboard.mixin'].with_context(**ctx).env
        return env['dashboard.mixin']

    @http.route('/dashboard/api/stats', type='jsonrpc', auth='user', methods=['POST'])
    def get_dashboard_stats(self, **params):
        """Return the dashboard summary cards."""
        dashboard_mixin = self._get_dashboard_mixin(params)
        store_id = params.get('store_id', 0)
        today = fields.Date.context_today(dashboard_mixin)

        _logger.debug(
            'dashboard.api.stats store_id=%s today=%s params=%s',
            store_id,
            today,
            params,
        )

        payment_methods_data = dashboard_mixin.get_payment_methods_data(
            today,
            today,
            store_id=store_id,
        )
        unpaid_total = payment_methods_data.get('unpaid_total', payment_methods_data.get('total_due', 0))
        store_id_val = store_id if store_id else 0

        result = {
            'sales_count': dashboard_mixin.get_today_sales_count(store_id=store_id_val),
            'today_revenue': dashboard_mixin.get_today_revenue(store_id=store_id_val),
            'today_profit': dashboard_mixin.get_today_profit(store_id=store_id_val),
            'table_usage': dashboard_mixin.get_table_usage(),
            'payment_methods': payment_methods_data['methods'],
            'payment_methods_total': unpaid_total,
            'unpaid_total': unpaid_total,
        }

        is_all_stores = not store_id or str(store_id) == '0' or str(store_id) == 'all'
        if is_all_stores:
            try:
                stores_data = dashboard_mixin.get_stores_data(today, today)
                result['stores_data'] = stores_data
            except Exception:
                _logger.exception('dashboard.api.stores data failed')
                result['stores_data'] = []

        return result

    @http.route('/dashboard/api/revenue', type='jsonrpc', auth='user', methods=['POST'])
    def get_revenue_chart(self, **post):
        """Return revenue chart data."""
        dashboard_mixin = self._get_dashboard_mixin(post)

        period = post.get('period', 'today')
        date_from = post.get('date_from')
        date_to = post.get('date_to')
        store_id = post.get('store_id', 0)

        _logger.debug(
            'dashboard.api.revenue post=%s',
            {
                'period': period,
                'date_from': date_from,
                'date_to': date_to,
                'store_id': store_id,
            },
        )

        revenue_data = dashboard_mixin.get_revenue_data(period, date_from=date_from, date_to=date_to, store_id=store_id)

        _logger.debug(
            'dashboard.api.revenue result granularity=%s points=%s first=%s last=%s',
            revenue_data.get('granularity') if isinstance(revenue_data, dict) else None,
            len(revenue_data.get('data', [])) if isinstance(revenue_data, dict) else None,
            (revenue_data.get('data', [{}])[0] if isinstance(revenue_data, dict) and revenue_data.get('data') else None),
            (revenue_data.get('data', [{}])[-1] if isinstance(revenue_data, dict) and revenue_data.get('data') else None),
        )

        return {
            'data': revenue_data,
            'period': period,
        }

    @http.route('/dashboard/api/profit', type='jsonrpc', auth='user', methods=['POST'])
    def get_profit_chart(self, **post):
        """Return profit chart data."""
        dashboard_mixin = self._get_dashboard_mixin(post)

        period = post.get('period', 'today')
        date_from = post.get('date_from')
        date_to = post.get('date_to')
        store_id = post.get('store_id', 0)

        _logger.debug(
            'dashboard.api.profit post=%s',
            {
                'period': period,
                'date_from': date_from,
                'date_to': date_to,
                'store_id': store_id,
            },
        )

        profit_data = dashboard_mixin.get_profit_data(period, date_from=date_from, date_to=date_to, store_id=store_id)

        _logger.debug(
            'dashboard.api.profit result granularity=%s points=%s first=%s last=%s',
            profit_data.get('granularity') if isinstance(profit_data, dict) else None,
            len(profit_data.get('data', [])) if isinstance(profit_data, dict) else None,
            (profit_data.get('data', [{}])[0] if isinstance(profit_data, dict) and profit_data.get('data') else None),
            (profit_data.get('data', [{}])[-1] if isinstance(profit_data, dict) and profit_data.get('data') else None),
        )

        return {
            'data': profit_data,
            'period': period,
        }

    @http.route('/dashboard/api/top-products', type='jsonrpc', auth='user', methods=['POST'])
    def get_top_products(self, **post):
        """Return top selling products."""
        dashboard_mixin = self._get_dashboard_mixin(post)

        period = post.get('period', 'today')
        limit = post.get('limit', 10)
        date_from = post.get('date_from')
        date_to = post.get('date_to')
        store_id = post.get('store_id', 0)

        _logger.debug(
            'dashboard.api.top_products post=%s',
            {
                'period': period,
                'limit': limit,
                'date_from': date_from,
                'date_to': date_to,
                'store_id': store_id,
            },
        )

        products_data = dashboard_mixin.get_top_selling_products(
            period,
            limit=limit,
            date_from=date_from,
            date_to=date_to,
            store_id=store_id,
        )

        _logger.debug(
            'dashboard.api.top_products result count=%s first=%s',
            len(products_data) if isinstance(products_data, list) else None,
            products_data[0] if isinstance(products_data, list) and products_data else None,
        )

        return {
            'data': products_data,
            'period': period,
        }

    @http.route('/dashboard/api/pos-configs', type='jsonrpc', auth='user', methods=['POST'])
    def get_pos_configs(self, **post):
        """Return list of POS configs (stores)."""
        dashboard_mixin = self._get_dashboard_mixin(post)
        stores = dashboard_mixin.get_pos_config_list()
        return stores

    @http.route('/dashboard/api/render-log', type='jsonrpc', auth='user', methods=['POST'])
    def log_chart_render(self, **post):
        """Log chart render events from the browser."""
        _logger.debug('dashboard.api.render_log post=%s', post)
        return {'ok': True}

    @http.route('/dashboard', type='http', auth='user', methods=['GET'])
    def dashboard_view(self):
        """Open the dashboard action in the web client."""
        action = request.env.ref('dashboard.action_dashboard')
        return request.redirect('/web#action=%s' % action.id)
