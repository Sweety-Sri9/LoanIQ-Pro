document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation & Core Elements ---
    const navItems = document.querySelectorAll('.nav-item');
    const contentArea = document.getElementById('app-content');
    const headerTitle = document.getElementById('header-title');
    const backBtn = document.getElementById('back-btn');
    
    // --- Bottom Sheet Elements ---
    const formModal = document.getElementById('form-modal');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalContent = document.getElementById('modal-content');
    const closeModalBtn = document.getElementById('close-modal');

    let currentChart = null;

    const openModal = (title, contentHtml) => {
        modalTitle.textContent = title;
        modalContent.innerHTML = contentHtml;
        formModal.classList.add('active');
        modalOverlay.classList.add('active');
    };

    const closeModal = () => {
        formModal.classList.remove('active');
        modalOverlay.classList.remove('active');
    };

    closeModalBtn.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);

    const navigate = (screen) => {
        navItems.forEach(nav => nav.classList.remove('active'));
        document.querySelector(`[data-target="${screen}"]`)?.classList.add('active');
        backBtn.classList.add('hidden');
        
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }

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

    // --- Dashboard Renderer ---
    const renderDashboard = () => {
        headerTitle.textContent = "Portfolios";
        const portfolios = Storage.getAllPortfolios();
        
        let html = `<button class="btn-primary" id="add-portfolio-trigger">+ Add Portfolio</button><br><br>`;
        
        if (portfolios.length === 0) {
            html += `<p style="text-align:center;color:var(--text-secondary);margin-top:20px;">No portfolios found. Click above to create one!</p>`;
        } else {
            portfolios.forEach(p => {
                const count = p.loans ? p.loans.length : 0;
                html += `
                    <div class="card" onclick="openPortfolio('${p.id}')" style="cursor:pointer">
                        <h3>${p.name}</h3>
                        <p style="color:var(--text-secondary)">${count} Active ${count === 1 ? 'Loan' : 'Loans'}</p>
                    </div>
                `;
            });
        }
        contentArea.innerHTML = html;

        document.getElementById('add-portfolio-trigger').addEventListener('click', () => {
            const modalHtml = `
                <div style="padding-top: 10px;">
                    <label style="display:block; margin-bottom:8px; color:var(--text-secondary)">Portfolio Name</label>
                    <input type="text" id="new-portfolio-name" placeholder="e.g., Personal Investments" autofocus>
                    <button class="btn-primary" id="save-portfolio-btn">Create Portfolio</button>
                </div>
            `;
            openModal('Add New Portfolio', modalHtml);

            document.getElementById('save-portfolio-btn').addEventListener('click', () => {
                const nameInput = document.getElementById('new-portfolio-name');
                const name = nameInput.value.trim();
                if (name) {
                    Storage.createPortfolio(name);
                    closeModal();
                    renderDashboard();
                    showToast(`Created ${name}`);
                } else {
                    showToast('Please enter a portfolio name.');
                }
            });
        });
    };

    window.openPortfolio = (id) => {
        Storage.setActivePortfolio(id);
        navigate('portfolio_detail');
    };

    // --- Detail View Renderer ---
    const renderPortfolioDetail = () => {
        const portfolio = Storage.getActivePortfolio();
        if (!portfolio) return navigate('dashboard');
        
        headerTitle.textContent = portfolio.name;
        backBtn.classList.remove('hidden');

        let totalCurrentEmi = 0, totalPrincipalPaid = 0, totalOutstanding = 0;
        let totalInterestPaid = 0, futureInterest = 0, totalDisbursed = 0;

        const loans = portfolio.loans || [];

        loans.forEach(loan => {
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
                <p style="color:var(--text-secondary);font-size:0.9rem">Monthly EMI Obligation</p>
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

            <div style="display:flex; gap:10px; margin-bottom:20px;">
                <button class="btn-primary" id="add-loan-trigger" style="margin:0; flex:2">+ Add Loan</button>
                <button class="btn-primary" id="delete-portfolio-trigger" style="margin:0; flex:1; background:var(--accent-red)">Delete</button>
            </div>

            <h3>Loans in Portfolio</h3>
        `;

        if (loans.length === 0) {
            html += `<p style="color:var(--text-secondary); margin-top:15px;">No loans tracked in this workspace yet.</p>`;
        } else {
            loans.forEach(loan => {
                const status = CalcEngine.getCurrentStatus(loan);
                html += `
                    <div class="card" style="margin-top:10px">
                        <h4>${loan.name}</h4>
                        <p style="color:var(--text-secondary);font-size:0.9rem">${loan.lender} • Outstanding: ${Storage.formatINR(status.outstandingToday)}</p>
                    </div>
                `;
            });
        }

        contentArea.innerHTML = html;

        // Render Analytics Circle Safely
        const ctx = document.getElementById('portfolioChart').getContext('2d');
        const standardData = [totalPrincipalPaid, totalOutstanding, totalInterestPaid, futureInterest];
        const displayData = standardData.every(v => v === 0) ? [1, 0, 0, 0] : standardData; 

        currentChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['Principal Paid', 'Outstanding', 'Interest Paid', 'Future Interest'],
                datasets: [{
                    data: displayData,
                    backgroundColor: ['#00e676', '#6366F1', '#ff4569', '#f97316'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '75%',
                plugins: { legend: { display: false } }
            }
        });

        // Event: Delete Portfolio
        document.getElementById('delete-portfolio-trigger').addEventListener('click', () => {
            if (confirm(`Delete portfolio "${portfolio.name}"? This cannot be undone.`)) {
                Storage.deletePortfolio(portfolio.id);
                showToast('Portfolio deleted');
                navigate('dashboard');
            }
        });

        // Event: Add Loan Quick Modal
        document.getElementById('add-loan-trigger').addEventListener('click', () => {
            const loanFormHtml = `
                <div style="padding-top:5px">
                    <input type="text" id="l-name" placeholder="Loan Nickname (e.g., Car Loan)">
                    <input type="text" id="l-lender" placeholder="Lender (e.g., HDFC)">
                    <input type="number" id="l-principal" placeholder="Principal Amount (₹)">
                    <input type="number" step="0.01" id="l-roi" placeholder="Interest Rate (%)">
                    <input type="number" id="l-tenure" placeholder="Tenure (Months)">
                    <button class="btn-primary" id="save-loan-btn">Save Asset Loan</button>
                </div>
            `;
            openModal('Add Loan Parameters', loanFormHtml);

            document.getElementById('save-loan-btn').addEventListener('click', () => {
                const name = document.getElementById('l-name').value.trim();
                const lender = document.getElementById('l-lender').value.trim();
                const principal = parseFloat(document.getElementById('l-principal').value);
                const roi = parseFloat(document.getElementById('l-roi').value);
                const tenure = parseInt(document.getElementById('l-tenure').value);

                if (name && principal > 0 && roi > 0 && tenure > 0) {
                    Storage.addLoanToActive({
                        id: 'loan_' + Date.now(),
                        name, lender: lender || 'Other',
                        principal, roi, tenure,
                        firstEmiDate: new Date().toISOString(),
                        emiOverride: 0, charges: []
                    });
                    closeModal();
                    renderPortfolioDetail();
                    showToast(`Added ${name}`);
                } else {
                    showToast('Please fill all financial variables correctly.');
                }
            });
        });
    };

    const renderSimulate = () => {
        headerTitle.textContent = "Simulate Prepayment";
        contentArea.innerHTML = `
            <div class="card">
                <h3>Prepayment Optimization</h3>
                <p style="color:var(--text-secondary); margin:10px 0 15px 0; font-size:0.9rem">Run deep distribution checks to pay down debt faster.</p>
                <input type="number" placeholder="Prepayment Pool Amount (₹)">
                <button class="btn-primary" onclick="showToast('Simulation calculations processed.')">🚀 Calculate All Strategies</button>
            </div>
        `;
    };

    const renderAnalytics = () => {
        headerTitle.textContent = "Analytics Engine";
        contentArea.innerHTML = `<div class="card"><p style="color:var(--text-secondary)">Compiling trends and real-time visualization paths...</p></div>`;
    };

    const renderSettings = () => {
        headerTitle.textContent = "Settings";
        contentArea.innerHTML = `
            <div class="card">
                <button class="btn-primary" onclick="Storage.loadDemoData(); location.reload();">Reload Playground Demo Data</button>
                <button class="btn-primary" style="background:var(--accent-red); margin-top:12px" onclick="Storage.wipeAll(); location.reload();">Wipe Application Memory</button>
            </div>
        `;
    };

    window.showToast = (msg) => {
        const oldToast = document.querySelector('.toast-banner');
        if (oldToast) oldToast.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-banner';
        toast.style.cssText = `
            background: var(--accent-cyan); color: #000; padding: 14px; 
            border-radius: 12px; font-weight: bold; text-align:center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3); transform: translateY(20px); 
            opacity: 0; transition: all 0.3s cubic-bezier(0.1, 0.8, 0.2, 1);
        `;
        toast.innerText = msg;
        const container = document.getElementById('toast-container');
        container.style.cssText = 'position:fixed; bottom:100px; left:20px; right:20px; z-index:9999;';
        container.appendChild(toast);
        
        setTimeout(() => { toast.style.transform = 'translateY(0)'; toast.style.opacity = '1'; }, 10);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    };

    // --- PWA Intelligent Automatic Update Engine ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').then(reg => {
            reg.addEventListener('updatefound', () => {
                const newWorker = reg.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showUpdateBanner(newWorker);
                    }
                });
            });

            if (reg.waiting) {
                showUpdateBanner(reg.waiting);
            }
        });

        let refreshing = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!refreshing) {
                refreshing = true;
                window.location.reload();
            }
        });
    }

    const showUpdateBanner = (worker) => {
        const updateDiv = document.createElement('div');
        updateDiv.style.cssText = `
            position: fixed; top: 20px; left: 20px; right: 20px;
            background: var(--bg-card); border: 2px solid var(--accent-cyan);
            color: #fff; padding: 16px; border-radius: 12px; z-index: 10000;
            display: flex; justify-content: space-between; align-items: center;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        `;
        
        updateDiv.innerHTML = `
            <div style="font-size: 0.9rem; font-weight: bold;">
                ✨ LoanIQ Update Available!
            </div>
            <button id="update-app-btn" style="
                background: var(--accent-cyan); color: #000; border: none;
                padding: 8px 14px; font-weight: bold; border-radius: 8px; cursor: pointer;
            ">Refresh</button>
        `;
        
        document.body.appendChild(updateDiv);

        document.getElementById('update-app-btn').addEventListener('click', () => {
            worker.postMessage('skipWaiting');
        });
    };

    navigate('dashboard');
});
