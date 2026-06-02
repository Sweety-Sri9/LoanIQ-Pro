'use strict';

const LoanCalculator = (() => {

  // ── Core Math ──────────────────────────────────────────────────────────────
  function calculateEMI(principal, annualRate, tenureMonths) {
    if (!principal || principal <= 0 || !tenureMonths || tenureMonths <= 0) return 0;
    if (!annualRate || annualRate === 0) return principal / tenureMonths;
    const r = annualRate / 12 / 100;
    const factor = Math.pow(1 + r, tenureMonths);
    return (principal * r * factor) / (factor - 1);
  }

  function calculateRemainingTenure(outstanding, annualRate, emi) {
    if (!outstanding || outstanding <= 0) return 0;
    if (!annualRate || annualRate === 0) return Math.ceil(outstanding / emi);
    const r = annualRate / 12 / 100;
    if (emi <= outstanding * r + 0.01) return 600;
    return Math.ceil(Math.log(emi / (emi - outstanding * r)) / Math.log(1 + r));
  }

  function addMonths(date, months) {
    const d = new Date(date);
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    if (d.getDate() < day) d.setDate(0);
    return d;
  }

  function normalizeDate(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function daysBetween(d1, d2) {
    return Math.round(Math.abs(new Date(d2) - new Date(d1)) / (1000 * 60 * 60 * 24));
  }

  // ── Pre-EMI Interest ───────────────────────────────────────────────────────
  function calculatePreEmiInterest(loan) {
    const startDate = normalizeDate(loan.sanctionDate);
    const firstEmiDate = normalizeDate(loan.firstEmiDate);
    const brokenPeriodEnd = normalizeDate(addMonths(firstEmiDate, -1));

    if (brokenPeriodEnd <= startDate) return 0;

    const diffDays = daysBetween(startDate, brokenPeriodEnd);
    const principal = parseFloat(loan.principal);
    const roi = parseFloat(loan.roi);
    const dailyRate = roi / 365 / 100;

    return principal * dailyRate * diffDays;
  }

  // ── Main Amortization Engine ───────────────────────────────────────────────
  // Generates complete amortization schedule handling all events:
  // - ROI changes
  // - Part payments
  // - Top-ups
  // Historical entries are preserved; future entries recalculate from event date
  function generateSchedule(loan, options) {
    options = options || {};
    const extraSimPayments = options.extraSimPayments || [];
    const simPartPayments = options.simPartPayments || []; // [{loanId, amount, date, mode}]

    let outstanding = parseFloat(loan.principal);
    let currentRoi = parseFloat(loan.roi);
    let remainingTenure = parseInt(loan.tenure);
    let emi = parseFloat(loan.emiOverride || 0) || calculateEMI(outstanding, currentRoi, remainingTenure);
    const prepayOption = loan.prepayOption || 'reduce_tenure';

    // Build events list
    const events = [];

    (loan.roiChanges || []).forEach(function(r) {
      events.push({
        type: 'roi',
        date: normalizeDate(r.date),
        newRoi: parseFloat(r.newRoi),
        roiOption: r.roiOption || r.option || 'keep_emi',
        id: r.id,
        label: 'ROI → ' + r.newRoi + '%'
      });
    });

    (loan.partialPayments || []).forEach(function(p) {
      events.push({
        type: 'payment',
        date: normalizeDate(p.date),
        amount: parseFloat(p.amount),
        charges: parseFloat(p.charges || 0),
        mode: p.mode || prepayOption,
        id: p.id,
        label: 'Prepayment ₹' + formatNumber(p.amount)
      });
    });

    (loan.topUps || []).forEach(function(t) {
      events.push({
        type: 'topup',
        date: normalizeDate(t.date),
        amount: parseFloat(t.amount),
        charges: parseFloat(t.charges || 0),
        newEmi: parseFloat(t.newEmi || 0),
        newTenure: parseInt(t.newTenure || 0),
        id: t.id,
        label: 'Top-up ₹' + formatNumber(t.amount)
      });
    });

    extraSimPayments.forEach(function(p, idx) {
      events.push({
        type: 'payment',
        date: normalizeDate(p.date),
        amount: parseFloat(p.amount),
        charges: parseFloat(p.charges || 0),
        mode: p.mode || prepayOption,
        id: 'sim_' + idx,
        simulated: true,
        label: 'Sim ₹' + formatNumber(p.amount)
      });
    });

    simPartPayments.forEach(function(p, idx) {
      if (p.loanId === loan.id) {
        events.push({
          type: 'payment',
          date: normalizeDate(p.date),
          amount: parseFloat(p.amount),
          charges: 0,
          mode: p.mode || prepayOption,
          id: 'simpp_' + idx,
          simulated: true,
          label: 'Sim PP ₹' + formatNumber(p.amount)
        });
      }
    });

    events.sort(function(a, b) { return a.date - b.date; });

    const schedule = [];
    let emiDate = normalizeDate(loan.firstEmiDate);
    let prevDate = normalizeDate(loan.sanctionDate);
    let month = 0;
    const processedIds = new Set();

    while (outstanding > 0.5 && month < 600) {
      month++;

      // Collect events for this period
      const monthEvents = events.filter(function(e) {
        const isAfterPrev = month === 1 ? (e.date >= prevDate) : (e.date > prevDate);
        return isAfterPrev && e.date <= emiDate && !processedIds.has(e.id);
      });

      // Apply events in chronological order
      for (let i = 0; i < monthEvents.length; i++) {
        const event = monthEvents[i];
        processedIds.add(event.id);

        if (event.type === 'payment') {
          outstanding = Math.max(0, outstanding - event.amount);
          if (outstanding < 0.5) break;
          const mode = event.mode || prepayOption;
          if (mode === 'reduce_emi') {
            const rem = Math.max(1, remainingTenure - (month - 1));
            emi = calculateEMI(outstanding, currentRoi, rem);
          } else {
            // reduce_tenure: keep EMI, recalculate remaining tenure
            const newT = calculateRemainingTenure(outstanding, currentRoi, emi);
            remainingTenure = (month - 1) + Math.max(1, newT);
          }
        } else if (event.type === 'roi') {
          currentRoi = event.newRoi;
          const rem = Math.max(1, remainingTenure - (month - 1));
          if (event.roiOption === 'keep_emi') {
            const newT = calculateRemainingTenure(outstanding, currentRoi, emi);
            remainingTenure = (month - 1) + Math.max(1, newT);
          } else {
            // recalculate_emi: keep tenure, recalculate EMI
            emi = calculateEMI(outstanding, currentRoi, rem);
          }
        } else if (event.type === 'topup') {
          outstanding += event.amount;
          const rem = Math.max(1, remainingTenure - (month - 1));
          if (event.newTenure > 0) {
            remainingTenure = (month - 1) + event.newTenure;
            emi = event.newEmi || calculateEMI(outstanding, currentRoi, event.newTenure);
          } else {
            emi = event.newEmi || calculateEMI(outstanding, currentRoi, rem);
          }
        }
      }

      if (outstanding < 0.5) break;

      const r = currentRoi / 12 / 100;
      const interest = outstanding * r;
      const principalComp = Math.min(Math.max(0, emi - interest), outstanding);
      const actualEmi = interest + principalComp;
      const closingBalance = Math.max(0, outstanding - principalComp);

      schedule.push({
        month: month,
        date: new Date(emiDate),
        openingBalance: outstanding,
        emi: actualEmi,
        interest: interest,
        principal: principalComp,
        outstanding: closingBalance,
        roi: currentRoi,
        events: monthEvents
      });

      outstanding = closingBalance;
      prevDate = new Date(emiDate);
      emiDate = addMonths(emiDate, 1);
    }

    return schedule;
  }

  // ── Current Status ─────────────────────────────────────────────────────────
  function getCurrentStatus(loan) {
    const today = normalizeDate(new Date());
    const schedule = generateSchedule(loan);
    const preEmiInterest = calculatePreEmiInterest(loan);
    const brokenPeriodEnd = normalizeDate(addMonths(normalizeDate(loan.firstEmiDate), -1));
    const preEmiPaid = today >= brokenPeriodEnd ? preEmiInterest : 0;
    const preEmiRemaining = today < brokenPeriodEnd ? preEmiInterest : 0;

    let paidEMIs = 0;
    let interestPaid = 0;
    let principalPaid = 0;
    let outstandingToday = parseFloat(loan.principal);

    for (let i = 0; i < schedule.length; i++) {
      const entry = schedule[i];
      if (normalizeDate(entry.date) <= today) {
        paidEMIs++;
        interestPaid += entry.interest;
        principalPaid += entry.principal;
        outstandingToday = entry.outstanding;
      } else {
        break;
      }
    }

    // If no EMIs paid yet, outstanding = principal
    if (paidEMIs === 0) {
      outstandingToday = parseFloat(loan.principal);
    }

    // Adjust outstanding for part payments applied between last EMI date and today
    // (These are part payments that have occurred but are not yet reflected in the EMI schedule
    //  because the next EMI date is still in the future)
    const lastEmiDate = paidEMIs > 0 ? normalizeDate(schedule[paidEMIs - 1].date) : normalizeDate(loan.sanctionDate);
    (loan.partialPayments || []).forEach(function(p) {
      const payDate = normalizeDate(p.date);
      if (payDate > lastEmiDate && payDate <= today) {
        outstandingToday = Math.max(0, outstandingToday - parseFloat(p.amount || 0));
      }
    });

    const futureSchedule = schedule.filter(function(e) { return normalizeDate(e.date) > today; });
    const remainingInterest = preEmiRemaining + futureSchedule.reduce(function(s, e) { return s + e.interest; }, 0);
    const remainingTenure = futureSchedule.length;
    const totalInterest = preEmiInterest + schedule.reduce(function(s, e) { return s + e.interest; }, 0);
    const totalInterestPaid = preEmiPaid + interestPaid;

    // Total disbursed to date (principal + top-ups that have occurred)
    const totalDisbursed = parseFloat(loan.principal) + (loan.topUps || []).reduce(function(s, t) {
      if (normalizeDate(t.date) <= today) return s + parseFloat(t.amount || 0);
      return s;
    }, 0);

    // Total part payments made
    const totalPrepaid = (loan.partialPayments || []).reduce(function(s, p) {
      return s + parseFloat(p.amount || 0);
    }, 0);

    // Total charges
    const charges = getTotalCharges(loan);

    // Current EMI — 0 if loan is fully closed (no future installments), otherwise first future EMI
    const currentEmi = futureSchedule.length > 0 ? futureSchedule[0].emi : 0;

    // Current ROI
    const currentRoi = futureSchedule.length > 0 ? futureSchedule[0].roi :
                       (schedule.length > 0 ? schedule[schedule.length - 1].roi : parseFloat(loan.roi));

    // Closure date
    const closureDate = futureSchedule.length > 0 ? futureSchedule[futureSchedule.length - 1].date : null;

    // Interest saved vs baseline (no prepayments)
    let interestSaved = 0;
    if ((loan.partialPayments || []).length > 0) {
      const baselineLoan = Object.assign({}, loan, { partialPayments: [] });
      const baselineSchedule = generateSchedule(baselineLoan);
      const baselineTotalInterest = preEmiInterest + baselineSchedule.reduce(function(s, e) { return s + e.interest; }, 0);
      interestSaved = Math.max(0, baselineTotalInterest - totalInterest);
    }

    return {
      outstandingPrincipal: outstandingToday,
      remainingInterest: remainingInterest,
      remainingTenure: remainingTenure,
      paidEMIs: paidEMIs,
      totalInterestPaid: totalInterestPaid,
      totalPrincipalPaid: Math.max(0, totalDisbursed - outstandingToday),
      totalDisbursed: totalDisbursed,
      totalInterest: totalInterest,
      preEmiInterest: preEmiInterest,
      totalCost: totalDisbursed + totalInterest,
      totalPrepaid: totalPrepaid,
      totalCharges: charges.total + preEmiInterest,
      chargesBreakdown: charges,
      currentEmi: currentEmi,
      currentRoi: currentRoi,
      closureDate: closureDate,
      interestSaved: interestSaved,
      schedule: schedule
    };
  }

  // ── Charges ────────────────────────────────────────────────────────────────
  function getTotalCharges(loan) {
    const charges = loan.charges || [];
    const byType = {};
    let total = 0;

    charges.forEach(function(c) {
      const amt = parseFloat(c.amount || 0);
      total += amt;
      if (!byType[c.type]) byType[c.type] = 0;
      byType[c.type] += amt;
    });

    // Also include charges from part payments and top-ups
    (loan.partialPayments || []).forEach(function(p) {
      const amt = parseFloat(p.charges || 0);
      if (amt > 0) {
        total += amt;
        byType['prepayment'] = (byType['prepayment'] || 0) + amt;
      }
    });

    (loan.topUps || []).forEach(function(t) {
      const amt = parseFloat(t.charges || 0);
      if (amt > 0) {
        total += amt;
        byType['processing_fee'] = (byType['processing_fee'] || 0) + amt;
      }
    });

    return { total: total, byType: byType };
  }

  // ── Portfolio Summary ──────────────────────────────────────────────────────
  function getPortfolioSummary(loans) {
    const statuses = loans.map(function(loan) {
      return { loan: loan, status: getCurrentStatus(loan) };
    });

    const totalSanctioned = statuses.reduce(function(s, x) {
      const topUps = (x.loan.topUps || []).reduce(function(sum, t) { return sum + parseFloat(t.amount || 0); }, 0);
      return s + parseFloat(x.loan.principal) + topUps;
    }, 0);

    const totalEmi = statuses.reduce(function(s, x) { return s + x.status.currentEmi; }, 0);

    const weightedRoi = statuses.length > 0 ?
      statuses.reduce(function(s, x) { return s + x.status.currentRoi * x.status.outstandingPrincipal; }, 0) /
      Math.max(1, statuses.reduce(function(s, x) { return s + x.status.outstandingPrincipal; }, 0)) : 0;

    return {
      totalOutstanding: statuses.reduce(function(s, x) { return s + x.status.outstandingPrincipal; }, 0),
      totalRemainingInterest: statuses.reduce(function(s, x) { return s + x.status.remainingInterest; }, 0),
      totalInterest: statuses.reduce(function(s, x) { return s + x.status.totalInterest; }, 0),
      maxTenure: Math.max.apply(null, statuses.map(function(x) { return x.status.remainingTenure; }).concat([0])),
      totalPrepaid: statuses.reduce(function(s, x) { return s + x.status.totalPrepaid; }, 0),
      totalCharges: statuses.reduce(function(s, x) { return s + x.status.totalCharges; }, 0),
      totalInterestPaid: statuses.reduce(function(s, x) { return s + x.status.totalInterestPaid; }, 0),
      totalPrincipalPaid: statuses.reduce(function(s, x) { return s + x.status.totalPrincipalPaid; }, 0),
      totalSanctioned: totalSanctioned,
      totalEmi: totalEmi,
      weightedRoi: weightedRoi,
      loanCount: loans.length,
      statuses: statuses
    };
  }

  // ── Simulation Engine ──────────────────────────────────────────────────────
  // Simulates part-payment impact on a single loan
  function simulatePartPayment(loan, partPaymentAmount, partPaymentDate, mode) {
    const today = normalizeDate(new Date());
    const payDate = normalizeDate(partPaymentDate || new Date());
    mode = mode || loan.prepayOption || 'reduce_tenure';

    // Current status (before)
    const before = getCurrentStatus(loan);

    // Simulate with part payment
    const simLoan = Object.assign({}, loan);
    simLoan.partialPayments = (loan.partialPayments || []).concat([{
      id: 'sim_pp',
      date: payDate.toISOString().split('T')[0],
      amount: partPaymentAmount,
      charges: 0,
      mode: mode
    }]);

    const afterStatus = getCurrentStatus(simLoan);
    const afterSchedule = afterStatus.schedule;
    const futureAfter = afterSchedule.filter(function(e) { return normalizeDate(e.date) > today; });

    const interestSaved = Math.max(0, before.remainingInterest - afterStatus.remainingInterest);
    const tenureReduced = Math.max(0, before.remainingTenure - afterStatus.remainingTenure);
    const newClosureDate = futureAfter.length > 0 ? futureAfter[futureAfter.length - 1].date : null;

    return {
      before: {
        outstanding: before.outstandingPrincipal,
        remainingInterest: before.remainingInterest,
        remainingTenure: before.remainingTenure,
        emi: before.currentEmi,
        closureDate: before.closureDate
      },
      after: {
        outstanding: afterStatus.outstandingPrincipal,
        remainingInterest: afterStatus.remainingInterest,
        remainingTenure: afterStatus.remainingTenure,
        emi: afterStatus.currentEmi,
        closureDate: newClosureDate
      },
      interestSaved: interestSaved,
      tenureReduced: tenureReduced,
      newEmi: afterStatus.currentEmi,
      schedule: afterSchedule
    };
  }

  // Simulates part-payment across multiple loans with a given strategy
  function simulateMultiLoan(loans, totalAmount, paymentDate, strategy, customAllocations) {
    const today = normalizeDate(new Date());
    const payDate = normalizeDate(paymentDate || new Date());

    // Get current statuses
    const statuses = loans.map(function(loan) {
      return { loan: loan, status: getCurrentStatus(loan) };
    });

    // Determine allocation based on strategy
    let allocations = {};

    if (strategy === 'highest_roi') {
      // Allocate to highest ROI loan first
      const sorted = statuses.slice().sort(function(a, b) {
        return b.status.currentRoi - a.status.currentRoi;
      });
      let remaining = totalAmount;
      sorted.forEach(function(item) {
        if (remaining <= 0) return;
        const alloc = Math.min(remaining, item.status.outstandingPrincipal);
        allocations[item.loan.id] = alloc;
        remaining -= alloc;
      });
    } else if (strategy === 'highest_outstanding') {
      // Proportional to outstanding
      const totalOutstanding = statuses.reduce(function(s, x) { return s + x.status.outstandingPrincipal; }, 0);
      statuses.forEach(function(item) {
        allocations[item.loan.id] = totalAmount * (item.status.outstandingPrincipal / Math.max(1, totalOutstanding));
      });
    } else if (strategy === 'equal_split') {
      // Equal split
      const perLoan = totalAmount / loans.length;
      statuses.forEach(function(item) {
        allocations[item.loan.id] = perLoan;
      });
    } else if (strategy === 'max_interest_saving') {
      // Allocate to maximize interest savings
      allocations = getOptimalAllocation(statuses, totalAmount, payDate);
    } else if (strategy === 'custom_split') {
      // Use user-provided custom allocations
      statuses.forEach(function(item) {
        allocations[item.loan.id] = customAllocations ? parseFloat(customAllocations[item.loan.id] || 0) : 0;
      });
    } else {
      // Custom / manual — use provided allocations or equal split
      statuses.forEach(function(item) {
        allocations[item.loan.id] = totalAmount / loans.length;
      });
    }

    // Calculate impact for each loan
    const loanResults = statuses.map(function(item) {
      const alloc = allocations[item.loan.id] || 0;

      // For "before" calculation, use the loan WITHOUT emiOverride so we show the original EMI
      const loanForBefore = (item.loan.emiOverride > 0)
        ? Object.assign({}, item.loan, { emiOverride: 0 })
        : item.loan;
      const beforeStatus = getCurrentStatus(loanForBefore);
      const beforeSnapshot = {
        outstanding: beforeStatus.outstandingPrincipal,
        remainingInterest: beforeStatus.remainingInterest,
        remainingTenure: beforeStatus.remainingTenure,
        emi: beforeStatus.currentEmi,
        closureDate: beforeStatus.closureDate
      };

      // For "after" calculation: use the loan WITHOUT emiOverride globally,
      // but inject a topUp event at the proposed date to change the EMI from that date forward.
      // This ensures the new EMI is applied only from the proposed date, not from the loan start.
      // If emiDuration > 0, also inject a revert event after the duration to restore the original EMI.
      const loanForAfter = Object.assign({}, item.loan, { emiOverride: 0 });
      if (item.loan.emiOverride > 0) {
        const emiChangeTopUps = [{
          id: 'sim_emi_change_' + item.loan.id,
          date: payDate.toISOString().split('T')[0],
          amount: 0,
          charges: 0,
          newEmi: item.loan.emiOverride,
          newTenure: 0,
          note: 'EMI change via simulation'
        }];

        // If duration is specified, add a revert event after the duration
        if (item.loan.emiDuration > 0) {
          const revertDate = addMonths(payDate, item.loan.emiDuration);
          emiChangeTopUps.push({
            id: 'sim_emi_revert_' + item.loan.id,
            date: revertDate.toISOString().split('T')[0],
            amount: 0,
            charges: 0,
            newEmi: beforeSnapshot.emi, // Revert to original EMI
            newTenure: 0,
            note: 'EMI revert after ' + item.loan.emiDuration + ' months'
          });
        }

        loanForAfter.topUps = (item.loan.topUps || []).concat(emiChangeTopUps);
      }

      if (alloc <= 0) {
        // Even with no part payment, apply the EMI change if specified
        if (item.loan.emiOverride > 0) {
          const simResult0 = simulatePartPayment(loanForAfter, 0, payDate, loanForAfter.prepayOption);
          const interestSaved0 = Math.max(0, beforeSnapshot.remainingInterest - simResult0.after.remainingInterest);
          const tenureReduced0 = Math.max(0, beforeSnapshot.remainingTenure - simResult0.after.remainingTenure);
          return {
            loan: item.loan,
            allocation: 0,
            before: beforeSnapshot,
            after: simResult0.after,
            interestSaved: interestSaved0,
            tenureReduced: tenureReduced0
          };
        }
        return {
          loan: item.loan,
          allocation: 0,
          before: beforeSnapshot,
          after: {
            outstanding: beforeSnapshot.outstanding,
            remainingInterest: beforeSnapshot.remainingInterest,
            remainingTenure: beforeSnapshot.remainingTenure,
            emi: beforeSnapshot.emi,
            closureDate: beforeSnapshot.closureDate
          },
          interestSaved: 0,
          tenureReduced: 0
        };
      }

      const simResult = simulatePartPayment(loanForAfter, alloc, payDate, loanForAfter.prepayOption);
      const interestSaved = Math.max(0, beforeSnapshot.remainingInterest - simResult.after.remainingInterest);
      const tenureReduced = Math.max(0, beforeSnapshot.remainingTenure - simResult.after.remainingTenure);
      return {
        loan: item.loan,
        allocation: alloc,
        before: beforeSnapshot,
        after: simResult.after,
        interestSaved: interestSaved,
        tenureReduced: tenureReduced
      };
    });

    // Portfolio-level impact
    const totalInterestSaved = loanResults.reduce(function(s, r) { return s + r.interestSaved; }, 0);
    const maxTenureReduced = Math.max.apply(null, loanResults.map(function(r) { return r.tenureReduced; }).concat([0]));
    const beforeOutstanding = statuses.reduce(function(s, x) { return s + x.status.outstandingPrincipal; }, 0);
    const totalPartPayment = loanResults.reduce(function(s, r) { return s + r.allocation; }, 0);
    const afterOutstanding = Math.max(0, beforeOutstanding - totalPartPayment);
    const beforeInterest = statuses.reduce(function(s, x) { return s + x.status.remainingInterest; }, 0);
    const afterInterest = loanResults.reduce(function(s, r) { return s + r.after.remainingInterest; }, 0);

    return {
      strategy: strategy,
      totalAmount: totalAmount,
      allocations: allocations,
      loanResults: loanResults,
      portfolio: {
        beforeOutstanding: beforeOutstanding,
        afterOutstanding: afterOutstanding,
        beforeInterest: beforeInterest,
        afterInterest: afterInterest,
        totalInterestSaved: totalInterestSaved,
        maxTenureReduced: maxTenureReduced,
        outstandingReduced: beforeOutstanding - afterOutstanding
      }
    };
  }

  // Find optimal allocation to maximize interest savings
  function getOptimalAllocation(statuses, totalAmount, payDate) {
    const allocations = {};

    // Calculate marginal interest savings per rupee for each loan
    const marginalSavings = statuses.map(function(item) {
      const testAmount = Math.min(100000, item.status.outstandingPrincipal * 0.1, totalAmount);
      if (testAmount <= 0) return { id: item.loan.id, savingsPerRupee: 0 };

      const simResult = simulatePartPayment(item.loan, testAmount, payDate, 'reduce_tenure');
      const savingsPerRupee = simResult.interestSaved / testAmount;
      return { id: item.loan.id, savingsPerRupee: savingsPerRupee, outstanding: item.status.outstandingPrincipal };
    });

    // Sort by savings per rupee (descending)
    marginalSavings.sort(function(a, b) { return b.savingsPerRupee - a.savingsPerRupee; });

    // Allocate greedily
    let remaining = totalAmount;
    marginalSavings.forEach(function(item) {
      if (remaining <= 0) {
        allocations[item.id] = 0;
        return;
      }
      const alloc = Math.min(remaining, item.outstanding);
      allocations[item.id] = alloc;
      remaining -= alloc;
    });

    return allocations;
  }

  // ── Smart Recommendations ──────────────────────────────────────────────────
  function getSmartRecommendations(loans, totalAmount, paymentDate) {
    const today = normalizeDate(new Date());
    const payDate = normalizeDate(paymentDate || new Date());

    const statuses = loans.map(function(loan) {
      const status = getCurrentStatus(loan);
      return { loan: loan, status: status };
    });

    // Score each loan for prepayment priority
    const scored = statuses.map(function(item) {
      const s = item.status;
      const loan = item.loan;

      // Factors:
      // 1. ROI (higher = more expensive)
      const roiScore = s.currentRoi / 30; // normalize to 0-1

      // 2. Interest-to-principal ratio (higher = more interest burden)
      const interestRatio = s.remainingInterest / Math.max(1, s.outstandingPrincipal);
      const interestRatioScore = Math.min(1, interestRatio / 2);

      // 3. Remaining tenure (longer = more interest to save)
      const tenureScore = Math.min(1, s.remainingTenure / 360);

      // 4. Total future interest burden
      const interestBurdenScore = Math.min(1, s.remainingInterest / 5000000);

      // Composite score
      const score = (roiScore * 0.35) + (interestRatioScore * 0.30) + (tenureScore * 0.20) + (interestBurdenScore * 0.15);

      // Calculate interest saved if entire amount goes to this loan
      const simResult = simulatePartPayment(loan, Math.min(totalAmount, s.outstandingPrincipal), payDate, 'reduce_tenure');

      return {
        loan: loan,
        status: s,
        score: score,
        interestSavedIfFull: simResult.interestSaved,
        tenureReducedIfFull: simResult.tenureReduced,
        roiScore: roiScore,
        interestRatioScore: interestRatioScore
      };
    });

    // Sort by score
    scored.sort(function(a, b) { return b.score - a.score; });

    // Generate recommended allocation (weighted by score)
    const totalScore = scored.reduce(function(s, x) { return s + x.score; }, 0);
    const recommendations = scored.map(function(item) {
      const pct = totalScore > 0 ? (item.score / totalScore) : (1 / scored.length);
      const amount = totalAmount * pct;
      return {
        loan: item.loan,
        status: item.status,
        score: item.score,
        percentage: Math.round(pct * 100),
        recommendedAmount: Math.round(amount),
        interestSavedIfFull: item.interestSavedIfFull,
        tenureReducedIfFull: item.tenureReducedIfFull,
        reasons: generateReasons(item)
      };
    });

    // Normalize percentages to sum to 100
    const totalPct = recommendations.reduce(function(s, r) { return s + r.percentage; }, 0);
    if (totalPct !== 100 && recommendations.length > 0) {
      recommendations[0].percentage += (100 - totalPct);
    }

    return {
      recommendations: recommendations,
      topLoan: scored[0] ? scored[0].loan : null,
      strategies: [
        { id: 'max_interest_saving', name: 'Max Interest Saving', desc: 'Allocate to maximize total interest saved' },
        { id: 'highest_roi', name: 'Highest ROI First', desc: 'Pay off most expensive loan first (Avalanche)' },
        { id: 'highest_outstanding', name: 'Proportional Split', desc: 'Split proportional to outstanding balance' },
        { id: 'equal_split', name: 'Equal Split', desc: 'Divide equally across all selected loans' }
      ]
    };
  }

  function generateReasons(item) {
    const reasons = [];
    const s = item.status;

    if (s.currentRoi >= 10) {
      reasons.push('High interest rate (' + s.currentRoi.toFixed(2) + '% p.a.)');
    }
    if (s.remainingInterest > s.outstandingPrincipal * 0.5) {
      reasons.push('High interest burden (' + Math.round(s.remainingInterest / s.outstandingPrincipal * 100) + '% of outstanding)');
    }
    if (s.remainingTenure > 120) {
      reasons.push('Long remaining tenure (' + formatTenure(s.remainingTenure) + ')');
    }
    if (item.interestSavedIfFull > 100000) {
      reasons.push('Can save ' + formatCurrency(item.interestSavedIfFull) + ' in interest');
    }

    return reasons;
  }

  // ── Formatting ─────────────────────────────────────────────────────────────
  function formatNumber(num, decimals) {
    decimals = decimals === undefined ? 0 : decimals;
    if (isNaN(num) || num === null || num === undefined) return '0';
    return parseFloat(num).toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  function formatCurrency(num) {
    return '₹' + formatNumber(num, 0);
  }

  function formatCurrencyFull(num) {
    return '₹' + formatNumber(num, 0);
  }

  function formatTenure(months) {
    if (!months || months <= 0) return '0 mo';
    const y = Math.floor(months / 12);
    const m = months % 12;
    if (y === 0) return m + ' mo';
    if (m === 0) return y + ' yr';
    return y + 'y ' + m + 'm';
  }

  function formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatDateShort(date) {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getLoanTypeLabel(type) {
    const labels = {
      home: 'Home Loan', personal: 'Personal Loan', vehicle: 'Vehicle Loan',
      business: 'Business Loan', education: 'Education Loan', gold: 'Gold Loan', other: 'Loan'
    };
    return labels[type] || 'Loan';
  }

  function getChargeTypeLabel(type) {
    const labels = {
      processing_fee: 'Processing Fee', legal: 'Legal Charges',
      documentation: 'Documentation', insurance: 'Insurance',
      gst: 'GST/Tax', prepayment: 'Prepayment Penalty',
      foreclosure: 'Foreclosure', late_payment: 'Late Payment',
      bounce: 'Bounce Charges', penal_interest: 'Penal Interest',
      pre_emi: 'Pre-EMI Interest', other: 'Other Charge'
    };
    return labels[type] || type;
  }

  return {
    calculateEMI: calculateEMI,
    calculateRemainingTenure: calculateRemainingTenure,
    generateSchedule: generateSchedule,
    getCurrentStatus: getCurrentStatus,
    getTotalCharges: getTotalCharges,
    getPortfolioSummary: getPortfolioSummary,
    calculatePreEmiInterest: calculatePreEmiInterest,
    simulatePartPayment: simulatePartPayment,
    simulateMultiLoan: simulateMultiLoan,
    getSmartRecommendations: getSmartRecommendations,
    formatNumber: formatNumber,
    formatCurrency: formatCurrency,
    formatCurrencyFull: formatCurrencyFull,
    formatTenure: formatTenure,
    formatDate: formatDate,
    formatDateShort: formatDateShort,
    generateId: generateId,
    escapeHtml: escapeHtml,
    getLoanTypeLabel: getLoanTypeLabel,
    getChargeTypeLabel: getChargeTypeLabel,
    addMonths: addMonths,
    normalizeDate: normalizeDate,
    daysBetween: daysBetween
  };
})();
