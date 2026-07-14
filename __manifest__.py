{
    'name': 'Dashboard',
    'summary': 'Hiển thị thông tin về doanh thu, lợi nhuận, số lượng đơn hàng và khách hàng',
    'description': '''
        module monitor realtime theo dõi các thông số như doanh thu, lợi nhuận, số lượng đơn hàng và khách hàng.
    ''',
    'icon': '/dashboard/static/description/icon.svg',
    'version': '19.0.1.0.0',
    'category': 'Tools',
    'license': 'LGPL-3',
    'depends': [
        'base',
        'sale',
        'account',
        'point_of_sale',
        'web',
    ],
    'data': [
        'security/dashboard_security.xml',
        'security/ir.model.access.csv',
        'data/dashboard_data.xml',
        'views/dashboard_templates.xml',
        'views/dashboard_views.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'dashboard/static/lib/chart.umd.min.js',
            'dashboard/static/src/css/dashboard.css',
            'dashboard/static/src/js/dashboard.js',
        ],
    },
    'installable': True,
    'auto_install': False,
    'application': True,
}
