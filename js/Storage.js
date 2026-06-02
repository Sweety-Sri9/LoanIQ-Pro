const Storage = (() => {
    const DB_KEY = 'loaniq_db';
    
    let db = {
        version: "3.0",
        activePortfolio: null,
        portfolios: {}
    };

    const load = () => {
        const data = localStorage.getItem(DB_KEY);
        if (data) db = JSON.parse(data);
    };

    const save = () => {
        localStorage.setItem(DB_KEY, JSON.stringify(db));
    };

    const loadDemoData = () => {
        const pid = 'portfolio_' + Date.now();
        db.portfolios[pid] = {
            id: pid,
            name: "Home & Business Workspace",
            loans: [
                {
                    id: 'loan_' + Date.now(),
                    name: "Primary Home Loan",
                    type: "home",
                    lender: "SBI",
                    principal: 4500000,
                    roi: 8.4,
                    tenure: 240,
                    firstEmiDate: new Date(new Date().setMonth(new Date().getMonth() - 12)).toISOString(), // 1 year ago
                    emiOverride: 0,
                    charges: []
                },
                {
                    id: 'loan_' + (Date.now() + 1),
                    name: "SUV Auto Finance",
                    type: "vehicle",
                    lender: "HDFC",
                    principal: 1500000,
                    roi: 9.2,
                    tenure: 84,
                    firstEmiDate: new Date(new Date().setMonth(new Date().getMonth() - 6)).toISOString(), // 6 months ago
                    emiOverride: 0,
                    charges: []
                }
            ]
        };
        db.activePortfolio = pid;
        save();
    };

    // Initialize DB
    load();
    if (Object.keys(db.portfolios).length === 0) {
        loadDemoData();
    }
    // ... keep the rest of your storage.js code the same above this line ...

    return {
        getAllPortfolios: () => Object.values(db.portfolios),
        getPortfolio: (id) => db.portfolios[id],
        getActivePortfolio: () => db.portfolios[db.activePortfolio],
        setActivePortfolio: (id) => { db.activePortfolio = id; save(); },
        createPortfolio: (name) => {
            const id = 'portfolio_' + Date.now();
            db.portfolios[id] = { id, name, loans: [] };
            db.activePortfolio = id;
            save();
            return id;
        },
        loadDemoData,
        formatINR: (num) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num)
    };
})();
    
    
})();
