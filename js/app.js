document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation & Routing ---
    const navItems = document.querySelectorAll('.nav-item');
    const contentArea = document.getElementById('app-content');
    const headerTitle = document.getElementById('header-title');
    const backBtn = document.getElementById('back-btn');
    
    let currentChart = null; // Store chart instance for destruction

    const navigate = (screen) => {
        navItems.forEach(nav => nav.classList.remove('active'));
        document.querySelector(`[data-target="${screen}"]`)?.classList.add('active');
        backBtn.classList.add('hidden');
        
        if (currentChart) currentChart.destroy();

        switch (screen) {
            case 'dashboard': renderDashboard(); break;
            case 'simulate': renderSimulate(); break;
            case 'analytics': renderAnalytics(); break;
            case 'settings': renderSettings(); break;
            case 'portfolio_detail': renderPortfolioDetail(); break;
        }
    };

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            navigate(e.currentTarget.dataset.target);
        });
    });

    backBtn.addEventListener('click', () => navigate('dashboard'));

    // --- UI Renderers ---
    const renderDashboard = () => {
        headerTitle.textContent = "Portfolios";
        const portfolios = Storage.getAllPortfolios();
        
        let html = `<button class="btn-primary" onclick="alert('Add portfolio modal logic here')">+ Add Portfolio</button><br><br>`;
        
        portfolios.forEach(p => {
            html += `
                <div class="card" onclick="openPortfolio('${p.id}')" style="cursor:pointer">
                    <h3>${p.name}</h3>
                    <p style="color:var(--text-secondary)">${p.loans.length} Active Loans</p>
                </div>
            `;
        });
        contentArea.innerHTML = html;
    };

    window.openPortfolio = (id) => {
        Storage.setActivePortfolio(id);
        navigate('portfolio_detail');
    };

    const renderPortfolioDetail = () => {
        const portfolio = Storage.getActivePortfolio();
        headerTitle.textContent = portfolio.name;
        backBtn.classList.remove('hidden');

        // Aggregate stats
        let totalCurrentEmi = 0;
        let totalPrincipalPaid = 0;
        let totalOutstanding = 0;
        let totalInterestPaid = 0;
        let futureInterest = 0;
        let totalDisbursed = 0;

        portfolio.loans.forEach(loan => {
            const status = CalcEngine.getCurrentStatus(loan);
            totalCurrentEmi += status.currentEmi;
            totalPrincipalPaid += status.totalPrincipalPaid;
            totalOutstanding += status.outstandingToday;
            totalInterestPaid += status.totalInterestPaid;
            futureInterest += status.futureInterest;
            totalDisbursed += status.totalDisbursed;
        });

        const pPercent = totalDisbursed > 0 ? ((totalPrincipalPaid / totalDisbursed) * 100).toFixed(1) : 0;

        let html = `
            <div class="card">
                <p>Monthly EMI Obligation</p>
                <h2>${Storage.formatINR(totalCurrentEmi)}</h2>
            </div>
            <div class="card">
                <div class="chart-container">
                    <canvas id="portfolioChart"></canvas>
                    <div class="chart-center-text">
                        <h3 style="color:var(--accent-cyan)">P: ${pPercent}%</h3>
                    </div>
                </div>
            </div>
            <h3>Loans</h3>
        `;

        portfolio.loans.forEach(loan => {
            const status = CalcEngine.getCurrentStatus(loan);
            html += `
                <div class="card" style="margin-top:10px">
                    <h4>${loan.name}</h4>
                    <p>${loan.lender} • Outstanding: ${Storage.formatINR(status.outstandingToday)}</p>
                </div>
            `;
        });

        contentArea.innerHTML = html;

        // Render Chart
        const ctx = document.getElementById('portfolioChart').getContext('2d');
        currentChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Principal Paid', 'Principal Outstanding', 'Interest Paid', 'Future Interest'],
                datasets: [{
                    data: [totalPrincipalPaid, totalOutstanding, totalInterestPaid, futureInterest],
                    backgroundColor: [
                        '#00e676', // Green
                        '#6366F1', // Purple
                        '#ff4569', // Red
                        '#f97316'  // Orange
                    ],
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#ffffff' } }
                }
            }
        });
    };

    const renderSimulate = () => {
        headerTitle.textContent = "Simulate Prepayment";
        contentArea.innerHTML = `
            <div class="card">
                <h3>Prepayment Amount</h3>
                <input type="number" placeholder="Enter ₹ Amount">
                <button class="btn-primary" onclick="showToast('Simulation Engine requires actual loan selection mapping.')">🚀 Calculate Options</button>
            </div>
            <p style="color:var(--text-secondary); font-size:0.9rem">
                Select strategies like Avalanche (Highest ROI) or Optimal Saving (AI-IQ) to distribute funds across your portfolio.
            </p>
        `;
    };

    const renderAnalytics = () => {
        headerTitle.textContent = "Analytics";
        contentArea.innerHTML = `<div class="card"><p>Analytics dashboard loading...</p></div>`;
    };

    const renderSettings = () => {
        headerTitle.textContent = "Settings";
        contentArea.innerHTML = `
            <div class="card">
                <button class="btn-primary" onclick="Storage.loadDemoData(); location.reload();">Load Demo Data</button>
                <button class="btn-primary" style="background:var(--accent-red); margin-top:10px" onclick="localStorage.clear(); location.reload();">Wipe LocalStorage</button>
            </div>
        `;
    };

    // --- Utils ---
    window.showToast = (msg) => {
        const toast = document.createElement('div');
        toast.style.cssText = `
            background: var(--accent-cyan); color: #000; padding: 12px; 
            border-radius: 8px; margin-bottom: 10px; font-weight: bold;
            transform: translateY(20px); opacity: 0; transition: all 0.3s;
        `;
        toast.innerText = msg;
        const container = document.getElementById('toast-container');
        container.style.cssText = 'position:fixed; top:20px; left:20px; right:20px; z-index:9999;';
        container.appendChild(toast);
        
        setTimeout(() => { toast.style.transform = 'translateY(0)'; toast.style.opacity = '1'; }, 10);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    };

    // Init App
    navigate('dashboard');
});
