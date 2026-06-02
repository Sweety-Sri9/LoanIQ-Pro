'use strict';

const LoanStorage = (() => {
  const STORAGE_KEY = 'loanIQ_v3';
  const SETTINGS_KEY = 'loanIQ_settings';
  const CURRENT_VERSION = '3.0';

  function normalizeLoan(loan) {
    if (!loan) return loan;
    if (!loan.topUps) loan.topUps = [];
    if (!loan.roiChanges) loan.roiChanges = [];
    if (!loan.partialPayments) loan.partialPayments = [];
    if (!loan.charges) loan.charges = [];
    if (!loan.type) loan.type = 'other';
    if (!loan.interestType) loan.interestType = 'reducing';
    if (!loan.prepayOption) loan.prepayOption = 'reduce_tenure';
    if (loan.emiOverride === undefined) loan.emiOverride = 0;
    if (loan.insuranceAmount === undefined) loan.insuranceAmount = 0;
    // Prepayment & foreclosure charge slabs [<1yr, 1-2yr, 2-3yr, 3-4yr, 4+yr] as %
    if (!loan.prepayCharges) loan.prepayCharges = [0, 0, 0, 0, 0];
    if (!loan.foreclosureCharges) loan.foreclosureCharges = [0, 0, 0, 0, 0];
    // Free prepayment policy (e.g. "free up to 25% after 12 EMIs, 12 EMI gap")
    if (!loan.freePrepayPolicy) loan.freePrepayPolicy = { afterEMIs: 0, maxPct: 0, minGapEMIs: 0 };
    return loan;
  }

  function migrateData(data) {
    if (!data) return createDefaultData();

    // Migrate from v1 (flat loans array)
    if (!data.version || data.version === '1.0' || data.loans) {
      const loans = (data.loans || []).map(normalizeLoan);
      const wsId = 'ws_default';
      return {
        version: CURRENT_VERSION,
        portfolios: {
          [wsId]: {
            id: wsId,
            name: 'My Loans',
            description: '',
            color: '#6366F1',
            loans: loans,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        },
        activePortfolio: wsId
      };
    }

    // Migrate from v2 (workspaces)
    if (data.workspaces && !data.portfolios) {
      const portfolios = {};
      Object.values(data.workspaces).forEach(function(ws) {
        portfolios[ws.id] = {
          id: ws.id,
          name: ws.name,
          description: '',
          color: '#6366F1',
          loans: (ws.loans || []).map(normalizeLoan),
          createdAt: ws.createdAt || new Date().toISOString(),
          updatedAt: ws.updatedAt || new Date().toISOString()
        };
      });
      return {
        version: CURRENT_VERSION,
        portfolios: portfolios,
        activePortfolio: data.activeWorkspace || Object.keys(portfolios)[0]
      };
    }

    // Already v3 — normalize loans
    if (data.portfolios) {
      Object.values(data.portfolios).forEach(function(p) {
        p.loans = (p.loans || []).map(normalizeLoan);
      });
    }

    data.version = CURRENT_VERSION;
    return data;
  }

  function createDefaultData() {
    return {
      version: CURRENT_VERSION,
      portfolios: {
        'ws_default': {
          id: 'ws_default',
          name: 'My Loans',
          description: '',
          color: '#6366F1',
          loans: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      },
      activePortfolio: 'ws_default'
    };
  }

  function loadData() {
    try {
      // Try v3 format first
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return migrateData(parsed);
      }
      // Try v2 format
      const v2raw = localStorage.getItem('loanTrackerV2');
      if (v2raw) {
        const v2parsed = JSON.parse(v2raw);
        const migrated = migrateData(v2parsed);
        saveData(migrated);
        return migrated;
      }
      // Try v1 format
      const v1raw = localStorage.getItem('loanTrackerData');
      if (v1raw) {
        const v1parsed = JSON.parse(v1raw);
        const migrated = migrateData(v1parsed);
        saveData(migrated);
        return migrated;
      }
      return createDefaultData();
    } catch (e) {
      console.error('Failed to load data:', e);
      return createDefaultData();
    }
  }

  function saveData(data) {
    try {
      data.version = CURRENT_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Failed to save data:', e);
      return false;
    }
  }

  // ── Portfolio Operations ───────────────────────────────────────────────────
  function getPortfolios() {
    return loadData().portfolios || {};
  }

  function getActivePortfolioId() {
    const data = loadData();
    const id = data.activePortfolio || 'ws_default';
    if (!data.portfolios[id]) {
      return Object.keys(data.portfolios)[0] || 'ws_default';
    }
    return id;
  }

  function getActivePortfolio() {
    const data = loadData();
    const id = getActivePortfolioId();
    return data.portfolios[id] || null;
  }

  function setActivePortfolio(id) {
    const data = loadData();
    if (data.portfolios[id]) {
      data.activePortfolio = id;
      return saveData(data);
    }
    return false;
  }

  function createPortfolio(name, description, color) {
    const data = loadData();
    const id = 'ws_' + LoanCalculator.generateId();
    data.portfolios[id] = {
      id: id,
      name: name || 'New Portfolio',
      description: description || '',
      color: color || '#6366F1',
      loans: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    data.activePortfolio = id;
    saveData(data);
    return id;
  }

  function updatePortfolio(id, updates) {
    const data = loadData();
    if (!data.portfolios[id]) return false;
    Object.assign(data.portfolios[id], updates, { updatedAt: new Date().toISOString() });
    return saveData(data);
  }

  function deletePortfolio(id) {
    const data = loadData();
    const keys = Object.keys(data.portfolios);
    if (keys.length <= 1) return false;
    delete data.portfolios[id];
    if (data.activePortfolio === id) {
      data.activePortfolio = Object.keys(data.portfolios)[0];
    }
    return saveData(data);
  }

  // ── Loan Operations ───────────────────────────────────────────────────────
  function getLoans(portfolioId) {
    const data = loadData();
    const pid = portfolioId || data.activePortfolio;
    return (data.portfolios[pid] && data.portfolios[pid].loans) || [];
  }

  function getLoan(id, portfolioId) {
    return getLoans(portfolioId).find(function(l) { return l.id === id; }) || null;
  }

  function saveLoan(loan, portfolioId) {
    const data = loadData();
    const pid = portfolioId || data.activePortfolio;
    if (!data.portfolios[pid]) return false;
    const idx = data.portfolios[pid].loans.findIndex(function(l) { return l.id === loan.id; });
    if (idx >= 0) {
      data.portfolios[pid].loans[idx] = loan;
    } else {
      data.portfolios[pid].loans.push(loan);
    }
    data.portfolios[pid].updatedAt = new Date().toISOString();
    return saveData(data);
  }

  function deleteLoan(id, portfolioId) {
    const data = loadData();
    const pid = portfolioId || data.activePortfolio;
    if (!data.portfolios[pid]) return false;
    data.portfolios[pid].loans = data.portfolios[pid].loans.filter(function(l) { return l.id !== id; });
    data.portfolios[pid].updatedAt = new Date().toISOString();
    return saveData(data);
  }

  // ── ROI Changes ───────────────────────────────────────────────────────────
  function addRoiChange(loanId, roiChange, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    if (!loan.roiChanges) loan.roiChanges = [];
    roiChange.id = roiChange.id || LoanCalculator.generateId();
    roiChange.createdAt = roiChange.createdAt || new Date().toISOString();
    loan.roiChanges.push(roiChange);
    loan.roiChanges.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    return saveLoan(loan, portfolioId);
  }

  function updateRoiChange(loanId, roiId, updates, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    const idx = (loan.roiChanges || []).findIndex(function(r) { return r.id === roiId; });
    if (idx < 0) return false;
    loan.roiChanges[idx] = Object.assign({}, loan.roiChanges[idx], updates);
    loan.roiChanges.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    return saveLoan(loan, portfolioId);
  }

  function removeRoiChange(loanId, roiChangeId, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    loan.roiChanges = (loan.roiChanges || []).filter(function(r) { return r.id !== roiChangeId; });
    return saveLoan(loan, portfolioId);
  }

  // ── Partial Payments ──────────────────────────────────────────────────────
  function addPartialPayment(loanId, payment, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    if (!loan.partialPayments) loan.partialPayments = [];
    payment.id = payment.id || LoanCalculator.generateId();
    payment.createdAt = payment.createdAt || new Date().toISOString();
    loan.partialPayments.push(payment);
    loan.partialPayments.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    return saveLoan(loan, portfolioId);
  }

  function updatePartialPayment(loanId, paymentId, updates, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    const idx = (loan.partialPayments || []).findIndex(function(p) { return p.id === paymentId; });
    if (idx < 0) return false;
    loan.partialPayments[idx] = Object.assign({}, loan.partialPayments[idx], updates);
    return saveLoan(loan, portfolioId);
  }

  function removePartialPayment(loanId, paymentId, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    loan.partialPayments = (loan.partialPayments || []).filter(function(p) { return p.id !== paymentId; });
    return saveLoan(loan, portfolioId);
  }

  // ── Top-Up Operations ─────────────────────────────────────────────────────
  function addTopUp(loanId, topUp, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    if (!loan.topUps) loan.topUps = [];
    topUp.id = topUp.id || LoanCalculator.generateId();
    topUp.createdAt = topUp.createdAt || new Date().toISOString();
    loan.topUps.push(topUp);
    loan.topUps.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    return saveLoan(loan, portfolioId);
  }

  function updateTopUp(loanId, topUpId, updates, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    const idx = (loan.topUps || []).findIndex(function(t) { return t.id === topUpId; });
    if (idx < 0) return false;
    loan.topUps[idx] = Object.assign({}, loan.topUps[idx], updates);
    return saveLoan(loan, portfolioId);
  }

  function removeTopUp(loanId, topUpId, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    loan.topUps = (loan.topUps || []).filter(function(t) { return t.id !== topUpId; });
    return saveLoan(loan, portfolioId);
  }

  // ── Charges ───────────────────────────────────────────────────────────────
  function addCharge(loanId, charge, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    if (!loan.charges) loan.charges = [];
    charge.id = charge.id || LoanCalculator.generateId();
    charge.createdAt = charge.createdAt || new Date().toISOString();
    loan.charges.push(charge);
    loan.charges.sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
    return saveLoan(loan, portfolioId);
  }

  function updateCharge(loanId, chargeId, updates, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    const idx = (loan.charges || []).findIndex(function(c) { return c.id === chargeId; });
    if (idx < 0) return false;
    loan.charges[idx] = Object.assign({}, loan.charges[idx], updates);
    return saveLoan(loan, portfolioId);
  }

  function removeCharge(loanId, chargeId, portfolioId) {
    const loan = getLoan(loanId, portfolioId);
    if (!loan) return false;
    loan.charges = (loan.charges || []).filter(function(c) { return c.id !== chargeId; });
    return saveLoan(loan, portfolioId);
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return getDefaultSettings();
      return Object.assign(getDefaultSettings(), JSON.parse(raw));
    } catch (e) {
      return getDefaultSettings();
    }
  }

  function getDefaultSettings() {
    return {
      theme: 'dark',
      defaultPrepayMode: 'reduce_tenure',
      currency: 'INR',
      dateFormat: 'DD MMM YYYY'
    };
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ── Export / Import ───────────────────────────────────────────────────────
  function exportData() {
    const data = loadData();
    const settings = getSettings();
    return JSON.stringify({
      appName: 'LoanIQ',
      version: CURRENT_VERSION,
      exportedAt: new Date().toISOString(),
      data: data,
      settings: settings
    }, null, 2);
  }

  function importData(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      const raw = parsed.data || parsed;
      const migrated = migrateData(raw);
      saveData(migrated);
      if (parsed.settings) saveSettings(parsed.settings);
      const total = Object.values(migrated.portfolios).reduce(function(s, p) {
        return s + (p.loans || []).length;
      }, 0);
      return { success: true, portfolioCount: Object.keys(migrated.portfolios).length, loanCount: total };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  function clearAllData() {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  }

  // ── Loan Template ─────────────────────────────────────────────────────────
  function createLoanTemplate() {
    const today = new Date();
    const firstEmi = new Date(today);
    firstEmi.setMonth(firstEmi.getMonth() + 1);
    firstEmi.setDate(5);
    return {
      id: LoanCalculator.generateId(),
      name: '',
      type: 'home',
      lender: '',
      principal: 0,
      roi: 8.5,
      tenure: 240,
      interestType: 'reducing',
      sanctionDate: today.toISOString().split('T')[0],
      firstEmiDate: firstEmi.toISOString().split('T')[0],
      emiOverride: 0,
      prepayOption: 'reduce_tenure',
      prepayCharges: [0, 0, 0, 0, 0],       // % of part-pay amount: [<1yr, 1-2yr, 2-3yr, 3-4yr, 4+yr]
      foreclosureCharges: [0, 0, 0, 0, 0],   // % of outstanding: [<1yr, 1-2yr, 2-3yr, 3-4yr, 4+yr]
      freePrepayPolicy: { afterEMIs: 0, maxPct: 0, minGapEMIs: 0 }, // free prepayment policy
      roiChanges: [],
      partialPayments: [],
      topUps: [],
      charges: [],
      notes: '',
      createdAt: new Date().toISOString()
    };
  }

  // ── Backward compatibility aliases ────────────────────────────────────────
  function getWorkspaces() { return getPortfolios(); }
  function getActiveWorkspaceId() { return getActivePortfolioId(); }
  function getActiveWorkspace() { return getActivePortfolio(); }
  function setActiveWorkspace(id) { return setActivePortfolio(id); }
  function createWorkspace(name) { return createPortfolio(name); }
  function renameWorkspace(id, name) { return updatePortfolio(id, { name: name }); }
  function deleteWorkspace(id) { return deletePortfolio(id); }

  return {
    // Portfolio
    getPortfolios: getPortfolios,
    getActivePortfolioId: getActivePortfolioId,
    getActivePortfolio: getActivePortfolio,
    setActivePortfolio: setActivePortfolio,
    createPortfolio: createPortfolio,
    updatePortfolio: updatePortfolio,
    deletePortfolio: deletePortfolio,
    // Backward compat
    getWorkspaces: getWorkspaces,
    getActiveWorkspaceId: getActiveWorkspaceId,
    getActiveWorkspace: getActiveWorkspace,
    setActiveWorkspace: setActiveWorkspace,
    createWorkspace: createWorkspace,
    renameWorkspace: renameWorkspace,
    deleteWorkspace: deleteWorkspace,
    // Loans
    getLoans: getLoans,
    getLoan: getLoan,
    saveLoan: saveLoan,
    deleteLoan: deleteLoan,
    // ROI
    addRoiChange: addRoiChange,
    updateRoiChange: updateRoiChange,
    removeRoiChange: removeRoiChange,
    // Payments
    addPartialPayment: addPartialPayment,
    updatePartialPayment: updatePartialPayment,
    removePartialPayment: removePartialPayment,
    // Top-ups
    addTopUp: addTopUp,
    updateTopUp: updateTopUp,
    removeTopUp: removeTopUp,
    // Charges
    addCharge: addCharge,
    updateCharge: updateCharge,
    removeCharge: removeCharge,
    // Settings
    getSettings: getSettings,
    saveSettings: saveSettings,
    // Export/Import
    exportData: exportData,
    importData: importData,
    clearAllData: clearAllData,
    // Template
    createLoanTemplate: createLoanTemplate,
    normalizeLoan: normalizeLoan
  };
})();
