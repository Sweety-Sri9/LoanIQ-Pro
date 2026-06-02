const CalcEngine = (() => {
    
    const calculateEMI = (principal, annualRate, tenureMonths) => {
        if (principal <= 0 || tenureMonths <= 0) return 0;
        if (annualRate === 0) return principal / tenureMonths;
        const r = annualRate / 12 / 100;
        return (principal * r * Math.pow(1 + r, tenureMonths)) / (Math.pow(1 + r, tenureMonths) - 1);
    };

    const addMonths = (dateStr, months) => {
        const d = new Date(dateStr);
        d.setMonth(d.getMonth() + months);
        return d.toISOString();
    };

    const generateSchedule = (loan) => {
        const timeline = [];
        
        timeline.push({
            date: new Date(loan.sanctionDate || loan.firstEmiDate).toISOString(),
            type: 'SANCTION'
        });

        const firstEmi = new Date(loan.firstEmiDate);
        for (let i = 0; i < (loan.tenure + 120); i++) {
            timeline.push({
                date: addMonths(firstEmi, i),
                type: 'EMI',
                sequence: i + 1
            });
        }

        if (loan.partialPayments) {
            loan.partialPayments.forEach(p => {
                timeline.push({ date: new Date(p.date).toISOString(), type: 'PART_PAYMENT', amount: parseFloat(p.amount) });
            });
        }
        if (loan.topUps) {
            loan.topUps.forEach(t => {
                timeline.push({ date: new Date(t.date).toISOString(), type: 'TOP_UP', amount: parseFloat(t.amount) });
            });
        }
        if (loan.roiChanges) {
            loan.roiChanges.forEach(r => {
                timeline.push({ date: new Date(r.date).toISOString(), type: 'ROI_CHANGE', rate: parseFloat(r.rate) });
            });
        }

        const typePriority = { 'SANCTION': 1, 'ROI_CHANGE': 2, 'TOP_UP': 3, 'PART_PAYMENT': 4, 'EMI': 5 };
        timeline.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (dateA !== dateB) return dateA - dateB;
            return typePriority[a.type] - typePriority[b.type];
        });

        let schedule = [];
        let outstanding = parseFloat(loan.principal);
        let currentRoi = parseFloat(loan.roi);
        let currentEmi = loan.emiOverride > 0 ? parseFloat(loan.emiOverride) : calculateEMI(outstanding, currentRoi, loan.tenure);
        
        let lastDate = new Date(timeline[0].date);
        let accumulatedInterestLedger = 0;
        let totalInterestPaid = 0;
        let totalPrincipalPaid = 0;
        let emiCount = 0;

        for (let event of timeline) {
            if (outstanding <= 0 && event.type !== 'SANCTION') continue;

            const currentDate = new Date(event.date);
            const timeDiff = currentDate.getTime() - lastDate.getTime();
            const daysElapsed = Math.max(0, Math.floor(timeDiff / (1000 * 60 * 60 * 24)));

            if (daysElapsed > 0 && outstanding > 0) {
                const dailyInterestRate = currentRoi / 365 / 100;
                const accruedInterestForPeriod = outstanding * dailyInterestRate * daysElapsed;
                accumulatedInterestLedger += accruedInterestForPeriod;
            }

            switch (event.type) {
                case 'EMI':
                    if (outstanding <= 0) break;
                    emiCount++;
                    
                    let interestComponent = accumulatedInterestLedger;
                    let principalComponent = currentEmi - interestComponent;

                    if (outstanding + interestComponent <= currentEmi) {
                        principalComponent = outstanding;
                        interestComponent = accumulatedInterestLedger;
                        outstanding = 0;
                        accumulatedInterestLedger = 0;
                    } else {
                        if (principalComponent < 0) {
                            principalComponent = 0;
                        }
                        outstanding -= principalComponent;
                        accumulatedInterestLedger = 0;
                    }

                    totalInterestPaid += interestComponent;
                    totalPrincipalPaid += principalComponent;

                    schedule.push({
                        type: 'EMI',
                        index: emiCount,
                        date: event.date,
                        emi: principalComponent + interestComponent,
                        principal: principalComponent,
                        interest: interestComponent,
                        outstanding: Math.round(outstanding * 100) / 100,
                        daysInPeriod: daysElapsed
                    });
                    break;

                case 'PART_PAYMENT':
                    const pAmount = Math.min(event.amount, outstanding);
                    outstanding -= pAmount;
                    totalPrincipalPaid += pAmount;

                    schedule.push({
                        type: 'PART_PAYMENT',
                        date: event.date,
                        emi: 0,
                        principal: pAmount,
                        interest: 0,
                        outstanding: Math.round(outstanding * 100) / 100,
                        label: 'Part Payment Injected'
                    });

                    if (loan.prepayOption === 'reduce_emi' && outstanding > 0) {
                        const estimatedRemainingMonths = Math.max(1, loan.tenure - emiCount);
                        currentEmi = calculateEMI(outstanding, currentRoi, estimatedRemainingMonths);
                    }
                    break;

                case 'TOP_UP':
                    outstanding += event.amount;
                    schedule.push({
                        type: 'TOP_UP',
                        date: event.date,
                        emi: 0,
                        principal: -event.amount, // Stored as negative principal impact
                        interest: 0,
                        outstanding: Math.round(outstanding * 100) / 100,
                        label: 'Top-Up Capital Disbursed'
                    });
                    
                    // Force immediate upward recalibration of the monthly EMI obligation
                    const remMonths = Math.max(1, loan.tenure - emiCount);
                    currentEmi = calculateEMI(outstanding, currentRoi, remMonths);
                    break;

                case 'ROI_CHANGE':
                    currentRoi = event.rate;
                    if (loan.prepayOption === 'reduce_emi' && outstanding > 0) {
                        const remMonthsROI = Math.max(1, loan.tenure - emiCount);
                        currentEmi = calculateEMI(outstanding, currentRoi, remMonthsROI);
                    }
                    break;
            }

            lastDate = currentDate;
        }

        return { schedule, totalInterest: totalInterestPaid, totalPrincipal: totalPrincipalPaid };
    };

    const getCurrentStatus = (loan) => {
        const { schedule, totalInterest } = generateSchedule(loan);
        const today = new Date();
        
        let outstandingToday = parseFloat(loan.principal);
        let paidEMIs = 0;
        let totalInterestPaid = 0;
        let totalPrincipalPaid = 0;
        let dynamicTotalDisbursed = parseFloat(loan.principal);

        for (let fracture of schedule) {
            // Update total volume scale if top-ups occurred historically up to today
            if (fracture.type === 'TOP_UP' && new Date(fracture.date) <= today) {
                dynamicTotalDisbursed += Math.abs(fracture.principal);
            }

            if (new Date(fracture.date) <= today) {
                outstandingToday = fracture.outstanding;
                if (fracture.type === 'EMI') {
                    paidEMIs++;
                    totalInterestPaid += fracture.interest;
                    totalPrincipalPaid += fracture.principal;
                } else if (fracture.type === 'PART_PAYMENT') {
                    totalPrincipalPaid += fracture.principal;
                }
            }
        }

        const isClosed = outstandingToday <= 0;
        const currentEmi = isClosed ? 0 : (schedule.find(f => new Date(f.date) > today && f.type === 'EMI')?.emi || 0);

        return {
            outstandingToday: Math.max(0, outstandingToday),
            paidEMIs,
            totalInterestPaid,
            totalPrincipalPaid,
            totalDisbursed: dynamicTotalDisbursed,
            futureInterest: Math.max(0, totalInterest - totalInterestPaid),
            currentEmi,
            isClosed
        };
    };

    return { calculateEMI, generateSchedule, getCurrentStatus };
})();
