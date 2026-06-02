'use strict';

const App = (() => {
  const C = LoanCalculator;
  const S = LoanStorage;

  const state = {
    screen: 'dashboard',
    portfolioId: null,
    loanId: null,
    loanTab: 'amortization',
    simTab: 'simulate',
    charts: {},
    confirmCallback: null,
    simData: null, // Multi-loan simulation results
    editingEventId: null,
    editingEventType: null,
    editingEventLoanId: null
  };

  // ── Helpers ────────────────────────────────────────────────────────────────
  const esc = C.escapeHtml;
  const fmt = C.formatCurrency;
  const fmtF = C.formatCurrencyFull;
  const fmtD = C.formatDate;
  const fmtT = C.formatTenure;
  const today = () => new Date().toISOString().split('T')[0];

  // ── Initialization ─────────────────────────────────────────────────────────
  function init() {
    setupNavigation();
    setupModalBackdrops();
    setupHeaderButtons();
    setupModalButtons();
    setupAppListeners();
    // Default portfolio if none exists
    const portfolios = S.getPortfolios();
    if (Object.keys(portfolios).length === 0) {
      S.createPortfolio('My Main Portfolio', 'Primary tracker for personal loans', '#6366F1');
    }
    state.portfolioId = S.getActivePortfolioId();
    navigateTo('dashboard');
    registerServiceWorker();
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // ── Navigation & Shell ─────────────────────────────────────────────────────
  function setupNavigation() {
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigateTo(btn.getAttribute('data-screen'));
      });
    });
    document.getElementById('back-btn').addEventListener('click', goBack);
  }

  function setupAppListeners() {
    // Listen for loan form input to calculate live preview
    const inputs = ['loan-principal', 'loan-roi', 'loan-tenure'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateLoanLivePreview);
    });
  }

  function navigateTo(screenId, opts = {}) {
    destroyCharts();
    closeModal();

    if (screenId === 'portfolio') state.portfolioId = opts.portfolioId || state.portfolioId || S.getActivePortfolioId();
    if (screenId === 'loan-detail') {
      state.loanId = opts.loanId || state.loanId;
      state.portfolioId = opts.portfolioId || state.portfolioId || S.getActivePortfolioId();
      state.loanTab = opts.tab || 'amortization';
    }
    if (screenId === 'add-loan') {
      state.loanId = opts.loanId || null;
      state.portfolioId = opts.portfolioId || state.portfolioId || S.getActivePortfolioId();
    }
    state.screen = screenId;

    // Toggle active screen visibility
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById('screen-' + screenId);
    if (target) {
      target.classList.add('active');
      target.scrollTop = 0;
    }

    // Toggle bottom navigation active state
    document.querySelectorAll('.bottom-nav .nav-btn').forEach(btn => {
      const s = btn.getAttribute('data-screen');
      const isActive = s === screenId ||
        (s === 'dashboard' && ['portfolio', 'loan-detail', 'add-loan'].includes(screenId));
      btn.classList.toggle('active', isActive);
    });

    updateHeader(screenId);
    renderScreen(screenId);
  }

  function goBack() {
    if (state.screen === 'loan-detail') {
      navigateTo('portfolio', { portfolioId: state.portfolioId });
    } else if (state.screen === 'portfolio') {
      navigateTo('dashboard');
    } else if (state.screen === 'add-loan') {
      if (state.loanId) navigateTo('loan-detail', { loanId: state.loanId, portfolioId: state.portfolioId });
      else navigateTo('portfolio', { portfolioId: state.portfolioId });
    } else {
      navigateTo('dashboard');
    }
  }

  function updateHeader(screenId) {
    const backBtn = document.getElementById('back-btn');
    const appBrand = document.getElementById('app-brand');
    const pageTitleWrap = document.getElementById('page-title-wrap');
    const pageTitle = document.getElementById('page-title');
    const pageSubtitle = document.getElementById('page-subtitle');
    const btnAdd = document.getElementById('btn-header-add');
    const btnMore = document.getElementById('btn-header-more');

    const showBack = ['portfolio', 'loan-detail', 'add-loan'].includes(screenId);
    backBtn.classList.toggle('hidden', !showBack);
    appBrand.classList.toggle('hidden', showBack);
    pageTitleWrap.classList.toggle('hidden', !showBack);
    btnAdd.style.display = 'none';
    btnMore.style.display = 'none';

    if (screenId === 'portfolio') {
      const p = S.getPortfolios()[state.portfolioId];
      pageTitle.textContent = p ? p.name : 'Portfolio';
      pageSubtitle.textContent = ''; // Removed captions/description under portfolio title
    } else if (screenId === 'loan-detail') {
      const loan = S.getLoan(state.loanId, state.portfolioId);
      pageTitle.textContent = loan ? loan.name : 'Loan Details';
      pageSubtitle.textContent = ''; // Removed bank name caption to keep it extremely clean and prevent double-lender suffix clutter!
    } else if (screenId === 'add-loan') {
      pageTitle.textContent = state.loanId ? 'Edit Loan Parameters' : 'Add New Loan';
      pageSubtitle.textContent = '';
    }
  }

  function renderScreen(screenId) {
    switch (screenId) {
      case 'dashboard': renderDashboard(); break;
      case 'portfolio': renderPortfolio(); break;
      case 'loan-detail': renderLoanDetail(); break;
      case 'simulate': renderSimulate(); break;
      case 'analytics': renderAnalytics(); break;
      case 'settings': renderSettings(); break;
    }
  }

  // ── Dashboard Screen ───────────────────────────────────────────────────────
  function renderDashboard() {
    const el = document.getElementById('dashboard-content');
    const portfolios = S.getPortfolios();
    const portfolioList = Object.values(portfolios);

    let html = `
      <div class="section-header">
        <span class="section-title">My Portfolios</span>
        <button class="section-action" id="btn-add-p-action">+ Add Portfolio</button>
      </div>
    `;

    if (portfolioList.length === 0) {
      html += `
        <div class="empty-state">
          <div class="empty-icon">🏦</div>
          <h2>No Portfolios Yet</h2>
          <p>Create your first loan portfolio workspace to get started.</p>
          <button class="btn btn-primary" id="btn-create-p-first">Create Portfolio</button>
        </div>
      `;
    } else {
      html += '<div class="portfolio-cards" id="dash-portfolio-cards"></div>';
    }

    el.innerHTML = html;

    // Direct event binds
    document.getElementById('btn-add-p-action').onclick = () => openPortfolioModal();
    if (document.getElementById('btn-create-p-first')) {
      document.getElementById('btn-create-p-first').onclick = () => openPortfolioModal();
    }

    // Render portfolio list cards
    const cardsContainer = document.getElementById('dash-portfolio-cards');
    if (cardsContainer) {
      portfolioList.forEach(p => {
        const pLoans = p.loans || [];
        const pSummary = pLoans.length > 0 ? C.getPortfolioSummary(pLoans) : null;
        const color = p.color || '#6366F1';
        const progress = pSummary && pSummary.totalSanctioned > 0 ?
          Math.min(100, (pSummary.totalPrincipalPaid / pSummary.totalSanctioned) * 100) : 0;

        const card = document.createElement('div');
        card.className = 'portfolio-card';
        card.style.setProperty('--portfolio-color', color);
        card.style.padding = '12px 14px';
        card.style.borderRadius = 'var(--radius-sm)';
        card.style.marginBottom = '6px';
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span style="font-size: 14px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${esc(p.name)}
            </span>
            <span style="font-size: 12px; font-weight: 600; color: var(--text3); flex-shrink: 0; margin-left: 12px;">
              ${pLoans.length} loan${pLoans.length !== 1 ? 's' : ''}
            </span>
          </div>
        `;
        card.onclick = () => navigateTo('portfolio', { portfolioId: p.id });
        cardsContainer.appendChild(card);
      });
    }
  }

  // ── Portfolio Detail Screen ────────────────────────────────────────────────
  function renderPortfolio() {
    const el = document.getElementById('portfolio-content');
    const p = S.getPortfolios()[state.portfolioId];
    if (!p) { navigateTo('dashboard'); return; }

    const loans = p.loans || [];
    const summary = loans.length > 0 ? C.getPortfolioSummary(loans) : null;
    // P% and I+C% are independent — each as % of total sanctioned, no dependency between them
    const progress = summary && summary.totalSanctioned > 0 ?
      Math.min(100, (summary.totalPrincipalPaid / summary.totalSanctioned) * 100) : 0;
    const interestAndChargesPaid = summary ? (summary.totalInterestPaid + summary.totalCharges) : 0;
    const interestPaidPct = summary && summary.totalSanctioned > 0 ?
      Math.min(100, (interestAndChargesPaid / summary.totalSanctioned) * 100) : 0;

    const totalInterestSaved = summary ? summary.statuses.reduce((acc, x) => acc + x.status.interestSaved, 0) : 0;

    let html = `
      <div class="summary-cards">
        <div class="summary-card card-green">
          <div class="card-label">Monthly EMI Obligation</div>
          <div class="card-value">${summary ? fmt(summary.totalEmi) : '₹0'}</div>
          <div class="card-sub">Max Tenure: ${summary ? fmtT(summary.maxTenure) : '—'} · Across all active loans</div>
        </div>
        <div class="summary-card card-purple">
          <div class="card-label">Prepaid Interest Savings</div>
          <div class="card-value text-green">${summary ? fmt(totalInterestSaved) : '₹0'}</div>
          <div class="card-sub">Total Prepaid: ${summary ? fmt(summary.totalPrepaid) : '₹0'}</div>
        </div>
      </div>

      <!-- Portfolio Composition Chart Card -->
      <div class="chart-card mb-12" style="padding: 12px 8px;">
        <div class="chart-card-title" style="margin-bottom: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text2); letter-spacing: 0.5px;">Portfolio Carrying Cost & Paid-To-Date Progress</div>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <div style="position: relative; width: 110px; height: 110px; flex-shrink: 0; margin: 0 auto;">
            <canvas id="chart-portfolio-breakdown"></canvas>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none; line-height: 1.4;">
              <div style="font-size: 10px; font-weight: 800; color: #34D399;">P: ${progress.toFixed(1)}%</div>
              <div style="font-size: 9px; font-weight: 700; color: #F87171;">I+C: ${interestPaidPct.toFixed(1)}%</div>
            </div>
          </div>
          <div class="chart-legend-box">
            <div style="font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px; display: flex; justify-content: space-between;">
              <span class="text-muted">Total Disbursed:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalSanctioned) : '₹0'}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #047857; font-weight: 600;">● Principal Paid:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalPrincipalPaid) : '₹0'}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #991B1B; font-weight: 600;">● Interest Paid:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalInterestPaid) : '₹0'}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #F97316; font-weight: 600;">● Total Charges:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalCharges) : '₹0'}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #34D399; font-weight: 600;">● Current Outstanding:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalOutstanding) : '₹0'}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #F87171; font-weight: 600;">● Future Interest:</span> <strong style="color: var(--text);">${summary ? fmtF(summary.totalRemainingInterest) : '₹0'}</strong>
            </div>
          </div>
        </div>
      </div>
    `;

    html += `
      <div class="section-header">
        <span class="section-title">Loans in this Portfolio</span>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="section-action" id="btn-add-loan-p">+ Add Loan</button>
          <button class="btn btn-outline btn-xs" id="btn-rename-portfolio">✏️ Rename</button>
          <button class="btn btn-danger btn-xs" id="btn-delete-portfolio">🗑️ Delete</button>
        </div>
      </div>
    `;

    if (loans.length === 0) {
      html += `
        <div class="empty-state">
          <div class="empty-icon">💳</div>
          <h3>No Loans Tracked Yet</h3>
          <p>Add a Home, Personal, or Vehicle Loan to start visualizing amortization and savings.</p>
          <button class="btn btn-primary" id="btn-add-loan-first">Add First Loan</button>
        </div>
      `;
    } else {
      html += '<div class="loan-cards" id="portfolio-loans-list"></div>';
    }

    el.innerHTML = html;

    // Draw portfolio breakdown chart
    if (summary) {
      setTimeout(() => {
        const ctx = document.getElementById('chart-portfolio-breakdown');
        if (!ctx) return;
        state.charts['portBreak'] = new Chart(ctx, {
          type: 'doughnut',
          data: {
            labels: ['Principal Paid', 'Principal Outstanding', 'Interest Paid', 'Future Interest', 'Total Charges'],
            datasets: [{
              data: [
                summary.totalPrincipalPaid,
                summary.totalOutstanding,
                summary.totalInterestPaid,
                summary.totalRemainingInterest,
                summary.totalCharges
              ],
              backgroundColor: ['#047857', '#34D399', '#991B1B', '#F87171', '#F97316'],
              borderColor: 'rgba(13,13,26,0.92)',
              borderWidth: 2
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
              legend: { display: false },
              tooltip: {
                enabled: false,
                external: ({ chart, tooltip }) => createExternalTooltip(chart, tooltip)
              }
            }
          }
        });
      }, 100);
    }

    // Direct event binds
    document.getElementById('btn-add-loan-p').onclick = () => openAddLoanModal();
    if (document.getElementById('btn-add-loan-first')) {
      document.getElementById('btn-add-loan-first').onclick = () => openAddLoanModal();
    }
    document.getElementById('btn-rename-portfolio').onclick = () => {
      openPortfolioModal(p);
    };
    document.getElementById('btn-delete-portfolio').onclick = () => {
      showConfirm(`Are you sure you want to delete the portfolio "${p.name}"? All associated loans and transaction timelines will be lost forever.`, () => {
        const remaining = S.getPortfolios();
        if (Object.keys(remaining).length <= 1) {
          showToast('Cannot delete the last remaining portfolio workspace!', 'error');
          return;
        }
        S.deletePortfolio(p.id);
        showToast('Portfolio deleted successfully', 'info');
        navigateTo('dashboard');
      });
    };

    // Render loans list
    const loansContainer = document.getElementById('portfolio-loans-list');
    if (loansContainer) {
      loans.forEach(loan => {
        const status = C.getCurrentStatus(loan);
        const paidPercent = status.totalDisbursed > 0 ?
          Math.min(100, (status.totalPrincipalPaid / status.totalDisbursed) * 100) : 0;

        const card = document.createElement('div');
        card.className = 'loan-card';
        card.style.padding = '12px 14px';
        card.style.borderRadius = 'var(--radius-sm)';
        card.style.marginBottom = '6px';
        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <span style="font-size: 14px; font-weight: 700; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${esc(loan.name)}
            </span>
            <span style="font-size: 13px; font-weight: 700; color: var(--green); flex-shrink: 0; margin-left: 12px;">
              ${paidPercent.toFixed(1)}% paid
            </span>
          </div>
        `;
        card.onclick = () => navigateTo('loan-detail', { loanId: loan.id, portfolioId: p.id });
        loansContainer.appendChild(card);
      });
    }
  }

  // ── Loan Detail Screen ─────────────────────────────────────────────────────
  function renderLoanDetail() {
    const el = document.getElementById('loan-detail-content');
    const loan = S.getLoan(state.loanId, state.portfolioId);
    if (!loan) { navigateTo('portfolio', { portfolioId: state.portfolioId }); return; }

    const status = C.getCurrentStatus(loan);
    // P% and I+C% are independent — each as % of total disbursed, no dependency between them
    const paidPercent = status.totalDisbursed > 0 ?
      Math.min(100, (status.totalPrincipalPaid / status.totalDisbursed) * 100) : 0;
    const loanInterestAndChargesPaid = status.totalInterestPaid + status.totalCharges;
    const interestPaidPct = status.totalDisbursed > 0 ?
      Math.min(100, (loanInterestAndChargesPaid / status.totalDisbursed) * 100) : 0;

    let html = `
      <div class="loan-detail-header">
        <div class="loan-detail-actions">
          <button class="btn btn-primary btn-sm" id="btn-prepay-action">+ Part Pay</button>
          <button class="btn btn-outline btn-sm" id="btn-roi-action">📈 ROI Change</button>
          <button class="btn btn-outline btn-sm" id="btn-topup-action">➕ Top-Up</button>
          <button class="btn btn-outline btn-sm" id="btn-charge-action">💸 Add Fee</button>
          <button class="btn btn-outline btn-sm" id="btn-edit-loan-action">⚙️ Edit Loan</button>
          <button class="btn btn-danger btn-sm" id="btn-delete-loan-action">🗑️ Delete Loan</button>
        </div>
      </div>

      <div class="summary-cards">
        <div class="summary-card card-green">
          <div class="card-label">Current Monthly EMI</div>
          <div class="card-value">${fmt(status.currentEmi)}</div>
          <div class="card-sub">Next: ${status.closureDate ? C.formatDate(C.addMonths(new Date(loan.firstEmiDate), status.paidEMIs)) : 'Closed'} · ${fmtT(status.remainingTenure)} left · ${status.currentRoi.toFixed(2)}% p.a.</div>
        </div>
        <div class="summary-card card-purple">
          <div class="card-label">Prepaid Interest Savings</div>
          <div class="card-value text-green">${fmt(status.interestSaved)}</div>
          <div class="card-sub">Total Prepaid: ${fmt(status.totalPrepaid)}</div>
        </div>
      </div>

      <!-- Loan Composition Chart Card -->
      <div class="chart-card mb-12" style="padding: 12px 8px;">
        <div class="chart-card-title" style="margin-bottom: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text2); letter-spacing: 0.5px;">Loan Carrying Cost & Paid-To-Date Progress</div>
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
          <div style="position: relative; width: 110px; height: 110px; flex-shrink: 0; margin: 0 auto;">
            <canvas id="chart-loan-composition"></canvas>
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; pointer-events: none; line-height: 1.4;">
              <div style="font-size: 10px; font-weight: 800; color: #34D399;">P: ${paidPercent.toFixed(1)}%</div>
              <div style="font-size: 9px; font-weight: 700; color: #F87171;">I+C: ${interestPaidPct.toFixed(1)}%</div>
            </div>
          </div>
          <div class="chart-legend-box">
            <div style="font-size: 12px; border-bottom: 1px solid rgba(255,255,255,0.06); padding-bottom: 4px; display: flex; justify-content: space-between;">
              <span class="text-muted">Total Disbursed:</span> <strong style="color: var(--text);">${fmtF(status.totalDisbursed)}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #047857; font-weight: 600;">● Principal Paid:</span> <strong style="color: var(--text);">${fmtF(status.totalPrincipalPaid)}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #991B1B; font-weight: 600;">● Interest Paid:</span> <strong style="color: var(--text);">${fmtF(status.totalInterestPaid)}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #F97316; font-weight: 600;">● Total Charges:</span> <strong style="color: var(--text);">${fmtF(status.totalCharges)}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #34D399; font-weight: 600;">● Current Outstanding:</span> <strong style="color: var(--text);">${fmtF(status.outstandingPrincipal)}</strong>
            </div>
            <div style="font-size: 11px; display: flex; justify-content: space-between;">
              <span style="color: #F87171; font-weight: 600;">● Future Interest:</span> <strong style="color: var(--text);">${fmtF(status.remainingInterest)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div class="tab-bar" id="loan-detail-tabs">
        <button class="tab-btn ${state.loanTab === 'amortization' ? 'active' : ''}" data-tab="amortization">Amortization</button>
        <button class="tab-btn ${state.loanTab === 'events' ? 'active' : ''}" data-tab="events">Events</button>
        <button class="tab-btn ${state.loanTab === 'charges' ? 'active' : ''}" data-tab="charges">Charges</button>
        <button class="tab-btn ${state.loanTab === 'info' ? 'active' : ''}" data-tab="info">Parameters</button>
      </div>

      <div id="tab-amortization" class="tab-content ${state.loanTab === 'amortization' ? 'active' : ''}"></div>
      <div id="tab-events" class="tab-content ${state.loanTab === 'events' ? 'active' : ''}"></div>
      <div id="tab-charges" class="tab-content ${state.loanTab === 'charges' ? 'active' : ''}"></div>
      <div id="tab-info" class="tab-content ${state.loanTab === 'info' ? 'active' : ''}"></div>
    `;

    el.innerHTML = html;

    // Top action bar binds
    document.getElementById('btn-prepay-action').onclick = () => showPaymentModal(loan);
    document.getElementById('btn-roi-action').onclick = () => showRoiModal(loan);
    document.getElementById('btn-topup-action').onclick = () => showTopupModal(loan);
    document.getElementById('btn-charge-action').onclick = () => showChargeModal(loan);
    document.getElementById('btn-edit-loan-action').onclick = () => {
      openAddLoanModal(loan); // Directly opens Edit Loan modal for this loan
    };
    document.getElementById('btn-delete-loan-action').onclick = () => {
      showConfirm(`Are you sure you want to permanently delete the loan "${loan.name}" and erase all recorded financial events? This action is completely irreversible.`, () => {
        S.deleteLoan(loan.id, state.portfolioId);
        showToast('Loan deleted from portfolio', 'info');
        navigateTo('portfolio');
      });
    };

    // Tab switcher binds
    document.querySelectorAll('#loan-detail-tabs .tab-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#loan-detail-tabs .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-tab');
        state.loanTab = tab;
        document.querySelectorAll('#loan-detail-content .tab-content').forEach(c => c.classList.remove('active'));
        const activeTabEl = document.getElementById('tab-' + tab);
        if (activeTabEl) activeTabEl.classList.add('active');
        renderLoanDetailTab(tab, loan, status);
      };
    });

    renderLoanDetailTab(state.loanTab, loan, status);

    // Draw the composition chart
    setTimeout(() => {
      drawLoanCompositionChart(status);
    }, 100);
  }

  function renderLoanDetailTab(tab, loan, status) {
    if (tab === 'events') {
      renderEventsTab(loan, status);
    } else if (tab === 'amortization') {
      renderAmortizationTab(loan, status);
    } else if (tab === 'charges') {
      renderChargesTab(loan, status);
    } else if (tab === 'info') {
      renderInfoTab(loan, status);
    }
  }

  function renderEventsTab(loan, status) {
    const tabEl = document.getElementById('tab-events');
    if (!tabEl) return;

    // Combine all financial timeline events chronologically
    const events = [];
    events.push({ type: 'sanction', date: new Date(loan.sanctionDate), label: 'Loan Sanctioned Base', details: `Initial Amount: ${fmtF(loan.principal)} · Starting ROI: ${loan.roi}% p.a.`, amount: loan.principal });

    (loan.roiChanges || []).forEach(r => {
      events.push({ type: 'roi', date: new Date(r.date), id: r.id, label: 'ROI Rate Adjustment', details: `New ROI: ${r.newRoi}% p.a. · Mode: ${r.option === 'keep_emi' ? 'Constant EMI' : 'Constant Tenure'}` + (r.note ? ` (${esc(r.note)})` : '') });
    });

    (loan.topUps || []).forEach(t => {
      events.push({ type: 'topup', date: new Date(t.date), id: t.id, label: 'Top-Up Disbursed', details: `Increased outstanding principal by ${fmtF(t.amount)}` + (t.note ? ` (${esc(t.note)})` : ''), amount: t.amount });
    });

    (loan.partialPayments || []).forEach(p => {
      events.push({ type: 'payment', date: new Date(p.date), id: p.id, label: 'Part Payment Applied', details: `Prepayment of ${fmtF(p.amount)}` + (p.note ? ` (${esc(p.note)})` : ''), amount: -p.amount });
    });

    (loan.charges || []).forEach(c => {
      events.push({ type: 'charge', date: new Date(c.date), id: c.id, label: `${C.getChargeTypeLabel(c.type)} Added`, details: `${esc(c.name || 'Filing Fee')}` + (c.notes ? ` (${esc(c.notes)})` : ''), amount: c.amount });
    });

    // Sort chronologically
    events.sort((a, b) => a.date - b.date);

    let html = '';

    if (events.length === 0) {
      html += '<div class="empty-mini">No events recorded. Add top-ups, ROI changes, or part-payments above.</div>';
    } else {
      html += '<div class="event-timeline">';
      events.forEach(ev => {
        const dotClass = `timeline-dot-${ev.type}`;
        const icon = { sanction: '🏦', roi: '📈', topup: '➕', payment: '💰', charge: '💸' }[ev.type] || '📌';
        const isSanction = ev.type === 'sanction';

        html += `
          <div class="timeline-item">
            <div class="timeline-dot ${dotClass}">${icon}</div>
            <div class="timeline-body">
              <div class="timeline-date">${fmtD(ev.date)}</div>
              <div class="timeline-title">${ev.label}</div>
              <div class="timeline-detail">${ev.details}</div>
              ${!isSanction ? `
                <div class="timeline-actions">
                  <button class="btn btn-xs btn-outline" onclick="App.editEvent('${ev.type}', '${ev.id}')">Edit Date/Info</button>
                  <button class="btn btn-xs btn-danger" onclick="App.deleteEvent('${ev.type}', '${ev.id}')">Delete</button>
                </div>
              ` : ''}
            </div>
            ${ev.amount !== undefined ? `
              <div class="timeline-amount ${ev.amount < 0 ? 'text-green' : 'text-blue'}">
                ${ev.amount < 0 ? '-' : '+'}${fmtF(Math.abs(ev.amount))}
              </div>
            ` : ''}
          </div>
        `;
      });
      html += '</div>';
    }

    tabEl.innerHTML = html;
  }

  function renderAmortizationTab(loan, status) {
    const tabEl = document.getElementById('tab-amortization');
    if (!tabEl) return;

    const schedule = status.schedule;
    const todayDate = C.normalizeDate(new Date());

    let html = `
      <div class="amortization-summary">
        <div class="amort-summary-item">
          <div class="amort-summary-label">Total Tenures</div>
          <div class="amort-summary-value">${schedule.length} EMIs</div>
        </div>
        <div class="amort-summary-item">
          <div class="amort-summary-label">Interest Cost</div>
          <div class="amort-summary-value text-orange">${fmt(status.totalInterest)}</div>
        </div>
        <div class="amort-summary-item">
          <div class="amort-summary-label">Total Cost</div>
          <div class="amort-summary-value text-green">${fmt(status.totalCost)}</div>
        </div>
      </div>

      <div class="flex-row mb-12">
        <button class="filter-tab active" id="f-tab-all">All Schedule</button>
        <button class="filter-tab" id="f-tab-past">Paid EMIs</button>
        <button class="filter-tab" id="f-tab-future">Remaining</button>
      </div>

      <div class="amortization-table-wrapper">
        <table class="amortization-table">
          <thead>
            <tr>
              <th>EMI #</th>
              <th>Due Date</th>
              <th>Opening</th>
              <th>EMI Amount</th>
              <th>Interest</th>
              <th>Principal</th>
              <th>Closing Bal</th>
              <th>Rate %</th>
            </tr>
          </thead>
          <tbody id="schedule-rows-container"></tbody>
        </table>
      </div>
      <div class="see-more mt-12" id="btn-see-full-schedule" style="display: none;">
        Show full dynamic schedule...
      </div>
    `;

    tabEl.innerHTML = html;

    let activeFilter = 'all';
    let displayLimit = 24;

    function drawScheduleRows() {
      const rowsContainer = document.getElementById('schedule-rows-container');
      if (!rowsContainer) return;
      rowsContainer.innerHTML = '';

      const filtered = schedule.filter(entry => {
        const rowDate = C.normalizeDate(entry.date);
        if (activeFilter === 'past') return rowDate <= todayDate;
        if (activeFilter === 'future') return rowDate > todayDate;
        return true;
      });

      const sliced = filtered.slice(0, displayLimit);
      sliced.forEach(entry => {
        const rowDate = C.normalizeDate(entry.date);
        const isPast = rowDate <= todayDate;
        const hasEvents = entry.events && entry.events.length > 0;

        const tr = document.createElement('tr');
        if (hasEvents) tr.className = 'amort-row-event';
        else if (isPast) tr.className = 'amort-row-past';

        let badgeHtml = '';
        if (hasEvents) {
          entry.events.forEach(ev => {
            const cls = ev.type === 'payment' ? 'amort-event-payment' : ev.type === 'roi' ? 'amort-event-roi' : 'amort-event-topup';
            const shortCode = ev.type === 'payment' ? 'PP' : ev.type === 'roi' ? 'ROI' : 'TU';
            badgeHtml += `<span class="amort-event-badge ${cls}">${shortCode}</span>`;
          });
        }

        tr.innerHTML = `
          <td>${entry.month}${badgeHtml}</td>
          <td>${fmtD(entry.date)}</td>
          <td>${fmtF(entry.openingBalance)}</td>
          <td>${fmtF(entry.emi)}</td>
          <td>${fmtF(entry.interest)}</td>
          <td>${fmtF(entry.principal)}</td>
          <td>${fmtF(entry.outstanding)}</td>
          <td>${entry.roi.toFixed(2)}</td>
        `;
        rowsContainer.appendChild(tr);
      });

      const seeMoreBtn = document.getElementById('btn-see-full-schedule');
      if (seeMoreBtn) {
        if (filtered.length > displayLimit) {
          seeMoreBtn.style.display = 'block';
          seeMoreBtn.textContent = `Showing first ${displayLimit} of ${filtered.length} installments. Click to view all.`;
          seeMoreBtn.onclick = () => {
            displayLimit = 9999;
            drawScheduleRows();
          };
        } else {
          seeMoreBtn.style.display = 'none';
        }
      }
    }

    // Filter switching binds
    document.getElementById('f-tab-all').onclick = (e) => { toggleFilter(e.target, 'all'); };
    document.getElementById('f-tab-past').onclick = (e) => { toggleFilter(e.target, 'past'); };
    document.getElementById('f-tab-future').onclick = (e) => { toggleFilter(e.target, 'future'); };

    function toggleFilter(targetEl, filterType) {
      document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
      targetEl.classList.add('active');
      activeFilter = filterType;
      displayLimit = 24;
      drawScheduleRows();
    }

    drawScheduleRows();
  }

  function renderChargesTab(loan, status) {
    const tabEl = document.getElementById('tab-charges');
    if (!tabEl) return;

    const charges = loan.charges || [];
    const breakdown = status.chargesBreakdown;

    let html = '';

    if (charges.length === 0) {
      html += '<div class="empty-mini">No additional charges mapped. Use button above to record Processing Fee, documentation, or Insurance.</div>';
    } else {
      html += '<div class="charges-list">';
      charges.forEach(c => {
        const icon = { processing_fee: '🏷️', legal: '⚖️', documentation: '📄', insurance: '🛡️', gst: '🧾', prepayment: '💸', foreclosure: '🔒', late_payment: '⏰', bounce: '↩️', penal_interest: '⚠️', pre_emi: '📅', other: '💰' }[c.type] || '💰';
        html += `
          <div class="charge-item">
            <div class="charge-item-icon">${icon}</div>
            <div class="charge-item-body">
              <div class="charge-item-name">${esc(c.name)}</div>
              <div class="charge-item-meta">${C.getChargeTypeLabel(c.type)} · Recorded: ${fmtD(c.date)}` + (c.notes ? ` · Note: ${esc(c.notes)}` : '') + `</div>
            </div>
            <div class="charge-item-amount">${fmtF(c.amount)}</div>
            <div class="charge-item-actions">
              <button class="btn btn-xs btn-outline" onclick="App.editEvent('charge', '${c.id}')">Edit</button>
              <button class="btn btn-xs btn-danger" onclick="App.deleteEvent('charge', '${c.id}')">✕</button>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    // Consolidated Charges card
    html += `
      <div class="charges-total-card" style="margin-top: 16px;">
        <div class="charges-total-row">
          <span>Processing/Administrative Charges</span>
          <strong>${fmtF(breakdown.byType['processing_fee'] || 0)}</strong>
        </div>
        <div class="charges-total-row">
          <span>Documentation/Stamp Duties</span>
          <strong>${fmtF(breakdown.byType['documentation'] || 0)}</strong>
        </div>
        <div class="charges-total-row">
          <span>Insurance Charges</span>
          <strong>${fmtF(breakdown.byType['insurance'] || 0)}</strong>
        </div>
        <div class="charges-total-row">
          <span>Pre-EMI Broken Period Interest</span>
          <strong>${fmtF(C.calculatePreEmiInterest(loan))}</strong>
        </div>
        <div class="charges-total-row">
          <span>Foreclosure/Prepayment Charges</span>
          <strong>${fmtF(breakdown.byType['prepayment'] || 0)}</strong>
        </div>
        <div class="charges-grand-total">
          <span>Total Accumulated Fees</span>
          <span class="text-red">${fmtF(breakdown.total + C.calculatePreEmiInterest(loan))}</span>
        </div>
      </div>
    `;

    tabEl.innerHTML = html;
  }

  function renderInfoTab(loan, status) {
    const tabEl = document.getElementById('tab-info');
    if (!tabEl) return;

    let html = `
      <div class="info-grid">
        <div class="info-item">
          <div class="info-label">Loan Portfolio ID</div>
          <div class="info-value" style="font-size: 11px; font-family: monospace;">${loan.id}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Interest Treatment</div>
          <div class="info-value" style="text-transform: capitalize;">${loan.interestType} rate</div>
        </div>
        <div class="info-item">
          <div class="info-label">Sanction Date</div>
          <div class="info-value">${fmtD(loan.sanctionDate)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">First Installment Date</div>
          <div class="info-value">${fmtD(loan.firstEmiDate)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Original Tenure (Months)</div>
          <div class="info-value">${loan.tenure} months (${Math.round(loan.tenure/12)} years)</div>
        </div>
        <div class="info-item">
          <div class="info-label">Starting Interest ROI</div>
          <div class="info-value">${loan.roi}% p.a.</div>
        </div>
        <div class="info-item">
          <div class="info-label">Original Sanction Base</div>
          <div class="info-value">${fmtF(loan.principal)}</div>
        </div>
        <div class="info-item">
          <div class="info-label">Auto EMI Override</div>
          <div class="info-value">${loan.emiOverride > 0 ? fmtF(loan.emiOverride) : 'None (Strict Math)'}</div>
        </div>
      </div>

    `;

    tabEl.innerHTML = html;
  }

  // ── Add/Edit Loan Screen (Full Page Entry) ─────────────────────────────────
  function renderAddLoan() {
    // Already rendered in full page or modular inside renderScreen.
    // The HTML input elements are inside the full page, so we read values directly and save them.
    // Since we put custom full forms in modal-loan, we don't need a separate screen for add-loan!
    // We can just trigger the modular modal sheets because they fit iPhone views perfectly.
    // Let's redirect to portfolio and trigger openAddLoanModal! This is highly streamlined.
    navigateTo('portfolio');
    openAddLoanModal(state.loanId ? S.getLoan(state.loanId, state.portfolioId) : null);
  }

  // ── Simulator Screen ───────────────────────────────────────────────────────
  function renderSimulate() {
    const el = document.getElementById('simulate-content');
    const portfolios = S.getPortfolios();
    const portfolioList = Object.values(portfolios);

    let html = `
      <div class="tab-bar" id="sim-tab-bar" style="margin-bottom: 12px;">
        <button class="tab-btn ${state.simTab !== 'compare' ? 'active' : ''}" data-sim-tab="simulate">⚡ Simulate</button>
        <button class="tab-btn ${state.simTab === 'compare' ? 'active' : ''}" data-sim-tab="compare">📊 Compare Saved</button>
      </div>
      <div id="sim-simulate-wrapper" style="${state.simTab === 'compare' ? 'display:none;' : ''}">
      <div class="simulate-header">
        <div class="simulate-title">⚡ Intelligent Debt Optimizer & Simulator</div>
        <div class="simulate-subtitle">Model prepayment strategies, split custom allocations, or let the smart engine suggest optimum distributions to minimize overall portfolio interest.</div>
      </div>

      <div class="form-group">
        <label>Select Portfolio Workspace</label>
        <select class="form-group select" id="sim-portfolio-selector" style="width: 100%;">
          <option value="">Choose portfolio...</option>
          ${portfolioList.map(p => `<option value="${p.id}" ${p.id === state.portfolioId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
      </div>

      <div id="sim-main-section" style="display: none;">
        <div class="section-header">
          <span class="section-title">Select Active Loans for Prepayment</span>
        </div>
        <div class="sim-loan-selector" id="sim-loans-checkboxes"></div>

        <div class="form-row">
          <div class="form-group">
            <label>Total Part-Payment Pool (₹) *</label>
            <input type="number" id="sim-total-amount" placeholder="e.g. 500000" min="1000">
          </div>
          <div class="form-group">
            <label>Proposed Date *</label>
            <input type="date" id="sim-pay-date">
          </div>
        </div>

        <div class="section-header">
          <span class="section-title">Debt Repayment Allocation Strategy</span>
        </div>
        <div class="strategy-grid">
          <div class="strategy-btn active" data-strategy="max_interest_saving" id="strat-opt">
            <div class="strategy-btn-title">Optimal Saving (AI-IQ)</div>
            <div class="strategy-btn-desc">Weighted algorithm maximizes total interest reduction</div>
          </div>
          <div class="strategy-btn" data-strategy="highest_roi" id="strat-avalanche">
            <div class="strategy-btn-title">Avalanche Method</div>
            <div class="strategy-btn-desc">100% focused on highest ROI first</div>
          </div>
          <div class="strategy-btn" data-strategy="highest_outstanding" id="strat-snowball">
            <div class="strategy-btn-title">Proportional Balance</div>
            <div class="strategy-btn-desc">Pro-rata split based on outstanding amount</div>
          </div>
          <div class="strategy-btn" data-strategy="equal_split" id="strat-equal">
            <div class="strategy-btn-title">Equal Split</div>
            <div class="strategy-btn-desc">Divide payment equally across selected loans</div>
          </div>
          <div class="strategy-btn" data-strategy="custom_split" id="strat-custom" style="grid-column: 1 / -1;">
            <div class="strategy-btn-title">✏️ Custom Split</div>
            <div class="strategy-btn-desc">Enter custom part-payment amount for each loan manually</div>
          </div>
        </div>

        <div id="custom-split-section" style="display: none; margin-top: 12px;">
          <div class="section-header" style="margin-top: 0;">
            <span class="section-title">Custom Allocation per Loan</span>
          </div>
          <div id="custom-split-inputs"></div>
        </div>

        <button class="btn btn-primary btn-full" id="btn-run-simulation-calc" style="margin-top: 16px;">
          🚀 Calculate Optimum Savings & Compare
        </button>
      </div>
      <div id="sim-saved-section" style="margin-top: 16px;"></div>
      <div id="sim-history-section" style="margin-top: 8px;"></div>
      </div>
      <div id="sim-compare-wrapper" style="${state.simTab !== 'compare' ? 'display:none;' : ''}"></div>
    `;

    el.innerHTML = html;

    const portfolioSelect = document.getElementById('sim-portfolio-selector');
    portfolioSelect.onchange = () => {
      state.portfolioId = portfolioSelect.value;
      loadPortfolioLoansForSim();
      refreshSimSections();
    };

    // Strategy picker bind
    document.querySelectorAll('.strategy-grid .strategy-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.strategy-grid .strategy-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const strategy = btn.getAttribute('data-strategy');
        const customSection = document.getElementById('custom-split-section');
        if (customSection) {
          customSection.style.display = strategy === 'custom_split' ? 'block' : 'none';
          if (strategy === 'custom_split') {
            const container = document.getElementById('custom-split-inputs');
            if (container) {
              container.innerHTML = '';
              document.querySelectorAll('.sim-loan-checkbox:checked').forEach(chk => {
                const loanId = chk.getAttribute('data-loan-id');
                const loanName = chk.closest('.sim-loan-item').querySelector('.sim-loan-name').textContent;
                const loan = S.getLoan(loanId, state.portfolioId);
                const outstanding = loan ? C.getCurrentStatus(loan).outstandingPrincipal : 0;
                const div = document.createElement('div');
                div.style.cssText = 'display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px;';
                div.innerHTML = `
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="flex: 1; font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${loanName}</span>
                    <input type="number" class="custom-split-input" data-loan-id="${loanId}" data-max="${outstanding}"
                      placeholder="₹ Amount" min="0" style="width: 130px; padding: 8px 10px; border: 1px solid var(--input-border); border-radius: var(--radius-xs); background: var(--input-bg); color: var(--text); font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.2s;">
                  </div>
                  <div style="font-size: 10px; color: var(--text3); text-align: right; padding-right: 2px;">Max: ${fmtF(outstanding)}</div>
                `;
                container.appendChild(div);
              });

              // Add remaining amount indicator
              const remainingDiv = document.createElement('div');
              remainingDiv.id = 'custom-split-remaining';
              remainingDiv.style.cssText = 'font-size: 12px; font-weight: 600; margin-top: 8px; padding: 8px 10px; border-radius: var(--radius-xs); transition: all 0.2s;';
              container.appendChild(remainingDiv);

              // Real-time validation
              const updateRemaining = () => {
                const totalPool = parseFloat(document.getElementById('sim-total-amount').value) || 0;
                let used = 0;
                let hasExceededOutstanding = false;
                container.querySelectorAll('.custom-split-input').forEach(inp => {
                  const amount = parseFloat(inp.value) || 0;
                  const maxAmount = parseFloat(inp.getAttribute('data-max')) || 0;
                  used += amount;
                  if (amount > maxAmount + 1) {
                    inp.style.borderColor = 'var(--red)';
                    hasExceededOutstanding = true;
                  } else {
                    inp.style.borderColor = 'var(--input-border)';
                  }
                });
                const left = totalPool - used;
                const el = document.getElementById('custom-split-remaining');
                if (!el) return;
                if (hasExceededOutstanding) {
                  el.style.cssText = 'font-size:12px;font-weight:600;margin-top:8px;padding:8px 10px;border-radius:var(--radius-xs);color:var(--red);background:rgba(255,69,105,0.08);border:1px solid rgba(255,69,105,0.25);';
                  el.textContent = `⚠️ Some amounts exceed the outstanding balance for that loan!`;
                } else if (left < 0) {
                  el.style.cssText = 'font-size:12px;font-weight:600;margin-top:8px;padding:8px 10px;border-radius:var(--radius-xs);color:var(--red);background:rgba(255,69,105,0.08);border:1px solid rgba(255,69,105,0.25);';
                  el.textContent = `⚠️ Exceeded by ${fmtF(Math.abs(left))} — Max pool: ${fmtF(totalPool)}`;
                } else {
                  el.style.cssText = 'font-size:12px;font-weight:600;margin-top:8px;padding:8px 10px;border-radius:var(--radius-xs);color:var(--green);background:rgba(0,230,118,0.08);border:1px solid rgba(0,230,118,0.2);';
                  el.textContent = `Max left: ${fmtF(left)} of ${fmtF(totalPool)}`;
                }
              };

              container.querySelectorAll('.custom-split-input').forEach(inp => {
                inp.addEventListener('input', updateRemaining);
              });
              updateRemaining();
            }
          }
        }
      };
    });

    document.getElementById('btn-run-simulation-calc').onclick = calculateMultiLoanSim;

    // Tab switching
    document.querySelectorAll('#sim-tab-bar .tab-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('#sim-tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.getAttribute('data-sim-tab');
        state.simTab = tab;
        const simWrapper = document.getElementById('sim-simulate-wrapper');
        const compareWrapper = document.getElementById('sim-compare-wrapper');
        if (tab === 'compare') {
          if (simWrapper) simWrapper.style.display = 'none';
          if (compareWrapper) { compareWrapper.style.display = 'block'; renderSimulateCompareTab(); }
        } else {
          if (simWrapper) simWrapper.style.display = 'block';
          if (compareWrapper) compareWrapper.style.display = 'none';
        }
      };
    });

    loadPortfolioLoansForSim();
    refreshSimSections();

    if (state.simTab === 'compare') {
      renderSimulateCompareTab();
    }
  }

  function loadPortfolioLoansForSim() {
    const mainSection = document.getElementById('sim-main-section');
    const checkboxesContainer = document.getElementById('sim-loans-checkboxes');
    const payDateInput = document.getElementById('sim-pay-date');

    if (!state.portfolioId || !mainSection || !checkboxesContainer) {
      if (mainSection) mainSection.style.display = 'none';
      return;
    }

    const loans = S.getLoans(state.portfolioId);
    if (loans.length === 0) {
      checkboxesContainer.innerHTML = '<div class="empty-mini">No loans in this portfolio to simulate. Add loans first.</div>';
      mainSection.style.display = 'block';
      return;
    }

    checkboxesContainer.innerHTML = '';
    loans.forEach(loan => {
      const status = C.getCurrentStatus(loan);
      if (status.outstandingPrincipal <= 1) return; // Skip closed loans

      const div = document.createElement('div');
      div.className = 'sim-loan-item selected';
      div.style.flexWrap = 'wrap';
      div.innerHTML = `
        <input type="checkbox" class="sim-loan-checkbox" data-loan-id="${loan.id}" checked>
        <div class="sim-loan-info" style="flex: 1; min-width: 0;">
          <div class="sim-loan-name">${esc(loan.name)}</div>
          <div class="sim-loan-meta">Outstanding: ${fmt(status.outstandingPrincipal)} · EMI: ${fmt(status.currentEmi)} · ROI: ${status.currentRoi.toFixed(2)}%</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; align-items: flex-end;">
          <div style="font-size: 9px; color: var(--text3);">New EMI (optional)</div>
          <input type="number" class="sim-emi-override" data-loan-id="${loan.id}"
            placeholder="${Math.round(status.currentEmi)}" min="0" style="width: 100px; padding: 5px 8px; border: 1px solid var(--input-border); border-radius: var(--radius-xs); background: var(--input-bg); color: var(--text); font-size: 12px; font-family: inherit; outline: none;">
          <div style="font-size: 9px; color: var(--text3); margin-top: 2px;">For months (0=forever)</div>
          <input type="number" class="sim-emi-duration" data-loan-id="${loan.id}"
            placeholder="0" min="0" style="width: 100px; padding: 5px 8px; border: 1px solid var(--input-border); border-radius: var(--radius-xs); background: var(--input-bg); color: var(--text); font-size: 12px; font-family: inherit; outline: none;">
        </div>
      `;
      // Checkbox visual styling toggle
      const chk = div.querySelector('input[type="checkbox"]');
      chk.onchange = () => {
        div.classList.toggle('selected', chk.checked);
      };
      checkboxesContainer.appendChild(div);
    });

    if (payDateInput && !payDateInput.value) {
      payDateInput.value = today();
    }

    mainSection.style.display = 'block';
  }

  function calculateMultiLoanSim() {
    const totalAmount = parseFloat(document.getElementById('sim-total-amount').value);
    const payDate = document.getElementById('sim-pay-date').value;
    const activeStrategy = document.querySelector('.strategy-grid .strategy-btn.active').getAttribute('data-strategy');

    if (activeStrategy !== 'custom_split' && (isNaN(totalAmount) || totalAmount <= 100)) {
      showToast('Please enter a valid part-payment amount above ₹100', 'error');
      return;
    }
    if (!payDate) {
      showToast('Please enter a valid simulation date', 'error');
      return;
    }

    // Collect custom allocations if custom_split strategy is selected
    let customAllocations = null;
    if (activeStrategy === 'custom_split') {
      customAllocations = {};
      let customTotal = 0;
      document.querySelectorAll('.custom-split-input').forEach(input => {
        const loanId = input.getAttribute('data-loan-id');
        const amount = parseFloat(input.value) || 0;
        customAllocations[loanId] = amount;
        customTotal += amount;
      });
      if (customTotal <= 0) {
        showToast('Please enter at least one custom allocation amount', 'error');
        return;
      }
      // Check if any individual amount exceeds the outstanding for that loan
      let hasExceededOutstanding = false;
      document.querySelectorAll('.custom-split-input').forEach(input => {
        const amount = parseFloat(input.value) || 0;
        const maxAmount = parseFloat(input.getAttribute('data-max')) || 0;
        if (amount > maxAmount + 1) hasExceededOutstanding = true;
      });
      if (hasExceededOutstanding) {
        showToast('Some amounts exceed the outstanding balance for that loan! Reduce allocations.', 'error');
        return;
      }
      const totalPool = parseFloat(document.getElementById('sim-total-amount').value) || 0;
      if (customTotal > totalPool + 0.01) {
        showToast(`Custom split total (${fmtF(customTotal)}) exceeds the part-payment pool (${fmtF(totalPool)})! Reduce allocations.`, 'error');
        return;
      }
    }

    // Collect selected loans
    const selectedLoanIds = [];
    document.querySelectorAll('.sim-loan-checkbox:checked').forEach(chk => {
      selectedLoanIds.push(chk.getAttribute('data-loan-id'));
    });

    if (selectedLoanIds.length === 0) {
      showToast('Please select at least one loan for prepayment', 'error');
      return;
    }

    const allLoans = S.getLoans(state.portfolioId);
    const selectedLoans = allLoans.filter(l => selectedLoanIds.includes(l.id));

    // Collect optional EMI overrides and durations per loan
    const emiOverrides = {};
    const emiDurations = {};
    document.querySelectorAll('.sim-emi-override').forEach(input => {
      const loanId = input.getAttribute('data-loan-id');
      const newEmi = parseFloat(input.value) || 0;
      if (newEmi > 0) emiOverrides[loanId] = newEmi;
    });
    document.querySelectorAll('.sim-emi-duration').forEach(input => {
      const loanId = input.getAttribute('data-loan-id');
      const duration = parseInt(input.value) || 0;
      if (duration > 0) emiDurations[loanId] = duration;
    });

    // Apply EMI overrides to selected loans for simulation
    const selectedLoansForSim = selectedLoans.map(loan => {
      if (emiOverrides[loan.id]) {
        return Object.assign({}, loan, {
          emiOverride: emiOverrides[loan.id],
          emiDuration: emiDurations[loan.id] || 0
        });
      }
      return loan;
    });

    // Run math model
    const simResult = C.simulateMultiLoan(selectedLoansForSim, totalAmount, payDate, activeStrategy, customAllocations);
    state.simPendingData = simResult;

    // Render results in beautiful modal-sim-results
    const resultsContainer = document.getElementById('sim-results-content');
    const subtitleEl = document.getElementById('sim-results-subtitle');
    const applyBtn = document.getElementById('btn-finalize-sim');

    if (!resultsContainer || !subtitleEl || !applyBtn) return;

    subtitleEl.textContent = `Prepayment Pool: ${fmt(totalAmount)} · Strategy: ${activeStrategy.replace('_', ' ').toUpperCase()}`;

    const maxAfterTenure = Math.max.apply(null, simResult.loanResults.map(r => r.after.remainingTenure).concat([0]));

    // Pre-calculate charge info and burden saved for each loan result
    const loanBurdenInfo = simResult.loanResults.map(r => {
      const origLoan = allLoans.find(l => l.id === r.loan.id) || r.loan;
      const isFC = r.after.remainingTenure === 0;
      const ls = C.getCurrentStatus(origLoan);
      const ci = isFC
        ? getApplicableChargeInfo(origLoan, payDate, origLoan.foreclosureCharges, r.allocation, r.before.outstanding, ls.paidEMIs)
        : getApplicableChargeInfo(origLoan, payDate, origLoan.prepayCharges, r.allocation, r.before.outstanding, ls.paidEMIs);
      const ca = r.allocation > 0 ? Math.round(ci.chargedAmt * ci.pct / 100) : 0;
      return { chargeInfo: ci, chargeAmt: ca, burdenSaved: Math.max(0, r.interestSaved - ca) };
    });
    const totalBurdenSaved = loanBurdenInfo.reduce((s, x) => s + x.burdenSaved, 0);

    let html = `
      <div class="savings-banner">
        🎉 Total Burden Saved: <strong>${fmt(totalBurdenSaved)}</strong><br>
        Outstanding Debt reduced to: <strong>${fmt(simResult.portfolio.afterOutstanding)}</strong> (from ${fmt(simResult.portfolio.beforeOutstanding)})<br>
        Max Remaining Tenure: <strong>${C.formatTenure(maxAfterTenure)}</strong>
      </div>

      <div class="section-header">
        <span class="section-title">Recommended Distribution across Loans</span>
      </div>
      <div class="recommendation-card">
        <div class="recommendation-title">Smart Allocations</div>
        ${simResult.loanResults.map((r, i) => `
          <div class="recommendation-item">
            <span class="recommendation-loan">${esc(r.loan.name)}</span>
            <div style="text-align: right;">
              <span class="recommendation-pct">${fmt(r.allocation)} (${Math.round((r.allocation / totalAmount)*100)}%)</span>
              <div class="recommendation-amt" style="font-size: 11px; color: var(--text3);">Burden Saved: ${fmt(loanBurdenInfo[i].burdenSaved)}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="section-header">
        <span class="section-title">Loan Level BEFORE vs AFTER</span>
      </div>
    `;

    simResult.loanResults.forEach((r, i) => {
      const reduction = r.before.remainingTenure - r.after.remainingTenure;
      const emiChanged = Math.abs(r.after.emi - r.before.emi) > 1;

      // Use pre-calculated charge info and burden saved
      const { chargeInfo, chargeAmt, burdenSaved: netBurdenSaved } = loanBurdenInfo[i];
      const isForeclosure = r.after.remainingTenure === 0;

      html += `
        <div class="glass" style="padding: 12px; margin-bottom: 8px;">
          <div style="font-weight: 700; font-size: 13px; color: var(--accent2); margin-bottom: 6px;">${esc(r.loan.name)}</div>
          <div class="comparison-grid">
            <div class="comparison-col">
              <div class="comparison-header">Before Prepayment</div>
              <div class="comparison-row"><span>EMI:</span><strong>${fmt(r.before.emi)}</strong></div>
              <div class="comparison-row"><span>Interest:</span><strong>${fmt(r.before.remainingInterest)}</strong></div>
              <div class="comparison-row"><span>Remaining:</span><strong>${C.formatTenure(r.before.remainingTenure)}</strong></div>
            </div>
            <div class="comparison-col comparison-col-sim">
              <div class="comparison-header">After Prepayment</div>
              <div class="comparison-row"><span>EMI:</span><strong style="${emiChanged ? 'color: var(--green);' : ''}">${fmt(r.after.emi)}</strong></div>
              <div class="comparison-row"><span>Interest:</span><strong>${fmt(r.after.remainingInterest)}</strong></div>
              <div class="comparison-row"><span>Remaining:</span><strong style="${reduction > 0 ? 'color: var(--green);' : ''}">${C.formatTenure(r.after.remainingTenure)}</strong></div>
            </div>
          </div>
          ${chargeInfo.isFree ? `
            <div style="margin-top: 8px; padding: 6px 8px; background: rgba(0,230,118,0.08); border-radius: var(--radius-xs); border: 1px solid rgba(0,230,118,0.2);">
              <div style="font-size: 11px; color: var(--green);">🎁 ${chargeInfo.freeReason}</div>
              <div style="font-size: 12px; color: var(--green); font-weight: 700; margin-top: 3px;">✅ Net Burden Saved: ${fmt(r.interestSaved)} (Zero charges!)</div>
            </div>
          ` : chargeAmt > 0 ? `
            <div style="margin-top: 8px; padding: 6px 8px; background: rgba(249,115,22,0.08); border-radius: var(--radius-xs); border: 1px solid rgba(249,115,22,0.2);">
              <div style="font-size: 11px; color: var(--orange);">💸 ${isForeclosure ? 'Foreclosure' : 'Prepayment'} Charge (${chargeInfo.pct}%): ${fmt(chargeAmt)}${chargeInfo.freeReason ? ` — ${chargeInfo.freeReason}` : ''}</div>
              <div style="font-size: 12px; color: var(--green); font-weight: 700; margin-top: 3px;">✅ Net Burden Saved: ${fmt(netBurdenSaved)}</div>
            </div>
          ` : `
            <div style="font-size: 11px; color: var(--green); font-weight: 600; margin-top: 6px;">✅ Net Burden Saved: ${fmt(r.interestSaved)} (No charges applicable)</div>
          `}
          ${emiChanged ? `
            <div style="font-size: 11px; color: var(--green); font-weight: 600; margin-top: 4px;">
              📈 EMI changed: ${fmt(r.before.emi)} → ${fmt(r.after.emi)}
            </div>
          ` : ''}
          ${reduction > 0 ? `
            <div style="font-size: 11px; color: var(--green); font-weight: 600; margin-top: 4px;">
              ✨ Reduced tenure by ${reduction} installments!
            </div>
          ` : ''}
        </div>
      `;
    });

    html += `
      <div style="margin-top: 16px;">
        <button class="btn btn-outline btn-full" id="btn-save-sim" style="margin-bottom: 8px;">💾 Save Simulation</button>
      </div>
    `;

    resultsContainer.innerHTML = html;
    openModalSheet('modal-sim-results');

    document.getElementById('btn-save-sim').onclick = () => {
      const defaultName = `Sim ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      const simName = prompt('Enter a name for this simulation experiment:', defaultName);
      if (simName === null) return; // User cancelled
      const finalName = simName.trim() || defaultName;
      saveSimulationToStorage({
        id: C.generateId(),
        name: finalName,
        createdAt: new Date().toISOString(),
        portfolioId: state.portfolioId,
        totalAmount: totalAmount,
        payDate: payDate,
        strategy: activeStrategy,
        customAllocations: customAllocations || {},
        emiOverrides: emiOverrides,
        emiDurations: emiDurations
      });
      showToast(`Simulation saved as "${finalName}"!`, 'success');
      refreshSimSections();
    };

    applyBtn.onclick = () => {
      showConfirm(`This will permanently commit these prepayments into the chronological history of the selected loans. Dynamic amortization tables will recalculate from this effective date. Continue?`, () => {
        const changes = [];
        simResult.loanResults.forEach(r => {
          if (r.allocation > 0) {
            const paymentId = C.generateId();
            S.addPartialPayment(r.loan.id, {
              id: paymentId,
              amount: r.allocation,
              date: payDate,
              charges: 0,
              mode: r.loan.prepayOption || 'reduce_tenure',
              note: `Simulated via intelligent allocation Optimizer (${activeStrategy})`
            }, state.portfolioId);
            changes.push({ loanId: r.loan.id, loanName: r.loan.name, paymentId: paymentId, amount: r.allocation, date: payDate });
          }
        });
        addSimHistoryEntry({
          id: C.generateId(),
          name: `Applied ${new Date().toLocaleDateString('en-IN')} ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
          appliedAt: new Date().toISOString(),
          portfolioId: state.portfolioId,
          strategy: activeStrategy,
          totalAmount: totalAmount,
          payDate: payDate,
          changes: changes
        });
        showToast('Prepayments applied permanently!', 'success');
        closeModal();
        navigateTo('portfolio');
      });
    };
  }

  // ── Analytics & Charts Screen ──────────────────────────────────────────────
  function renderAnalytics() {
    const el = document.getElementById('analytics-content');
    const loans = S.getLoans(state.portfolioId);

    if (loans.length === 0) {
      el.innerHTML = `
        <div class="analytics-header">
          <div class="analytics-title">📊 Visual Financial Analytics</div>
        </div>
        <div class="empty-state">
          <div class="empty-icon">📈</div>
          <h3>No Data to Analyze</h3>
          <p>Add dynamic active loans in your portfolio workspace first to see projection charts.</p>
        </div>
      `;
      return;
    }

    const summary = C.getPortfolioSummary(loans);

    let html = `
      <div class="analytics-header">
        <div class="analytics-title">📊 Visual Financial Analytics</div>
      </div>

      <div class="chart-card">
        <div class="chart-card-title">Principal Outstanding vs Remaining Interest</div>
        <div style="position: relative; height: 180px;">
          <canvas id="chart-principal-interest"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-title">Dynamic Debt Amortization Projections</div>
        <div style="position: relative; height: 200px;">
          <canvas id="chart-amortization-timeline"></canvas>
        </div>
      </div>

      <div class="chart-card">
        <div class="chart-card-title">Prepaid Interest Savings & Performance</div>
        <div style="position: relative; height: 180px;">
          <canvas id="chart-savings-bar"></canvas>
        </div>
      </div>
    `;

    el.innerHTML = html;

    // Wait until browser renders DOM and Chart.js is cached/loaded
    setTimeout(() => {
      drawPrincipalInterestChart(summary);
      drawAmortizationTimelineChart(loans);
      drawSavingsBarChart(summary);
    }, 100);
  }

  function drawPrincipalInterestChart(summary) {
    const ctx = document.getElementById('chart-principal-interest');
    if (!ctx) return;

    state.charts['pi'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Outstanding Principal', 'Remaining Interest Cost'],
        datasets: [{
          data: [summary.totalOutstanding, summary.totalRemainingInterest],
          backgroundColor: ['#6366F1', '#F59E0B'],
          borderColor: 'rgba(13,13,26,0.92)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f0f0ff', font: { size: 11 } } }
        }
      }
    });
  }

  function drawAmortizationTimelineChart(loans) {
    const ctx = document.getElementById('chart-amortization-timeline');
    if (!ctx) return;

    // Calculate aggregated portfolio outstanding balance over the next 120 months (10 years)
    const months = 120;
    const labels = [];
    const datasetData = [];

    const d = new Date();
    for (let i = 0; i <= months; i += 12) {
      labels.push(`Year ${Math.round(i/12)}`);
    }

    // Mock trend based on schedules
    for (let i = 0; i <= months; i += 12) {
      let activeOutstanding = 0;
      loans.forEach(loan => {
        const sched = C.generateSchedule(loan);
        const idx = i;
        if (idx < sched.length) activeOutstanding += sched[idx].outstanding;
      });
      datasetData.push(activeOutstanding);
    }

    state.charts['amort'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Outstanding Principal (₹)',
          data: datasetData,
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0,212,255,0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#f0f0ff' } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#f0f0ff' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  function drawSavingsBarChart(summary) {
    const ctx = document.getElementById('chart-savings-bar');
    if (!ctx) return;

    const labels = [];
    const paidData = [];
    const savedData = [];

    summary.statuses.forEach(x => {
      labels.push(x.loan.name);
      paidData.push(x.status.totalInterestPaid);
      savedData.push(x.status.interestSaved);
    });

    state.charts['savings'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Interest Paid', data: paidData, backgroundColor: '#EF4444' },
          { label: 'Interest Saved', data: savedData, backgroundColor: '#10B981' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: '#f0f0ff' } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: '#f0f0ff' } }
        },
        plugins: { legend: { position: 'bottom', labels: { color: '#f0f0ff' } } }
      }
    });
  }

  function createExternalTooltip(chart, tooltip) {
    let el = document.getElementById('chartjs-tooltip-global');
    if (!el) {
      el = document.createElement('div');
      el.id = 'chartjs-tooltip-global';
      el.style.cssText = 'position:fixed;background:rgba(13,13,26,0.97);border:1px solid rgba(255,255,255,0.2);border-radius:10px;padding:10px 14px;color:#f0f0ff;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;pointer-events:none;z-index:99999;box-shadow:0 8px 32px rgba(0,0,0,0.7);transition:opacity 0.15s;min-width:160px;';
      document.body.appendChild(el);
    }
    if (tooltip.opacity === 0) { el.style.opacity = '0'; return; }
    if (tooltip.body) {
      const titles = tooltip.title || [];
      const bodies = tooltip.body.map(b => b.lines);
      let html = '';
      titles.forEach(t => { html += `<div style="font-weight:700;margin-bottom:6px;font-size:13px;">${t}</div>`; });
      bodies.forEach((body, i) => {
        const colors = tooltip.labelColors[i];
        html += `<div style="display:flex;align-items:center;gap:7px;padding:2px 0;"><span style="width:10px;height:10px;background:${colors.backgroundColor};border-radius:2px;flex-shrink:0;"></span><span>${body}</span></div>`;
      });
      el.innerHTML = html;
    }
    const pos = chart.canvas.getBoundingClientRect();
    const x = pos.left + tooltip.caretX;
    const y = pos.top + tooltip.caretY;
    const elW = el.offsetWidth || 180;
    const elH = el.offsetHeight || 80;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    el.style.opacity = '1';
    el.style.left = Math.min(x + 12, vw - elW - 8) + 'px';
    el.style.top = Math.max(y - elH - 8, 8) + 'px';
  }

  function drawLoanCompositionChart(status) {
    const ctx = document.getElementById('chart-loan-composition');
    if (!ctx) return;

    state.charts['loanComp'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: [
          'Principal Paid',
          'Principal Outstanding',
          'Interest Paid',
          'Remaining Interest',
          'Total Charges'
        ],
        datasets: [{
          data: [
            status.totalPrincipalPaid,
            status.outstandingPrincipal,
            status.totalInterestPaid,
            status.remainingInterest,
            status.totalCharges
          ],
          backgroundColor: ['#047857', '#34D399', '#991B1B', '#F87171', '#F97316'],
          borderColor: 'rgba(13,13,26,0.92)',
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: ({ chart, tooltip }) => createExternalTooltip(chart, tooltip)
          }
        }
      }
    });
  }

  function destroyCharts() {
    Object.values(state.charts).forEach(c => {
      if (c) c.destroy();
    });
    state.charts = {};
  }

  // ── Settings & Backup Screen ───────────────────────────────────────────────
  function renderSettings() {
    const el = document.getElementById('settings-content');

    let html = `
      <div class="settings-section">
        <div class="settings-section-title">Visual Layout</div>
        <div class="settings-list">
          <div class="settings-item">
            <div class="settings-item-left">
              <div class="settings-item-icon" style="background: rgba(124,106,255,0.15); color: var(--accent);">🌓</div>
              <div>
                <div class="settings-item-label">Default Mode</div>
                <div class="settings-item-desc">Optimized iOS premium dark style</div>
              </div>
            </div>
            <span class="settings-item-value">Dark Active</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Backup & Restore</div>
        <div class="settings-list">
          <div class="settings-item" onclick="App.exportBackup()">
            <div class="settings-item-left">
              <div class="settings-item-icon" style="background: rgba(0,230,118,0.15); color: var(--green);">📤</div>
              <div>
                <div class="settings-item-label">Export JSON Backup</div>
                <div class="settings-item-desc">Download complete localized portfolios snapshot</div>
              </div>
            </div>
            <div class="settings-item-arrow">➔</div>
          </div>
          <div class="settings-item" style="position: relative;">
            <div class="settings-item-left">
              <div class="settings-item-icon" style="background: rgba(0,212,255,0.15); color: var(--accent2);">📥</div>
              <div>
                <div class="settings-item-label">Import JSON Backup</div>
                <div class="settings-item-desc">Erase current state and restore complete backup file</div>
              </div>
            </div>
            <input type="file" id="file-import-json" style="position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%;" onchange="App.importBackup(event)">
            <div class="settings-item-arrow">➔</div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Sample Playground Data</div>
        <div class="settings-list">
          <div class="settings-item" onclick="App.loadPlaygroundDemoData()">
            <div class="settings-item-left">
              <div class="settings-item-icon" style="background: rgba(255,145,0,0.15); color: var(--orange);">🚀</div>
              <div>
                <div class="settings-item-label">Load Playground Demo Data</div>
                <div class="settings-item-desc">Instantly populate beautiful Home, Personal & Vehicle Loans with historical logs</div>
              </div>
            </div>
            <div class="settings-item-arrow">➔</div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Developer & System</div>
        <div class="settings-list">
          <div class="settings-item" onclick="App.clearStorageForever()">
            <div class="settings-item-left">
              <div class="settings-item-icon" style="background: rgba(255,69,105,0.15); color: var(--red);">🗑️</div>
              <div>
                <div class="settings-item-label" style="color: var(--red);">Wipe LocalStorage Forever</div>
                <div class="settings-item-desc">Clear IndexedDB/Web storage complete offline state</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    el.innerHTML = html;
  }

  // ── Modals Handling ────────────────────────────────────────────────────────
  function setupModalBackdrops() {
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    });
  }

  function setupHeaderButtons() {
    // Nav header is handled dynamically
  }

  function setupModalButtons() {
    // Set up Portfolio Modal Buttons
    document.getElementById('btn-save-portfolio').onclick = savePortfolioModal;
    document.getElementById('btn-save-loan').onclick = saveLoanModal;
    document.getElementById('pay-save-btn').onclick = savePrepaymentModal;
    document.getElementById('roi-save-btn').onclick = saveRoiChangeModal;
    document.getElementById('topup-save-btn').onclick = saveTopUpModal;
    document.getElementById('btn-save-charge').onclick = saveChargeModalForm;
    document.getElementById('btn-save-edit-event').onclick = commitEventEditForm;
  }

  function openModalSheet(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  }

  function closeModal() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  }

  function openPortfolioModal(p = null) {
    closeModal();
    const titleEl = document.getElementById('modal-portfolio-title');
    const nameInput = document.getElementById('portfolio-name');
    const descInput = document.getElementById('portfolio-desc');

    titleEl.textContent = p ? 'Update Portfolio' : 'Create New Portfolio';
    nameInput.value = p ? p.name : '';
    descInput.value = p ? p.description : '';

    // Set active color block select
    document.querySelectorAll('#portfolio-color-picker .color-option').forEach(el => {
      el.classList.remove('selected');
      if (p && el.getAttribute('data-color') === p.color) {
        el.classList.add('selected');
      }
    });

    // Make color clickable
    document.querySelectorAll('#portfolio-color-picker .color-option').forEach(el => {
      el.onclick = () => {
        document.querySelectorAll('#portfolio-color-picker .color-option').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
      };
    });

    document.getElementById('btn-save-portfolio').setAttribute('data-id', p ? p.id : '');
    openModalSheet('modal-portfolio');
  }

  function savePortfolioModal() {
    const id = this.getAttribute('data-id');
    const name = document.getElementById('portfolio-name').value.trim();
    const desc = document.getElementById('portfolio-desc').value.trim();
    const activeColorEl = document.querySelector('#portfolio-color-picker .color-option.selected');
    const color = activeColorEl ? activeColorEl.getAttribute('data-color') : '#6366F1';

    if (!name) {
      showToast('Please enter a valid portfolio reference name!', 'error');
      return;
    }

    if (id) {
      S.updatePortfolio(id, { name: name, description: desc, color: color });
      showToast('Portfolio settings updated', 'success');
    } else {
      const newId = S.createPortfolio(name, desc, color);
      state.portfolioId = newId;
      showToast('New Portfolio Workspace Created', 'success');
    }

    closeModal();
    navigateTo('portfolio');
  }

  function openAddLoanModal(loan = null) {
    closeModal();
    const titleEl = document.getElementById('modal-loan-title');
    const subtitleEl = document.getElementById('modal-loan-subtitle');

    titleEl.textContent = loan ? 'Edit Loan Parameters' : 'Add New Loan Record';
    subtitleEl.textContent = loan ? `Modifying: ${loan.name}` : 'Setup structural dynamic parameters';

    // Form mappings
    document.getElementById('loan-name').value = loan ? loan.name : '';
    document.getElementById('loan-type').value = loan ? loan.type : 'home';
    document.getElementById('loan-lender').value = loan ? (loan.lender || '') : '';
    document.getElementById('loan-principal').value = loan ? loan.principal : '';
    document.getElementById('loan-roi').value = loan ? loan.roi : '';
    document.getElementById('loan-tenure').value = loan ? loan.tenure : '';
    document.getElementById('loan-interest-type').value = loan ? (loan.interestType || 'reducing') : 'reducing';
    document.getElementById('loan-sanction-date').value = loan ? loan.sanctionDate : today();
    document.getElementById('loan-first-emi-date').value = loan ? loan.firstEmiDate : today();
    document.getElementById('loan-emi-override').value = loan ? (loan.emiOverride || '') : '';
    document.getElementById('loan-prepay-mode').value = loan ? (loan.prepayOption || 'reduce_tenure') : 'reduce_tenure';

    // Charges mappings
    document.getElementById('loan-processing-fee').value = '';
    document.getElementById('loan-insurance').value = '';
    document.getElementById('loan-legal-charges').value = '';
    document.getElementById('loan-other-charges').value = '';
    document.getElementById('loan-notes').value = loan ? (loan.notes || '') : '';

    // Prepayment charge slabs
    const ppC = loan ? (loan.prepayCharges || [0,0,0,0,0]) : [0,0,0,0,0];
    ['loan-pp-yr1','loan-pp-yr2','loan-pp-yr3','loan-pp-yr4','loan-pp-yr5'].forEach((id, i) => {
      document.getElementById(id).value = ppC[i] > 0 ? ppC[i] : '';
    });
    // Foreclosure charge slabs
    const fcC = loan ? (loan.foreclosureCharges || [0,0,0,0,0]) : [0,0,0,0,0];
    ['loan-fc-yr1','loan-fc-yr2','loan-fc-yr3','loan-fc-yr4','loan-fc-yr5'].forEach((id, i) => {
      document.getElementById(id).value = fcC[i] > 0 ? fcC[i] : '';
    });
    // Free prepayment policy
    const fpp = loan ? (loan.freePrepayPolicy || {}) : {};
    document.getElementById('loan-free-pp-after').value = fpp.afterEMIs > 0 ? fpp.afterEMIs : '';
    document.getElementById('loan-free-pp-pct').value = fpp.maxPct > 0 ? fpp.maxPct : '';
    document.getElementById('loan-free-pp-gap').value = fpp.minGapEMIs > 0 ? fpp.minGapEMIs : '';

    // Hide preview on start
    document.getElementById('emi-preview-box').style.display = 'none';

    document.getElementById('btn-save-loan').setAttribute('data-id', loan ? loan.id : '');
    openModalSheet('modal-loan');
    updateLoanLivePreview();
  }

  function updateLoanLivePreview() {
    const p = parseFloat(document.getElementById('loan-principal').value);
    const r = parseFloat(document.getElementById('loan-roi').value);
    const t = parseInt(document.getElementById('loan-tenure').value);
    const hintEl = document.getElementById('tenure-years-hint');

    if (t > 0 && hintEl) {
      hintEl.textContent = `${Math.floor(t / 12)} years ${t % 12} months`;
    }

    const previewBox = document.getElementById('emi-preview-box');
    if (p > 0 && r > 0 && t > 0 && previewBox) {
      const emi = C.calculateEMI(p, r, t);
      const totalCost = emi * t;
      const totalInterest = Math.max(0, totalCost - p);

      document.getElementById('preview-emi').textContent = fmtF(emi);
      document.getElementById('preview-total-interest').textContent = fmtF(totalInterest);
      document.getElementById('preview-total-payback').textContent = fmtF(totalCost);
      previewBox.style.display = 'block';
    } else if (previewBox) {
      previewBox.style.display = 'none';
    }
  }

  function saveLoanModal() {
    const id = this.getAttribute('data-id');
    const name = document.getElementById('loan-name').value.trim();
    const principal = parseFloat(document.getElementById('loan-principal').value);
    const roi = parseFloat(document.getElementById('loan-roi').value);
    const tenure = parseInt(document.getElementById('loan-tenure').value);
    const sanctionDate = document.getElementById('loan-sanction-date').value;
    const firstEmiDate = document.getElementById('loan-first-emi-date').value;

    if (!name) { showToast('Please enter a valid loan name', 'error'); return; }
    if (isNaN(principal) || principal <= 0) { showToast('Please enter a valid sanction principal', 'error'); return; }
    if (isNaN(roi) || roi <= 0) { showToast('Please enter a valid interest rate', 'error'); return; }
    if (isNaN(tenure) || tenure <= 0) { showToast('Please enter a valid tenure', 'error'); return; }
    if (!sanctionDate) { showToast('Please select sanction date', 'error'); return; }
    if (!firstEmiDate) { showToast('Please select first EMI date', 'error'); return; }

    const emiOverride = parseFloat(document.getElementById('loan-emi-override').value) || 0;
    const notes = document.getElementById('loan-notes').value.trim();

    // Sanction charges
    const processingFee = parseFloat(document.getElementById('loan-processing-fee').value) || 0;
    const insurance = parseFloat(document.getElementById('loan-insurance').value) || 0;
    const legal = parseFloat(document.getElementById('loan-legal-charges').value) || 0;
    const otherCharges = parseFloat(document.getElementById('loan-other-charges').value) || 0;

    let loan;
    if (id) {
      loan = S.getLoan(id, state.portfolioId);
      loan.name = name;
      loan.type = document.getElementById('loan-type').value;
      loan.lender = document.getElementById('loan-lender').value.trim();
      loan.principal = principal;
      loan.roi = roi;
      loan.tenure = tenure;
      loan.interestType = document.getElementById('loan-interest-type').value;
      loan.sanctionDate = sanctionDate;
      loan.firstEmiDate = firstEmiDate;
      loan.emiOverride = emiOverride;
      loan.prepayOption = document.getElementById('loan-prepay-mode').value;
      loan.notes = notes;
    } else {
      loan = S.createLoanTemplate();
      loan.name = name;
      loan.type = document.getElementById('loan-type').value;
      loan.lender = document.getElementById('loan-lender').value.trim();
      loan.principal = principal;
      loan.roi = roi;
      loan.tenure = tenure;
      loan.interestType = document.getElementById('loan-interest-type').value;
      loan.sanctionDate = sanctionDate;
      loan.firstEmiDate = firstEmiDate;
      loan.emiOverride = emiOverride;
      loan.prepayOption = document.getElementById('loan-prepay-mode').value;
      loan.notes = notes;
    }

    // Capture initial sanction charges
    if (processingFee > 0) loan.charges.push({ id: C.generateId(), name: 'Sanction Processing Fee', type: 'processing_fee', amount: processingFee, date: sanctionDate, notes: 'Sanction time fee' });
    if (insurance > 0) loan.charges.push({ id: C.generateId(), name: 'Sanction Loan Credit Shield Insurance', type: 'insurance', amount: insurance, date: sanctionDate, notes: 'Credit safeguard shield' });
    if (legal > 0) loan.charges.push({ id: C.generateId(), name: 'Sanction Legal/Valuation Charge', type: 'legal', amount: legal, date: sanctionDate, notes: 'Property vetting processing' });
    if (otherCharges > 0) loan.charges.push({ id: C.generateId(), name: 'Miscellaneous Administrative Surcharges', type: 'other', amount: otherCharges, date: sanctionDate, notes: 'Incidentals' });

    // Save prepayment & foreclosure charge slabs
    loan.prepayCharges = ['loan-pp-yr1','loan-pp-yr2','loan-pp-yr3','loan-pp-yr4','loan-pp-yr5']
      .map(id => parseFloat(document.getElementById(id).value) || 0);
    loan.foreclosureCharges = ['loan-fc-yr1','loan-fc-yr2','loan-fc-yr3','loan-fc-yr4','loan-fc-yr5']
      .map(id => parseFloat(document.getElementById(id).value) || 0);
    // Save free prepayment policy
    loan.freePrepayPolicy = {
      afterEMIs: parseInt(document.getElementById('loan-free-pp-after').value) || 0,
      maxPct: parseFloat(document.getElementById('loan-free-pp-pct').value) || 0,
      minGapEMIs: parseInt(document.getElementById('loan-free-pp-gap').value) || 0
    };

    S.saveLoan(loan, state.portfolioId);
    showToast(id ? 'Loan properties successfully updated!' : 'New active loan recorded!', 'success');
    closeModal();
    navigateTo('portfolio');
  }

  function showPaymentModal(loan) {
    closeModal();
    document.getElementById('pay-loan-name').textContent = loan.name;
    document.getElementById('pay-date').value = today();
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-charges').value = '';
    document.getElementById('pay-mode').value = loan.prepayOption || 'reduce_tenure';
    document.getElementById('pay-note').value = '';

    document.getElementById('pay-save-btn').onclick = () => {
      const amount = parseFloat(document.getElementById('pay-amount').value);
      const date = document.getElementById('pay-date').value;
      const charges = parseFloat(document.getElementById('pay-charges').value) || 0;
      const note = document.getElementById('pay-note').value.trim();

      if (isNaN(amount) || amount <= 0) { showToast('Please enter a valid part-payment amount', 'error'); return; }
      if (!date) { showToast('Please select payment date', 'error'); return; }

      S.addPartialPayment(loan.id, { amount: amount, date: date, charges: charges, mode: document.getElementById('pay-mode').value, note: note }, state.portfolioId);
      showToast('Part payment transaction logged', 'success');
      closeModal();
      navigateTo('loan-detail');
    };

    openModalSheet('modal-payment');
  }

  function showRoiModal(loan) {
    closeModal();
    document.getElementById('roi-loan-name').textContent = loan.name;
    document.getElementById('roi-current-display').textContent = `Current ROI rate is: ${loan.roi}% p.a.`;
    document.getElementById('roi-date').value = today();
    document.getElementById('roi-new').value = '';
    document.getElementById('roi-option').value = 'keep_emi';
    document.getElementById('roi-note').value = '';

    document.getElementById('roi-save-btn').onclick = () => {
      const newRoi = parseFloat(document.getElementById('roi-new').value);
      const date = document.getElementById('roi-date').value;
      const note = document.getElementById('roi-note').value.trim();

      if (isNaN(newRoi) || newRoi <= 0) { showToast('Please enter a valid interest rate', 'error'); return; }
      if (!date) { showToast('Please select effective date', 'error'); return; }

      S.addRoiChange(loan.id, { newRoi: newRoi, date: date, option: document.getElementById('roi-option').value, note: note }, state.portfolioId);
      showToast('Dynamic interest rate adjustment applied', 'success');
      closeModal();
      navigateTo('loan-detail');
    };

    openModalSheet('modal-roi');
  }

  function showTopupModal(loan) {
    closeModal();
    document.getElementById('topup-loan-name').textContent = loan.name;
    document.getElementById('topup-date').value = today();
    document.getElementById('topup-amount').value = '';
    document.getElementById('topup-charges').value = '';
    document.getElementById('topup-new-emi').value = '';
    document.getElementById('topup-new-tenure').value = '';
    document.getElementById('topup-note').value = '';

    document.getElementById('topup-save-btn').onclick = () => {
      const amount = parseFloat(document.getElementById('topup-amount').value);
      const date = document.getElementById('topup-date').value;
      const charges = parseFloat(document.getElementById('topup-charges').value) || 0;
      const newEmi = parseFloat(document.getElementById('topup-new-emi').value) || 0;
      const newTenure = parseInt(document.getElementById('topup-new-tenure').value) || 0;
      const note = document.getElementById('topup-note').value.trim();

      if (isNaN(amount) || amount <= 0) { showToast('Please enter a valid top-up disbursement amount', 'error'); return; }
      if (!date) { showToast('Please select disbursement date', 'error'); return; }

      S.addTopUp(loan.id, { amount: amount, date: date, charges: charges, newEmi: newEmi, newTenure: newTenure, note: note }, state.portfolioId);
      showToast('Top-up disbursement added, schedule updated', 'success');
      closeModal();
      navigateTo('loan-detail');
    };

    openModalSheet('modal-topup');
  }

  function showChargeModal(loan) {
    closeModal();
    document.getElementById('charge-loan-name').textContent = loan.name;
    document.getElementById('charge-name').value = '';
    document.getElementById('charge-amount').value = '';
    document.getElementById('charge-date').value = today();
    document.getElementById('charge-notes').value = '';

    document.getElementById('btn-save-charge').onclick = () => {
      const name = document.getElementById('charge-name').value.trim();
      const amount = parseFloat(document.getElementById('charge-amount').value);
      const date = document.getElementById('charge-date').value;
      const type = document.getElementById('charge-type').value;
      const notes = document.getElementById('charge-notes').value.trim();

      if (!name) { showToast('Please enter a valid charge label', 'error'); return; }
      if (isNaN(amount) || amount <= 0) { showToast('Please enter a valid charge amount', 'error'); return; }
      if (!date) { showToast('Please select charge date', 'error'); return; }

      S.addCharge(loan.id, { name: name, amount: amount, date: date, type: type, notes: notes }, state.portfolioId);
      showToast('Fee charge mapped successfully', 'success');
      closeModal();
      navigateTo('loan-detail');
    };

    openModalSheet('modal-charge');
  }

  // ── Event Edit/Delete Chronological Logic ──────────────────────────────────
  function editEvent(type, id) {
    closeModal();
    const loan = S.getLoan(state.loanId, state.portfolioId);
    if (!loan) return;

    state.editingEventId = id;
    state.editingEventType = type;

    const titleEl = document.getElementById('edit-event-title');
    const container = document.getElementById('edit-event-content');
    if (!container || !titleEl) return;

    titleEl.textContent = `Edit Event Parameters`;
    let html = '';

    if (type === 'payment') {
      const item = loan.partialPayments.find(p => p.id === id);
      if (!item) return;
      html = `
        <div class="form-group"><label>Payment Date</label><input type="date" id="ed-date" value="${item.date}"></div>
        <div class="form-group"><label>Amount (₹)</label><input type="number" id="ed-amount" value="${item.amount}"></div>
        <div class="form-group"><label>Incidental Penalty Charges (₹)</label><input type="number" id="ed-charges" value="${item.charges || 0}"></div>
        <div class="form-group"><label>Note</label><input type="text" id="ed-note" value="${esc(item.note || '')}"></div>
      `;
    } else if (type === 'roi') {
      const item = loan.roiChanges.find(r => r.id === id);
      if (!item) return;
      html = `
        <div class="form-group"><label>Effective Date</label><input type="date" id="ed-date" value="${item.date}"></div>
        <div class="form-group"><label>New Interest Rate ROI (%)</label><input type="number" id="ed-roi" value="${item.newRoi}" step="0.01"></div>
        <div class="form-group"><label>Note</label><input type="text" id="ed-note" value="${esc(item.note || '')}"></div>
      `;
    } else if (type === 'topup') {
      const item = loan.topUps.find(t => t.id === id);
      if (!item) return;
      html = `
        <div class="form-group"><label>Disbursement Date</label><input type="date" id="ed-date" value="${item.date}"></div>
        <div class="form-group"><label>Top-Up amount (₹)</label><input type="number" id="ed-amount" value="${item.amount}"></div>
        <div class="form-group"><label>Processing Fees (₹)</label><input type="number" id="ed-charges" value="${item.charges || 0}"></div>
        <div class="form-group"><label>New monthly EMI post-TopUp (₹)</label><input type="number" id="ed-new-emi" value="${item.newEmi || 0}"></div>
        <div class="form-group"><label>Note</label><input type="text" id="ed-note" value="${esc(item.note || '')}"></div>
      `;
    } else if (type === 'charge') {
      const item = loan.charges.find(c => c.id === id);
      if (!item) return;
      html = `
        <div class="form-group"><label>Charge Label</label><input type="text" id="ed-name" value="${esc(item.name)}"></div>
        <div class="form-group"><label>Amount (₹)</label><input type="number" id="ed-amount" value="${item.amount}"></div>
        <div class="form-group"><label>Charge Date</label><input type="date" id="ed-date" value="${item.date}"></div>
        <div class="form-group"><label>Notes</label><input type="text" id="ed-note" value="${esc(item.notes || '')}"></div>
      `;
    }

    container.innerHTML = html;
    openModalSheet('modal-edit-event');
  }

  function commitEventEditForm() {
    const loan = S.getLoan(state.loanId, state.portfolioId);
    if (!loan) return;

    const type = state.editingEventType;
    const id = state.editingEventId;
    const date = document.getElementById('ed-date').value;

    if (!date) { showToast('Please select a valid date', 'error'); return; }

    if (type === 'payment') {
      const amt = parseFloat(document.getElementById('ed-amount').value);
      const chg = parseFloat(document.getElementById('ed-charges').value) || 0;
      const note = document.getElementById('ed-note').value.trim();
      if (isNaN(amt) || amt <= 0) { showToast('Please enter a valid amount', 'error'); return; }

      S.updatePartialPayment(loan.id, id, { date: date, amount: amt, charges: chg, note: note }, state.portfolioId);
    } else if (type === 'roi') {
      const roiVal = parseFloat(document.getElementById('ed-roi').value);
      const note = document.getElementById('ed-note').value.trim();
      if (isNaN(roiVal) || roiVal <= 0) { showToast('Please enter a valid ROI', 'error'); return; }

      S.updateRoiChange(loan.id, id, { date: date, newRoi: roiVal, note: note }, state.portfolioId);
    } else if (type === 'topup') {
      const amt = parseFloat(document.getElementById('ed-amount').value);
      const chg = parseFloat(document.getElementById('ed-charges').value) || 0;
      const newE = parseFloat(document.getElementById('ed-new-emi').value) || 0;
      const note = document.getElementById('ed-note').value.trim();
      if (isNaN(amt) || amt <= 0) { showToast('Please enter a valid amount', 'error'); return; }

      S.updateTopUp(loan.id, id, { date: date, amount: amt, charges: chg, newEmi: newE, note: note }, state.portfolioId);
    } else if (type === 'charge') {
      const name = document.getElementById('ed-name').value.trim();
      const amt = parseFloat(document.getElementById('ed-amount').value);
      const note = document.getElementById('ed-note').value.trim();
      if (!name) { showToast('Please enter a valid label', 'error'); return; }
      if (isNaN(amt) || amt <= 0) { showToast('Please enter a valid amount', 'error'); return; }

      S.updateCharge(loan.id, id, { name: name, amount: amt, date: date, notes: note }, state.portfolioId);
    }

    showToast('Chronological transaction timeline corrected!', 'success');
    closeModal();
    navigateTo('loan-detail');
  }

  function deleteEvent(type, id) {
    const loan = S.getLoan(state.loanId, state.portfolioId);
    if (!loan) return;

    showConfirm(`Are you sure you want to delete this event from the loan timeline? dynamic schedules will instantly recalculate.`, () => {
      if (type === 'payment') S.removePartialPayment(loan.id, id, state.portfolioId);
      if (type === 'roi') S.removeRoiChange(loan.id, id, state.portfolioId);
      if (type === 'topup') S.removeTopUp(loan.id, id, state.portfolioId);
      if (type === 'charge') S.removeCharge(loan.id, id, state.portfolioId);

      showToast('Event removed. Future schedules regenerated.', 'info');
      navigateTo('loan-detail');
    });
  }

  function showConfirm(msg, onConfirm) {
    closeModal();
    document.getElementById('confirm-message').textContent = msg;
    document.getElementById('confirm-ok').onclick = () => {
      onConfirm();
      closeModal();
    };
    openModalSheet('modal-confirm');
  }

  // ── Backup, Export, Settings Actions ───────────────────────────────────────
  function exportBackup() {
    try {
      const dataStr = S.exportData();
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LoanIQ_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast('JSON Snapshot Exported successfully!', 'success');
    } catch (e) {
      showToast('Backup failed: ' + e.message, 'error');
    }
  }

  function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const res = S.importData(e.target.result);
      if (res.success) {
        showToast(`Backup restored! Imported ${res.portfolioCount} portfolios and ${res.loanCount} active loans!`, 'success');
        navigateTo('dashboard');
      } else {
        showToast(`Import failed: ${res.error}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  function clearStorageForever() {
    showConfirm('Warning: This will permanently erase ALL portfolios, loans, topups, and part payment histories. You will lose everything. Continue?', () => {
      S.clearAllData();
      showToast('All local storage wiped. Reloading application...', 'info');
      setTimeout(() => { location.reload(); }, 1200);
    });
  }

  function loadPlaygroundDemoData() {
    showConfirm('This will overwrite current storage with a professional sandbox demo data representing a real-world home loan, top-ups, ROI revisions, and structured part-payments. Proceed?', () => {
      const demoData = {
        version: "3.0",
        activePortfolio: "p_demo",
        portfolios: {
          "p_demo": {
            id: "p_demo",
            name: "Home & Business Workspace",
            description: "Intelligent decision testing playground",
            color: "#6366F1",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            loans: [
              {
                id: "loan_home_1",
                name: "Primary Home Loan",
                type: "home",
                lender: "State Bank of India",
                principal: 4500000,
                roi: 8.4,
                tenure: 240,
                interestType: "reducing",
                sanctionDate: "2024-01-05",
                firstEmiDate: "2024-02-05",
                emiOverride: 0,
                prepayOption: "reduce_tenure",
                notes: "Main home loan under floating rate structure",
                createdAt: new Date().toISOString(),
                partialPayments: [
                  { id: "pp_1", date: "2024-06-15", amount: 250000, charges: 0, mode: "reduce_tenure", note: "Mid-year bonus prepayment" },
                  { id: "pp_2", date: "2025-01-10", amount: 150000, charges: 0, mode: "reduce_tenure", note: "Annual principal trimmer" }
                ],
                roiChanges: [
                  { id: "roi_1", date: "2024-11-05", newRoi: 8.9, option: "keep_emi", note: "RBI rate hike transmission" }
                ],
                topUps: [
                  { id: "top_1", date: "2025-05-15", amount: 300000, charges: 1200, note: "Home renovation credit line expansion" }
                ],
                charges: [
                  { id: "c_1", name: "Documentation Processing Stamp Duties", type: "documentation", amount: 15000, date: "2024-01-05" },
                  { id: "c_2", name: "Comprehensive Home Safeguard Asset Cover", type: "insurance", amount: 45000, date: "2024-01-05" }
                ]
              },
              {
                id: "loan_vehicle_1",
                name: "SUV Auto Finance",
                type: "vehicle",
                lender: "HDFC Car Loans",
                principal: 1500000,
                roi: 9.2,
                tenure: 84,
                interestType: "reducing",
                sanctionDate: "2024-04-10",
                firstEmiDate: "2024-05-10",
                emiOverride: 0,
                prepayOption: "reduce_emi",
                notes: "Family SUV purchase finance",
                createdAt: new Date().toISOString(),
                partialPayments: [],
                roiChanges: [],
                topUps: [],
                charges: [
                  { id: "c_v_1", name: "HDFC Registration Documentation Charges", type: "processing_fee", amount: 6500, date: "2024-04-10" }
                ]
              }
            ]
          }
        }
      };

      localStorage.setItem('loanIQ_v3', JSON.stringify(demoData));
      showToast('Professional Sandbox Data successfully restored!', 'success');
      state.portfolioId = "p_demo";
      navigateTo('dashboard');
    });
  }

  // ── Charge Slab Helper ─────────────────────────────────────────────────────
  // Returns { pct, isFree, freeReason, freeAmt, chargedAmt } based on free prepayment policy + charge slabs
  // Charge is applied ONLY to the portion exceeding the free limit (not the entire allocation)
  function getApplicableChargeInfo(loan, payDate, chargesArray, allocation, outstandingPrincipal, paidEMIs) {
    const policy = loan.freePrepayPolicy || {};
    const basePct = getChargeFromSlabs(chargesArray, loan.sanctionDate, payDate);

    // Check if free prepayment policy applies
    if (policy.afterEMIs > 0 && paidEMIs >= policy.afterEMIs) {
      // Check minimum gap between part payments first
      if (policy.minGapEMIs > 0) {
        const prevPPs = (loan.partialPayments || [])
          .filter(p => new Date(p.date) < new Date(payDate))
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (prevPPs.length > 0) {
          const monthsSinceLast = (new Date(payDate) - new Date(prevPPs[0].date)) / (1000 * 60 * 60 * 24 * 30.44);
          if (monthsSinceLast < policy.minGapEMIs) {
            // Gap not met — charge entire allocation
            return { pct: basePct, isFree: false, freeReason: `Gap < ${policy.minGapEMIs} EMIs (last PP was ${Math.round(monthsSinceLast)} mo ago)`, freeAmt: 0, chargedAmt: allocation };
          }
        }
      }

      // Calculate free and charged portions
      const freeLimit = policy.maxPct > 0 ? Math.round(outstandingPrincipal * policy.maxPct / 100) : allocation;
      const freeAmt = Math.min(allocation, freeLimit);
      const chargedAmt = Math.max(0, allocation - freeLimit);

      if (chargedAmt === 0) {
        // Entire allocation is within free limit — zero charges!
        const reason = `Free policy: after ${policy.afterEMIs} EMIs` +
          (policy.maxPct > 0 ? `, ≤${policy.maxPct}% of outstanding (${fmt(freeLimit)})` : '') +
          (policy.minGapEMIs > 0 ? `, ${policy.minGapEMIs} EMI gap` : '');
        return { pct: 0, isFree: true, freeReason: reason, freeAmt, chargedAmt: 0 };
      } else {
        // Partial free: charge only the excess above the free limit
        const reason = `Partial free: ${fmt(freeAmt)} free (${policy.maxPct}% of outstanding), ${fmt(chargedAmt)} charged at ${basePct}%`;
        return { pct: basePct, isFree: false, freeReason: reason, freeAmt, chargedAmt };
      }
    }

    // No free policy or conditions not met — charge entire allocation
    return { pct: basePct, isFree: false, freeReason: null, freeAmt: 0, chargedAmt: allocation };
  }

  function getChargeFromSlabs(chargesArray, sanctionDate, payDate) {
    if (!chargesArray || chargesArray.every(c => c === 0)) return 0;
    const yearsElapsed = (new Date(payDate) - new Date(sanctionDate)) / (1000 * 60 * 60 * 24 * 365.25);
    if (yearsElapsed < 1) return chargesArray[0] || 0;
    if (yearsElapsed < 2) return chargesArray[1] || 0;
    if (yearsElapsed < 3) return chargesArray[2] || 0;
    if (yearsElapsed < 4) return chargesArray[3] || 0;
    return chargesArray[4] || 0;
  }

  // ── Simulation Compare Tab ─────────────────────────────────────────────────
  function renderSimulateCompareTab() {
    const el = document.getElementById('sim-compare-wrapper');
    if (!el) return;

    const savedSims = getSavedSimulations().filter(s => s.portfolioId === state.portfolioId);

    if (savedSims.length === 0) {
      el.innerHTML = `
        <div class="empty-state" style="padding: 32px 16px;">
          <div class="empty-icon">💾</div>
          <h3>No Saved Simulations</h3>
          <p>Run a simulation and click "💾 Save Simulation" to save it, then compare multiple scenarios here.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="section-header" style="margin-top: 0;">
        <span class="section-title">Select Simulations to Compare</span>
        <span style="font-size: 11px; color: var(--text3);">Select 2–4</span>
      </div>
      ${savedSims.map(sim => `
        <div class="glass" style="padding: 10px 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" class="sim-compare-checkbox" data-sim-id="${sim.id}" style="width: 16px; height: 16px; flex-shrink: 0; cursor: pointer;">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(sim.name)}</div>
            <div style="font-size: 10px; color: var(--text3);">${C.formatDate(new Date(sim.createdAt))} · ${sim.strategy.replace(/_/g, ' ')} · ${fmt(sim.totalAmount)} pool · ${sim.payDate}</div>
          </div>
        </div>
      `).join('')}
      <button class="btn btn-primary btn-full" id="btn-compare-selected" style="margin-top: 12px;">
        📊 Compare Selected Simulations
      </button>
    `;

    document.getElementById('btn-compare-selected').onclick = compareSelectedSims;
  }

  function compareSelectedSims() {
    const selectedIds = [];
    document.querySelectorAll('.sim-compare-checkbox:checked').forEach(chk => {
      selectedIds.push(chk.getAttribute('data-sim-id'));
    });

    if (selectedIds.length < 2) {
      showToast('Please select at least 2 simulations to compare', 'error');
      return;
    }
    if (selectedIds.length > 4) {
      showToast('Please select at most 4 simulations to compare', 'error');
      return;
    }

    const savedSims = getSavedSimulations();
    const selectedSims = selectedIds.map(id => savedSims.find(s => s.id === id)).filter(Boolean);
    const allLoans = S.getLoans(state.portfolioId);

    // Re-run each simulation
    const results = selectedSims.map(sim => {
      const loansForSim = allLoans.map(loan => {
        if (sim.emiOverrides && sim.emiOverrides[loan.id]) {
          return Object.assign({}, loan, {
            emiOverride: sim.emiOverrides[loan.id],
            emiDuration: sim.emiDurations ? (sim.emiDurations[loan.id] || 0) : 0
          });
        }
        return loan;
      });
      const simResult = C.simulateMultiLoan(loansForSim, sim.totalAmount, sim.payDate, sim.strategy, sim.customAllocations || null);
      return { sim, result: simResult };
    });

    // Render comparison in modal
    const resultsContainer = document.getElementById('sim-results-content');
    const subtitleEl = document.getElementById('sim-results-subtitle');
    const applyBtn = document.getElementById('btn-finalize-sim');
    if (!resultsContainer || !subtitleEl || !applyBtn) return;

    subtitleEl.textContent = `Comparing ${selectedSims.length} Saved Simulations`;
    applyBtn.style.display = 'none';

    // Calculate total burden saved for each simulation (interest saved - applicable charges)
    const simBurdenSaved = results.map(r => {
      let totalBurden = 0;
      r.result.loanResults.forEach(lr => {
        const origLoan = allLoans.find(l => l.id === lr.loan.id) || lr.loan;
        const isFC = lr.after.remainingTenure === 0;
        const ls = C.getCurrentStatus(origLoan);
        const ci = isFC
          ? getApplicableChargeInfo(origLoan, r.sim.payDate, origLoan.foreclosureCharges, lr.allocation, lr.before.outstanding, ls.paidEMIs)
          : getApplicableChargeInfo(origLoan, r.sim.payDate, origLoan.prepayCharges, lr.allocation, lr.before.outstanding, ls.paidEMIs);
        const ca = lr.allocation > 0 ? Math.round(ci.chargedAmt * ci.pct / 100) : 0;
        totalBurden += Math.max(0, lr.interestSaved - ca);
      });
      return totalBurden;
    });

    // Portfolio-level comparison table
    let html = `
      <div class="section-header" style="margin-top: 0;"><span class="section-title">Portfolio-Level Comparison</span></div>
      <div style="overflow-x: auto; margin-bottom: 16px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; min-width: 320px;">
          <thead>
            <tr>
              <th style="text-align: left; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--text2); font-size: 10px; text-transform: uppercase; min-width: 90px;">Metric</th>
              ${results.map(r => `<th style="text-align: right; padding: 8px 6px; border-bottom: 1px solid rgba(255,255,255,0.1); color: var(--accent2); font-size: 11px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(r.sim.name)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr><td style="padding:5px 6px;color:var(--text3);">Strategy</td>${results.map(r => `<td style="text-align:right;padding:5px 6px;color:var(--text);font-size:11px;">${r.sim.strategy.replace(/_/g,' ')}</td>`).join('')}</tr>
            <tr><td style="padding:5px 6px;color:var(--text3);">Pool Amount</td>${results.map(r => `<td style="text-align:right;padding:5px 6px;color:var(--text);">${fmt(r.sim.totalAmount)}</td>`).join('')}</tr>
            <tr><td style="padding:5px 6px;color:var(--text3);">Pay Date</td>${results.map(r => `<td style="text-align:right;padding:5px 6px;color:var(--text);font-size:11px;">${r.sim.payDate}</td>`).join('')}</tr>
            <tr style="background:rgba(0,230,118,0.06);">
              <td style="padding:5px 6px;color:var(--green);font-weight:700;">🎉 Burden Saved</td>
              ${results.map((r, i) => `<td style="text-align:right;padding:5px 6px;color:var(--green);font-weight:800;">${fmt(simBurdenSaved[i])}</td>`).join('')}
            </tr>
            <tr><td style="padding:5px 6px;color:var(--text3);">Outstanding Reduced</td>${results.map(r => `<td style="text-align:right;padding:5px 6px;color:var(--text);">${fmt(r.result.portfolio.outstandingReduced)}</td>`).join('')}</tr>
            <tr><td style="padding:5px 6px;color:var(--text3);">After Outstanding</td>${results.map(r => `<td style="text-align:right;padding:5px 6px;color:var(--text);">${fmt(r.result.portfolio.afterOutstanding)}</td>`).join('')}</tr>
          </tbody>
        </table>
      </div>
    `;

    // Per-loan comparison
    const allLoanNames = [...new Set(results.flatMap(r => r.result.loanResults.map(lr => lr.loan.name)))];
    html += `<div class="section-header" style="margin-top: 0;"><span class="section-title">Per-Loan Impact</span></div>`;

    allLoanNames.forEach(loanName => {
      html += `
        <div class="glass" style="padding: 10px 12px; margin-bottom: 8px;">
          <div style="font-weight: 700; font-size: 12px; color: var(--accent2); margin-bottom: 8px;">${esc(loanName)}</div>
          <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11px; min-width: 280px;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:3px 5px;color:var(--text3);font-size:10px;">Metric</th>
                  ${results.map(r => `<th style="text-align:right;padding:3px 5px;color:var(--text2);font-size:10px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.sim.name)}</th>`).join('')}
                </tr>
              </thead>
              <tbody>
                <tr><td style="padding:3px 5px;color:var(--text3);">Allocation</td>${results.map(r => { const lr = r.result.loanResults.find(l => l.loan.name === loanName); return `<td style="text-align:right;padding:3px 5px;color:var(--text);">${lr && lr.allocation > 0 ? fmt(lr.allocation) : '—'}</td>`; }).join('')}</tr>
                <tr><td style="padding:3px 5px;color:var(--green);">Interest Saved</td>${results.map(r => { const lr = r.result.loanResults.find(l => l.loan.name === loanName); return `<td style="text-align:right;padding:3px 5px;color:var(--green);font-weight:600;">${lr ? fmt(lr.interestSaved) : '—'}</td>`; }).join('')}</tr>
                <tr><td style="padding:3px 5px;color:var(--text3);">After EMI</td>${results.map(r => { const lr = r.result.loanResults.find(l => l.loan.name === loanName); return `<td style="text-align:right;padding:3px 5px;color:var(--text);">${lr ? fmt(lr.after.emi) : '—'}</td>`; }).join('')}</tr>
                <tr><td style="padding:3px 5px;color:var(--text3);">Remaining</td>${results.map(r => { const lr = r.result.loanResults.find(l => l.loan.name === loanName); return `<td style="text-align:right;padding:3px 5px;color:var(--text);">${lr ? C.formatTenure(lr.after.remainingTenure) : '—'}</td>`; }).join('')}</tr>
              </tbody>
            </table>
          </div>
        </div>
      `;
    });

    resultsContainer.innerHTML = html;
    applyBtn.style.display = 'none';
    openModalSheet('modal-sim-results');
  }

  // ── Simulation Save/History Helpers ────────────────────────────────────────
  function getSavedSimulations() {
    try { return JSON.parse(localStorage.getItem('loanIQ_saved_sims') || '[]'); } catch { return []; }
  }
  function saveSimulationToStorage(sim) {
    const sims = getSavedSimulations();
    sims.unshift(sim);
    localStorage.setItem('loanIQ_saved_sims', JSON.stringify(sims.slice(0, 20)));
  }
  function deleteSavedSimulation(id) {
    localStorage.setItem('loanIQ_saved_sims', JSON.stringify(getSavedSimulations().filter(s => s.id !== id)));
    refreshSimSections();
  }
  function getSimHistory() {
    try { return JSON.parse(localStorage.getItem('loanIQ_sim_history') || '[]'); } catch { return []; }
  }
  function addSimHistoryEntry(entry) {
    const history = getSimHistory();
    history.unshift(entry);
    localStorage.setItem('loanIQ_sim_history', JSON.stringify(history.slice(0, 50)));
  }
  function revertSimulation(id) {
    const history = getSimHistory();
    const entry = history.find(h => h.id === id);
    if (!entry) return;
    showConfirm(`Revert "${entry.name}"? This will remove ${entry.changes.length} part payment(s) that were applied via this simulation.`, () => {
      entry.changes.forEach(change => {
        S.removePartialPayment(change.loanId, change.paymentId, entry.portfolioId);
      });
      localStorage.setItem('loanIQ_sim_history', JSON.stringify(history.filter(h => h.id !== id)));
      showToast('Simulation reverted successfully!', 'success');
      refreshSimSections();
    });
  }
  function loadSavedSimulation(id) {
    const sim = getSavedSimulations().find(s => s.id === id);
    if (!sim) return;
    state.portfolioId = sim.portfolioId;
    navigateTo('simulate');
    setTimeout(() => {
      const portfolioSelect = document.getElementById('sim-portfolio-selector');
      if (portfolioSelect) { portfolioSelect.value = sim.portfolioId; loadPortfolioLoansForSim(); }
      setTimeout(() => {
        const totalAmountInput = document.getElementById('sim-total-amount');
        const payDateInput = document.getElementById('sim-pay-date');
        if (totalAmountInput) totalAmountInput.value = sim.totalAmount;
        if (payDateInput) payDateInput.value = sim.payDate;
        document.querySelectorAll('.strategy-grid .strategy-btn').forEach(btn => {
          btn.classList.toggle('active', btn.getAttribute('data-strategy') === sim.strategy);
        });
        if (sim.emiOverrides) {
          Object.entries(sim.emiOverrides).forEach(([loanId, emi]) => {
            const input = document.querySelector(`.sim-emi-override[data-loan-id="${loanId}"]`);
            if (input) input.value = emi;
          });
        }
        if (sim.emiDurations) {
          Object.entries(sim.emiDurations).forEach(([loanId, duration]) => {
            const input = document.querySelector(`.sim-emi-duration[data-loan-id="${loanId}"]`);
            if (input) input.value = duration;
          });
        }
        // If strategy is custom_split, trigger the click to show and populate custom split inputs
        if (sim.strategy === 'custom_split' && sim.customAllocations && Object.keys(sim.customAllocations).length > 0) {
          const customSplitBtn = document.querySelector('.strategy-btn[data-strategy="custom_split"]');
          if (customSplitBtn) {
            customSplitBtn.click();
            setTimeout(() => {
              Object.entries(sim.customAllocations).forEach(([loanId, amount]) => {
                if (amount > 0) {
                  const input = document.querySelector(`.custom-split-input[data-loan-id="${loanId}"]`);
                  if (input) {
                    input.value = amount;
                    input.dispatchEvent(new Event('input'));
                  }
                }
              });
            }, 150);
          }
        }
        showToast(`Simulation "${sim.name}" loaded!`, 'success');
      }, 200);
    }, 100);
  }
  function refreshSimSections() {
    const savedSims = getSavedSimulations().filter(s => s.portfolioId === state.portfolioId);
    const savedEl = document.getElementById('sim-saved-section');
    if (savedEl) {
      if (savedSims.length === 0) { savedEl.innerHTML = ''; }
      else {
        savedEl.innerHTML = `
          <div class="section-header" style="margin-top: 0;"><span class="section-title">💾 Saved Simulations</span></div>
          ${savedSims.map(sim => `
            <div class="glass" style="padding: 10px 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 10px;">
              <div style="flex: 1; min-width: 0;">
                <div style="font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(sim.name)}</div>
                <div style="font-size: 10px; color: var(--text3);">${C.formatDate(new Date(sim.createdAt))} · ${sim.strategy.replace(/_/g, ' ')} · ${fmt(sim.totalAmount)} pool</div>
              </div>
              <button class="btn btn-xs btn-outline" onclick="App.loadSavedSimulation('${sim.id}')">Load</button>
              <button class="btn btn-xs btn-danger" onclick="App.deleteSavedSimulation('${sim.id}')">✕</button>
            </div>
          `).join('')}
        `;
      }
    }
    const history = getSimHistory().filter(h => h.portfolioId === state.portfolioId);
    const histEl = document.getElementById('sim-history-section');
    if (histEl) {
      if (history.length === 0) { histEl.innerHTML = ''; }
      else {
        histEl.innerHTML = `
          <div class="section-header" style="margin-top: 0;"><span class="section-title">📋 Applied History</span></div>
          ${history.map(entry => `
            <div class="glass" style="padding: 10px 12px; margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                <div style="flex: 1; min-width: 0;">
                  <div style="font-size: 13px; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(entry.name)}</div>
                  <div style="font-size: 10px; color: var(--text3);">${C.formatDate(new Date(entry.appliedAt))} · ${fmt(entry.totalAmount)} applied</div>
                </div>
                <button class="btn btn-xs btn-danger" onclick="App.revertSimulation('${entry.id}')">↩️ Revert</button>
              </div>
              <div style="font-size: 10px; color: var(--text3);">
                ${entry.changes.map(c => `${esc(c.loanName)}: ${fmt(c.amount)}`).join(' · ')}
              </div>
            </div>
          `).join('')}
        `;
      }
    }
  }

  // ── Toast Messages ─────────────────────────────────────────────────────────
  function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    if (!toast) return;

    toast.className = `toast toast-${type} show`;
    toast.textContent = msg;

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }

  return {
    init: init,
    navigateTo: navigateTo,
    editEvent: editEvent,
    deleteEvent: deleteEvent,
    exportBackup: exportBackup,
    importBackup: importBackup,
    clearStorageForever: clearStorageForever,
    loadPlaygroundDemoData: loadPlaygroundDemoData,
    closeModal: closeModal,
    loadSavedSimulation: loadSavedSimulation,
    deleteSavedSimulation: deleteSavedSimulation,
    revertSimulation: revertSimulation
  };
})();

// Bootstrap
window.onload = () => {
  App.init();
};
