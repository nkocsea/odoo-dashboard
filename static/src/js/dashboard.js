odoo.define('dashboard.main', [], function (require) {
    'use strict';

    function getActiveCompanyIds() {
        var match = document.cookie.match(/(?:^|;\s*)cids=([^;]*)/);
        if (match) {
            return match[1].split('-').map(Number).filter(function(id) { return !isNaN(id); });
        }
        return [];
    }

    let revenueChart = null;
    let profitChart = null;
    let currentStoreId = '0';
    let statsTimer = null;
    let chartTimer = null;
    let dashboardInitialized = false;
    let dashboardObserver = null;
    let chartBootstrapStarted = false;
    let chartDomObserver = null;
    let chartLibraryReady = false;
    let pendingRevenueData = null;
    let pendingProfitData = null;
    let revenueRequestSeq = 0;
    let profitRequestSeq = 0;
    let dashboardEventsBound = false;
    let storeListLoaded = false;
    let revenueChartType = 'bar';
    let profitChartType = 'bar';

    function debugLog() {
        return;
    }

    function scheduleAfterPaint(callback) {
        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(callback);
            return;
        }
        window.setTimeout(callback, 0);
    }

    function setChartLoading(chartName, isLoading) {
        const canvas = document.getElementById(chartName + '_chart');
        const wrapper = canvas ? canvas.closest('.dashboard-chart') : null;
        if (!wrapper) {
            return;
        }
        wrapper.classList.toggle('is-loading', Boolean(isLoading));
    }

    function getCustomFilterControls(prefix) {
        return document.querySelector(`.dashboard-custom-range[data-filter-prefix="${prefix}"]`);
    }

    function setCustomFilterVisibility(prefix, isVisible) {
        const controls = getCustomFilterControls(prefix);
        if (!controls) {
            return;
        }
        controls.classList.toggle('is-visible', Boolean(isVisible));
    }

    function getContext() {
        return {
            allowed_company_ids: getActiveCompanyIds(),
        };
    }

    function jsonRpc(url, params = {}, method = 'POST') {
        const options = {
            method: method,
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
            },
        };

        if (method === 'POST') {
            options.body = JSON.stringify({
                jsonrpc: '2.0',
                method: 'call',
                params: Object.assign({}, {context: getContext()}, params),
                id: Date.now(),
            });
        }

        const finalUrl = method === 'GET' && Object.keys(params).length
            ? `${url}?${new URLSearchParams(params).toString()}`
            : url;

        return fetch(finalUrl, options)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Lỗi mạng: ${response.status} ${response.statusText}`);
                }
                return response.json();
            })
            .then((data) => {
                if (data && typeof data === 'object' && 'error' in data && data.error) {
                    throw new Error(data.error.message || JSON.stringify(data.error));
                }
                if (data && typeof data === 'object' && 'result' in data) {
                    return data.result;
                }
                return data;
            });
    }

    function formatCurrency(value) {
        return new Intl.NumberFormat('vi-VN', {
            style: 'currency',
            currency: 'VND',
        }).format(value || 0);
    }

    function formatNumber(value) {
        return new Intl.NumberFormat('vi-VN').format(value || 0);
    }

    function formatChartLabel(label, granularity) {
        if (!label) {
            return label;
        }
        if (granularity === 'hour') {
            return label;
        }
        if (typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label)) {
            const parts = label.split('-');
            return `${parts[2]}/${parts[1]}`;
        }
        return label;
    }

    function getChartPayload(result) {
        if (!result) {
            return { data: [], granularity: 'day' };
        }
        if (Array.isArray(result.data)) {
            return {
                data: result.data,
                granularity: result.granularity || 'day',
            };
        }
        if (result.data && typeof result.data === 'object') {
            return {
                data: Array.isArray(result.data.data) ? result.data.data : [],
                granularity: result.data.granularity || result.granularity || 'day',
            };
        }
        if (Array.isArray(result)) {
            return { data: result, granularity: 'day' };
        }
        return { data: [], granularity: 'day' };
    }

    function getStoreId() {
        const storeSelect = document.getElementById('store_id_select');
        return storeSelect ? (storeSelect.value || '0') : '0';
    }

    function hasDashboardDom() {
        return Boolean(
            document.getElementById('store_id_select') ||
            document.querySelector('.o_dashboard_container')
        );
    }

    function hasChartDom() {
        return Boolean(
            document.getElementById('revenue_chart') &&
            document.getElementById('profit_chart')
        );
    }

    function teardownDashboard() {
        debugLog('teardownDashboard');
        if (statsTimer) {
            clearInterval(statsTimer);
            statsTimer = null;
        }
        if (chartTimer) {
            clearInterval(chartTimer);
            chartTimer = null;
        }
        if (revenueChart) {
            revenueChart.destroy();
            revenueChart = null;
        }
        if (profitChart) {
            profitChart.destroy();
            profitChart = null;
        }
        pendingRevenueData = null;
        pendingProfitData = null;
        revenueRequestSeq = 0;
        profitRequestSeq = 0;
        dashboardInitialized = false;
        chartBootstrapStarted = false;
        if (dashboardObserver) {
            dashboardObserver.disconnect();
            dashboardObserver = null;
        }
        if (chartDomObserver) {
            chartDomObserver.disconnect();
            chartDomObserver = null;
        }
        if (document.body) {
            scheduleDashboardInit();
        }
    }

    function bindDashboardEvents() {
        if (dashboardEventsBound || !document.body) {
            return;
        }
        dashboardEventsBound = true;
        debugLog('bindDashboardEvents');

        document.addEventListener('change', function (event) {
            const target = event.target;
            if (!target || !target.id) {
                return;
            }

            if (target.id === 'store_id_select') {
                currentStoreId = getStoreId();
                loadDashboardStats();
                applyRevenueFilters();
                applyProfitFilters();
                applyProductFilters();
                return;
            }

            if (target.id === 'revenue_period') {
                setCustomFilterVisibility('revenue', target.value === 'custom');
                if (target.value === 'custom') {
                    setDefaultSectionDates('revenue');
                    return;
                }
                applyRevenueFilters();
                return;
            }

            if (target.id === 'profit_period') {
                setCustomFilterVisibility('profit', target.value === 'custom');
                if (target.value === 'custom') {
                    setDefaultSectionDates('profit');
                    return;
                }
                applyProfitFilters();
                return;
            }

            if (target.id === 'products_period') {
                setCustomFilterVisibility('products', target.value === 'custom');
                if (target.value === 'custom') {
                    setDefaultSectionDates('products');
                    return;
                }
                applyProductFilters();
            }
        });

        document.addEventListener('click', function (event) {
            const target = event.target;
            if (!target || !target.id) {
                return;
            }

            var prefix = null, type = null;
            if (target.id === 'revenue_chart_bar') { prefix = 'revenue'; type = 'bar'; }
            else if (target.id === 'revenue_chart_line') { prefix = 'revenue'; type = 'line'; }
            else if (target.id === 'profit_chart_bar') { prefix = 'profit'; type = 'bar'; }
            else if (target.id === 'profit_chart_line') { prefix = 'profit'; type = 'line'; }

            if (prefix && type) {
                event.preventDefault();
                setChartType(prefix, type);
                var barBtn = document.getElementById(prefix + '_chart_bar');
                var lineBtn = document.getElementById(prefix + '_chart_line');
                if (barBtn && lineBtn) {
                    if (type === 'bar') {
                        barBtn.className = 'btn btn-sm btn-primary';
                        lineBtn.className = 'btn btn-sm btn-outline-secondary';
                    } else {
                        barBtn.className = 'btn btn-sm btn-outline-secondary';
                        lineBtn.className = 'btn btn-sm btn-primary';
                    }
                }
                if (window.Chart) {
                    var chart = prefix === 'revenue' ? revenueChart : profitChart;
                    if (chart) {
                        var chartData = {
                            labels: chart.data.labels,
                            values: chart.data.datasets[0].data,
                        };
                        if (prefix === 'revenue') {
                            revenueChartType = type;
                            revenueChart = createOrUpdateChart(
                                revenueChart, document.getElementById('revenue_chart'),
                                chartData.labels, chartData.values,
                                'Doanh thu', '#0d6efd', 'rgba(13, 110, 253, 0.12)', type
                            );
                        } else {
                            profitChartType = type;
                            profitChart = createOrUpdateChart(
                                profitChart, document.getElementById('profit_chart'),
                                chartData.labels, chartData.values,
                                'Lợi nhuận', '#198754', 'rgba(25, 135, 84, 0.12)', type
                            );
                        }
                    }
                }
                return;
            }

            const actionButton = target.closest(
                '#revenue_apply_filters, #profit_apply_filters, #products_apply_filters'
            );
            if (!actionButton) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (actionButton.id === 'revenue_apply_filters') {
                applyRevenueFilters();
                return;
            }

            if (actionButton.id === 'profit_apply_filters') {
                applyProfitFilters();
                return;
            }

            if (actionButton.id === 'products_apply_filters') {
                applyProductFilters();
            }
        }, true);
    }

    function scheduleDashboardInit() {
        debugLog('scheduleDashboardInit', {
            readyState: document.readyState,
            hasDashboardDom: hasDashboardDom(),
            hasBody: Boolean(document.body),
        });
        if (dashboardInitialized) {
            return;
        }
        if (hasDashboardDom()) {
            initDashboard();
            return;
        }
        if (dashboardObserver || !document.body) {
            return;
        }
        dashboardObserver = new MutationObserver(function () {
            if (hasDashboardDom()) {
                dashboardObserver.disconnect();
                dashboardObserver = null;
                initDashboard();
            }
        });
        dashboardObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    function logRenderEvent(chartName, chartData) {
        return Promise.resolve({
            chart_name: chartName,
            labels_count: Array.isArray(chartData && chartData.labels) ? chartData.labels.length : 0,
            values_count: Array.isArray(chartData && chartData.values) ? chartData.values.length : 0,
        });
    }

    function startChartBootstrap() {
        debugLog('startChartBootstrap', {
            started: chartBootstrapStarted,
            hasDashboardDom: hasDashboardDom(),
            hasChartDom: hasChartDom(),
            hasWindowChart: Boolean(window.Chart),
        });
        if (chartBootstrapStarted) {
            return;
        }
        if (!hasDashboardDom()) {
            return;
        }
        if (!hasChartDom()) {
            if (chartDomObserver || !document.body) {
                return;
            }
            chartDomObserver = new MutationObserver(function () {
                if (hasChartDom()) {
                    chartDomObserver.disconnect();
                    chartDomObserver = null;
                    startChartBootstrap();
                }
            });
            chartDomObserver.observe(document.body, {
                childList: true,
                subtree: true,
            });
            return;
        }
        chartBootstrapStarted = true;
        loadChartJs()
            .then(function () {
                chartLibraryReady = true;
                debugLog('chartLibraryReady', {
                    hasWindowChart: Boolean(window.Chart),
                });
                const initialRevenuePeriod = getPeriodValue('revenue_period', 'today');
                const initialProfitPeriod = getPeriodValue('profit_period', 'today');
                debugLog('initialPeriods', {
                    revenue: initialRevenuePeriod,
                    profit: initialProfitPeriod,
                });
                return Promise.all([
                    loadRevenueChart(initialRevenuePeriod),
                    loadProfitChart(initialProfitPeriod),
                ]);
            })
            .then(function () {
                flushPendingCharts();
            })
            .catch(function (error) {
                console.error('Dashboard chart bootstrap error:', error);
            });
    }

    function getPeriodValue(selectId, fallback) {
        const select = document.getElementById(selectId);
        return select ? (select.value || fallback) : fallback;
    }

    function getSectionCustomDateRange(prefix) {
        const dateFromInput = document.getElementById(`${prefix}_date_from`);
        const dateToInput = document.getElementById(`${prefix}_date_to`);
        return {
            date_from: dateFromInput ? dateFromInput.value || '' : '',
            date_to: dateToInput ? dateToInput.value || '' : '',
        };
    }

    function setDefaultSectionDates(prefix) {
        const dateFromInput = document.getElementById(`${prefix}_date_from`);
        const dateToInput = document.getElementById(`${prefix}_date_to`);
        if (!dateFromInput || !dateToInput) {
            return;
        }
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const value = `${yyyy}-${mm}-${dd}`;
        if (!dateFromInput.value) {
            dateFromInput.value = value;
        }
        if (!dateToInput.value) {
            dateToInput.value = value;
        }
    }

    function getRequestParams(period, sectionPrefix, includeLimit) {
        const params = {
            period: period,
            store_id: currentStoreId,
        };
        if (period === 'custom') {
            const customRange = getSectionCustomDateRange(sectionPrefix);
            params.date_from = customRange.date_from;
            params.date_to = customRange.date_to;
        }
        if (includeLimit) {
            params.limit = includeLimit;
        }
        return params;
    }

    function renderEmptyTable(tbody, message, colspan) {
        if (!tbody) {
            return;
        }
        tbody.innerHTML = '';
        const row = document.createElement('tr');
        row.innerHTML = `<td colspan="${colspan}" class="text-center text-muted">${message}</td>`;
        tbody.appendChild(row);
    }

    var dataLabelPlugin = {
        id: 'customDataLabels',
        afterDatasetsDraw: function (chart) {
            var ctx = chart.ctx;
            var chartType = chart.config.type;
            chart.data.datasets.forEach(function (dataset, i) {
                var meta = chart.getDatasetMeta(i);
                if (!meta.hidden) {
                    meta.data.forEach(function (element, index) {
                        var value = dataset.data[index];
                        if (value === null || value === undefined) return;
                        var x = element.x;
                        var y = element.y;
                        if (chartType === 'bar') {
                            y = element.y - 4;
                        } else {
                            y = element.y - 8;
                        }
                        if (element.hidden) return;
                        ctx.save();
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'bottom';
                        ctx.font = '8px system-ui, -apple-system, sans-serif';
                        ctx.fillStyle = '#444';
                        ctx.fillText(formatCurrency(value), x, y);
                        ctx.restore();
                    });
                }
            });
        }
    };

    function getChartConfig(type, labels, values, label, borderColor, backgroundColor) {
        var isBar = type === 'bar';
        return {
            type: isBar ? 'bar' : 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: label,
                    data: values,
                    backgroundColor: isBar ? borderColor + '33' : backgroundColor,
                    borderColor: borderColor,
                    borderWidth: isBar ? 1 : 2,
                    tension: isBar ? 0 : 0.25,
                    fill: !isBar,
                    pointRadius: isBar ? 0 : 2,
                    pointHoverRadius: isBar ? 0 : 4,
                    pointBackgroundColor: borderColor,
                    pointBorderColor: borderColor,
                    barPercentage: 0.6,
                    categoryPercentage: 0.8,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                parsing: true,
                plugins: {
                    legend: { display: true, position: 'top' },
                },
                scales: {
                    x: {
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0,
                            font: { size: 9 },
                        },
                        grid: { display: !isBar },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function (value) { return formatCurrency(value); },
                            font: { size: 9 },
                        },
                    },
                },
            },
            plugins: [dataLabelPlugin],
        };
    }

    function createOrUpdateChart(chartInstance, canvas, labels, values, label, borderColor, backgroundColor, chartType) {
        var config = getChartConfig(chartType, labels, values, label, borderColor, backgroundColor);
        if (chartInstance) {
            chartInstance.destroy();
        }
        var newChart = new Chart(canvas.getContext('2d'), config);
        window.requestAnimationFrame(function () {
            if (newChart) {
                newChart.resize();
            }
        });
        return newChart;
    }

    function logCanvasMetrics(canvas, chart, label) {
        const metrics = {
            canvasClientWidth: canvas ? canvas.clientWidth : null,
            canvasClientHeight: canvas ? canvas.clientHeight : null,
            canvasOffsetWidth: canvas ? canvas.offsetWidth : null,
            canvasOffsetHeight: canvas ? canvas.offsetHeight : null,
            chartWidth: chart ? chart.width : null,
            chartHeight: chart ? chart.height : null,
            parentDisplay: canvas && canvas.parentElement ? window.getComputedStyle(canvas.parentElement).display : null,
            parentHeight: canvas && canvas.parentElement ? window.getComputedStyle(canvas.parentElement).height : null,
        };
        debugLog(label, metrics);
    }



    function loadChartJs() {
        debugLog('loadChartJs called', {
            hasWindowChart: Boolean(window.Chart),
        });
        return new Promise(function (resolve, reject) {
            if (window.Chart) {
                return resolve();
            }
            const script = document.createElement('script');
            script.src = '/dashboard/static/lib/chart.umd.min.js';
            script.onload = function () {
                if (window.Chart) {
                    resolve();
                    return;
                }
                let attempts = 0;
                const waitForChart = function () {
                    if (window.Chart) {
                        resolve();
                        return;
                    }
                    attempts += 1;
                    if (attempts >= 20) {
                        reject(new Error('Chart.js loaded but global Chart is unavailable'));
                        return;
                    }
                    window.setTimeout(waitForChart, 50);
                };
                waitForChart();
            };
            script.onerror = function () {
                reject(new Error('Không tải được Chart.js cục bộ'));
            };
            document.head.appendChild(script);
        });
    }

    function fetchRevenueChartData(period = 'today') {
        currentStoreId = getStoreId();
        debugLog('fetchRevenueChartData', {
            period: period,
            storeId: currentStoreId,
        });
        return jsonRpc('/dashboard/api/revenue', getRequestParams(period, 'revenue'), 'POST').then(function (result) {
            const payload = getChartPayload(result);
            const data = payload.data || [];
            const granularity = payload.granularity || 'day';
            debugLog('fetchRevenueChartData result', {
                count: data.length,
                granularity: granularity,
                sample: data.slice(0, 3),
            });
            return {
                labels: data.map((item) => formatChartLabel(item.label, granularity)),
                values: data.map((item) => item.revenue),
            };
        });
    }

    function fetchProfitChartData(period = 'today') {
        currentStoreId = getStoreId();
        debugLog('fetchProfitChartData', {
            period: period,
            storeId: currentStoreId,
        });
        return jsonRpc('/dashboard/api/profit', getRequestParams(period, 'profit'), 'POST').then(function (result) {
            const payload = getChartPayload(result);
            const data = payload.data || [];
            const granularity = payload.granularity || 'day';
            debugLog('fetchProfitChartData result', {
                count: data.length,
                granularity: granularity,
                sample: data.slice(0, 3),
            });
            return {
                labels: data.map((item) => formatChartLabel(item.label, granularity)),
                values: data.map((item) => item.profit),
            };
        });
    }

    function renderStoresTable(storesData) {
        const tbody = document.querySelector('#stores_table tbody');
        const row = document.getElementById('stores_table_row');
        if (!tbody || !row) {
            return;
        }

        const isAllStores = currentStoreId === '0' || currentStoreId === 'all';
        row.style.display = isAllStores && storesData && storesData.length ? '' : 'none';

        if (!isAllStores || !storesData || !storesData.length) {
            return;
        }

        tbody.innerHTML = '';
        storesData.forEach(function (store) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${store.name}</td>
                <td class="text-end">${formatNumber(store.order_count)}</td>
                <td class="text-end">${formatCurrency(store.revenue)}</td>
                <td class="text-end">${formatCurrency(store.cost)}</td>
                <td class="text-end">${formatCurrency(store.profit)}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    function loadDashboardStats() {
        currentStoreId = getStoreId();
        debugLog('loadDashboardStats', {
            storeId: currentStoreId,
        });
        return jsonRpc('/dashboard/api/stats', { store_id: currentStoreId }, 'POST')
            .then(function (stats) {
                debugLog('loadDashboardStats result', stats);
                const salesElement = document.getElementById('sales_count');
                const revenueElement = document.getElementById('today_revenue');
                const profitElement = document.getElementById('today_profit');
                const tableElement = document.getElementById('table_usage');
                const unpaidElement = document.getElementById('payment_methods_total');
                const tbody = document.querySelector('#payment_methods_table tbody');

                if (salesElement) {
                    salesElement.textContent = formatNumber(stats.sales_count);
                }
                if (revenueElement) {
                    revenueElement.textContent = formatCurrency(stats.today_revenue);
                }
                if (profitElement) {
                    profitElement.textContent = formatCurrency(stats.today_profit);
                }
                if (tableElement && stats.table_usage) {
                    tableElement.textContent = `${stats.table_usage.used_tables || 0}/${stats.table_usage.total_tables || 0}`;
                }
                if (unpaidElement) {
                    unpaidElement.textContent = formatCurrency(stats.unpaid_total || stats.payment_methods_total || 0);
                }

                if (tbody) {
                    tbody.innerHTML = '';
                    const methods = stats.payment_methods || [];
                    if (!methods.length) {
                        renderEmptyTable(tbody, 'Không có dữ liệu phương thức thanh toán', 2);
                    } else {
                        methods.forEach(function (method) {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td>${method.name}</td>
                                <td class="text-end">${formatCurrency(method.total_amount)}</td>
                            `;
                            tbody.appendChild(row);
                        });
                    }
                }

                renderStoresTable(stats.stores_data);
            })
            .catch(function (error) {
                console.error('dashboard.loadDashboardStats error', error);
            });
    }

    function getChartType(prefix) {
        var hid = document.getElementById(prefix + '_chart_type');
        return hid ? hid.value : 'bar';
    }

    function setChartType(prefix, type) {
        var hid = document.getElementById(prefix + '_chart_type');
        if (hid) hid.value = type;
    }

    function renderRevenueChart(chartData) {
        debugLog('renderRevenueChart', {
            hasCanvas: Boolean(document.getElementById('revenue_chart')),
            hasWindowChart: Boolean(window.Chart),
            labels: chartData && chartData.labels ? chartData.labels.length : 0,
            values: chartData && chartData.values ? chartData.values.length : 0,
        });
        const ctx = document.getElementById('revenue_chart');
        if (!ctx || !window.Chart) {
            debugLog('renderRevenueChart pending');
            pendingRevenueData = chartData;
            return;
        }
        revenueChartType = getChartType('revenue');
        revenueChart = createOrUpdateChart(
            revenueChart, ctx,
            chartData.labels, chartData.values,
            'Doanh thu', '#0d6efd', 'rgba(13, 110, 253, 0.12)',
            revenueChartType
        );
        scheduleAfterPaint(function () {
            logRenderEvent('revenue', chartData);
        });
        setChartLoading('revenue', false);
    }

    function renderProfitChart(chartData) {
        debugLog('renderProfitChart', {
            hasCanvas: Boolean(document.getElementById('profit_chart')),
            hasWindowChart: Boolean(window.Chart),
            labels: chartData && chartData.labels ? chartData.labels.length : 0,
            values: chartData && chartData.values ? chartData.values.length : 0,
        });
        const ctx = document.getElementById('profit_chart');
        if (!ctx || !window.Chart) {
            debugLog('renderProfitChart pending');
            pendingProfitData = chartData;
            return;
        }
        profitChartType = getChartType('profit');
        profitChart = createOrUpdateChart(
            profitChart, ctx,
            chartData.labels, chartData.values,
            'Lợi nhuận', '#198754', 'rgba(25, 135, 84, 0.12)',
            profitChartType
        );
        scheduleAfterPaint(function () {
            logRenderEvent('profit', chartData);
        });
        setChartLoading('profit', false);
    }

    function flushPendingCharts() {
        debugLog('flushPendingCharts', {
            hasWindowChart: Boolean(window.Chart),
            hasPendingRevenue: Boolean(pendingRevenueData),
            hasPendingProfit: Boolean(pendingProfitData),
        });
        if (!window.Chart) {
            return;
        }
        if (pendingRevenueData) {
            renderRevenueChart(pendingRevenueData);
            if (revenueChart) {
                pendingRevenueData = null;
            }
        }
        if (pendingProfitData) {
            renderProfitChart(pendingProfitData);
            if (profitChart) {
                pendingProfitData = null;
            }
        }
    }

    function loadRevenueChart(period = 'today') {
        const seq = ++revenueRequestSeq;
        debugLog('loadRevenueChart', {
            period: period,
            seq: seq,
        });
        setChartLoading('revenue', true);
        return fetchRevenueChartData(period).then(function (chartData) {
            if (seq !== revenueRequestSeq) {
                debugLog('loadRevenueChart stale', {
                    seq: seq,
                    latest: revenueRequestSeq,
                });
                return;
            }
            renderRevenueChart(chartData);
        }).catch(function (error) {
            setChartLoading('revenue', false);
            console.error('dashboard.loadRevenueChart error', error);
        });
    }

    function loadProfitChart(period = 'today') {
        const seq = ++profitRequestSeq;
        debugLog('loadProfitChart', {
            period: period,
            seq: seq,
        });
        setChartLoading('profit', true);
        return fetchProfitChartData(period).then(function (chartData) {
            if (seq !== profitRequestSeq) {
                debugLog('loadProfitChart stale', {
                    seq: seq,
                    latest: profitRequestSeq,
                });
                return;
            }
            renderProfitChart(chartData);
        }).catch(function (error) {
            setChartLoading('profit', false);
            console.error('dashboard.loadProfitChart error', error);
        });
    }

    function loadTopProducts(period = 'today') {
        currentStoreId = getStoreId();
        debugLog('loadTopProducts', {
            period: period,
            storeId: currentStoreId,
        });
        const tbody = document.querySelector('#products_table tbody');
        const wrapper = tbody ? tbody.closest('.dashboard-table') : null;
        if (wrapper) {
            wrapper.dataset.loading = '1';
        }
        return jsonRpc('/dashboard/api/top-products', getRequestParams(period, 'products', 10), 'POST').then(function (result) {
            const data = result.data || [];
            debugLog('loadTopProducts result', {
                count: data.length,
                sample: data.slice(0, 3),
            });
            if (!tbody) {
                return;
            }

            tbody.innerHTML = '';
            if (!data.length) {
                renderEmptyTable(tbody, 'Không có dữ liệu sản phẩm', 5);
                return;
            }

            data.forEach(function (product) {
                const revenue = product.revenue || 0;
                const cost = product.cost || 0;
                const profit = product.profit !== undefined ? product.profit : (revenue - cost);
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${product.name}</td>
                    <td class="text-end">${formatNumber(product.quantity)}</td>
                    <td class="text-end">${formatCurrency(revenue)}</td>
                    <td class="text-end">${formatCurrency(cost)}</td>
                    <td class="text-end">${formatCurrency(profit)}</td>
                `;
                tbody.appendChild(row);
            });
        }).finally(function () {
            if (wrapper) {
                delete wrapper.dataset.loading;
            }
        });
    }

    function loadStoreList() {
        if (storeListLoaded) {
            return;
        }
        const select = document.getElementById('store_id_select');
        if (!select) {
            return;
        }

        jsonRpc('/dashboard/api/pos-configs', {}, 'POST')
            .then(function (stores) {
                if (!stores || !stores.length) {
                    return;
                }
                stores.forEach(function (store) {
                    const option = document.createElement('option');
                    option.value = store.id;
                    option.textContent = store.name;
                    select.appendChild(option);
                });
                storeListLoaded = true;
            })
            .catch(function (error) {
                console.error('dashboard.loadStoreList error', error);
            });
    }

    function refreshStatsData() {
        debugLog('refreshStatsData');
        if (!hasDashboardDom()) {
            teardownDashboard();
            return;
        }
        loadDashboardStats();
    }

    function refreshChartData() {
        debugLog('refreshChartData');
        if (!hasDashboardDom()) {
            teardownDashboard();
            return;
        }
        const revenuePeriod = getPeriodValue('revenue_period', 'today');
        const profitPeriod = getPeriodValue('profit_period', 'today');
        if (revenuePeriod !== 'custom') {
            loadRevenueChart(revenuePeriod);
        }
        if (profitPeriod !== 'custom') {
            loadProfitChart(profitPeriod);
        }
    }

    function applyRevenueFilters() {
        const period = getPeriodValue('revenue_period', 'today');
        const effectivePeriod = period === 'custom' ? 'custom' : period;
        debugLog('applyRevenueFilters', {
            period: period,
            effectivePeriod: effectivePeriod,
            customRange: getSectionCustomDateRange('revenue'),
        });
        setChartLoading('revenue', true);
        loadRevenueChart(effectivePeriod);
    }

    function applyProfitFilters() {
        const period = getPeriodValue('profit_period', 'today');
        const effectivePeriod = period === 'custom' ? 'custom' : period;
        debugLog('applyProfitFilters', {
            period: period,
            effectivePeriod: effectivePeriod,
            customRange: getSectionCustomDateRange('profit'),
        });
        setChartLoading('profit', true);
        loadProfitChart(effectivePeriod);
    }

    function applyProductFilters() {
        const period = getPeriodValue('products_period', 'today');
        const effectivePeriod = period === 'custom' ? 'custom' : period;
        debugLog('applyProductFilters', {
            period: period,
            effectivePeriod: effectivePeriod,
            customRange: getSectionCustomDateRange('products'),
        });
        const tbody = document.querySelector('#products_table tbody');
        const wrapper = tbody ? tbody.closest('.dashboard-table') : null;
        if (wrapper) {
            wrapper.dataset.loading = '1';
        }
        loadTopProducts(effectivePeriod);
    }

    function initDashboard() {
        debugLog('initDashboard called', {
            dashboardInitialized: dashboardInitialized,
            hasDashboardDom: hasDashboardDom(),
        });
        if (dashboardInitialized) {
            return;
        }
        if (!hasDashboardDom()) {
            return;
        }
        dashboardInitialized = true;
        debugLog('initDashboard started', {
            revenuePeriod: getPeriodValue('revenue_period', 'today'),
            profitPeriod: getPeriodValue('profit_period', 'today'),
            productsPeriod: getPeriodValue('products_period', 'today'),
        });

        setDefaultSectionDates('revenue');
        setDefaultSectionDates('profit');
        setDefaultSectionDates('products');
        setCustomFilterVisibility('revenue', false);
        setCustomFilterVisibility('profit', false);
        setCustomFilterVisibility('products', false);

        loadStoreList();
        loadDashboardStats();
        loadTopProducts(getPeriodValue('products_period', 'today'));
        startChartBootstrap();
        bindDashboardEvents();

        if (statsTimer) {
            clearInterval(statsTimer);
        }
        statsTimer = setInterval(refreshStatsData, 5000);

        if (chartTimer) {
            clearInterval(chartTimer);
        }
        chartTimer = setInterval(function () {
            if (!document.hidden) {
                refreshChartData();
            }
        }, 60000);

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) {
                refreshChartData();
            }
        });

        window.addEventListener('beforeunload', function () {
            if (statsTimer) {
                clearInterval(statsTimer);
                statsTimer = null;
            }
            if (chartTimer) {
                clearInterval(chartTimer);
                chartTimer = null;
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scheduleDashboardInit);
    } else {
        scheduleDashboardInit();
    }

    return {
        initDashboard: initDashboard,
    };
});
