const Storage = (() => {
    const DB_KEY = 'loaniq_db_v3'; 
    
    let db = {
        version: "3.0",
        activePortfolio: null,
        portfolios: {}
    };

    const load = () => {
        try {
            const data = localStorage.getItem(DB_KEY);
            if (data) {
                db = JSON.parse(data);
            } else {
                loadDemoData();
            }
        } catch (e) {
            console.error("Storage corruption detected. Reinitializing...", e);
            loadDemoData();
        }
    };

    const save = () => {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
    };

    const loadDemoData = () => {
        const pid = 'portfolio_demo';
        db.portfolios = {
            [pid]: {
                id: pid,
                name: "Home & Business Workspace",
                loans: [
                    {
                        id: 'loan_home',
                        name: "Primary Home Loan",
                        lender: "SBI",
                        principal: 4500000,
                        roi: 8.4,
                        tenure: 240,
                        firstEmiDate: new Date(Date.now() - 31536000000).toISOString(), 
                        emiOverride: 0,
                        charges: []
                    },
                    {
                        id: 'loan_suv',
                        name: "SUV Auto Finance",
                        lender: "HDFC",
                        principal: 1500000,
                        roi: 9.2,
                        tenure: 84,
                        firstEmiDate: new Date(Date.now() - 15768000000).toISOString(), 
                        emiOverride: 0,
                        charges: []
                    }
                ]
            }
        };
        db.activePortfolio = pid;
        save();
    };

    // Self-initialize smoothly
    if (!localStorage.getItem(DB_KEY)) {
        loadDemoData();
    } else {
        load();
    }

    return {
        getAllPortfolios: () => Object.values(db.portfolios || {}),
        getPortfolio: (id) => db.portfolios[id],
        getActivePortfolio: () => db.portfolios[db.activePortfolio] || Object.values(db.portfolios)[0],
        setActivePortfolio: (id) => { db.activePortfolio = id; save(); },
        createPortfolio: (name) => {
            const id = 'portfolio_' + Date.now();
            db.portfolios[id] = { id, name, loans: [] };
            db.activePortfolio = id;
            save();
            return id;
        },
        deletePortfolio: (id) => {
            delete db.portfolios[id];
            const remaining = Object.keys(db.portfolios);
            db.activePortfolio = remaining.length > 0 ? remaining[0] : null;
            save();
        },
        addLoanToActive: (loan) => {
            const active = db.portfolios[db.activePortfolio];
            if (active) {
                if (!active.loans) active.loans = [];
                active.loans.push(loan);
                save();
            }
        },
        wipeAll: () => {
            localStorage.removeItem(DB_KEY);
            loadDemoData();
        },
        loadDemoData,
        formatINR: (num) => {
            return new Intl.NumberFormat('en-IN', { 
                style: 'currency', 
                currency: 'INR', 
                maximumFractionDigits: 0 
            }).format(num || 0);
        }
    };
})();
