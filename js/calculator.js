const CalcEngine = (() => {
    // Standard EMI formula
    const calculateEMI = (principal, annualRate, tenureMonths) => {
        if (principal <= 0 || tenureMonths <= 0) return 0;
        if (annualRate === 0) return principal / tenureMonths;
        const r = annualRate / 12 / 100;
        return (principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1);
    };

    // Calculate remaining tenure based on current outstanding and EMI
    const calculateRemainingTenure = (outstanding, annualRate, emi) => {
        if (outstanding <= 0) return 0;
        const r = annualRate / 12 / 100;
        if (emi <= outstanding * r) return Infinity; // EMI doesn't cover interest
        return Math.log(emi / (emi - outstanding * r)) / Math.log(1 + r);
    };

    const generateSchedule = (loan) => {
        let schedule = [];
        let outstanding = loan.principal;
        let currentRate = loan.roi;
        let currentEMI = loan.emiOverride > 0 ? loan.emiOverride : calculateEMI(outstanding, currentRate, loan.tenure);
        
        let date = new Date(loan.firstEmiDate);
        let totalInterest = 0;
        let totalPrincipal = 0;

        // Process up to max 600 months to prevent infinite loops on bad data
        for (let i = 1; i <= 600; i++) {
            if (outstanding <= 0) break;

            const r = currentRate / 12 / 100;
            let interest = outstanding * r;
            
            // Handle last EMI
            let principal = currentEMI - interest;
            if (outstanding < principal) {
                principal = outstanding;
                currentEMI = principal + interest;
            }

            outstanding -= principal;
            totalInterest += interest;
            totalPrincipal += principal;

            schedule.push({
                month: i,
                date: new Date(date).toISOString(),
                emi: currentEMI,
                principal: principal,
                interest: interest,
                outstanding: Math.max(0, outstanding)
            });

            // Advance month
            date.setMonth(date.getMonth() + 1);
        }
        
        return { schedule, totalInterest, totalPrincipal };
    };

    const getCurrentStatus = (loan) => {
        const { schedule, totalInterest } = generateSchedule(loan);
        const today = new Date();
        
        let paidEMIs = 0;
        let outstandingToday = loan.principal;
        let totalInterestPaid = 0;

        for (let row of schedule) {
            if (new Date(row.date) <= today) {
                paidEMIs++;
                outstandingToday = row.outstanding;
                totalInterestPaid += row.interest;
            } else {
                break;
            }
        }

        const isClosed = outstandingToday <= 0;
        const currentEmi = isClosed ? 0 : (schedule.length > 0 ? schedule[paidEMIs]?.emi || 0 : 0);
        const totalDisbursed = loan.principal;
        const totalPrincipalPaid = totalDisbursed - outstandingToday;

        return {
            outstandingToday,
            paidEMIs,
            totalInterestPaid,
            totalPrincipalPaid,
            totalDisbursed,
            futureInterest: totalInterest - totalInterestPaid,
            currentEmi,
            isClosed
        };
    };

    return { calculateEMI, calculateRemainingTenure, generateSchedule, getCurrentStatus };
})();
